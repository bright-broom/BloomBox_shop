import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import type { WebhookInbox } from "../application/receive-provider-webhook";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import type { StripeWebhookVerifier } from "./stripe-webhook-verifier";

export const INITIAL_RECONCILIATION_LOOKBACK_HOURS = 72;
export const RECONCILIATION_OVERLAP_MINUTES = 10;
export const MAX_RECONCILIATION_EVENTS = 1_000;

export type ReconciliationResult = Readonly<{
  checked: number;
  relevant: number;
  discovered: number;
}>;

export class StripeReconciliationLimitError extends Error {
  constructor() {
    super("Stripe reconciliation exceeded its bounded event limit");
    this.name = "StripeReconciliationLimitError";
  }
}

export interface StripeEventSource {
  list(since: Date): AsyncIterable<unknown>;
}

export class StripeSdkEventSource implements StripeEventSource {
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.reconciliationSecretKey, {
      appInfo: { name: "BloomBox", version: "0.1.0" },
      maxNetworkRetries: 2,
      timeout: 10_000,
      telemetry: false,
    });
  }

  list(since: Date): AsyncIterable<Stripe.Event> {
    return this.stripe.events.list({
      created: { gte: Math.floor(since.getTime() / 1000) },
      limit: 100,
    }, { apiVersion: this.config.apiVersion });
  }
}

export class StripeEventReconciler {
  private readonly eventSource: StripeEventSource;

  constructor(
    private readonly sql: DatabaseClient,
    private readonly verifier: StripeWebhookVerifier,
    private readonly inbox: WebhookInbox,
    config: StripeConfig,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    eventSource?: StripeEventSource,
  ) {
    this.eventSource = eventSource ?? new StripeSdkEventSource(config);
  }

  async execute(): Promise<ReconciliationResult> {
    const startedAt = this.now();
    const runId = this.createId();
    const since = await this.reconciliationStart(startedAt);
    await this.sql`
      INSERT INTO bloombox.reconciliation_runs (
        id, commerce_provider, resource_type, status, cursor_value, started_at
      ) VALUES (
        ${runId}, 'STRIPE', 'EVENT', 'RUNNING', ${since.toISOString()}, ${startedAt}
      )
    `;

    let checked = 0;
    let relevant = 0;
    let discovered = 0;
    try {
      const events: Array<{ id: string; created: number } & Record<string, unknown>> = [];
      for await (const untrustedEvent of this.eventSource.list(since)) {
        checked += 1;
        if (checked > MAX_RECONCILIATION_EVENTS) throw new StripeReconciliationLimitError();
        const event = sortableEvent(untrustedEvent);
        events.push(event);
      }
      events.sort((left, right) => left.created - right.created || left.id.localeCompare(right.id));

      for (const providerEvent of events) {
        const event = this.verifier.mapTrustedEvent(providerEvent);
        if (!event) continue;
        relevant += 1;
        if (await this.inbox.record(event) === "INSERTED") discovered += 1;
      }

      const completedAt = this.now();
      await this.sql`
        UPDATE bloombox.reconciliation_runs
        SET status = 'SUCCEEDED', completed_at = ${completedAt},
            checked_count = ${checked}, difference_count = ${discovered},
            cursor_value = ${completedAt.toISOString()}
        WHERE id = ${runId}
      `;
      return { checked, relevant, discovered };
    } catch (error) {
      await this.sql`
        UPDATE bloombox.reconciliation_runs
        SET status = 'FAILED', completed_at = ${this.now()},
            checked_count = ${checked}, difference_count = ${discovered},
            error_code = ${failureCode(error)}
        WHERE id = ${runId}
      `;
      throw error;
    }
  }

  private async reconciliationStart(startedAt: Date): Promise<Date> {
    const rows = await this.sql`
      SELECT completed_at
      FROM bloombox.reconciliation_runs
      WHERE commerce_provider = 'STRIPE'
        AND resource_type = 'EVENT'
        AND status = 'SUCCEEDED'
      ORDER BY completed_at DESC
      LIMIT 1
    `;
    if (rows[0]?.completed_at) {
      return new Date(
        new Date(rows[0].completed_at).getTime() - RECONCILIATION_OVERLAP_MINUTES * 60 * 1000,
      );
    }
    return new Date(startedAt.getTime() - INITIAL_RECONCILIATION_LOOKBACK_HOURS * 60 * 60 * 1000);
  }
}

function sortableEvent(value: unknown): { id: string; created: number } & Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || !("id" in value)
    || typeof value.id !== "string"
    || !("created" in value)
    || typeof value.created !== "number"
  ) {
    throw new Error("Stripe reconciliation event is invalid");
  }
  return { ...value, id: value.id, created: value.created };
}

function failureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)) return error.name;
  return "UnknownReconciliationError";
}
