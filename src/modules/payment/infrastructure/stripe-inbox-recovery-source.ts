import Stripe from "stripe";
import type { StripeConfig } from "@/shared/infrastructure/config/stripe-config";
import { InboxRecoveryUnavailableError, type PurgedInboxEventSource } from "../application/restore-purged-inbox-event";
import { StripeWebhookVerifier } from "./stripe-webhook-verifier";

/** Authenticated Events GET is the only source; browser-supplied replacement payloads are never accepted. */
export class StripeInboxRecoverySource implements PurgedInboxEventSource {
  private readonly stripe: Stripe;
  private readonly verifier: StripeWebhookVerifier;
  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.reconciliationSecretKey, { maxNetworkRetries: 0, timeout: 10_000, telemetry: false });
    this.verifier = new StripeWebhookVerifier(config);
  }
  async retrieve(id: string) {
    try {
      // Non-Connect events omit account: prove which account owns the key before mapping them.
      const account = await this.stripe.accounts.retrieveCurrent({}, { apiVersion: this.config.apiVersion });
      if (account.id !== this.config.accountId) throw new InboxRecoveryUnavailableError();
      const event = await this.stripe.events.retrieve(id, {}, { apiVersion: this.config.apiVersion });
      if (event.id !== id) throw new InboxRecoveryUnavailableError();
      return this.verifier.mapTrustedEvent(event);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) return null;
      // Never propagate provider error bodies or customer details to logs.
      throw new InboxRecoveryUnavailableError();
    }
  }
}
