export const MAX_REQUEUE_EVENTS = 20;

const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9]{8,255}$/;
const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const MAX_INCIDENT_ISSUE = 1_000_000_000;
const REQUEST_KEYS = new Set(["externalEventIds", "incidentIssue", "requestedBy"]);

export type FailedInboxRequeueRequest = Readonly<{
  externalEventIds: readonly string[];
  /** The incident issue records the investigation, so no free-text reason (and no personal data) reaches the audit log. */
  incidentIssue: number;
  /** GitHub login of the operator who dispatched the protected workflow. */
  requestedBy: string;
}>;

export type FailedInboxRequeueOutcome = "REQUEUED" | "NOT_FOUND" | "NOT_FAILED" | "PAYLOAD_PURGED";

export type FailedInboxRequeueResult = Readonly<{
  results: ReadonlyArray<Readonly<{ externalEventId: string; outcome: FailedInboxRequeueOutcome }>>;
}>;

/**
 * Returns explicitly named provider events that exhausted their attempts to the worker queue after an operator
 * fixed the cause. Only failed events whose payload is still retained are requeued; the worker then processes them
 * with the normal idempotent processor.
 */
export interface FailedInboxRequeue {
  execute(request: FailedInboxRequeueRequest): Promise<FailedInboxRequeueResult>;
}

export class InvalidFailedInboxRequeueRequestError extends Error {
  constructor() {
    super("Failed inbox requeue request is invalid");
    this.name = "InvalidFailedInboxRequeueRequestError";
  }
}

export function parseFailedInboxRequeueRequest(untrusted: unknown): FailedInboxRequeueRequest {
  if (typeof untrusted !== "object" || untrusted === null || Array.isArray(untrusted)) {
    throw new InvalidFailedInboxRequeueRequestError();
  }
  const candidate = untrusted as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !REQUEST_KEYS.has(key))) throw new InvalidFailedInboxRequeueRequestError();

  const { externalEventIds, incidentIssue, requestedBy } = candidate;
  if (
    !Array.isArray(externalEventIds)
    || externalEventIds.length < 1
    || externalEventIds.length > MAX_REQUEUE_EVENTS
    || !externalEventIds.every((id): id is string => typeof id === "string" && STRIPE_EVENT_ID.test(id))
    || new Set(externalEventIds).size !== externalEventIds.length
  ) {
    throw new InvalidFailedInboxRequeueRequestError();
  }
  if (
    typeof incidentIssue !== "number"
    || !Number.isSafeInteger(incidentIssue)
    || incidentIssue < 1
    || incidentIssue > MAX_INCIDENT_ISSUE
  ) {
    throw new InvalidFailedInboxRequeueRequestError();
  }
  if (typeof requestedBy !== "string" || !GITHUB_LOGIN.test(requestedBy)) throw new InvalidFailedInboxRequeueRequestError();

  return { externalEventIds: [...externalEventIds], incidentIssue, requestedBy };
}
