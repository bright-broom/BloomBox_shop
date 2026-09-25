import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import {
  EXPECTED_NOTIFICATION_SKIPS,
  NOTIFICATION_ATTENTION_DAYS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_SEND_WINDOW_HOURS,
} from "../domain/notification";

const eventTypes = Object.keys(NOTIFICATION_EVENT_TYPES);
const countRow = z.object({ undelivered: z.number().int().nonnegative() });

/**
 * Counts recent buyer notifications that will never reach the buyer: the provider rejected them, retries ran out,
 * the facts were missing, or the send window closed while retrying. Events never attempted, such as those queued
 * while delivery was disabled, are not counted, so enabling delivery does not raise an alert for an old backlog.
 * Only a count leaves the database.
 */
export class PostgresUndeliveredNotifications {
  constructor(private readonly sql: DatabaseClient) {}

  async count(): Promise<number> {
    const rows = await this.sql`
      SELECT count(*)::int AS undelivered
      FROM bloombox.outbox_events
      WHERE event_type IN ${this.sql(eventTypes)}
        AND occurred_at > clock_timestamp() - make_interval(days => ${NOTIFICATION_ATTENTION_DAYS})
        AND (
          (status = 'FAILED' AND (last_error_code IS NULL OR last_error_code NOT IN ${this.sql(EXPECTED_NOTIFICATION_SKIPS)}))
          OR (
            status = 'PENDING' AND attempts > 0
            AND (
              occurred_at <= clock_timestamp() - make_interval(hours => ${NOTIFICATION_SEND_WINDOW_HOURS})
              OR attempts >= ${NOTIFICATION_MAX_ATTEMPTS}
            )
          )
        )
    `;
    return countRow.parse(rows[0]).undelivered;
  }
}
