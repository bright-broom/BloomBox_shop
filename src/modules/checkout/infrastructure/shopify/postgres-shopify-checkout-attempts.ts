import { shopifyCartIdentityFromId } from "./shopify-cart-identity";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient, DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import type { PurchaseIntentId } from "../../domain/purchase-intent";
import {
  ShopifyCheckoutConflictError, ShopifyCheckoutPersistenceError,
  type ShopifyCartHandoff, type ShopifyCheckoutAttempt, type ShopifyCheckoutAttempts,
} from "../../application/shopify-checkout-attempt";

const rowSchema = z.object({
  attempt_id: z.uuid(), provider_scope: z.string().min(1), status: z.enum(["CREATING", "UNKNOWN", "READY"]),
  started_at: z.date(), credential_key_id: z.string().nullable(), credential_ciphertext: z.instanceof(Buffer).nullable(),
  api_version: z.string().nullable(),
});
const cartIdSchema = z.string().min(1).max(128_000).refine((value) => {
  try {
    const url = new URL(value);
    return value.startsWith("gid://shopify/Cart/") && !/\s/.test(value) && !url.hash
      && url.pathname.length > "/Cart/".length && url.searchParams.getAll("key").length === 1
      && Boolean(url.searchParams.get("key"));
  } catch { return false; }
});

export class PostgresShopifyCheckoutAttempts implements ShopifyCheckoutAttempts {
  constructor(private readonly sql: DatabaseClient, private readonly protector: AesGcmDataProtector) {}

