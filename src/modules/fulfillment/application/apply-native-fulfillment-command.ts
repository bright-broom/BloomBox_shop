import { NativeFulfillmentError, type NativeFulfillmentCommand } from "../domain/native-fulfillment";
import { decideNativeFulfillment, normalizeTrackingNumber } from "../domain/native-fulfillment-policy";
import type { NativeFulfillmentActor, NativeFulfillmentReceipt, NativeFulfillmentStore } from "./manage-native-fulfillment";

export class ApplyNativeFulfillmentCommand {
  constructor(private readonly store: NativeFulfillmentStore) {}

  async execute(input: NativeFulfillmentCommand, actor: NativeFulfillmentActor): Promise<NativeFulfillmentReceipt> {
    const command = input.action === "SHIP" || input.action === "CORRECT_TRACKING"
      ? { ...input, trackingNumber: normalizeTrackingNumber(input.trackingNumber) ?? "" } : input;
    const facts = await this.store.lockFacts(command.fulfillmentId);
    if (!facts) throw new NativeFulfillmentError("NOT_FOUND");
    const previous = await this.store.findChange(actor.operatorId, command.requestId);
    if (previous) {
      if (command.fulfillmentId !== previous.command.fulfillmentId || command.action !== previous.command.action
        || command.expectedVersion !== previous.command.expectedVersion
        || ("reason" in command && (!("reason" in previous.command) || command.reason !== previous.command.reason))
        || ("carrier" in command && (!("carrier" in previous.command) || command.carrier !== previous.command.carrier || command.trackingNumber !== previous.command.trackingNumber))) {
        throw new NativeFulfillmentError("CONFLICT");
      }
      return { fulfillmentId: command.fulfillmentId, status: previous.status, version: previous.version, replayed: true };
    }
    if (facts.version !== command.expectedVersion) throw new NativeFulfillmentError("CONFLICT");
    const decision = decideNativeFulfillment(facts, command);
    const receipt = await this.store.record({ command, fromStatus: facts.status, ...decision }, actor);
    return { ...receipt, replayed: false };
  }
}
