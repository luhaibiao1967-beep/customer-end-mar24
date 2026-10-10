import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

/** Inlined: Supabase deploy bundles one function folder — ../_shared is not uploaded. */
async function getProductVoucherRow(
  supabase: SupabaseClient,
  customerId: string,
  productId: string,
): Promise<{ balance: number; gift_balance: number }> {
  const { data, error } = await supabase
    .from('customer_product_vouchers')
    .select('balance, gift_balance')
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .maybeSingle()
  if (error) throw new Error('FAILED_TO_VALIDATE_VOUCHER_BALANCE')

  const balance = Number(data?.balance ?? 0)
  const giftBalance = Number(data?.gift_balance ?? 0)
  if (
    !Number.isSafeInteger(balance) ||
    balance < 0 ||
    !Number.isSafeInteger(giftBalance) ||
    giftBalance < 0 ||
    giftBalance > balance
  ) {
    throw new Error('INVALID_VOUCHER_BALANCE')
  }
  return {
    balance,
    gift_balance: giftBalance,
  }
}

function splitGiftAndPaidVoucherQty(
  quantity: number,
  giftBalance: number,
): { from_gift: number; from_paid: number } {
  const from_gift = Math.min(quantity, Math.max(0, giftBalance))
  return { from_gift, from_paid: quantity - from_gift }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CheckoutDisposition = 'discard_key' | 'retry_same_key' | 'manual_reconcile'

function checkoutDispositionForError(message: string): CheckoutDisposition {
  if (
    message.includes('CONFLICT') ||
    message.includes('PREPAY_LATE_PAYMENT') ||
    message.includes('MIDTRANS_GROSS_AMOUNT_MISMATCH') ||
    message.includes('MIDTRANS_ORDER_ID_MISMATCH') ||
    message.includes('PREPAY_CHECKOUT_CUSTOMER_MISMATCH')
  ) {
    return 'manual_reconcile'
  }

  if (
    message === 'Token required' ||
    message === 'Order data required' ||
    message === 'Invalid token' ||
    message === 'Only pre_pay customers use this payment path' ||
    message === 'Invalid delivery date' ||
    message === 'INVALID_PREPAY_CHECKOUT_KEY' ||
    message === 'INVALID_ORDER_NOTE' ||
    message === 'ORDER_TOTAL_CHANGED' ||
    message === 'PAYMENT_AMOUNT_CHANGED' ||
    message === 'DELIVERY_DATE_TOO_SOON' ||
    message === 'DELIVERY_DATE_BRANCH_CLOSED' ||
    message.includes('PREPAY_CHECKOUT_RELEASED') ||
    message.includes('PREPAY_CHECKOUT_ALREADY_RELEASED') ||
    message.includes('PREPAY_CHECKOUT_IDENTITY_REQUIRED') ||
    message.includes('DELIVERY_DATE_REQUIRED') ||
    message.includes('ORDER_NOTE_TOO_LONG') ||
    message.includes('INVALID_ORDER_') ||
    message.includes('INVALID_PRODUCT_DEDUCTION') ||
    message.includes('INVALID_PAYMENT_AMOUNT') ||
    message.includes('INVALID_PREPAY_AMOUNT') ||
    message.includes('INVALID_OR_INACTIVE_PRODUCT') ||
    message.includes('PAID_VOUCHER_COST_BASIS_MISSING') ||
    message.includes('VOUCHER_UNIT_AMOUNT_INVALID') ||
    message.includes('VOUCHER_ITEM_SPLIT_') ||
    message.includes('INSUFFICIENT_OR_INVALID_VOUCHER_BALANCE') ||
    message.includes('VOUCHER_BALANCE_CHANGED') ||
    message.includes('CUSTOMER_NOT_FOUND') ||
    message.includes('CUSTOMER_IS_') ||
    message.includes('CUSTOMER_PROFILE_INCOMPLETE') ||
    message.includes('SERVICE_BRANCH_NOT_FOUND') ||
    message.includes('DELIVERY_SCHEDULE_INVALID') ||
    message.startsWith('MIDTRANS_SNAP_REJECTED_')
  ) {
    return 'discard_key'
  }

  // Unknown external/database outcomes may have committed. Retaining the key
  // is the conservative default and lets a retry reconcile the same checkout.
  return 'retry_same_key'
}

function jakartaWeekdayFromYmd(ymd: string): number {
  return new Date(`${ymd}T12:00:00+07:00`).getUTCDay()
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0))
  return dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

