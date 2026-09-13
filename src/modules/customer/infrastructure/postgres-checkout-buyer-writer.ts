import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import { CheckoutBuyerUnavailableError, type CheckoutBuyerWriter } from "../application/checkout-buyer-writer";

export class PostgresCheckoutBuyerWriter implements CheckoutBuyerWriter {
  constructor(private readonly transaction: DatabaseTransaction) {}
  async create(input: Parameters<CheckoutBuyerWriter["create"]>[0]): Promise<void> {
    const tx = this.transaction;
    try {
      if (!z.uuid().safeParse(input.buyerId).success || !z.uuid().safeParse(input.purchaseIntentId).success
        || !Number.isFinite(input.occurredAt.getTime())) throw new CheckoutBuyerUnavailableError();
      const rows = await tx`SELECT customer_id FROM bloombox.purchase_intents
        WHERE id = ${input.purchaseIntentId} AND commerce_provider = 'STRIPE' AND status = 'CHECKOUT_CREATED'
        FOR SHARE`;
      if (rows.length !== 1) throw new CheckoutBuyerUnavailableError();
      const customerId = z.uuid().nullable().parse(rows[0].customer_id);
      // Settlement survives logout, revocation and account disable; history still checks current account status.
      await tx`INSERT INTO bloombox.buyers (id, customer_id, created_at)
        VALUES (${input.buyerId}, ${customerId}, ${input.occurredAt})`;
      await tx`INSERT INTO bloombox.audit_logs
        (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
        VALUES (${randomUUID()}, 'SYSTEM', 'customer.checkout_buyer.created', 'Buyer', ${input.buyerId},
          ${tx.json({ customerLinked: customerId !== null })}, ${input.occurredAt})`;
    } catch { throw new CheckoutBuyerUnavailableError(); }
  }
}
