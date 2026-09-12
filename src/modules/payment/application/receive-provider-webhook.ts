export type VerifiedProviderEvent = Readonly<{
  provider: "STRIPE" | "SHOPIFY";
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

export interface ProviderWebhookVerifier<Body = string, Signature = string> {
  verify(rawBody: Body, signature: Signature): VerifiedProviderEvent | null;
}

export interface WebhookInbox {
  record(event: VerifiedProviderEvent): Promise<"INSERTED" | "DUPLICATE">;
}

export interface ProviderEventProcessor {
  process(event: VerifiedProviderEvent): Promise<void>;
}

export class ReceiveProviderWebhook<Body = string, Signature = string> {
  constructor(
    private readonly verifier: ProviderWebhookVerifier<Body, Signature>,
    private readonly inbox: WebhookInbox,
  ) {}

  async execute(rawBody: Body, signature: Signature): Promise<"IGNORED" | "INSERTED" | "DUPLICATE"> {
    const event = this.verifier.verify(rawBody, signature);
    if (!event) return "IGNORED";
    return this.inbox.record(event);
  }
}