function computeMinDeliveryYmd(now: Date, cutoffHour: number, closed: number[]): string {
  const ymd = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }).format(now),
    10,
  )
  let c = hour >= cutoffHour ? addDaysYmd(ymd, 1) : ymd
  let g = 0
  while (closed.includes(jakartaWeekdayFromYmd(c)) && g < 14) {
    c = addDaysYmd(c, 1)
    g += 1
  }
  return c
}

function validateDeliveryDate(
  deliveryYmd: string,
  cutoffHour: number,
  closedWeekdays: number[],
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryYmd)) return 'Invalid delivery date'
  const min = computeMinDeliveryYmd(new Date(), cutoffHour, closedWeekdays)
  if (deliveryYmd < min) return 'DELIVERY_DATE_TOO_SOON'
  if (closedWeekdays.includes(jakartaWeekdayFromYmd(deliveryYmd))) return 'DELIVERY_DATE_BRANCH_CLOSED'
  return null
}

interface OrderItem {
  product_id?: string
  product: string
  is_refill: boolean
  quantity: number
  unit_price: number
  discount: number
}

interface ProductDeduction {
  product_id: string
  quantity: number
}

interface VoucherSplitPlan {
  product_id: string
  quantity: number
  from_gift: number
  from_paid: number
}

interface CanonicalProduct {
  id: string
  name: string
  price: number
  is_refill: boolean
}

interface ActiveProductCatalog {
  byId: Map<string, CanonicalProduct>
  // A null value means more than one active product has the same normalized name.
  byName: Map<string, CanonicalProduct | null>
}

interface RequestBody {
  token: string
  checkout_key: string
  order: {
    delivery_date: string
    note?: string | null
    total_amount?: number
  }
  items: OrderItem[]
  payment_amount?: number
  product_deductions?: ProductDeduction[]
}

async function buildVoucherSplitPlans(
  supabase: SupabaseClient,
  customerId: string,
  productDeductions: ProductDeduction[],
): Promise<VoucherSplitPlan[]> {
  const plans: VoucherSplitPlan[] = []
  for (const deduction of productDeductions) {
    const row = await getProductVoucherRow(supabase, customerId, deduction.product_id)
    if (row.balance < deduction.quantity) {
      throw new Error(`Insufficient vouchers for product (need ${deduction.quantity}, have ${row.balance})`)
    }
    const { from_gift, from_paid } = splitGiftAndPaidVoucherQty(deduction.quantity, row.gift_balance)
    plans.push({
      product_id: deduction.product_id,
      quantity: deduction.quantity,
      from_gift,
      from_paid,
    })
  }
  return plans
}

async function loadActiveProductCatalog(
  supabase: SupabaseClient,
): Promise<ActiveProductCatalog> {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, is_refill')
    .eq('status', 'active')
  if (error) throw new Error('FAILED_TO_LOAD_PRODUCTS')

  const byId = new Map<string, CanonicalProduct>()
  const byName = new Map<string, CanonicalProduct | null>()
  for (const raw of products || []) {
    const id = String(raw.id || '').trim().toLowerCase()
    const name = String(raw.name || '').trim()
    const price = Number(raw.price)
    if (!UUID_RE.test(id) || !name || !Number.isSafeInteger(price) || price < 0) {
      throw new Error('INVALID_ACTIVE_PRODUCT_DATA')
    }

    const product: CanonicalProduct = {
      id,
      name,
      price,
      is_refill: Boolean(raw.is_refill),
    }
    byId.set(id, product)

    const nameKey = name.toLowerCase()
    if (byName.has(nameKey)) {
      byName.set(nameKey, null)
    } else {
      byName.set(nameKey, product)
    }
  }

  return { byId, byName }
}

