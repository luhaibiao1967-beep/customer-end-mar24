/** Catalog rows shown in Place Order — keep postpaid home gallery in sync. */

export const CANONICAL_GALLON_REFILL_19_LITER = 'gallon refill 19 liter';

export function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isFeaturedRefill19Liter(p: { name: string }): boolean {
  return normalizeProductName(p.name) === CANONICAL_GALLON_REFILL_19_LITER;
}

/** Hide collection/recovery SKUs (operator enters those). */
export function isCustomerHiddenProductName(lower: string): boolean {
  if (lower.includes('sample')) return true;
  if (lower.includes('empty gallon collection')) return true;
  if (lower.includes('empty') && lower.includes('collection')) return true;
  return false;
}

/** Sort: refill first → new gallon second → accessories last */
export function getProductSortOrder(name: string, is_refill: boolean): number {
  const lower = name.toLowerCase();
  if (is_refill || lower.includes('refill')) return 0;
  if ((lower.includes('gallon') || lower.includes('galon')) && !lower.includes('rack')) return 1;
  return 2;
}

export function filterAndSortOrderableProducts<T extends { name: string; is_refill: boolean }>(
  rows: T[] | null | undefined,
  branch: string,
): T[] {
  const filtered = (rows || []).filter((p) => {
    const lower = p.name.toLowerCase();
    if (isCustomerHiddenProductName(lower)) return false;
    if (lower.includes('test') && branch !== 'Demo') return false;
    return true;
  });
  filtered.sort((a, b) => {
    const fa = isFeaturedRefill19Liter(a) ? 0 : 1;
    const fb = isFeaturedRefill19Liter(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const o = getProductSortOrder(a.name, a.is_refill) - getProductSortOrder(b.name, b.is_refill);
    if (o !== 0) return o;
    return a.name.localeCompare(b.name);
  });
  return filtered;
}
