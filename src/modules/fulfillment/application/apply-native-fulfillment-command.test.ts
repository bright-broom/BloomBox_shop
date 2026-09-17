import { describe, expect, it, vi } from "vitest";
import { ApplyNativeFulfillmentCommand } from "./apply-native-fulfillment-command";
import type { NativeFulfillmentStore } from "./manage-native-fulfillment";
import type { NativeFulfillmentCommand } from "../domain/native-fulfillment";
const actor = { operatorId: "operator", expiresAt: new Date("2100-01-01") };
const command: NativeFulfillmentCommand = { fulfillmentId: "f", requestId: "r", expectedVersion: 2, action: "SHIP", carrier: "YAMATO", trackingNumber: "1234-5678" };
function store(): NativeFulfillmentStore {
  return { list: vi.fn(), read: vi.fn(), lockFacts: vi.fn().mockResolvedValue({ fulfillmentId: "f", version: 2, status: "READY", orderStatus: "CONFIRMED", paymentStatuses: ["CAPTURED"], itemQuantity: 1, hasShipment: false }), findChange: vi.fn().mockResolvedValue(null), record: vi.fn().mockResolvedValue({ fulfillmentId: "f", status: "SHIPPED", version: 3 }) };
}
describe("native fulfillment commands", () => {
  it("persists a normalized shipment and returns the saved version", async () => {
    const db = store();
    await expect(new ApplyNativeFulfillmentCommand(db).execute(command, actor)).resolves.toEqual({ fulfillmentId: "f", status: "SHIPPED", version: 3, replayed: false });
    expect(db.record).toHaveBeenCalledWith(expect.objectContaining({ command: { ...command, trackingNumber: "12345678" }, fromStatus: "READY", toStatus: "SHIPPED", shipment: { kind: "CREATE", carrier: "YAMATO", trackingNumber: "12345678" } }), actor);
  });
  it("returns an exact replay even when current state has advanced", async () => {
    const db = store();
    vi.mocked(db.lockFacts).mockResolvedValue({ fulfillmentId: "f", version: 4, status: "DELIVERED", orderStatus: "CONFIRMED", paymentStatuses: ["REFUNDED"], itemQuantity: 1, hasShipment: true });
    vi.mocked(db.findChange).mockResolvedValue({ command: { ...command, trackingNumber: "12345678" }, version: 3, status: "SHIPPED" });
    await expect(new ApplyNativeFulfillmentCommand(db).execute(command, actor)).resolves.toMatchObject({ replayed: true, version: 3, status: "SHIPPED" });
    expect(db.record).not.toHaveBeenCalled();
    await expect(new ApplyNativeFulfillmentCommand(db).execute({ ...command, carrier: "SAGAWA" }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("fails missing objects and stale versions without updating", async () => {
    const db = store(), usecase = new ApplyNativeFulfillmentCommand(db);
    await expect(usecase.execute({ ...command, expectedVersion: 1 }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    vi.mocked(db.lockFacts).mockResolvedValue(null);
    await expect(usecase.execute(command, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.record).not.toHaveBeenCalled();
  });
});
