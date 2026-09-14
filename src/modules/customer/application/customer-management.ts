export { CUSTOMER_DIRECTORY_PAGE_SIZE } from "../domain/customer-management-policy";
export type ManagedCustomer = Readonly<{ id: string; status: 'ACTIVE' | 'DISABLED' | 'ANONYMIZED'; createdAt: string }>;
export type CustomerDirectoryFilter = Readonly<{ customerId?: string; after?: string; status?: ManagedCustomer['status'] }>;
export interface CustomerDirectoryQuery {
  list(filter: CustomerDirectoryFilter): Promise<Readonly<{ customers: readonly ManagedCustomer[]; next: string | null }>>;
  find(id: string): Promise<ManagedCustomer | null>;
}
export class CustomerManagementError extends Error {
  constructor(public readonly code: 'DENIED' | 'INVALID' | 'UNAVAILABLE') {
    super('Customer management ' + code);
    this.name = 'CustomerManagementError';
  }
}
