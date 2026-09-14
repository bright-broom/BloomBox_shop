import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import type { CustomerPurchasePerformance } from "../application/customer-purchase-performance";
import { CustomerOrderHistoryUnavailableError } from "../application/customer-order-history";

export class PostgresCustomerPurchasePerformance implements CustomerPurchasePerformance {
  constructor(private readonly sql: DatabaseClient) {}
  async readEligibleSpend(customerId: string): Promise<number> {
    try {
      z.uuid().parse(customerId);
      // One statement/snapshot; EXISTS ownership cannot multiply the aggregation.
      // Refunds are conservatively allocated to goods before shipping (ADR 0013).
      const rows = await this.sql`SELECT coalesce(sum(eligible.spend), 0)::text AS spend
        FROM bloombox.customer_accounts customer
        LEFT JOIN LATERAL (
          SELECT greatest(0, orders.subtotal_minor - orders.discount_minor - payment.amount_refunded_minor) AS spend
          FROM bloombox.buyers buyer JOIN bloombox.orders orders ON orders.buyer_id = buyer.id
          JOIN bloombox.payments payment ON payment.order_id = orders.id
          WHERE buyer.customer_id = customer.id AND orders.commerce_provider = 'STRIPE'
            AND orders.status IN ('CONFIRMED', 'CLOSED') AND orders.currency = 'JPY'
            AND payment.commerce_provider = 'STRIPE' AND payment.currency = 'JPY'
            AND payment.status IN ('CAPTURED', 'PARTIALLY_REFUNDED')
            AND payment.amount_captured_minor = orders.total_minor
            AND payment.amount_requested_minor = orders.total_minor
            AND payment.amount_refunded_minor BETWEEN 0 AND payment.amount_captured_minor
            AND NOT EXISTS (SELECT 1 FROM bloombox.payments other WHERE other.order_id = orders.id AND other.id <> payment.id)
        ) eligible ON TRUE
        WHERE customer.id = ${customerId} AND customer.status = 'ACTIVE'
        GROUP BY customer.id`;
      return z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(rows[0]?.spend);
    } catch { throw new CustomerOrderHistoryUnavailableError(); }
  }
}