  async claim(intentId: PurchaseIntentId, attemptId: string, scope: string, now: Date): Promise<{
    owned: boolean; attempt: ShopifyCheckoutAttempt;
  }> {
    try {
      z.uuid().parse(attemptId);
      z.string().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/).max(255).parse(scope);
      return await this.sql.begin(async (tx) => {
        // Same row lock as the legacy provider claim. No network calls inside this transaction.
        const intents = await tx`SELECT status, commerce_provider, expires_at FROM bloombox.purchase_intents
          WHERE id = ${intentId} FOR UPDATE`;
        const intent = intents[0];
        if (!intent || !["READY_FOR_CHECKOUT", "CHECKOUT_CREATED"].includes(intent.status)
          || (intent.commerce_provider && intent.commerce_provider !== "SHOPIFY")) throw new ShopifyCheckoutConflictError();
        const rows = await tx`SELECT * FROM bloombox.shopify_checkout_attempts WHERE purchase_intent_id = ${intentId}`;
        if (rows.length) {
          const row = rowSchema.parse(rows[0]);
          if (row.provider_scope !== scope || intent.commerce_provider !== "SHOPIFY") throw new ShopifyCheckoutConflictError();
          return { owned: false, attempt: this.restore(intentId, row) };
        }
        if (intent.status !== "READY_FOR_CHECKOUT" || intent.commerce_provider
          || new Date(intent.expires_at) <= now) throw new ShopifyCheckoutConflictError();
        await tx`UPDATE bloombox.purchase_intents SET commerce_provider = 'SHOPIFY', version = version + 1, updated_at = ${now}
          WHERE id = ${intentId}`;
        await tx`INSERT INTO bloombox.shopify_checkout_attempts
          (purchase_intent_id, attempt_id, provider_scope, status, started_at, updated_at)
          VALUES (${intentId}, ${attemptId}, ${scope}, 'CREATING', ${now}, ${now})`;
        await recordTransition(tx, intentId, attemptId, "CREATING", now);
        return { owned: true, attempt: { id: attemptId, startedAt: now, status: "CREATING" as const } };
      });
    } catch (error) { throw safePersistenceError(error); }
  }

  async markUnknown(intentId: PurchaseIntentId, attemptId: string, now: Date): Promise<void> {
    try {
      await this.sql.begin(async (tx) => {
        const rows = await tx`UPDATE bloombox.shopify_checkout_attempts SET status = 'UNKNOWN', updated_at = ${now}
          WHERE purchase_intent_id = ${intentId} AND attempt_id = ${attemptId} AND status = 'CREATING'
          RETURNING attempt_id`;
        if (rows.length) await recordTransition(tx, intentId, attemptId, "UNKNOWN", now);
        else {
          const existing = await tx`SELECT status FROM bloombox.shopify_checkout_attempts
            WHERE purchase_intent_id = ${intentId} AND attempt_id = ${attemptId}`;
          if (!existing.length) throw new ShopifyCheckoutConflictError();
          // A lost commit acknowledgment must never downgrade READY or duplicate its events.
        }
      });
    } catch (error) { throw safePersistenceError(error); }
  }

  async complete(intentId: PurchaseIntentId, attemptId: string, cart: ShopifyCartHandoff, now: Date): Promise<void> {
    try {
      if (cart.purchaseIntentId !== intentId) throw new ShopifyCheckoutConflictError();
      cartIdSchema.parse(cart.cartId);
      z.string().regex(/^\d{4}-\d{2}$/).parse(cart.apiVersion);
      await this.sql.begin(async (tx) => {
        const intents = await tx`SELECT status, commerce_provider FROM bloombox.purchase_intents WHERE id = ${intentId} FOR UPDATE`;
        if (intents[0]?.commerce_provider !== "SHOPIFY") throw new ShopifyCheckoutConflictError();
        const rows = await tx`SELECT * FROM bloombox.shopify_checkout_attempts
          WHERE purchase_intent_id = ${intentId} AND attempt_id = ${attemptId} FOR UPDATE`;
        if (!rows.length) throw new ShopifyCheckoutConflictError();
        const row = rowSchema.parse(rows[0]);
        if (row.status === "READY") {
          const existing = this.restore(intentId, row);
          if (existing.status !== "READY" || existing.cartId !== cart.cartId || existing.apiVersion !== cart.apiVersion) {
            throw new ShopifyCheckoutConflictError();
          }
          await tx`UPDATE bloombox.shopify_checkout_attempts SET cart_token_digest = ${shopifyCartIdentityFromId(existing.cartId)}
            WHERE purchase_intent_id = ${intentId} AND cart_token_digest IS NULL`;
          return;
        }
        if (intents[0].status !== "READY_FOR_CHECKOUT") throw new ShopifyCheckoutConflictError();
        const protectedCart = this.protector.protect(cart.cartId, credentialContext(intentId, row));
        await tx`UPDATE bloombox.shopify_checkout_attempts
          SET status = 'READY', credential_key_id = ${protectedCart.keyId}, credential_ciphertext = ${protectedCart.ciphertext},
            api_version = ${cart.apiVersion}, cart_token_digest = ${shopifyCartIdentityFromId(cart.cartId)}, updated_at = ${now}
          WHERE purchase_intent_id = ${intentId} AND attempt_id = ${attemptId}`;
        await tx`UPDATE bloombox.purchase_intents SET status = 'CHECKOUT_CREATED', provider_api_version = ${cart.apiVersion},
          checkout_created_at = ${now}, version = version + 1, updated_at = ${now} WHERE id = ${intentId}`;
        await recordTransition(tx, intentId, attemptId, "READY", now);
      });
    } catch (error) { throw safePersistenceError(error); }
  }

  private restore(intentId: PurchaseIntentId, row: z.infer<typeof rowSchema>): ShopifyCheckoutAttempt {
    const base = { id: row.attempt_id, startedAt: row.started_at };
    if (row.status !== "READY") return { ...base, status: row.status };
    if (!row.credential_key_id || !row.credential_ciphertext || !row.api_version) throw new ShopifyCheckoutPersistenceError();
    const cartId = cartIdSchema.parse(this.protector.unprotect({
      keyId: row.credential_key_id, ciphertext: row.credential_ciphertext,
    }, credentialContext(intentId, row)));
    return { ...base, status: "READY", cartId, apiVersion: row.api_version };
  }
}

function credentialContext(intentId: PurchaseIntentId, row: z.infer<typeof rowSchema>): string {
  return `shopify-cart:${intentId}:${row.attempt_id}:${row.provider_scope}:v1`;
}
function safePersistenceError(error: unknown): Error {
  return error instanceof ShopifyCheckoutConflictError ? error : new ShopifyCheckoutPersistenceError();
}
async function recordTransition(tx: DatabaseTransaction, intentId: PurchaseIntentId, attemptId: string, status: string, now: Date) {
  const eventType = `checkout.shopify_attempt.${status.toLowerCase()}`;
  const payload = { purchaseIntentId: intentId, attemptId, status, provider: "SHOPIFY" };
  await tx`INSERT INTO bloombox.outbox_events
    (id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at)
    VALUES (${randomUUID()}, 'PurchaseIntent', ${intentId}, ${eventType}, 1, ${tx.json(payload)}, ${now}, ${now})`;
  await tx`INSERT INTO bloombox.audit_logs
    (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
    VALUES (${randomUUID()}, 'SYSTEM', ${eventType}, 'PurchaseIntent', ${intentId}, ${tx.json(payload)}, ${now})`;
}
