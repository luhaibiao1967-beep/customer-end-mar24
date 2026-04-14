# Later Pay Outstanding Block Rules

This document defines how later_pay customers are blocked from creating new orders when previous orders are still unpaid (outstanding).

## Scope

- Applies to customers with `customer_type = later_pay`
- Applies during new order creation in `submit-order`
- Pre-pay (`customer_type = pre_pay`) is not covered by these rules

## Core Rule

For each unpaid **delivered** order, calculate a `grace_until` date from the customer's `payment_term`.

If `today (Asia/Jakarta) > grace_until` for at least one unpaid delivered order, then new order creation must be blocked.

Return error code:

- `OUTSTANDING_PAYMENT_BLOCKED`

UI should show a clear message that customer must settle outstanding bills before placing a new order.

## Grace Window by Payment Term

### Daily

- Rule: if yesterday/previous delivered order is still unpaid, block today.
- Formula: `grace_until = order.delivery_date`

### Weekly

- Rule: if last week's delivered orders are still unpaid, customer can still order in current week, but is blocked starting next week.
- Formula: `grace_until = Sunday of order week` (week = Monday..Sunday, Jakarta timezone)

### Monthly

- Rule: if current month's outstanding exists, customer can still order until the 20th; blocked after the 20th.
- Formula: `grace_until = YYYY-MM-20` of the order month

### Quarterly

- Rule requested by business: if previous quarter's bill is outstanding, customer can still order in this month; blocked after the 20th of next month.
- Formula used in code: `grace_until = 20th of next calendar month` from order month

## Implementation

- Backend enforcement:
  - `supabase/functions/submit-order/index.ts`
  - Calculates term-based grace date and throws `OUTSTANDING_PAYMENT_BLOCKED` when overdue outstanding exists

- Frontend pre-check and user warning:
  - `src/Pages/PlaceOrder.tsx`
  - Uses the same term logic for early block UI and maps `OUTSTANDING_PAYMENT_BLOCKED` to existing unpaid warning display

## Notes

- Time basis is `Asia/Jakarta`.
- Only `payment_status = unpaid` and `status = delivered` orders are counted for this blocking rule.
- Credit limit logic remains separate and still uses `CREDIT_LIMIT_EXCEEDED`.
- Valid `customers.payment_term` values include `daily`, `weekly`, `biweekly`, `monthly`, and `quarterly`.
