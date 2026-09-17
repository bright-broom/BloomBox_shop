import { InvalidFailedInboxRequeueRequestError, parseFailedInboxRequeueRequest } from "./requeue-failed-inbox-events";
import type { VerifiedProviderEvent } from "./receive-provider-webhook";

export const RESTORED_INBOX_RETENTION_HOURS = 24;
export type RestorePurgedInboxRequest = Readonly<{ externalEventId: string; incidentIssue: number; requestedBy: string }>;
export type RestorePurgedInboxOutcome = "RESTORED" | "NOT_FOUND" | "NOT_FAILED" | "PAYLOAD_RETAINED" | "ALREADY_RESTORED" | "PROVIDER_UNAVAILABLE" | "EVENT_MISMATCH";
export interface PurgedInboxEventSource { retrieve(id: string): Promise<VerifiedProviderEvent | null> }
export class InboxRecoveryUnavailableError extends Error {
  constructor() { super("Inbox recovery source is unavailable"); this.name = "InboxRecoveryUnavailableError"; }
}
export function parseRestorePurgedInboxRequest(value: unknown): RestorePurgedInboxRequest {
  const candidate = typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(candidate).some((key) => !["externalEventId", "incidentIssue", "requestedBy"].includes(key))) throw new InvalidFailedInboxRequeueRequestError();
  const { externalEventId, ...rest } = candidate;
  const parsed = parseFailedInboxRequeueRequest({ ...rest, externalEventIds: [externalEventId] });
  return { externalEventId: parsed.externalEventIds[0], incidentIssue: parsed.incidentIssue, requestedBy: parsed.requestedBy };
}
