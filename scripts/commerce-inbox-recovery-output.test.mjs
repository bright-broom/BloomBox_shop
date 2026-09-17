import { describe, expect, it } from 'vitest';
import { formatInboxRecoveryOutput } from './commerce-inbox-recovery-output.mjs';
const fixture = () => ({ ok: true, inbox: { scope: 'CONFIGURED_STRIPE_ACCOUNT', summary: [{ status: 'FAILED', count: 1, oldest_at: '2026-09-17T00:00:00.000Z', purged_count: 1 }],
  entries: [{ external_event_id: 'evt_syntheticSafe001', status: 'FAILED', attempts: 12, received_at: '2026-09-17T00:00:00.000Z', payload_retained: false }], nextCursor: null },
  outbox: { scope: 'ALL_PROVIDERS', summary: [] } });
describe('public recovery workflow output', () => {
  it('logs validated metadata and ignores unselected private fields', () => {
    const response = { ...fixture(), payload: 'private address' };
    expect(formatInboxRecoveryOutput('inspect', response).lines.join()).not.toContain('private address');
  });
  it.each(['status', 'count', 'oldest_at', 'purged_count'])('rejects untrusted summary %s before returning output', (field) => {
    const data = fixture(); data.inbox.summary[0][field] = { private: 'address' };
    expect(() => formatInboxRecoveryOutput('inspect', data)).toThrow('Invalid recovery response');
  });
  it.each(['status', 'external_event_id', 'received_at', 'attempts', 'payload_retained'])('rejects untrusted entry %s', (field) => {
    const data = fixture(); data.inbox.entries[0][field] = 'private address'; expect(() => formatInboxRecoveryOutput('inspect', data)).toThrow();
  });
  it('rejects unexpected cursor and unbounded pages', () => {
    const data = fixture(); data.inbox.nextCursor = 'private address'; expect(() => formatInboxRecoveryOutput('inspect', data)).toThrow();
    data.inbox.nextCursor = null; data.inbox.entries = Array(51).fill(data.inbox.entries[0]); expect(() => formatInboxRecoveryOutput('inspect', data)).toThrow();
  });
  it('accepts only known restore outcomes', () => {
    expect(formatInboxRecoveryOutput('restore', { outcome: 'RESTORED' }).successful).toBe(true);
    expect(formatInboxRecoveryOutput('restore', { outcome: 'EVENT_MISMATCH' }).successful).toBe(false);
    expect(() => formatInboxRecoveryOutput('restore', { outcome: 'private address' })).toThrow();
  });
});
