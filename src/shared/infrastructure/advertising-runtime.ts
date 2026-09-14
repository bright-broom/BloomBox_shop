import { cookies } from "next/headers";
import { DeliverAdvertisingConversions } from "@/modules/advertising/public";
import { PostgresAdvertisingStore, cleanAdvertisingRecords } from "@/modules/advertising/infrastructure/postgres-advertising-store";
import { createAdvertisingDestinations } from "@/modules/advertising/infrastructure/destinations";
import { PostgresAdvertisingPurchaseQuery } from "@/modules/order/infrastructure/postgres-advertising-purchase-query";
import { getApplicationDatabaseClient, getWorkerDatabaseClient } from "./database/database-connections";
import { loadAdvertisingConfig, type AdvertisingConfig } from "./config/advertising-config";
import { loadDataProtectionConfig } from "./config/data-protection-config";
import { AesGcmDataProtector } from "./security/aes-gcm-data-protector";
import { reportUnexpectedError } from "./observability/report-unexpected-error";
export function advertisingCookieName(config: AdvertisingConfig) {
  return config.origin.startsWith("https:") ? "__Host-bloombox.ad-consent" : "bloombox.ad-consent";
}
export function advertisingPublicSettings() {
  try { const config = loadAdvertisingConfig(); return { enabled: config.enabled, preview: !config.live }; }
  catch (error) { reportUnexpectedError(error, { operation: "advertising_configuration" }); return { enabled: false, preview: true }; }
}
export function advertisingStore(worker = false) {
  return new PostgresAdvertisingStore(worker ? getWorkerDatabaseClient() : getApplicationDatabaseClient(), new AesGcmDataProtector(loadDataProtectionConfig()));
}
/** Best effort attribution must never convert a successful checkout into an error. */
export async function bindAdvertisingCheckout(intentId: string, provider: string, reference: string): Promise<void> {
  try {
    const config = loadAdvertisingConfig();
    if (!config.enabled || !config.live || provider !== "STRIPE" || !/^cs_live_[A-Za-z0-9]+$/.test(reference)) return;
    const token = (await cookies()).get(advertisingCookieName(config))?.value;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    await advertisingStore().bind(token, intentId, createAdvertisingDestinations(config));
  } catch (error) { reportUnexpectedError(error, { operation: "advertising_bind_checkout" }); }
}
export async function deliverAdvertising() {
  const config = loadAdvertisingConfig();
  if (!config.enabled || !config.live) return { disabled: true };
  const store = advertisingStore(true);
  await store.clean();
  const query = new PostgresAdvertisingPurchaseQuery(getWorkerDatabaseClient());
  return new DeliverAdvertisingConversions(store, (id) => query.findConfirmedPurchase(id), createAdvertisingDestinations(config),
    (error) => reportUnexpectedError(error, { operation: "advertising_delivery" })).execute();
}

export async function cleanAdvertising(): Promise<void> { await cleanAdvertisingRecords(getWorkerDatabaseClient()); }
