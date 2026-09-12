import { randomUUID } from "node:crypto";
import type { ProviderEventProcessor, VerifiedProviderEvent } from "./receive-provider-webhook";
import { PROVIDER_INBOX_BATCH_SIZE, PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES } from "./provider-inbox-policy";
export { PROVIDER_INBOX_BATCH_SIZE, PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES } from "./provider-inbox-policy";

export type FailedEventDisposition = "RETRY_SCHEDULED" | "FAILED";
export type ProviderEventReference = Pick<VerifiedProviderEvent, "provider" | "providerAccountId" | "externalEventId">;
export type ClaimedProviderEvent = Readonly<{ kind: "READABLE"; event: VerifiedProviderEvent }>
  | Readonly<{ kind: "UNREADABLE"; reference: ProviderEventReference }>;

export class ProviderEventUnreadableError extends Error {
  constructor() { super("Stored provider event could not be restored"); this.name = "ProviderEventUnreadableError"; }
}

export interface ProviderEventQueue {
  claim(input: Readonly<{
    limit: number;
    workerId: string;
    now: Date;
    lockTimeoutMinutes: number;
  }>): Promise<readonly ClaimedProviderEvent[]>;
  markProcessed(event: VerifiedProviderEvent, processedAt: Date, workerId: string): Promise<void>;
  markFailed(
    event: ProviderEventReference,
    errorCode: string,
    failedAt: Date,
    workerId: string,
  ): Promise<FailedEventDisposition>;
}

export type ProviderInboxProcessingResult = Readonly<{
  claimed: number;
  processed: number;
  retryScheduled: number;
  failed: number;
}>;

export class ProcessProviderInbox {
  constructor(
    private readonly queue: ProviderEventQueue,
    private readonly processor: ProviderEventProcessor,
    private readonly now: () => Date = () => new Date(),
    private readonly createWorkerId: () => string = randomUUID,
    private readonly batchSize: number = PROVIDER_INBOX_BATCH_SIZE,
  ) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > PROVIDER_INBOX_BATCH_SIZE) {
      throw new RangeError("Invalid provider inbox batch size");
    }
  }

  async execute(): Promise<ProviderInboxProcessingResult> {
    const workerId = this.createWorkerId();
    const events = await this.queue.claim({
      limit: this.batchSize,
      workerId,
      now: this.now(),
      lockTimeoutMinutes: PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES,
    });
    let processed = 0;
    let retryScheduled = 0;
    let failed = 0;

    for (const claim of events) {
      const reference = claim.kind === "READABLE" ? claim.event : claim.reference;
      try {
        // An unreadable record is a failed attempt, never an empty or fabricated provider event.
        if (claim.kind === "UNREADABLE") throw new ProviderEventUnreadableError();
        await this.processor.process(claim.event);
        await this.queue.markProcessed(claim.event, this.now(), workerId);
        processed += 1;
      } catch (error) {
        const disposition = await this.queue.markFailed(
          reference,
          failureCode(error),
          this.now(),
          workerId,
        );
        if (disposition === "FAILED") failed += 1;
        else retryScheduled += 1;
      }
    }

    return { claimed: events.length, processed, retryScheduled, failed };
  }
}

function failureCode(error: unknown): string {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)) return error.name;
  return "UnknownProviderEventError";
}