function normalizeProductDeductions(
  rawDeductions: ProductDeduction[] | undefined,
): ProductDeduction[] {
  if (rawDeductions === undefined) return []
  if (!Array.isArray(rawDeductions)) throw new Error('INVALID_PRODUCT_DEDUCTIONS')

  const aggregated = new Map<string, number>()
  for (const raw of rawDeductions) {
    const productId = typeof raw?.product_id === 'string'
      ? raw.product_id.trim().toLowerCase()
      : ''
    if (
      !UUID_RE.test(productId) ||
      !Number.isSafeInteger(raw?.quantity) ||
      raw.quantity <= 0
    ) {
      throw new Error('INVALID_PRODUCT_DEDUCTION')
    }

    const quantity = (aggregated.get(productId) || 0) + raw.quantity
    if (!Number.isSafeInteger(quantity)) throw new Error('INVALID_PRODUCT_DEDUCTION')
    aggregated.set(productId, quantity)
  }

  return [...aggregated].map(([product_id, quantity]) => ({ product_id, quantity }))
}

/**
 * Build the immutable checkout payload before reading any mutable catalog or
 * voucher state. The database validates product activity, prices, and balances
 * inside the same transaction that creates the reservation.
 */
function normalizeCheckoutItems(items: OrderItem[]): { product_id: string; quantity: number }[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new Error('INVALID_ORDER_ITEMS')
  }

  const aggregated = new Map<string, number>()
  for (const item of items) {
    const productId = typeof item?.product_id === 'string'
      ? item.product_id.trim().toLowerCase()
      : ''
    if (
      !UUID_RE.test(productId) ||
      !Number.isSafeInteger(item?.quantity) ||
      item.quantity <= 0
    ) {
      throw new Error('INVALID_ORDER_ITEM')
    }

    const quantity = checkedQuantityAdd(aggregated.get(productId) || 0, item.quantity)
    aggregated.set(productId, quantity)
  }

  return [...aggregated]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product_id, quantity]) => ({ product_id, quantity }))
}

function resolveActiveProduct(
  item: OrderItem,
  catalog: ActiveProductCatalog,
): CanonicalProduct {
  const explicitProductId = (item as { product_id?: unknown }).product_id
  if (explicitProductId !== undefined && explicitProductId !== null) {
    if (typeof explicitProductId !== 'string') throw new Error('INVALID_ORDER_PRODUCT')
    const productId = explicitProductId.trim().toLowerCase()
    if (!UUID_RE.test(productId)) throw new Error('INVALID_ORDER_PRODUCT')
    const product = catalog.byId.get(productId)
    if (!product) throw new Error('INVALID_ORDER_PRODUCT')
    return product
  }

  const identifier = String((item as { product?: unknown }).product || '').trim()
  if (!identifier) throw new Error('INVALID_ORDER_PRODUCT')
  if (UUID_RE.test(identifier)) {
    const product = catalog.byId.get(identifier.toLowerCase())
    if (!product) throw new Error('INVALID_ORDER_PRODUCT')
    return product
  }

  const product = catalog.byName.get(identifier.toLowerCase())
  if (product === null) throw new Error('AMBIGUOUS_ORDER_PRODUCT')
  if (!product) throw new Error('INVALID_ORDER_PRODUCT')
  return product
}

function checkedQuantityAdd(current: number, addition: number): number {
  const result = current + addition
  if (!Number.isSafeInteger(result)) throw new Error('INVALID_ORDER_QUANTITY')
  return result
}

function checkedMoneyAdd(current: number, unitAmount: number, quantity: number): number {
  const lineAmount = unitAmount * quantity
  const result = current + lineAmount
  if (!Number.isSafeInteger(lineAmount) || !Number.isSafeInteger(result)) {
    throw new Error('INVALID_ORDER_TOTAL')
  }
  return result
}

