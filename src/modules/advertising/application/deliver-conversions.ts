import { AD_RETRY_LIMIT, hasAttribution, purchaseConversion, type AdvertisingProvider, type AdAttribution, type ConversionFacts, type PurchaseConversion } from "../domain/conversion";
export type AdvertisingJob = Readonly<{
  id: string; lease: string; intentId: string; provider: AdvertisingProvider; destination: string;
  attempts: number; event: PurchaseConversion | null;
}>;
export interface AdvertisingDeliveryStore {
  claim(): Promise<AdvertisingJob | null>;
  attribution(job: AdvertisingJob): Promise<AdAttribution | null>;
  snapshot(job: AdvertisingJob, event: PurchaseConversion): Promise<void>;
  finish(job: AdvertisingJob, status: "accepted" | "skipped" | "failed" | "pending", receipt?: string): Promise<void>;
}
export interface AdvertisingDestination {
  provider: AdvertisingProvider;
  fingerprint: string;
  send(event: PurchaseConversion, attribution: AdAttribution): Promise<string>;
}
export class DeliverAdvertisingConversions {
  constructor(
    private readonly store: AdvertisingDeliveryStore,
    private readonly facts: (intentId: string) => Promise<ConversionFacts | null>,
    private readonly destinations: readonly AdvertisingDestination[],
    private readonly report: (error: unknown) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async execute(limit = 5) {
    const result = { accepted: 0, pending: 0, skipped: 0, failed: 0 };
    for (let i = 0; i < limit; i++) {
      const job = await this.store.claim();
      if (!job) break;
      try {
        const destination = this.destinations.find((entry) => entry.provider === job.provider && entry.fingerprint === job.destination);
        const attribution = await this.store.attribution(job);
        if (!destination || !attribution || !hasAttribution(job.provider, attribution)) {
          await this.store.finish(job, "skipped"); result.skipped++; continue;
        }
        // Order is re-read before every send, including retries after a refund/cancellation.
        const facts = await this.facts(job.intentId);
        if (!facts) { await this.store.finish(job, "pending"); result.pending++; continue; }
        const current = purchaseConversion(facts, this.now());
        if (!current || attribution.capturedAt > facts.confirmedAt.getTime() || (job.event && JSON.stringify(current) !== JSON.stringify(job.event))) {
          await this.store.finish(job, "skipped"); result.skipped++; continue;
        }
        const event = job.event ?? current;
        await this.store.snapshot(job, event);
        // Recheck consent after the order query and immediately before the external request.
        if (!await this.store.attribution(job)) { await this.store.finish(job, "skipped"); result.skipped++; continue; }
        const receipt = await destination.send(event, attribution);
        await this.store.finish(job, "accepted", receipt); result.accepted++;
      } catch (error) {
        this.report(error);
        const status = job.attempts >= AD_RETRY_LIMIT ? "failed" : "pending";
        await this.store.finish(job, status); result[status]++;
      }
    }
    return result;
  }
}
