import type { CustomerOrderHistoryQuery } from "@/modules/order/public";
import type { CustomerAccountReader } from "../domain/customer-account";

export class NativeCustomerAccountReader implements CustomerAccountReader {
  constructor(private readonly customer: Readonly<{ customerId: string; name: string; email: string }>,
    private readonly orders: CustomerOrderHistoryQuery) {}
  async read(after: string | null) {
    const history = await this.orders.read(this.customer.customerId, after);
    return { name: this.customer.name, email: this.customer.email, ...history };
  }
}
