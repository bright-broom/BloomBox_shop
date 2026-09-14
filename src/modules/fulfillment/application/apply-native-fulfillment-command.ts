import { NativeFulfillmentError, type NativeFulfillmentCommand } from "../domain/native-fulfillment";
import type { NativeFulfillmentActor, NativeFulfillmentReceipt, NativeFulfillmentStore } from "./manage-native-fulfillment";

// #124 contract stub (ADR 0015). The operations agent replaces this body; the signature is frozen.
export class ApplyNativeFulfillmentCommand {
  constructor(private readonly store: NativeFulfillmentStore) {}

  async execute(command: NativeFulfillmentCommand, actor: NativeFulfillmentActor): Promise<NativeFulfillmentReceipt> {
    void command;
    void actor;
    throw new NativeFulfillmentError("UNAVAILABLE");
  }
}
