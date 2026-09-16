import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseTransaction } from "@/shared/infrastructure/database/postgres-client";
import type { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { AccountPortalError, ACCOUNT_LIMITS } from "../domain/customer-portal";
import { requestBodySchema, revisionSchema } from "./customer-portal-schema";
import { requestRowSchema } from "./postgres-customer-portal";
export const requestReplySchema = z
  .object({
    id: z.uuid(),
    revision: revisionSchema,
    status: z.enum(["REPLIED", "CLOSED"]),
    reply: requestBodySchema.shape.reply.trim().min(1),
  })
  .strict();
export class PostgresCustomerRequests {
  constructor(
    private readonly tx: DatabaseTransaction,
    private readonly protector: AesGcmDataProtector,
  ) {}
  async list(closed = false) {
    const rows = await this
      .tx`SELECT * FROM bloombox.customer_requests WHERE (status = 'CLOSED') = ${closed} ORDER BY updated_at ASC, id ASC LIMIT ${ACCOUNT_LIMITS.queue}`;
    return rows.map((raw) => {
      const row = requestRowSchema.parse(raw);
      const body = requestBodySchema.parse(
        JSON.parse(
          this.protector.unprotect(
            { keyId: row.key_id, ciphertext: row.ciphertext },
            `customer:${row.customer_id}:request:${row.id}:v1`,
          ),
        ),
      );
      return {
        id: row.id,
        customerId: row.customer_id,
        orderId: row.order_id,
        status: row.status,
        kind: row.kind,
        createdAt: row.created_at.toISOString(),
        revision: row.revision,
        ...body,
      };
    });
  }
  async reply(input: z.infer<typeof requestReplySchema>, operatorId: string) {
    const value = requestReplySchema.parse(input);
    const [raw] = await this
      .tx`SELECT * FROM bloombox.customer_requests WHERE id = ${value.id} FOR UPDATE`;
    if (!raw) throw new AccountPortalError("not-found");
    const row = requestRowSchema.parse(raw);
    if (row.revision !== value.revision)
      throw new AccountPortalError("conflict");
    const body = requestBodySchema.parse(
      JSON.parse(
        this.protector.unprotect(
          { keyId: row.key_id, ciphertext: row.ciphertext },
          `customer:${row.customer_id}:request:${row.id}:v1`,
        ),
      ),
    );
    const encrypted = this.protector.protect(
      JSON.stringify({ ...body, reply: value.reply }),
      `customer:${row.customer_id}:request:${row.id}:v1`,
    );
    await this
      .tx`UPDATE bloombox.customer_requests SET status = ${value.status}, key_id = ${encrypted.keyId}, ciphertext = ${encrypted.ciphertext}, revision = revision + 1, updated_at = clock_timestamp() WHERE id = ${value.id}`;
    await this
      .tx`INSERT INTO bloombox.customer_request_changes(id, request_id, operator_id, revision, status) VALUES (${randomUUID()}, ${value.id}, ${operatorId}, ${row.revision + 1}, ${value.status})`;
    return row.customer_id;
  }
  async privacyQueue() {
    const rows = await this
      .tx`SELECT id, customer_id, request_type, status, requested_at FROM bloombox.data_subject_requests WHERE status IN ('RECEIVED','VERIFYING','PROCESSING') ORDER BY requested_at, id LIMIT ${ACCOUNT_LIMITS.privacyQueue}`;
    return rows.map((row) =>
      z
        .object({
          id: z.uuid(),
          customer_id: z.uuid().nullable(),
          request_type: z.string(),
          status: z.string(),
          requested_at: z.date(),
        })
        .parse(row),
    );
  }
}
