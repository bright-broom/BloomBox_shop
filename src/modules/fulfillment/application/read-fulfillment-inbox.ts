import type { FulfillmentStatus } from "../domain/fulfillment-status";

export const FULFILLMENT_INBOX_PAGE_SIZE = 20;
export type FulfillmentInboxRequest = Readonly<{ shop: string; cursor?: string }>;
/** A minimal discovery view; neither a current stock assessment nor permission to dispatch. */
export type FulfillmentInbox = Readonly<{
  shop: string;
  testMode: boolean;
  viewedAt: string;
  entries: ReadonlyArray<Readonly<{
    fulfillmentId: string;
    reference: string;
    deliveryDate: string;
    totalMinor: number;
    status: FulfillmentStatus;
  }>>;
  nextCursor: string | null;
}>;
export interface FulfillmentInboxQuery {
  list(input: FulfillmentInboxRequest): Promise<FulfillmentInbox>;
}
