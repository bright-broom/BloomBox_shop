import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { FulfillmentApprovalError, type FulfillmentOperatorIdentity } from "../application/approve-shopify-fulfillment";
import type { ApprovalSubmissionLimiter } from "../application/limit-approval-submissions";
import { APPROVAL_SUBMISSION_POLICY, assessApprovalSubmission } from "../domain/approval-submission-policy";

const actorSchema = z.object({ operatorId: z.uuid(), expiresAt: z.date() });
const attemptsSchema = z.array(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER))
  .max(APPROVAL_SUBMISSION_POLICY.maxAttempts);

/** A short separate transaction: failed approval work must not refund its consumed allowance. */
export class PostgresApprovalSubmissionLimiter implements ApprovalSubmissionLimiter {
  constructor(private readonly sql: DatabaseClient, private readonly identity: FulfillmentOperatorIdentity) {}

  async consume(): Promise<void> {
    try {
      const authenticated = actorSchema.safeParse(await this.identity.current());
      if (!authenticated.success) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
      const actor = authenticated.data;
      const allowed = await this.sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '1s'`;
        await tx`SET LOCAL statement_timeout = '2s'`;
        await tx`INSERT INTO bloombox.fulfillment_approval_submission_limits (operator_id)
          VALUES (${actor.operatorId}) ON CONFLICT (operator_id) DO NOTHING`;
        const [row] = await tx`SELECT attempts FROM bloombox.fulfillment_approval_submission_limits
          WHERE operator_id = ${actor.operatorId} FOR UPDATE`;
        // A separate statement observes DB time after the row lock, including any wait.
        const [clock] = await tx`SELECT clock_timestamp() AS now`;
        const now = z.date().parse(clock?.now);
        if (actor.expiresAt <= now) throw new FulfillmentApprovalError("NOT_AUTHORIZED");
        const decision = assessApprovalSubmission(attemptsSchema.parse(row?.attempts), now.getTime());
        if (!decision.allowed) return false;
        await tx`UPDATE bloombox.fulfillment_approval_submission_limits
          SET attempts = ${tx.json([...decision.attempts])}, updated_at = ${now}
          WHERE operator_id = ${actor.operatorId}`;
        return true;
      });
      if (!allowed) throw new FulfillmentApprovalError("RATE_LIMITED");
    } catch (error) {
      if (error instanceof FulfillmentApprovalError) throw error;
      // Missing migration/grants, contention timeouts and corrupt state all fail closed.
      throw new FulfillmentApprovalError("UNAVAILABLE");
    }
  }
}
