/** All scheduling uses Asia/Jakarta (WIB). */

export const DELIVERY_TIMEZONE = 'Asia/Jakarta';

/** JS weekday 0=Sunday … 6=Saturday, evaluated on the calendar day in Jakarta. */
export type ClosedWeekdays = readonly number[];

export function getJakartaDateString(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: DELIVERY_TIMEZONE });
}

/** Weekday 0–6 for a YYYY-MM-DD interpreted as that calendar day in Jakarta. */
export function jakartaWeekday(ymd: string): number {
  return new Date(`${ymd}T12:00:00+07:00`).getUTCDay();
}

export function getJakartaHour(d: Date = new Date()): number {
  return parseInt(
    d.toLocaleString('en-US', { timeZone: DELIVERY_TIMEZONE, hour: 'numeric', hour12: false }),
    10,
  );
}

export function isWeekdayClosed(ymd: string, closedWeekdays: ClosedWeekdays): boolean {
  if (!closedWeekdays || closedWeekdays.length === 0) return false;
  const w = jakartaWeekday(ymd);
  return closedWeekdays.includes(w);
}

/** Calendar day +1 in Jakarta (simple UTC date advance). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  const s = dt.toLocaleDateString('en-CA', { timeZone: DELIVERY_TIMEZONE });
  return s;
}

/**
 * First eligible delivery date (YYYY-MM-DD) from "today" in Jakarta:
 * - If now is on or after cutoff hour, earliest calendar day is tomorrow.
 * - Then skip any closed_weekdays until an open day.
 */
export function getMinimumDeliveryDate(
  now: Date,
  orderCutoffHour: number,
  closedWeekdays: ClosedWeekdays,
): string {
  const today = getJakartaDateString(now);
  const hour = getJakartaHour(now);
  let candidate = hour >= orderCutoffHour ? addDaysYmd(today, 1) : today;
  let guard = 0;
  while (isWeekdayClosed(candidate, closedWeekdays) && guard < 14) {
    candidate = addDaysYmd(candidate, 1);
    guard += 1;
  }
  return candidate;
}

/** Advance ymd until weekday not in closed_weekdays (inclusive). */
export function snapToNextOpenDay(ymd: string, closedWeekdays: ClosedWeekdays): string {
  let candidate = ymd;
  let guard = 0;
  while (isWeekdayClosed(candidate, closedWeekdays) && guard < 14) {
    candidate = addDaysYmd(candidate, 1);
    guard += 1;
  }
  return candidate;
}

export function isDeliveryDateAllowed(
  chosenYmd: string,
  minYmd: string,
  closedWeekdays: ClosedWeekdays,
): boolean {
  if (chosenYmd < minYmd) return false;
  return !isWeekdayClosed(chosenYmd, closedWeekdays);
}
