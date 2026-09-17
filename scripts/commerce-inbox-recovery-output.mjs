const outcomes = new Set(['RESTORED', 'NOT_FOUND', 'NOT_FAILED', 'PAYLOAD_RETAINED', 'ALREADY_RESTORED', 'PROVIDER_UNAVAILABLE', 'EVENT_MISMATCH']);
const inboxStatuses = new Set(['PENDING', 'PROCESSING', 'FAILED']);
const outboxStatuses = new Set(['PENDING', 'FAILED']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventId = /^evt_[A-Za-z0-9]{8,255}$/;
function requireValid(condition) { if (!condition) throw new Error('Invalid recovery response'); }
function record(value) { requireValid(value !== null && typeof value === 'object' && !Array.isArray(value)); return value; }
function integer(value) { requireValid(Number.isSafeInteger(value) && value >= 0); return value; }
function timestamp(value) { requireValid(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))); return value; }
function array(value, maximum) { requireValid(Array.isArray(value) && value.length <= maximum); return value; }

/** Construct the entire safe result before logging anything. Never serialize arbitrary server values. */
export function formatInboxRecoveryOutput(operation, response) {
  const data = record(response);
  if (operation === 'restore') { requireValid(outcomes.has(data.outcome)); return { lines: [data.outcome], successful: data.outcome === 'RESTORED' }; }
  requireValid(operation === 'inspect' && data.ok === true);
  const inbox = record(data.inbox); const outbox = record(data.outbox);
  requireValid(inbox.scope === 'CONFIGURED_STRIPE_ACCOUNT' && outbox.scope === 'ALL_PROVIDERS');
  const lines = [];
  for (const [queue, value, statuses] of [['inbox', inbox, inboxStatuses], ['outbox', outbox, outboxStatuses]]) {
    for (const valueRow of array(value.summary, statuses.size)) {
      const row = record(valueRow); requireValid(statuses.has(row.status));
      lines.push(JSON.stringify({ queue, status: row.status, count: integer(row.count), oldestAt: timestamp(row.oldest_at),
        ...(queue === 'inbox' ? { purgedCount: integer(row.purged_count) } : {}) }));
    }
  }
  for (const value of array(inbox.entries, 50)) {
    const row = record(value); requireValid(typeof row.external_event_id === 'string' && eventId.test(row.external_event_id)
      && inboxStatuses.has(row.status) && typeof row.payload_retained === 'boolean');
    lines.push(JSON.stringify({ event: row.external_event_id, status: row.status, attempts: integer(row.attempts),
      receivedAt: timestamp(row.received_at), payloadRetained: row.payload_retained }));
  }
  requireValid(inbox.nextCursor === null || (typeof inbox.nextCursor === 'string' && uuid.test(inbox.nextCursor)));
  lines.push(JSON.stringify({ nextCursor: inbox.nextCursor }));
  return { lines, successful: true };
}
