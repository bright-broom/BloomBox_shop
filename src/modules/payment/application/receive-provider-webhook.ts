export type VerifiedProviderEvent = Readonly<{
  provider: "STRIPE";
  providerAccountId: string;
  externalEventId: string;
  eventType: string;
  externalObjectId?: string;
  apiVersion: string;
  occurredAt: Date;
  payload: Readonly<Record<string, unknown>>;
}>;

export class InvalidProviderWebhookError extends Error {
  constructor() {
    super("Provider webhook is invalid");
    this.name = "InvalidProviderWebhookError";
  }
}

export interface ProviderWebhookVerifier {
  verify(rawBody: string, signature: string): VerifiedProviderEvent | null;
}

export interface WebhookInbox {
  record(event: VerifiedProviderEvent): Promise<"INSERTED" | "DUPLICATE">;
}

export interface ProviderEventProcessor {
  process(event: VerifiedProviderEvent): Promise<void>;
}

export class ReceiveProviderWebhook {
  constructor(
    private readonly verifier: ProviderWebhookVerifier,
    private readonly inbox: WebhookInbox,
  ) {}

  async execute(rawBody: string, signature: string): Promise<"IGNORED" | "INSERTED" | "DUPLICATE"> {
    const event = this.verifier.verify(rawBody, signature);
    if (!event) return "IGNORED";
    return this.inbox.record(event);
  }
}
