import { randomUUID } from "node:crypto";
import { money } from "@/shared/domain/money";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { z } from "zod";
import {
  catalogProductReference,
  commerceProductReference,
  PurchaseIntent,
  purchaseIntentId,
  type PurchaseIntentId,
} from "../domain/purchase-intent";
import { giftMessage, recipientName } from "../domain/purchase-intent-policy";
import type { PurchaseIntentRepository } from "../domain/purchase-intent-repository";
import {
  PurchaseIntentAlreadyExistsError,
  PurchaseIntentConcurrencyError,
} from "../domain/purchase-intent-repository";
import { PURCHASE_INTENT_STATUSES } from "../domain/purchase-intent-status";

const persistedIntentSchema = z.object({
  id: z.string().uuid(),
  display_id: z.string().min(1),
  status: z.enum(PURCHASE_INTENT_STATUSES),
  currency: z.literal("JPY"),
  subtotal_minor: z.union([z.string(), z.number(), z.bigint()]),
  delivery_date: z.string(),
  pii_key_id: z.string().min(1).nullable(),
  recipient_ciphertext: z.instanceof(Buffer).nullable(),
  gift_message_ciphertext: z.instanceof(Buffer).nullable(),
  created_at: z.union([z.string(), z.date()]),
  expires_at: z.union([z.string(), z.date()]),
  pii_retention_expires_at: z.union([z.string(), z.date()]),
  commerce_provider: z.enum(["SHOPIFY", "STRIPE"]).nullable(),
  external_checkout_id: z.string().nullable(),
  provider_api_version: z.string().nullable(),
  checkout_created_at: z.union([z.string(), z.date()]).nullable(),
  catalog_product_id: z.string().min(1),
  external_product_id: z.string().min(1),
  product_name_snapshot: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_amount_minor: z.union([z.string(), z.number(), z.bigint()]),
  item_subtotal_minor: z.union([z.string(), z.number(), z.bigint()]),
  item_currency: z.literal("JPY"),
});

const recipientPayloadSchema = z.object({ name: z.string().min(1) });

export class PurchaseIntentPersistenceError extends Error {
  constructor() {
    super("Purchase intent could not be persisted");
    this.name = "PurchaseIntentPersistenceError";
  }
}

