export type CustomerIdentity = Readonly<{ customerId: string; version: number }>;
export interface CustomerIdentityRepository {
  registerGoogleSubject(subject: string): Promise<CustomerIdentity>;
  isActive(subject: string, identity: CustomerIdentity): Promise<boolean>;
}
export class CustomerIdentityUnavailableError extends Error {
  constructor() { super("Customer identity unavailable"); this.name = "CustomerIdentityUnavailableError"; }
}
