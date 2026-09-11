import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApprovalExpiry } from "./approval-expiry";

const preparedAt = "2026-09-12T00:00:00.000Z", expiresAt = "2026-09-12T00:00:30.000Z";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "performance"] });
  vi.setSystemTime(new Date(preparedAt));
  vi.stubGlobal("window", new EventTarget()); vi.stubGlobal("document", new EventTarget());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("approval display deadline", () => {
  it("expires at the deadline, announces once, and clears timers on unmount", () => {
    const expiry = createApprovalExpiry(preparedAt, expiresAt), changed = vi.fn();
    expect(expiry.getServerSnapshot()).toBe(false);
    const unsubscribe = expiry.subscribe(changed);
    vi.advanceTimersByTime(29_999); expect(expiry.getSnapshot()).toBe(false);
    vi.advanceTimersByTime(1); expect(expiry.getSnapshot()).toBe(true); expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus")); expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
  it("accounts for late hydration and detects a deadline crossed while timer delivery is paused", () => {
    vi.setSystemTime(new Date(Date.parse(preparedAt) + 20_000));
    const expiry = createApprovalExpiry(preparedAt, expiresAt), changed = vi.fn(); const unsubscribe = expiry.subscribe(changed);
    vi.advanceTimersByTime(9_999); expect(expiry.getSnapshot()).toBe(false);
    vi.setSystemTime(new Date(Date.parse(expiresAt) + 1));
    document.dispatchEvent(new Event("visibilitychange")); expect(expiry.getSnapshot()).toBe(true);
    unsubscribe();
  });
  it.each(["focus", "pageshow"])("checks on %s after returning to the page", (event) => {
    const expiry = createApprovalExpiry(preparedAt, expiresAt); const unsubscribe = expiry.subscribe(() => {});
    vi.setSystemTime(new Date(expiresAt)); window.dispatchEvent(new Event(event));
    expect(expiry.getSnapshot()).toBe(true); unsubscribe();
  });
  it("does not extend the initial window when the local clock moves backwards", () => {
    const expiry = createApprovalExpiry(preparedAt, expiresAt); const unsubscribe = expiry.subscribe(() => {});
    vi.advanceTimersByTime(10_000); vi.setSystemTime(new Date(Date.parse(preparedAt) - 3_600_000));
    window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(20_000);
    expect(expiry.getSnapshot()).toBe(true); unsubscribe();
  });
  it("rejects submission at the deadline even before a delayed timer fires, and never re-enables an expired instance", () => {
    const expiry = createApprovalExpiry(preparedAt, expiresAt); const unsubscribe = expiry.subscribe(() => {});
    vi.setSystemTime(new Date(expiresAt)); expect(expiry.check()).toBe(true);
    vi.setSystemTime(new Date(preparedAt)); expect(expiry.check()).toBe(true); unsubscribe();
    const fresh = createApprovalExpiry(preparedAt, expiresAt); const stop = fresh.subscribe(() => {});
    expect(fresh.getSnapshot()).toBe(false); stop();
  });
  it("retains the elapsed budget through resubscription and removes old page listeners", () => {
    const expiry = createApprovalExpiry(preparedAt, expiresAt), first = vi.fn(), second = vi.fn();
    const stop = expiry.subscribe(first); vi.advanceTimersByTime(20_000); stop();
    expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(5_000);
    const stopAgain = expiry.subscribe(second); vi.advanceTimersByTime(5_000);
    expect(second).toHaveBeenCalledTimes(1); expect(first).not.toHaveBeenCalled(); stopAgain();
  });
  it.each([[null, null], [preparedAt, "invalid"], [preparedAt, preparedAt], [expiresAt, preparedAt]])
    ("keeps malformed or nonpositive windows disabled", (start, end) => {
      const expiry = createApprovalExpiry(start, end);
      expect(expiry.getServerSnapshot()).toBe(true); expect(expiry.getSnapshot()).toBe(true);
      const stop = expiry.subscribe(() => {}); expect(vi.getTimerCount()).toBe(0); stop();
    });
});
