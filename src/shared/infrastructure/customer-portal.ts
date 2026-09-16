import { headers } from "next/headers";
import {
  AccountPortalError,
  type AccountChange,
} from "@/modules/customer/public";
import { PostgresCustomerPortal } from "@/modules/customer/infrastructure/postgres-customer-portal";
import {
  changeSchema,
  requestInputSchema,
  revisionSchema,
} from "@/modules/customer/infrastructure/customer-portal-schema";
import { readCustomerCredential } from "./security/customer-auth/service";
import { loadCustomerAccountConfig } from "./config/customer-account-config";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";
import { getApplicationDatabaseClient } from "./database/database-connections";
import { application } from "./composition-root";
import { productId } from "@/modules/catalog/public";

export async function customerPortalContext(mutation = false) {
  const config = loadCustomerAccountConfig();
  const incoming = await headers();
  if (!config || (mutation && incoming.get("origin") !== config.origin))
    throw new AccountPortalError("expired");
  const actor = await readCustomerCredential(
    incoming.get("cookie") ?? "",
    config,
  );
  if (!actor) throw new AccountPortalError("expired");
  return {
    actor,
    repository: new PostgresCustomerPortal(
      getApplicationDatabaseClient(),
      new AesGcmDataProtector(loadDataProtectionConfig()),
    ),
  };
}
export async function loadCustomerPortal() {
  try {
    const { actor, repository } = await customerPortalContext();
    const snapshot = await repository.read(actor);
    return {
      status: "ready" as const,
      snapshot,
      email: actor.email,
      googleName: actor.name,
    };
  } catch (error) {
    if (error instanceof AccountPortalError && error.code === "expired")
      return { status: "signed-out" as const };
    console.error("customer_portal_read_failed");
    return { status: "unavailable" as const };
  }
}
export async function changeCustomerPortal(form: FormData) {
  const { actor, repository } = await customerPortalContext(true);
  const kind = form.get("kind");
  let input: unknown;
  if (kind === "profile")
    input = { kind, name: form.get("name"), phone: form.get("phone") };
  else if (kind === "address")
    input = {
      kind,
      address: Object.fromEntries(
        [
          "id",
          "label",
          "name",
          "postalCode",
          "prefecture",
          "city",
          "line1",
          "line2",
          "phone",
        ].map((k) => [k, form.get(k)]),
      ),
    };
  else if (kind === "remove-address" || kind === "default-address")
    input = { kind, id: form.get("id") };
  else if (kind === "favorite" || kind === "unfavorite")
    input = { kind, productId: form.get("productId") };
  else if (kind === "marketing")
    input = {
      kind,
      enabled: form.get("enabled") === "on",
      verifiedEmail: actor.email,
    };
  const parsed = changeSchema.safeParse(input),
    revision = revisionSchema.safeParse(form.get("revision"));
  if (!parsed.success || !revision.success)
    throw new AccountPortalError("invalid");
  const change: AccountChange = parsed.data;
  if (
    change.kind === "favorite" &&
    !(await application.getProduct.byId(productId(change.productId)))
  )
    throw new AccountPortalError("not-found");
  await repository.change(actor, revision.data, change);
}
export async function createCustomerRequest(form: FormData) {
  const { actor, repository } = await customerPortalContext(true);
  const input = requestInputSchema.safeParse({
    id: form.get("id"),
    kind: form.get("requestKind"),
    orderId: form.get("orderId") || null,
    message: form.get("message"),
  });
  if (!input.success) throw new AccountPortalError("invalid");
  await repository.request(actor, input.data);
}
export async function loadCustomerRequests() {
  const { actor, repository } = await customerPortalContext();
  return repository.requests(actor);
}
