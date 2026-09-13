import { CustomerOrderDetailPanel } from "@/ui/customer-order-detail";

export default function CustomerOrderNotFound() {
  return <CustomerOrderDetailPanel state={{ status: "not-found" }} />;
}
