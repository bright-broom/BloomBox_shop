import { describe, expect, it } from "vitest";
import {
  InvalidFailedInboxRequeueRequestError,
  MAX_REQUEUE_EVENTS,
  parseFailedInboxRequeueRequest,
} from "./requeue-failed-inbox-events";

const valid = { externalEventIds: ["evt_1234567890abcdef"], incidentIssue: 171, requestedBy: "bright-broom" };
const eventIds = (count: number) => Array.from({ length: count }, (_, index) => `evt_${String(index).padStart(10, "0")}`);

describe("parseFailedInboxRequeueRequest", () => {
  it("accepts explicit Stripe event IDs, an incident issue, and the dispatching GitHub login", () => {
    expect(parseFailedInboxRequeueRequest(valid)).toEqual(valid);
  });

  it("accepts up to the bounded number of events", () => {
    expect(parseFailedInboxRequeueRequest({ ...valid, externalEventIds: eventIds(MAX_REQUEUE_EVENTS) }).externalEventIds)
      .toHaveLength(MAX_REQUEUE_EVENTS);
  });

  it.each([
    { name: "no events", request: { ...valid, externalEventIds: [] } },
    { name: "too many events", request: { ...valid, externalEventIds: eventIds(MAX_REQUEUE_EVENTS + 1) } },
    { name: "duplicate events", request: { ...valid, externalEventIds: ["evt_1234567890abcdef", "evt_1234567890abcdef"] } },
    { name: "a non-array event list", request: { ...valid, externalEventIds: "evt_1234567890abcdef" } },
    { name: "a non-Stripe event ID", request: { ...valid, externalEventIds: ["cs_test_1234567890"] } },
    { name: "a non-string event ID", request: { ...valid, externalEventIds: [1234567890] } },
    { name: "an ID with injected characters", request: { ...valid, externalEventIds: ["evt_1234567890'; DROP"] } },
    { name: "a missing incident issue", request: { externalEventIds: valid.externalEventIds, requestedBy: valid.requestedBy } },
    { name: "a non-numeric incident issue", request: { ...valid, incidentIssue: "171" } },
    { name: "a fractional incident issue", request: { ...valid, incidentIssue: 1.5 } },
    { name: "a non-positive incident issue", request: { ...valid, incidentIssue: 0 } },
    { name: "a missing GitHub login", request: { externalEventIds: valid.externalEventIds, incidentIssue: valid.incidentIssue } },
    { name: "an invalid GitHub login", request: { ...valid, requestedBy: "bright broom" } },
    { name: "a free-text reason field", request: { ...valid, reason: "customer 山田 called" } },
    { name: "a non-object body", request: "evt_1234567890abcdef" },
    { name: "an array body", request: [valid] },
    { name: "a null body", request: null },
  ])("rejects $name", ({ request }) => {
    expect(() => parseFailedInboxRequeueRequest(request)).toThrow(InvalidFailedInboxRequeueRequestError);
  });
});
