import { BUSINESS_TIME_ZONE } from "@/shared/domain/time";

export const DELIVERY_LEAD_TIME_DAYS = 3;

export function getEarliestDeliveryDate(now: Date = new Date()): string {
  const earliest = new Date(now.getTime());
  earliest.setUTCDate(earliest.getUTCDate() + DELIVERY_LEAD_TIME_DAYS);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(earliest);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function isAvailableDeliveryDate(value: string, now: Date = new Date()): boolean {
  return isIsoCalendarDate(value) && value >= getEarliestDeliveryDate(now);
}

export function assertAvailableDeliveryDate(value: string, now: Date = new Date()): void {
  if (!isAvailableDeliveryDate(value, now)) throw new DeliveryDateUnavailableError();
}

export class DeliveryDateUnavailableError extends Error {
  constructor() {
    super("お届け可能な日付を選択してください。");
    this.name = "DeliveryDateUnavailableError";
  }
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
