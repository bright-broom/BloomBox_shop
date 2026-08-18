const DELIVERY_LEAD_TIME_DAYS = 3;
const TOKYO_TIME_ZONE = "Asia/Tokyo";

export function getEarliestDeliveryDate(now: Date = new Date()): string {
  const earliest = new Date(now.getTime());
  earliest.setUTCDate(earliest.getUTCDate() + DELIVERY_LEAD_TIME_DAYS);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(earliest);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function isAvailableDeliveryDate(value: string, now: Date = new Date()): boolean {
  return value >= getEarliestDeliveryDate(now);
}
