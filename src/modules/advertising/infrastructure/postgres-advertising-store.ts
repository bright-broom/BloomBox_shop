import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseClient } from "@/shared/infrastructure/database/postgres-client";
import { AesGcmDataProtector } from "@/shared/infrastructure/security/aes-gcm-data-protector";
import { AD_CONSENT_DAYS, hasAttribution, type AdAttribution, type PurchaseConversion } from "../domain/conversion";
import type { AdvertisingDestination, AdvertisingDeliveryStore, AdvertisingJob } from "../application/deliver-conversions";
export const clickIdSchema = z.string().regex(/^[A-Za-z0-9_.~-]{1,512}$/);
export const attributionSchema = z.object({
  gclid: clickIdSchema.optional(), gbraid: clickIdSchema.optional(), wbraid: clickIdSchema.optional(), fbclid: clickIdSchema.optional(),
  capturedAt: z.number().int().positive(), userAgent: z.string().max(512),
}).strict();
const eventSchema = z.object({ eventId: z.string().regex(/^purchase_[a-f0-9-]{36}$/), occurredAt: z.iso.datetime(), value: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal("JPY") }).strict();
const jobSchema = z.object({ id: z.uuid(), lease: z.uuid(), purchase_intent_id: z.uuid(), provider: z.enum(["google", "meta", "webhook"]), destination: z.string(), attempts: z.number().int(), event: eventSchema.nullable() });
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
export const AD_CONSENT_POLICY = "ads-measurement-v1";
export class PostgresAdvertisingStore implements AdvertisingDeliveryStore {
  constructor(private readonly sql: DatabaseClient, private readonly protector: AesGcmDataProtector) {}
  async active(token: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const rows = await this.sql`SELECT id FROM bloombox.advertising_consents WHERE token_hash = ${digest(token)} AND revoked_at IS NULL AND expires_at > now() AND attribution_ciphertext IS NOT NULL AND policy_version = ${AD_CONSENT_POLICY}`;
    return rows.length === 1;
  }
  async grant(attribution: AdAttribution): Promise<string> {
    const id = randomUUID(); const token = randomBytes(32).toString("hex");
    const encrypted = this.protector.protect(JSON.stringify(attributionSchema.parse(attribution)), `advertising:${id}`);
    await this.sql`INSERT INTO bloombox.advertising_consents (id, token_hash, policy_version, key_id, attribution_ciphertext, expires_at)
      VALUES (${id}, ${digest(token)}, ${AD_CONSENT_POLICY}, ${encrypted.keyId}, ${encrypted.ciphertext}, now() + ${AD_CONSENT_DAYS} * interval '1 day')`;
    return token;
  }
  async captureIfEmpty(token: string, attribution: AdAttribution): Promise<void> {
    if (![attribution.gclid, attribution.gbraid, attribution.wbraid, attribution.fbclid].some(Boolean)) return;
    await this.sql.begin(async (tx) => {
      const rows = await tx`SELECT id, key_id, attribution_ciphertext FROM bloombox.advertising_consents
        WHERE token_hash = ${digest(token)} AND revoked_at IS NULL AND expires_at > now()
        AND attribution_ciphertext IS NOT NULL FOR UPDATE`;
      if (!rows.length) return;
      const v = z.object({ id: z.uuid(), key_id: z.string(), attribution_ciphertext: z.instanceof(Buffer) }).parse(rows[0]);
      const old = attributionSchema.parse(JSON.parse(this.protector.unprotect({ keyId: v.key_id, ciphertext: v.attribution_ciphertext }, `advertising:${v.id}`)));
      if ([old.gclid, old.gbraid, old.wbraid, old.fbclid].some(Boolean)) return;
      const encrypted = this.protector.protect(JSON.stringify(attributionSchema.parse(attribution)), `advertising:${v.id}`);
      await tx`UPDATE bloombox.advertising_consents SET key_id = ${encrypted.keyId}, attribution_ciphertext = ${encrypted.ciphertext} WHERE id = ${v.id}`;
    });
  }
  async revoke(token: string): Promise<void> {
    await this.sql`UPDATE bloombox.advertising_consents SET revoked_at = coalesce(revoked_at, now()), attribution_ciphertext = NULL WHERE token_hash = ${digest(token)}`;
  }
  async bind(token: string, intentId: string, destinations: readonly Pick<AdvertisingDestination, "provider" | "fingerprint">[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL statement_timeout = '1500ms'");
      const rows = await tx`SELECT id, key_id, attribution_ciphertext FROM bloombox.advertising_consents
        WHERE token_hash = ${digest(token)} AND revoked_at IS NULL AND expires_at > now()
        AND attribution_ciphertext IS NOT NULL AND policy_version = ${AD_CONSENT_POLICY} FOR SHARE`;
      if (!rows.length) return;
      const consent = z.object({ id: z.uuid(), key_id: z.string(), attribution_ciphertext: z.instanceof(Buffer) }).parse(rows[0]);
      const attribution = attributionSchema.parse(JSON.parse(this.protector.unprotect(
        { keyId: consent.key_id, ciphertext: consent.attribution_ciphertext }, `advertising:${consent.id}`,
      )));
      // Bind only clicks that already exist when checkout starts; later consent cannot backfill purchases.
      for (const destination of destinations) {
        if (!hasAttribution(destination.provider, attribution)) continue;
        await tx`INSERT INTO bloombox.advertising_deliveries (id, purchase_intent_id, consent_id, provider, destination)
          VALUES (${randomUUID()}, ${intentId}, ${consent.id}, ${destination.provider}, ${destination.fingerprint})
          ON CONFLICT (purchase_intent_id, provider) DO NOTHING`;
      }
    });
  }
  async clean(): Promise<void> { await cleanAdvertisingRecords(this.sql); }
  async claim(): Promise<AdvertisingJob | null> {
    const rows = await this.sql`UPDATE bloombox.advertising_deliveries SET status = 'sending', lease = ${randomUUID()}, available_at = now() + interval '2 minutes'
      WHERE id = (SELECT id FROM bloombox.advertising_deliveries WHERE status IN ('pending', 'sending') AND available_at <= now() AND expires_at > now() AND attempts < 5 ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, lease, purchase_intent_id, provider, destination, attempts, event`;
    if (!rows.length) return null;
    const v = jobSchema.parse(rows[0]);
    return { id: v.id, lease: v.lease, intentId: v.purchase_intent_id, provider: v.provider, destination: v.destination, attempts: v.attempts + 1, event: v.event };
  }
  async attribution(job: AdvertisingJob): Promise<AdAttribution | null> {
    const rows = await this.sql`SELECT c.id, c.key_id, c.attribution_ciphertext FROM bloombox.advertising_consents c
      JOIN bloombox.advertising_deliveries d ON d.consent_id = c.id WHERE d.id = ${job.id} AND d.lease = ${job.lease}
      AND c.revoked_at IS NULL AND c.expires_at > now() AND c.attribution_ciphertext IS NOT NULL AND c.policy_version = ${AD_CONSENT_POLICY}`;
    if (!rows.length) return null;
    const v = z.object({ id: z.uuid(), key_id: z.string(), attribution_ciphertext: z.instanceof(Buffer) }).parse(rows[0]);
    return attributionSchema.parse(JSON.parse(this.protector.unprotect({ keyId: v.key_id, ciphertext: v.attribution_ciphertext }, `advertising:${v.id}`)));
  }
  async snapshot(job: AdvertisingJob, event: PurchaseConversion): Promise<void> {
    const rows = await this.sql`UPDATE bloombox.advertising_deliveries SET event = coalesce(event, ${this.sql.json(event)}), attempts = attempts + 1
      WHERE id = ${job.id} AND lease = ${job.lease} AND status = 'sending' AND attempts < 5 RETURNING id`;
    if (!rows.length) throw new AdvertisingLeaseLostError();
  }
  async finish(job: AdvertisingJob, status: "accepted" | "skipped" | "failed" | "pending", receipt?: string): Promise<void> {
    await this.sql`UPDATE bloombox.advertising_deliveries SET status = ${status}, lease = NULL, receipt = ${receipt ?? null}, available_at = now() + interval '5 minutes'
      WHERE id = ${job.id} AND lease = ${job.lease}`;
  }
}
class AdvertisingLeaseLostError extends Error { constructor() { super("Advertising delivery lease lost"); this.name = "AdvertisingLeaseLostError"; } }

export async function cleanAdvertisingRecords(sql: DatabaseClient): Promise<void> {
    await sql`UPDATE bloombox.advertising_consents SET attribution_ciphertext = NULL WHERE expires_at <= now() AND attribution_ciphertext IS NOT NULL`;
    await sql`UPDATE bloombox.advertising_deliveries SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'skipped' END, lease = NULL
      WHERE status IN ('pending', 'sending') AND available_at <= now() AND (expires_at <= now() OR attempts >= 5)`;
    await sql`DELETE FROM bloombox.advertising_deliveries WHERE created_at < now() - interval '90 days'`;
    await sql`DELETE FROM bloombox.advertising_consents c WHERE c.expires_at <= now() AND NOT EXISTS (SELECT 1 FROM bloombox.advertising_deliveries d WHERE d.consent_id = c.id)`;
}