function validateOrderItemsAndCalculateAmounts(
  items: OrderItem[],
  plans: VoucherSplitPlan[],
  catalog: ActiveProductCatalog,
): { totalAmount: number; qrisAmount: number; normalizedItems: OrderItem[] } {
  if (!Array.isArray(items) || items.length === 0) throw new Error('INVALID_ORDER_ITEMS')

  const quantities = new Map<string, {
    product: CanonicalProduct
    total: number
  }>()

  for (const item of items) {
    // Product identity and quantity are the only client-owned line inputs.
    // Price, discount, name, and refill flags are rebuilt from the active catalog.
    if (
      !item ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new Error('INVALID_ORDER_ITEM')
    }

    const product = resolveActiveProduct(item, catalog)
    const row = quantities.get(product.id) || { product, total: 0 }
    row.total = checkedQuantityAdd(row.total, item.quantity)
    quantities.set(product.id, row)
  }

  const plansByProduct = new Map(plans.map((plan) => [plan.product_id, plan]))
  for (const plan of plans) {
    if (!quantities.has(plan.product_id)) throw new Error('VOUCHER_ITEM_SPLIT_CHANGED')
  }

  const normalizedItems: OrderItem[] = []
  let totalAmount = 0
  let qrisAmount = 0

  for (const [productId, row] of quantities) {
    const plan = plansByProduct.get(productId)
    const voucherQty = plan?.quantity || 0
    const expectedGiftQty = plan?.from_gift || 0
    const paidVoucherQty = plan?.from_paid || 0

    if (row.product.price === 0 && voucherQty > 0) {
      throw new Error('VOUCHER_ITEM_SPLIT_CHANGED')
    }
    if (
      voucherQty > row.total ||
      expectedGiftQty > row.total ||
      paidVoucherQty > row.total - expectedGiftQty
    ) {
      throw new Error('VOUCHER_ITEM_SPLIT_CHANGED')
    }

    const pricedQty = row.total - expectedGiftQty
    const qrisQty = row.total - voucherQty
    totalAmount = checkedMoneyAdd(totalAmount, row.product.price, pricedQty)
    qrisAmount = checkedMoneyAdd(qrisAmount, row.product.price, qrisQty)

    if (expectedGiftQty > 0) {
      normalizedItems.push({
        product_id: productId,
        product: row.product.name,
        is_refill: row.product.is_refill,
        quantity: expectedGiftQty,
        unit_price: 0,
        discount: 0,
      })
    }
    if (pricedQty > 0) {
      normalizedItems.push({
        product_id: productId,
        product: row.product.name,
        is_refill: row.product.is_refill,
        quantity: pricedQty,
        unit_price: row.product.price,
        discount: 0,
      })
    }
  }

  if (qrisAmount > totalAmount) throw new Error('INVALID_PAYMENT_AMOUNT')
  return { totalAmount, qrisAmount, normalizedItems }
}

function assertOptionalAmountMatches(
  supplied: unknown,
  expected: number,
  mismatchError: string,
): void {
  if (supplied === undefined || supplied === null) return
  if (!Number.isSafeInteger(supplied) || supplied < 0 || supplied !== expected) {
    throw new Error(mismatchError)
  }
}

function asJsonObject(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode)
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode)
  return value.trim()
}

function requiredSafeInteger(value: unknown, errorCode: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(errorCode)
  return parsed
}

type PrepayReleaseReason =
  | 'snap_create_failed'
  | 'payment_expired'
  | 'payment_cancelled'
  | 'payment_denied'
  | 'payment_failed'

interface VerifiedMidtransStatus {
  body: Record<string, unknown>
  grossAmount: number | null
  paid: boolean
  transactionStatus: string
}

