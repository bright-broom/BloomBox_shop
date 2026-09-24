import { describe, expect, it, vi } from "vitest";
import { ChangeOrderDeliveryDate, type OrderDeliveryDateStore } from "./change-order-delivery-date";
import { OrderDeliveryDateChangeError, type OrderDeliveryDateCommand, type OrderDeliveryDateFacts } from "../domain/order-delivery-date-change";

const facts: OrderDeliveryDateFacts = { orderStatus: "CONFIRMED", deliveryDate: "2026-10-01", fulfillmentStatuses: ["PROCESSING"],
  hasShipment: false, piiPurged: false, confirmedAt: new Date("2026-09-20T02:00:00Z") };
const command: OrderDeliveryDateCommand = { orderId: "order-1", requestId: "request-1", expectedDate: "2026-10-01", nextDate: "2026-10-08", reason: "ご相談あり" };
const window = { earliest: "2026-09-27", latest: "2026-11-23" };
const actor = { operatorId: "operator-1" };
const store = (overrides: Partial<{
  lockFacts: ReturnType<typeof lockFactsMock>; findChange: ReturnType<typeof findChangeMock>;
}> = {}) => ({ lockFacts: lockFactsMock(async () => facts), findChange: findChangeMock(async () => null),
  apply: vi.fn<OrderDeliveryDateStore["apply"]>(async () => undefined), ...overrides });
const lockFactsMock = (implementation: OrderDeliveryDateStore["lockFacts"]) => vi.fn<OrderDeliveryDateStore["lockFacts"]>(implementation);
const findChangeMock = (implementation: OrderDeliveryDateStore["findChange"]) => vi.fn<OrderDeliveryDateStore["findChange"]>(implementation);
const code = async (promise: Promise<unknown>) => {
  try { await promise; return "ACCEPTED"; } catch (error) { return error instanceof OrderDeliveryDateChangeError ? error.code : "UNEXPECTED"; }
};

describe("change order delivery date", () => {
  it("applies the planned change once and reports the new date", async () => {
    const repository = store();
    await expect(new ChangeOrderDeliveryDate(repository).execute(command, window, actor))
      .resolves.toEqual({ orderId: "order-1", deliveryDate: "2026-10-08", replayed: false });
    expect(repository.apply).toHaveBeenCalledTimes(1);
    expect(repository.apply.mock.calls[0][0]).toMatchObject({ previousDate: "2026-10-01", nextDate: "2026-10-08" });
  });
  it("returns the first result for the same request instead of moving the date again", async () => {
    const repository = store({ findChange: findChangeMock(async () => ({
      orderId: "order-1", previousDate: "2026-10-01", nextDate: "2026-10-08", reason: "ご相談あり", occurredAt: "2026-09-24T02:00:00.000Z" })) });
    await expect(new ChangeOrderDeliveryDate(repository).execute({ ...command, reason: " ご相談あり " }, window, actor))
      .resolves.toEqual({ orderId: "order-1", deliveryDate: "2026-10-08", replayed: true });
    expect(repository.apply).not.toHaveBeenCalled();
    expect(repository.lockFacts).not.toHaveBeenCalled();
  });
  it("refuses to reuse a request identifier for different content", async () => {
    const repository = store({ findChange: findChangeMock(async () => ({
      orderId: "order-1", previousDate: "2026-10-01", nextDate: "2026-10-08", reason: "ご相談あり", occurredAt: "2026-09-24T02:00:00.000Z" })) });
    for (const overrides of [{ nextDate: "2026-10-09" }, { orderId: "order-2" }, { expectedDate: "2026-10-02" }, { reason: "別の理由" }]) {
      expect(await code(new ChangeOrderDeliveryDate(repository).execute({ ...command, ...overrides }, window, actor))).toBe("CONFLICT");
    }
    expect(repository.apply).not.toHaveBeenCalled();
  });
  it("reports a missing order and does not write when the rules reject the change", async () => {
    const missing = store({ lockFacts: lockFactsMock(async () => null) });
    expect(await code(new ChangeOrderDeliveryDate(missing).execute(command, window, actor))).toBe("NOT_FOUND");
    const shipped = store({ lockFacts: lockFactsMock(async () => ({ ...facts, hasShipment: true })) });
    expect(await code(new ChangeOrderDeliveryDate(shipped).execute(command, window, actor))).toBe("DISPATCHED");
    expect(missing.apply).not.toHaveBeenCalled();
    expect(shipped.apply).not.toHaveBeenCalled();
  });
});
