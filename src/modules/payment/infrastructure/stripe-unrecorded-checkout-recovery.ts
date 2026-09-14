import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { InventoryReservations } from "@/modules/inventory/public";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import type { DatabaseClient, DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";

/** Stripe expires the session at the intent's expiry; give its verified expiry event time to settle first. */
export const UNRECORDED_CHECKOUT_RECOVERY_GRACE_MINUTES = 15;
export const UNRECORDED_CHECKOUT_RECOVERY_BATCH = 20;
export const MAX_CHECKOUT_SESSIONS_PER_LOOKUP = 1_000;
const SESSION_CREATION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const RELEASE_ACTION = "checkout.expired.provider_lookup";
const REVIEW_ACTION = "checkout.unrecorded_session.review_required";

export type ProviderCheckoutSession = Readonly<{ id: string; status: string | null; paymentStatus: string }>;

export interface StripeCheckoutSessionFinder {
  /** Checkout Sessions created within the window that carry this purchase reference. */
  findByPurchaseReference(purchaseIntentId: string, createdFrom: Date, createdTo: Date): Promise<readonly ProviderCheckoutSession[]>;
}

export class StripeCheckoutLookupLimitError extends Error {
  constructor() {
    super("Stripe checkout lookup exceeded its bounded session limit");
    this.name = "StripeCheckoutLookupLimitError";
  }
}

export class StripeCheckoutLookupResponseError extends Error {
  constructor() {
    super("Stripe checkout lookup returned a session from another mode");
    this.name = "StripeCheckoutLookupResponseError";
  }
}

type ListedCheckoutSession = Readonly<{
  id: string;
  client_reference_id: string | null;
  status: string | null;
  payment_status: string;
  livemode: boolean;
}>;

export type StripeCheckoutSessionList = (
  window: Readonly<{ createdFrom: number; createdTo: number }>,
) => AsyncIterable<ListedCheckoutSession>;

export class StripeSdkCheckoutSessionFinder implements StripeCheckoutSessionFinder {
  private readonly list: StripeCheckoutSessionList;

  constructor(private readonly config: StripeConfig, list?: StripeCheckoutSessionList) {
    this.list = list ?? sdkCheckoutSessionList(config);
  }

  async findByPurchaseReference(purchaseIntentId: string, createdFrom: Date, createdTo: Date): Promise<readonly ProviderCheckoutSession[]> {
    const expectedIdPrefix = this.config.mode === "test" ? "cs_test_" : "cs_live_";
    // Widen to whole seconds on both sides so a session created at a boundary is never missed.
    const window = {
      createdFrom: Math.floor(createdFrom.getTime() / 1000),
      createdTo: Math.floor(createdTo.getTime() / 1000) + 1,
    };
    const matches: ProviderCheckoutSession[] = [];
    let scanned = 0;
    for await (const session of this.list(window)) {
      scanned += 1;
      if (scanned > MAX_CHECKOUT_SESSIONS_PER_LOOKUP) throw new StripeCheckoutLookupLimitError();
      if (!session.id.startsWith(expectedIdPrefix) || session.livemode !== (this.config.mode === "live")) {
        throw new StripeCheckoutLookupResponseError();
      }
      if (session.client_reference_id === purchaseIntentId) {
        matches.push({ id: session.id, status: session.status, paymentStatus: session.payment_status });
      }
    }
    return matches;
  }
}

function sdkCheckoutSessionList(config: StripeConfig): StripeCheckoutSessionList {
  // Checkout Session read is an existing application-key permission; the event key stays limited to Events.
  const stripe = new Stripe(config.checkoutSecretKey, {
    appInfo: { name: "BloomBox", version: "0.1.0" },
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });
  return ({ createdFrom, createdTo }) => stripe.checkout.sessions.list(
    { created: { gte: createdFrom, lte: createdTo }, limit: 100 },
    { apiVersion: config.apiVersion },
  );
}

export type UnrecordedCheckoutDecision = "RELEASE" | "REVIEW";

/**
 * After the intent expires, no checkout URL can be obtained again and any session created for it has expired too.
 * Release only when Stripe has no session for the purchase or every one ended unpaid. Anything else, such as a
 * completed session whose ID was never saved, may mean the customer paid and must be reviewed, never released.
 */
export function decideUnrecordedCheckout(sessions: readonly ProviderCheckoutSession[]): UnrecordedCheckoutDecision {
  return sessions.every((session) => session.status === "expired" && session.paymentStatus === "unpaid") ? "RELEASE" : "REVIEW";
}

export type UnrecordedCheckoutRecoveryResult = Readonly<{ checked: number; released: number; heldForReview: number }>;

type SettlementOutcome = "RELEASED" | "REVIEW" | "SKIPPED";

/**
 * Settles Stripe-selected purchases that never recorded a Checkout Session ID, typically because the creation request
 * or its response was lost. A verified expiry event handles sessions that exist; this lookup covers the rest (ADR 0010).
 */
export class StripeUnrecordedCheckoutRecovery {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly sessions: StripeCheckoutSessionFinder,
    private readonly inventory: (transaction: DatabaseTransaction) => InventoryReservations,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async execute(): Promise<UnrecordedCheckoutRecoveryResult> {
    const startedAt = this.now();
    const expiredBefore = new Date(startedAt.getTime() - UNRECORDED_CHECKOUT_RECOVERY_GRACE_MINUTES * 60 * 1000);
    const candidates = await this.sql`
      SELECT intent.id, intent.created_at, intent.expires_at
      FROM bloombox.purchase_intents AS intent
      WHERE intent.status = 'READY_FOR_CHECKOUT'
        AND intent.commerce_provider = 'STRIPE'
        AND intent.external_checkout_id IS NULL
        AND intent.expires_at <= ${expiredBefore}
        AND NOT EXISTS (
          SELECT 1 FROM bloombox.audit_logs AS review
          WHERE review.resource_type = 'PurchaseIntent'
            AND review.resource_id = intent.id
            AND review.action = ${REVIEW_ACTION}
        )
      ORDER BY intent.expires_at, intent.id
      LIMIT ${UNRECORDED_CHECKOUT_RECOVERY_BATCH}
    `;

    let released = 0;
    let heldForReview = 0;
    for (const candidate of candidates) {
      const purchaseIntentId = String(candidate.id);
      const createdAt = new Date(candidate.created_at);
      // Stripe is queried outside any database transaction (ADR 0010).
      const found = await this.sessions.findByPurchaseReference(
        purchaseIntentId,
        new Date(createdAt.getTime() - SESSION_CREATION_CLOCK_SKEW_MS),
        new Date(candidate.expires_at),
      );
      const outcome = await this.settle(purchaseIntentId, decideUnrecordedCheckout(found), found.length, startedAt);
      if (outcome === "RELEASED") released += 1;
      if (outcome === "REVIEW") heldForReview += 1;
    }
    return { checked: candidates.length, released, heldForReview };
  }

  private async settle(
    purchaseIntentId: string,
    decision: UnrecordedCheckoutDecision,
    sessionsFound: number,
    occurredAt: Date,
  ): Promise<SettlementOutcome> {
    return this.sql.begin(async (transaction): Promise<SettlementOutcome> => {
      const rows = await transaction`
        SELECT intent.status, intent.commerce_provider, intent.external_checkout_id, item.catalog_product_id
        FROM bloombox.purchase_intents AS intent
        JOIN bloombox.purchase_intent_items AS item ON item.purchase_intent_id = intent.id AND item.position = 0
        WHERE intent.id = ${purchaseIntentId}
        FOR UPDATE OF intent
      `;
      const row = rows[0];
      // A verified event or a recorded session may have settled the purchase while Stripe was being queried.
      if (!row || row.status !== "READY_FOR_CHECKOUT" || row.commerce_provider !== "STRIPE" || row.external_checkout_id !== null) {
        return "SKIPPED";
      }
      if (decision === "REVIEW") {
        await this.audit(transaction, REVIEW_ACTION, purchaseIntentId, sessionsFound, occurredAt, `unrecorded-checkout-review:${purchaseIntentId}`);
        return "REVIEW";
      }
      if (String(row.catalog_product_id).startsWith("native_")) {
        await this.inventory(transaction).release(purchaseIntentId, "CHECKOUT_EXPIRED", occurredAt);
      }
      await transaction`
        UPDATE bloombox.purchase_intents
        SET status = 'EXPIRED', version = version + 1, updated_at = ${occurredAt}
        WHERE id = ${purchaseIntentId}
      `;
      await transaction`
        INSERT INTO bloombox.outbox_events (
          id, aggregate_type, aggregate_id, event_type, event_version, payload, occurred_at, available_at
        ) VALUES (
          ${this.createId()}, 'PurchaseIntent', ${purchaseIntentId}, 'checkout.purchase_intent.expired', 1,
          ${transaction.json({ purchaseIntentId, status: "EXPIRED" })}, ${occurredAt}, ${occurredAt}
        )
      `;
      await this.audit(transaction, RELEASE_ACTION, purchaseIntentId, sessionsFound, occurredAt, `unrecorded-checkout-release:${purchaseIntentId}`);
      return "RELEASED";
    });
  }

  private async audit(
    transaction: DatabaseTransaction,
    action: string,
    purchaseIntentId: string,
    sessionsFound: number,
    occurredAt: Date,
    idempotencyKey: string,
  ): Promise<void> {
    await transaction`
      INSERT INTO bloombox.audit_logs (
        id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at, idempotency_key
      ) VALUES (
        ${this.createId()}, 'SYSTEM', ${action}, 'PurchaseIntent', ${purchaseIntentId},
        ${transaction.json({ sessionsFound })}, ${occurredAt}, ${idempotencyKey}
      ) ON CONFLICT DO NOTHING
    `;
  }
}
