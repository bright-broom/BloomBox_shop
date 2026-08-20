import { randomUUID } from "node:crypto";
import type { ProviderEventProcessor, VerifiedProviderEvent } from "./receive-provider-webhook";

export const PROVIDER_INBOX_BATCH_SIZE = 100;
export const PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES = 5;

export type FailedEventDisposition = "RETRY_SCHEDULED" | "FAILED";

export interface ProviderEventQueue {
  claim(input: Readonly<{
    limit: number;
    workerId: string;
    now: Date;
    lockTimeoutMinutes: number;
  }>): Promise<readonly VerifiedProviderEvent[]>;
  markProcessed(event: VerifiedProviderEvent, processedAt: Date, workerId: string): Promise<void>;
  markFailed(
    event: VerifiedProviderEvent,
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
  ) {}

  async execute(): Promise<ProviderInboxProcessingResult> {
    const workerId = this.createWorkerId();
    const events = await this.queue.claim({
      limit: PROVIDER_INBOX_BATCH_SIZE,
      workerId,
      now: this.now(),
      lockTimeoutMinutes: PROVIDER_INBOX_LOCK_TIMEOUT_MINUTES,
    });
    let processed = 0;
    let retryScheduled = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await this.processor.process(event);
        await this.queue.markProcessed(event, this.now(), workerId);
        processed += 1;
      } catch (error) {
        const disposition = await this.queue.markFailed(
          event,
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
