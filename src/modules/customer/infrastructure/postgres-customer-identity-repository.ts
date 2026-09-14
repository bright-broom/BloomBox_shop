import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { CustomerIdentityUnavailableError, type CustomerIdentity, type CustomerIdentityRepository } from "../application/customer-identity";

const subjectSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const identitySchema = z.object({ customer_id: z.uuid(), version: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), status: z.literal("ACTIVE") });
export class PostgresCustomerIdentityRepository implements CustomerIdentityRepository {
  constructor(private readonly sql: DatabaseClient) {}
  async registerGoogleSubject(subject: string): Promise<CustomerIdentity> {
    if (!subjectSchema.safeParse(subject).success) throw new CustomerIdentityUnavailableError();
    try {
      return await this.sql.begin(async (tx) => {
        // Serialize only this verified Google identity; the unique constraint is the final guard.
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'google-customer:' + subject}, 0))`;
        const rows = await tx`SELECT identity.customer_id, account.version, account.status
          FROM bloombox.customer_identities identity JOIN bloombox.customer_accounts account ON account.id = identity.customer_id
          WHERE identity.provider = 'GOOGLE' AND identity.provider_subject = ${subject} FOR UPDATE OF account`;
        if (rows.length) {
          const row = identitySchema.parse(rows[0]);
          return { customerId: row.customer_id, version: row.version };
        }
        const customerId = randomUUID();
        await tx`INSERT INTO bloombox.customer_accounts (id, status) VALUES (${customerId}, 'ACTIVE')`;
        await tx`INSERT INTO bloombox.customer_identities (id, customer_id, provider, provider_subject, verified_at)
          VALUES (${randomUUID()}, ${customerId}, 'GOOGLE', ${subject}, clock_timestamp())`;
        await tx`INSERT INTO bloombox.audit_logs (id, actor_type, action, resource_type, resource_id, safe_metadata, occurred_at)
          VALUES (${randomUUID()}, 'CUSTOMER', 'customer.google_registered', 'customer_account', ${customerId}, '{}', clock_timestamp())`;
        return { customerId, version: 1 };
      });
    } catch { throw new CustomerIdentityUnavailableError(); }
  }
  async isActive(subject: string, identity: CustomerIdentity): Promise<boolean> {
    if (!subjectSchema.safeParse(subject).success || !z.uuid().safeParse(identity.customerId).success
      || !Number.isSafeInteger(identity.version) || identity.version < 1) return false;
    try {
      const rows = await this.sql`SELECT account.id FROM bloombox.customer_accounts account
        JOIN bloombox.customer_identities identity ON identity.customer_id = account.id
        WHERE account.id = ${identity.customerId} AND account.status = 'ACTIVE' AND account.version = ${identity.version}
          AND identity.provider = 'GOOGLE' AND identity.provider_subject = ${subject} AND identity.verified_at IS NOT NULL`;
      return rows.length === 1;
    } catch { throw new CustomerIdentityUnavailableError(); }
  }
}
