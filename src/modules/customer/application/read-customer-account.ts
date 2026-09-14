import { CustomerAccountUnavailableError, type CustomerAccountReader } from "../domain/customer-account";

/** A cursor changes the page, never the authenticated customer. No customer ID is accepted. */
export async function readCustomerAccount(reader: CustomerAccountReader, after: unknown) {
  if (after !== undefined && (typeof after !== "string" || !/^[A-Za-z0-9_+/=-]{1,2048}$/.test(after))) {
    throw new CustomerAccountUnavailableError();
  }
  return reader.read(typeof after === "string" ? after : null);
}
