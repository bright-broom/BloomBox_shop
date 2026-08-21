import { BUSINESS_TIME_ZONE } from "@/shared/domain/time";

export const DELIVERY_LEAD_TIME_DAYS = 3;
export const DELIVERY_BOOKING_WINDOW_DAYS = 60;

export function getEarliestDeliveryDate(now: Date = new Date()): string {
  return dateInBusinessTimeZone(addDays(now, DELIVERY_LEAD_TIME_DAYS));
}

export function getLatestDeliveryDate(now: Date = new Date()): string {
  return dateInBusinessTimeZone(addDays(now, DELIVERY_BOOKING_WINDOW_DAYS));
}

function addDays(now: Date, days: number): Date {
  const value = new Date(now.getTime());
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function dateInBusinessTimeZone(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function isAvailableDeliveryDate(value: string, now: Date = new Date()): boolean {
  return isIsoCalendarDate(value)
    && value >= getEarliestDeliveryDate(now)
    && value <= getLatestDeliveryDate(now);
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