function parseGrossAmount(raw: unknown): number | null {
  const amount = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

function parseMidtransTime(body: Record<string, unknown>): string {
  const raw = body.settlement_time ?? body.transaction_time
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  return new Date().toISOString()
}

function releaseReasonForMidtransStatus(status: string): PrepayReleaseReason | null {
  if (status === 'expire') return 'payment_expired'
  if (status === 'cancel') return 'payment_cancelled'
  if (status === 'deny') return 'payment_denied'
  if (status === 'failure') return 'payment_failed'
  return null
}

async function fetchVerifiedMidtransStatus(
  midtransOrderId: string,
  serverKey: string,
  midtransEnv: string,
): Promise<VerifiedMidtransStatus | null> {
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'

  let response: Response
  try {
    response = await fetch(`${base}/${encodeURIComponent(midtransOrderId)}/status`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
    })
  } catch (error) {
    console.error('Midtrans status lookup failed:', error)
    throw new Error('PREPAY_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
  }

  if (response.status === 404) return null
  if (!response.ok) throw new Error(`PREPAY_STATUS_UNKNOWN_HTTP_${response.status}`)

  let body: Record<string, unknown>
  try {
    body = asJsonObject(await response.json(), 'INVALID_MIDTRANS_STATUS_RESPONSE')
  } catch (error) {
    console.error('Midtrans status response was invalid:', response.status, error)
    throw new Error('PREPAY_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
  }
  if (body.order_id !== midtransOrderId) throw new Error('MIDTRANS_ORDER_ID_MISMATCH')

  const transactionStatus = typeof body.transaction_status === 'string'
    ? body.transaction_status.trim().toLowerCase()
    : ''
  if (!transactionStatus) throw new Error('INVALID_MIDTRANS_STATUS_RESPONSE')
  const fraudStatus = typeof body.fraud_status === 'string'
    ? body.fraud_status.trim().toLowerCase()
    : ''
  const paid = transactionStatus === 'settlement' ||
    (transactionStatus === 'capture' && fraudStatus === 'accept')
  const grossAmount = parseGrossAmount(body.gross_amount)
  if ((paid || releaseReasonForMidtransStatus(transactionStatus)) && grossAmount === null) {
    throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
  }

  return { body, grossAmount, paid, transactionStatus }
}

async function cancelPendingMidtransTransaction(
  midtransOrderId: string,
  serverKey: string,
  midtransEnv: string,
): Promise<void> {
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
  try {
    await fetch(`${base}/${encodeURIComponent(midtransOrderId)}/cancel`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
    })
  } catch (error) {
    console.error('Midtrans cancel request outcome unknown:', error)
  }
}

function buildCheckoutItems(
  normalizedItems: OrderItem[],
): { product_id: string; quantity: number }[] {
  const quantities = new Map<string, number>()
  for (const item of normalizedItems) {
    const productId = String(item.product_id || '').trim().toLowerCase()
    if (!UUID_RE.test(productId)) throw new Error('INVALID_ORDER_PRODUCT')
    const quantity = checkedQuantityAdd(quantities.get(productId) || 0, item.quantity)
    quantities.set(productId, quantity)
  }
  return [...quantities]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([product_id, quantity]) => ({ product_id, quantity }))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body: RequestBody = await req.json()
    const { token, checkout_key, order, items, payment_amount, product_deductions } = body
    if (typeof token !== 'string' || !token.trim()) throw new Error('Token required')
    const checkoutKey = typeof checkout_key === 'string' ? checkout_key.trim().toLowerCase() : ''
    if (!UUID_RE.test(checkoutKey)) throw new Error('INVALID_PREPAY_CHECKOUT_KEY')
    if (!order || !Array.isArray(items) || items.length === 0) throw new Error('Order data required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    const clientKey = Deno.env.get('MIDTRANS_CLIENT_KEY')
    if (!supabaseUrl || !supabaseKey || !serverKey || !clientKey) {
      throw new Error('Missing required environment variables')
    }
    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const snapUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'
    const snapJsUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js'

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, address, whatsapp, branch, discount, customer_type')
      .eq('auth_token', token.trim())
      .maybeSingle()
    if (customerError) {
      throw new Error('CUSTOMER_LOOKUP_FAILED: ' + customerError.message)
    }
    if (!customer) throw new Error('Invalid token')
    if (
      typeof order.delivery_date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(order.delivery_date)
    ) {
      throw new Error('Invalid delivery date')
    }

    // The request identity must stay stable after the first transaction reserves
    // vouchers. Do not read current customer type, branch schedule, catalog, or
    // balances before the idempotent database lookup. The RPC validates all of
    // those mutable values only when it creates the reservation; an existing
    // checkout must remain recoverable even if they change later.
    const checkoutItems = normalizeCheckoutItems(items)
    const normalizedDeductions = normalizeProductDeductions(product_deductions)
    if (order.note != null && typeof order.note !== 'string') {
      throw new Error('INVALID_ORDER_NOTE')
    }
    const checkoutArgs = {
      p_customer_id: customer.id,
      p_checkout_key: checkoutKey,
      p_delivery_date: order.delivery_date,
      p_note: order.note == null ? null : order.note,
      p_items: checkoutItems,
      p_product_deductions: normalizedDeductions,
    }

    // The database owns the transaction boundary: order, items, voucher
    // reservation, breakdown, and ledger either all commit or all roll back.
    const { data: checkoutRaw, error: checkoutError } = await supabase.rpc(
      'create_customer_prepay_checkout',
      checkoutArgs,
    )
    if (checkoutError) throw new Error(checkoutError.message || 'PREPAY_CHECKOUT_CREATE_FAILED')

    const checkout = asJsonObject(checkoutRaw, 'INVALID_PREPAY_CHECKOUT_RESPONSE')
    const orderId = requiredString(checkout.order_id, 'INVALID_PREPAY_CHECKOUT_RESPONSE')
    const midtransOrderId = requiredString(
      checkout.midtrans_order_id,
      'INVALID_PREPAY_CHECKOUT_RESPONSE',
    )
    const authoritativeTotal = requiredSafeInteger(
      checkout.total_amount,
      'INVALID_PREPAY_CHECKOUT_RESPONSE',
    )
    const authoritativeQris = requiredSafeInteger(
      checkout.qris_charged_idr,
      'INVALID_PREPAY_CHECKOUT_RESPONSE',
    )
    const paymentStatus = requiredString(
      checkout.payment_status,
      'INVALID_PREPAY_CHECKOUT_RESPONSE',
    )
    const isActive = checkout.is_active
    const wasCreated = checkout.created === true
    const existingSnapToken = typeof checkout.snap_token === 'string'
      ? checkout.snap_token.trim()
      : ''

    if (
      !UUID_RE.test(orderId) ||
      midtransOrderId !== `pop_${checkoutKey.replaceAll('-', '')}` ||
      authoritativeTotal < authoritativeQris ||
      authoritativeQris <= 0 ||
      (paymentStatus !== 'unpaid' && paymentStatus !== 'paid') ||
      typeof isActive !== 'boolean' ||
      typeof checkout.created !== 'boolean'
    ) {
      throw new Error('INVALID_PREPAY_CHECKOUT_RESPONSE')
    }

    const releaseCheckout = async (reason: PrepayReleaseReason) => {
      const { data: releasedRaw, error: releaseError } = await supabase.rpc(
        'release_customer_prepay_checkout',
        {
          p_customer_id: customer.id,
          p_order_id: orderId,
          p_reason: reason,
        },
      )
      if (releaseError) throw new Error(releaseError.message || 'PREPAY_CHECKOUT_RELEASE_FAILED')
      const released = asJsonObject(releasedRaw, 'PREPAY_CHECKOUT_RELEASE_FAILED')
      if (released.released !== true) throw new Error('PREPAY_CHECKOUT_RELEASE_FAILED')
    }

    const settleVerifiedCheckout = async (
      verified: VerifiedMidtransStatus,
    ): Promise<Response> => {
      if (!verified.paid || verified.grossAmount !== authoritativeQris) {
        throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
      }
      const transactionId = requiredString(
        verified.body.transaction_id,
        'MIDTRANS_TRANSACTION_ID_MISSING',
      )
      const paymentType = requiredString(
        verified.body.payment_type,
        'MIDTRANS_PAYMENT_TYPE_MISSING',
      )
      const { data: settlementRaw, error: settlementError } = await supabase.rpc(
        'settle_customer_prepay_checkout',
        {
          p_midtrans_order_id: midtransOrderId,
          p_gross_amount: authoritativeQris,
          p_midtrans_transaction_id: transactionId,
          p_transaction_status: verified.transactionStatus,
          p_payment_type: paymentType,
          p_raw_notification: verified.body,
          p_settled_at: parseMidtransTime(verified.body),
        },
      )
      if (settlementError) throw new Error(settlementError.message || 'PREPAY_SETTLEMENT_FAILED')
      const settlement = asJsonObject(settlementRaw, 'PREPAY_SETTLEMENT_FAILED')
      if (settlement.late_payment === true) {
        return new Response(
          JSON.stringify({
            success: false,
            paid: false,
            error: 'PREPAY_LATE_PAYMENT_REQUIRES_REFUND',
            checkout_disposition: 'manual_reconcile',
            order_id: orderId,
            midtrans_order_id: midtransOrderId,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
        )
      }
      if (settlement.settled !== true) throw new Error('PREPAY_SETTLEMENT_FAILED')

      return new Response(
        JSON.stringify({
          success: true,
          paid: true,
          checkout_disposition: 'discard_key',
          order_id: orderId,
          midtrans_order_id: midtransOrderId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    const releaseFromVerifiedFailure = async (
      verified: VerifiedMidtransStatus,
    ): Promise<Response | null> => {
      const reason = releaseReasonForMidtransStatus(verified.transactionStatus)
      if (!reason) return null
      if (verified.grossAmount !== authoritativeQris) {
        throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
      }
      await releaseCheckout(reason)
      return new Response(
        JSON.stringify({
          success: false,
          paid: false,
          error: 'PREPAY_CHECKOUT_RELEASED',
          transaction_status: verified.transactionStatus,
          checkout_disposition: 'discard_key',
          order_id: orderId,
          midtrans_order_id: midtransOrderId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    // Protect the tiny catalog race between the Edge pre-check and the locked
    // database transaction. A newly-created mismatched reservation is safely
    // released before any Midtrans request is sent.
    if (wasCreated) {
      try {
        assertOptionalAmountMatches(order.total_amount, authoritativeTotal, 'ORDER_TOTAL_CHANGED')
        assertOptionalAmountMatches(payment_amount, authoritativeQris, 'PAYMENT_AMOUNT_CHANGED')
      } catch (amountError) {
        await releaseCheckout('snap_create_failed')
        throw amountError
      }
    }

    if (paymentStatus === 'paid') {
      return new Response(
        JSON.stringify({
          success: true,
          paid: true,
          checkout_disposition: 'discard_key',
          order_id: orderId,
          midtrans_order_id: midtransOrderId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }
    if (isActive !== true || checkout.released_at != null) {
      throw new Error('PREPAY_CHECKOUT_RELEASED')
    }

    if (existingSnapToken) {
      return new Response(
        JSON.stringify({
          success: true,
          paid: false,
          checkout_disposition: 'retry_same_key',
          snap_token: existingSnapToken,
          client_key: clientKey,
          snap_js_url: snapJsUrl,
          order_id: orderId,
          midtrans_order_id: midtransOrderId,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }

    // The database transaction may have committed while the Edge response or
    // Snap token persistence was lost. On a same-key retry, reconcile Midtrans
    // before attempting to create another transaction with the same order id.
    if (!wasCreated) {
      let verified = await fetchVerifiedMidtransStatus(midtransOrderId, serverKey, midtransEnv)
      if (verified?.paid) return await settleVerifiedCheckout(verified)
      if (verified) {
        const released = await releaseFromVerifiedFailure(verified)
        if (released) return released
      }

      if (verified?.transactionStatus === 'pending') {
        // A pending transaction without a recoverable local Snap token cannot
        // be resumed safely. Cancel it at Midtrans, then trust only a fresh
        // Status API read before restoring reserved vouchers.
        await cancelPendingMidtransTransaction(midtransOrderId, serverKey, midtransEnv)
        verified = await fetchVerifiedMidtransStatus(midtransOrderId, serverKey, midtransEnv)
        if (verified?.paid) return await settleVerifiedCheckout(verified)
        if (verified) {
          const released = await releaseFromVerifiedFailure(verified)
          if (released) return released
        }
        throw new Error('PREPAY_PENDING_SESSION_UNAVAILABLE_RETRY_SAME_CHECKOUT')
      }

      if (verified) {
        throw new Error('PREPAY_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
      }
      // A verified 404 means no Midtrans transaction exists for this id. It is
      // safe to continue with the original idempotency key and create Snap.
    }

    // Midtrans is external to the database transaction. Network/5xx and
    // duplicate-id responses are deliberately treated as unknown outcomes:
    // keep the reservation and require a retry with the same checkout key.
    let mtResponse: Response
    try {
      mtResponse = await fetch(snapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${btoa(serverKey + ':')}`,
        },
        body: JSON.stringify({
          transaction_details: {
            order_id: midtransOrderId,
            gross_amount: authoritativeQris,
          },
          item_details: [{
            id: orderId,
            price: authoritativeQris,
            quantity: 1,
            name: 'Order Payment',
          }],
          customer_details: { first_name: customer.name, phone: customer.whatsapp },
          enabled_payments: ['other_qris'],
          notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
        }),
      })
    } catch (fetchError) {
      console.error('Midtrans Snap request outcome unknown:', fetchError)
      throw new Error('PREPAY_SNAP_CREATE_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
    }

    let mtRaw: string
    try {
      mtRaw = await mtResponse.text()
    } catch (readError) {
      console.error('Unable to read Midtrans Snap response:', mtResponse.status, readError)
      throw new Error('PREPAY_SNAP_CREATE_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
    }
    let mtData: Record<string, unknown> = {}
    if (mtRaw) {
      try {
        mtData = asJsonObject(JSON.parse(mtRaw), 'INVALID_MIDTRANS_RESPONSE')
      } catch (parseError) {
        console.error('Midtrans Snap response was not valid JSON:', mtResponse.status, parseError)
        throw new Error('PREPAY_SNAP_CREATE_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
      }
    }

    const snapToken = typeof mtData.token === 'string' ? mtData.token.trim() : ''
    const redirectUrl = typeof mtData.redirect_url === 'string' ? mtData.redirect_url.trim() : null
    if (!mtResponse.ok || !snapToken) {
      console.error('Midtrans Snap rejected or incomplete:', {
        http_status: mtResponse.status,
        status_code: mtData.status_code ?? null,
        status_message: mtData.status_message ?? null,
      })
      // Only these statuses prove Snap rejected the request before creating a
      // transaction. Timeout/throttle/conflict-style 4xx responses remain
      // unknown and must retain the reservation for same-key reconciliation.
      const deterministicClientRejection = [400, 401, 403, 404, 405, 422]
        .includes(mtResponse.status) && !snapToken

      if (deterministicClientRejection) {
        await releaseCheckout('snap_create_failed')
        throw new Error(`MIDTRANS_SNAP_REJECTED_${mtResponse.status}`)
      }
      throw new Error('PREPAY_SNAP_CREATE_STATUS_UNKNOWN_RETRY_SAME_CHECKOUT')
    }

    let storedRaw: unknown = null
    let storeError: { message?: string } | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stored = await supabase.rpc('store_customer_prepay_snap_session', {
        p_customer_id: customer.id,
        p_checkout_key: checkoutKey,
        p_snap_token: snapToken,
        p_redirect_url: redirectUrl,
      })
      storedRaw = stored.data
      storeError = stored.error
      if (!storeError) break
    }

    if (storeError) {
      // A concurrent request may have stored the canonical token, or the first
      // store may have committed while its response was lost. Re-read the same
      // idempotent checkout before asking the client to retry.
      const reread = await supabase.rpc('create_customer_prepay_checkout', checkoutArgs)
      if (!reread.error) {
        const current = asJsonObject(reread.data, 'INVALID_PREPAY_CHECKOUT_RESPONSE')
        const canonicalToken = typeof current.snap_token === 'string'
          ? current.snap_token.trim()
          : ''
        if (
          canonicalToken &&
          current.order_id === orderId &&
          current.midtrans_order_id === midtransOrderId &&
          current.is_active === true &&
          current.released_at == null &&
          (current.payment_status === 'unpaid' || current.payment_status === 'paid')
        ) {
          return new Response(
            JSON.stringify({
              success: true,
              paid: current.payment_status === 'paid',
              checkout_disposition: current.payment_status === 'paid'
                ? 'discard_key'
                : 'retry_same_key',
              snap_token: canonicalToken,
              client_key: clientKey,
              snap_js_url: snapJsUrl,
              order_id: orderId,
              midtrans_order_id: midtransOrderId,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
          )
        }
      }
      console.error('Unable to persist Midtrans Snap session:', storeError)
      throw new Error('PREPAY_SNAP_SESSION_SAVE_UNKNOWN_RETRY_SAME_CHECKOUT')
    }

    const storedSession = asJsonObject(storedRaw, 'INVALID_PREPAY_SNAP_SESSION_RESPONSE')
    const storedToken = requiredString(
      storedSession.snap_token,
      'INVALID_PREPAY_SNAP_SESSION_RESPONSE',
    )
    if (
      storedSession.stored !== true ||
      storedSession.order_id !== orderId ||
      storedSession.checkout_key !== checkoutKey ||
      storedSession.midtrans_order_id !== midtransOrderId ||
      storedSession.is_active !== true ||
      storedToken !== snapToken
    ) {
      throw new Error('INVALID_PREPAY_SNAP_SESSION_RESPONSE')
    }

    return new Response(
      JSON.stringify({
        success: true,
        paid: storedSession.payment_status === 'paid',
        checkout_disposition: storedSession.payment_status === 'paid'
          ? 'discard_key'
          : 'retry_same_key',
        snap_token: storedToken,
        client_key: clientKey,
        snap_js_url: snapJsUrl,
        order_id: orderId,
        midtrans_order_id: midtransOrderId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: any) {
    console.error('submit-prepay-order error:', error)
    const message = error instanceof Error ? error.message : 'PREPAY_CHECKOUT_UNKNOWN_ERROR'
    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        checkout_disposition: checkoutDispositionForError(message),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
