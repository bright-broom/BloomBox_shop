import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { NativeFulfillmentError } from "../domain/native-fulfillment";
import type { NativeFulfillmentStore } from "../application/manage-native-fulfillment";

// #124 contract stub (ADR 0015). The database agent replaces these bodies; the constructor is frozen.
export class PostgresNativeFulfillmentStore implements NativeFulfillmentStore {
  constructor(
    private readonly tx: DatabaseTransaction,
    private readonly protector: Pick<AesGcmDataProtector, "unprotect">,
  ) {}

  async list(): ReturnType<NativeFulfillmentStore["list"]> { throw new NativeFulfillmentError("UNAVAILABLE"); }
  async read(): ReturnType<NativeFulfillmentStore["read"]> { throw new NativeFulfillmentError("UNAVAILABLE"); }
  async lockFacts(): ReturnType<NativeFulfillmentStore["lockFacts"]> { throw new NativeFulfillmentError("UNAVAILABLE"); }
  async findChange(): ReturnType<NativeFulfillmentStore["findChange"]> { throw new NativeFulfillmentError("UNAVAILABLE"); }
  async record(): ReturnType<NativeFulfillmentStore["record"]> { throw new NativeFulfillmentError("UNAVAILABLE"); }
}