export class PostgresPurchaseIntentRepository implements PurchaseIntentRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly protector: AesGcmDataProtector,
    private readonly createId: () => string = randomUUID,
  ) {}

  async save(intent: PurchaseIntent): Promise<void> {
    const recipient = this.protector.protect(
      JSON.stringify({ name: intent.recipient.name }),
      recipientContext(intent.id),
    );
    const giftMessagePayload = this.protector.protect(
      intent.giftMessage,
      giftMessageContext(intent.id),
    );
    if (recipient.keyId !== giftMessagePayload.keyId) throw new PurchaseIntentPersistenceError();

    try {
      await this.sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO bloombox.purchase_intents (
            id, display_id, status, currency, subtotal_minor, delivery_date,
            pii_key_id, recipient_ciphertext, gift_message_ciphertext,
            version, created_at, updated_at, expires_at, pii_retention_expires_at
          ) VALUES (
            ${intent.id}, ${intent.displayId}, ${intent.status}, ${intent.item.subtotal.currency},
            ${intent.item.subtotal.amount}, ${intent.recipient.deliveryDate}, ${recipient.keyId},
            ${recipient.ciphertext}, ${giftMessagePayload.ciphertext}, 1,
            ${intent.createdAt}, ${intent.createdAt}, ${intent.expiresAt},
            ${intent.piiRetentionExpiresAt}
          )
        `;
        await transaction`
          INSERT INTO bloombox.purchase_intent_items (
            id, purchase_intent_id, catalog_product_id, external_product_id, product_name_snapshot,
            quantity, unit_amount_minor, subtotal_minor, currency, position
          ) VALUES (
            ${this.createId()}, ${intent.id}, ${intent.item.productId},
            ${intent.item.externalProductReference}, ${intent.item.productName},
            ${intent.item.quantity}, ${intent.item.unitPriceSnapshot.amount},
            ${intent.item.subtotal.amount}, ${intent.item.subtotal.currency}, 0
          )
        `;
        await transaction`
          INSERT INTO bloombox.outbox_events (
            id, aggregate_type, aggregate_id, event_type, event_version,
            payload, occurred_at, available_at
          ) VALUES (
            ${this.createId()}, 'PurchaseIntent', ${intent.id},
            'checkout.purchase_intent.ready', 1,
            ${transaction.json({ purchaseIntentId: intent.id, status: intent.status })},
            ${intent.createdAt}, ${intent.createdAt}
          )
        `;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new PurchaseIntentAlreadyExistsError();
      throw new PurchaseIntentPersistenceError();
    }
  }

  async findById(id: PurchaseIntentId): Promise<PurchaseIntent | null> {
    const rows = await this.sql`
      SELECT
        intent.id,
        intent.display_id,
        intent.status,
        intent.currency,
        intent.subtotal_minor,
        intent.delivery_date::text,
        intent.pii_key_id,
        intent.recipient_ciphertext,
        intent.gift_message_ciphertext,
        intent.created_at,
        intent.expires_at,
        intent.pii_retention_expires_at,
        intent.commerce_provider,
        intent.external_checkout_id,
        intent.provider_api_version,
        intent.checkout_created_at,
        item.catalog_product_id,
        item.external_product_id,
        item.product_name_snapshot,
        item.quantity,
        item.unit_amount_minor,
        item.subtotal_minor AS item_subtotal_minor,
        item.currency AS item_currency
      FROM bloombox.purchase_intents AS intent
      JOIN bloombox.purchase_intent_items AS item
        ON item.purchase_intent_id = intent.id AND item.position = 0
      WHERE intent.id = ${id}
    `;
    if (rows.length === 0) return null;
    if (rows.length !== 1) throw new PurchaseIntentPersistenceError();

    const row = persistedIntentSchema.safeParse(rows[0]);
    if (!row.success) throw new PurchaseIntentPersistenceError();
    if (
      row.data.pii_key_id === null
      || row.data.recipient_ciphertext === null
      || row.data.gift_message_ciphertext === null
    ) {
      return null;
    }

    const recipientPayload = parseRecipientPayload(this.protector.unprotect(
      { keyId: row.data.pii_key_id, ciphertext: row.data.recipient_ciphertext },
      recipientContext(id),
    ));
    const restoredGiftMessage = this.protector.unprotect(
      { keyId: row.data.pii_key_id, ciphertext: row.data.gift_message_ciphertext },
      giftMessageContext(id),
    );

    return PurchaseIntent.restore({
      id: purchaseIntentId(row.data.id),
      displayId: row.data.display_id,
      status: row.data.status,
      item: {
        productId: catalogProductReference(row.data.catalog_product_id),
        externalProductReference: commerceProductReference(row.data.external_product_id),
        productName: row.data.product_name_snapshot,
        quantity: row.data.quantity,
        unitPriceSnapshot: money(toSafeInteger(row.data.unit_amount_minor)),
        subtotal: money(toSafeInteger(row.data.item_subtotal_minor)),
      },
      recipient: {
        name: recipientName(recipientPayload.name),
        deliveryDate: row.data.delivery_date,
      },
      giftMessage: giftMessage(restoredGiftMessage),
      createdAt: new Date(row.data.created_at),
      expiresAt: new Date(row.data.expires_at),
      piiRetentionExpiresAt: new Date(row.data.pii_retention_expires_at),
      commerceProvider: row.data.commerce_provider ?? undefined,
      externalCheckoutId: row.data.external_checkout_id ?? undefined,
      providerApiVersion: row.data.provider_api_version ?? undefined,
      checkoutCreatedAt: row.data.checkout_created_at
        ? new Date(row.data.checkout_created_at)
        : undefined,
    });
  }

  async saveCheckoutCreated(intent: PurchaseIntent): Promise<void> {
    if (
      intent.status !== "CHECKOUT_CREATED"
      || !intent.commerceProvider
      || !intent.externalCheckoutId
      || !intent.providerApiVersion
      || !intent.checkoutCreatedAt
    ) {
      throw new PurchaseIntentPersistenceError();
    }
    const commerceProvider = intent.commerceProvider;
    const externalCheckoutId = intent.externalCheckoutId;
    const providerApiVersion = intent.providerApiVersion;
    const checkoutCreatedAt = intent.checkoutCreatedAt;

    await this.sql.begin(async (transaction) => {
      const updated = await transaction`
        UPDATE bloombox.purchase_intents
        SET
          status = ${intent.status},
          commerce_provider = ${commerceProvider},
          external_checkout_id = ${externalCheckoutId},
          provider_api_version = ${providerApiVersion},
          checkout_created_at = ${checkoutCreatedAt},
          updated_at = ${checkoutCreatedAt},
          version = version + 1
        WHERE id = ${intent.id}
          AND status = 'READY_FOR_CHECKOUT'
          AND external_checkout_id IS NULL
        RETURNING id
      `;

      if (updated.length === 0) {
        const existing = await transaction`
          SELECT commerce_provider, external_checkout_id, provider_api_version
          FROM bloombox.purchase_intents
          WHERE id = ${intent.id}
        `;
        if (
          existing.length === 1
          && existing[0].commerce_provider === commerceProvider
          && existing[0].external_checkout_id === externalCheckoutId
          && existing[0].provider_api_version === providerApiVersion
        ) {
          return;
        }
        throw new PurchaseIntentConcurrencyError();
      }

      await transaction`
        INSERT INTO bloombox.outbox_events (
          id, aggregate_type, aggregate_id, event_type, event_version,
          payload, occurred_at, available_at
        ) VALUES (
          ${this.createId()}, 'PurchaseIntent', ${intent.id},
          'checkout.purchase_intent.checkout_created', 1,
          ${transaction.json({
            purchaseIntentId: intent.id,
            provider: commerceProvider,
            externalCheckoutId,
          })},
          ${checkoutCreatedAt}, ${checkoutCreatedAt}
        )
      `;
    });
  }
}

function recipientContext(id: PurchaseIntentId): string {
  return `purchase-intent:${id}:recipient:v1`;
}

function giftMessageContext(id: PurchaseIntentId): string {
  return `purchase-intent:${id}:gift-message:v1`;
}

function parseRecipientPayload(value: string): z.infer<typeof recipientPayloadSchema> {
  try {
    return recipientPayloadSchema.parse(JSON.parse(value));
  } catch {
    throw new PurchaseIntentPersistenceError();
  }
}

function toSafeInteger(value: string | number | bigint): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) throw new PurchaseIntentPersistenceError();
  return amount;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
