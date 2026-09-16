import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  DatabaseClient,
  DatabaseTransaction,
} from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import {
  AccountPortalError,
  changeAccount,
  emptyAccountPreferences,
  ACCOUNT_LIMITS,
  type AccountChange,
} from "../domain/customer-portal";
import type {
  AccountActor,
  CustomerPortalRepository,
  PortalSnapshot,
  AccountRequest,
} from "../application/customer-portal";
import {
  actorSchema,
  changeSchema,
  preferencesSchema,
  requestBodySchema,
  requestInputSchema,
  revisionSchema,
} from "./customer-portal-schema";

const encryptedRow = z.object({
  key_id: z.string(),
  ciphertext: z.instanceof(Buffer),
  revision: revisionSchema,
});
export const requestRowSchema = encryptedRow.extend({
  id: z.uuid(),
  customer_id: z.uuid(),
  order_id: z.uuid().nullable(),
  kind: requestInputSchema.shape.kind,
  status: z.enum(["OPEN", "REPLIED", "CLOSED"]),
  created_at: z.date(),
});
export class PostgresCustomerPortal implements CustomerPortalRepository {
  constructor(
    private readonly sql: DatabaseClient,
    private readonly protector: AesGcmDataProtector,
  ) {}
  private async transaction<T>(
    actor: AccountActor,
    work: (tx: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    if (!actorSchema.safeParse(actor).success)
      throw new AccountPortalError("expired");
    try {
      const result = await this.sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '2s'`;
        await tx`SET LOCAL statement_timeout = '5s'`;
        const [account] =
          await tx`SELECT version, status FROM bloombox.customer_accounts WHERE id = ${actor.customerId} FOR UPDATE`;
        if (
          !account ||
          account.status !== "ACTIVE" ||
          Number(account.version) !== actor.version
        )
          throw new AccountPortalError("expired");
        const verifyTime = async () => {
          const [clock] = await tx`SELECT clock_timestamp() AS now`;
          if (z.date().parse(clock.now).getTime() >= actor.expiresAt)
            throw new AccountPortalError("expired");
        };
        await verifyTime();
        const value = await work(tx);
        await verifyTime();
        return { value };
      });
      return result.value;
    } catch (error) {
      if (error instanceof AccountPortalError) throw error;
      throw new AccountPortalError("unavailable");
    }
  }
  private async snapshot(
    tx: DatabaseTransaction,
    customerId: string,
  ): Promise<PortalSnapshot> {
    const [raw] =
      await tx`SELECT * FROM bloombox.customer_portals WHERE customer_id = ${customerId}`;
    if (!raw) return { revision: 0, preferences: emptyAccountPreferences() };
    const row = encryptedRow.parse(raw);
    return {
      revision: row.revision,
      preferences: preferencesSchema.parse(
        JSON.parse(
          this.protector.unprotect(
            { keyId: row.key_id, ciphertext: row.ciphertext },
            `customer:${customerId}:portal:v1`,
          ),
        ),
      ),
    };
  }
  read(actor: AccountActor) {
    return this.transaction(actor, (tx) => this.snapshot(tx, actor.customerId));
  }
  async change(actor: AccountActor, revision: number, input: AccountChange) {
    const parsed = changeSchema.safeParse(input);
    if (!parsed.success || !revisionSchema.safeParse(revision).success)
      throw new AccountPortalError("invalid");
    await this.transaction(actor, async (tx) => {
      const current = await this.snapshot(tx, actor.customerId);
      if (current.revision !== revision)
        throw new AccountPortalError("conflict");
      const value = preferencesSchema.parse(
        changeAccount(current.preferences, parsed.data),
      );
      const encrypted = this.protector.protect(
        JSON.stringify(value),
        `customer:${actor.customerId}:portal:v1`,
      );
      await tx`INSERT INTO bloombox.customer_portals(customer_id, revision, key_id, ciphertext)
        VALUES (${actor.customerId}, ${revision + 1}, ${encrypted.keyId}, ${encrypted.ciphertext})
        ON CONFLICT (customer_id) DO UPDATE SET revision = EXCLUDED.revision, key_id = EXCLUDED.key_id, ciphertext = EXCLUDED.ciphertext, updated_at = clock_timestamp()`;
      if (
        parsed.data.kind === "marketing" &&
        current.preferences.marketing !== parsed.data.enabled
      ) {
        await tx`INSERT INTO bloombox.customer_consents(id, customer_id, purpose, status, policy_version, occurred_at, source)
          VALUES (${randomUUID()}, ${actor.customerId}, 'EMAIL_MARKETING', ${parsed.data.enabled ? "GRANTED" : "WITHDRAWN"}, 'account-v1', clock_timestamp(), 'ACCOUNT_SETTINGS')`;
      }
      await this.audit(tx, actor, "customer.portal." + parsed.data.kind);
    });
  }
  requests(actor: AccountActor): Promise<readonly AccountRequest[]> {
    return this.transaction(actor, async (tx) => {
      const rows =
        await tx`SELECT * FROM bloombox.customer_requests WHERE customer_id = ${actor.customerId} ORDER BY created_at DESC, id DESC LIMIT ${ACCOUNT_LIMITS.requestHistory}`;
      return rows.map((raw) => {
        const row = requestRowSchema.parse(raw);
        const body = requestBodySchema.parse(
          JSON.parse(
            this.protector.unprotect(
              { keyId: row.key_id, ciphertext: row.ciphertext },
              `customer:${actor.customerId}:request:${row.id}:v1`,
            ),
          ),
        );
        return {
          id: row.id,
          kind: row.kind,
          orderId: row.order_id,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          ...body,
          revision: row.revision,
        };
      });
    });
  }
  async request(
    actor: AccountActor,
    input: Parameters<CustomerPortalRepository["request"]>[1],
  ) {
    const parsed = requestInputSchema.safeParse(input);
    if (!parsed.success) throw new AccountPortalError("invalid");
    await this.transaction(actor, async (tx) => {
      const value = parsed.data;
      const [previous] =
        await tx`SELECT * FROM bloombox.customer_requests WHERE id = ${value.id}`;
      if (previous) {
        const row = requestRowSchema.parse(previous);
        if (row.customer_id !== actor.customerId)
          throw new AccountPortalError("conflict");
        const body = requestBodySchema.parse(
          JSON.parse(
            this.protector.unprotect(
              { keyId: row.key_id, ciphertext: row.ciphertext },
              `customer:${actor.customerId}:request:${row.id}:v1`,
            ),
          ),
        );
        if (
          row.order_id !== value.orderId ||
          row.kind !== value.kind ||
          body.message !== value.message
        )
          throw new AccountPortalError("conflict");
        return;
      }
      if (value.kind !== "OTHER" && !value.orderId)
        throw new AccountPortalError("invalid");
      if (value.orderId) {
        const [owned] =
          await tx`SELECT orders.id FROM bloombox.orders orders JOIN bloombox.buyers buyer ON buyer.id = orders.buyer_id
          WHERE orders.id = ${value.orderId} AND buyer.customer_id = ${actor.customerId} AND orders.commerce_provider = 'STRIPE'`;
        if (!owned) throw new AccountPortalError("not-found");
      }
      const [count] =
        await tx`SELECT count(*) FROM bloombox.customer_requests WHERE customer_id = ${actor.customerId} AND status <> 'CLOSED'`;
      if (Number(count.count) >= ACCOUNT_LIMITS.requests)
        throw new AccountPortalError("limit");
      const encrypted = this.protector.protect(
        JSON.stringify({ message: value.message, reply: "" }),
        `customer:${actor.customerId}:request:${value.id}:v1`,
      );
      await tx`INSERT INTO bloombox.customer_requests(id, customer_id, order_id, kind, key_id, ciphertext)
        VALUES (${value.id}, ${actor.customerId}, ${value.orderId}, ${value.kind}, ${encrypted.keyId}, ${encrypted.ciphertext})`;
      await this.audit(tx, actor, "customer.request.created");
    });
  }
  async revokeSessions(actor: AccountActor) {
    await this.transaction(actor, async (tx) => {
      await tx`UPDATE bloombox.customer_accounts SET version = version + 1, updated_at = clock_timestamp() WHERE id = ${actor.customerId}`;
      await this.audit(tx, actor, "customer.sessions.revoked");
    });
  }
  async close(actor: AccountActor) {
    await this.transaction(actor, async (tx) => {
      // Disable access now; transactional records and provider identities remain for reviewed erasure.
      const reference = randomUUID();
      await tx`INSERT INTO bloombox.data_subject_requests(id, customer_id, request_type, status, safe_reference, requested_at, due_at, updated_at)
        VALUES (${reference}, ${actor.customerId}, 'DELETION', 'RECEIVED', ${reference}, clock_timestamp(), clock_timestamp() + ${ACCOUNT_LIMITS.erasureReviewDays} * interval '1 day', clock_timestamp())`;
      await tx`DELETE FROM bloombox.customer_portals WHERE customer_id = ${actor.customerId}`;
      await tx`INSERT INTO bloombox.customer_consents(id, customer_id, purpose, status, policy_version, occurred_at, source)
        VALUES (${randomUUID()}, ${actor.customerId}, 'EMAIL_MARKETING', 'WITHDRAWN', 'account-v1', clock_timestamp(), 'ACCOUNT_CLOSURE')`;
      await tx`UPDATE bloombox.customer_accounts SET status = 'DISABLED', version = version + 1, updated_at = clock_timestamp() WHERE id = ${actor.customerId}`;
      await this.audit(tx, actor, "customer.account.closed");
    });
  }
  private async audit(
    tx: DatabaseTransaction,
    actor: AccountActor,
    action: string,
  ) {
    await tx`INSERT INTO bloombox.audit_logs(id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
      VALUES (${randomUUID()}, 'CUSTOMER', ${action}, 'customer_account', ${actor.customerId}, '{}', clock_timestamp())`;
  }
}
