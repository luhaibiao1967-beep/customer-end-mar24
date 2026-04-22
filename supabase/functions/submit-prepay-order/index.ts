import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

/** Inlined: Supabase deploy bundles one function folder — ../_shared is not uploaded. */
async function getProductVoucherRow(
  supabase: SupabaseClient,
  customerId: string,
  productId: string,
): Promise<{ balance: number; gift_balance: number }> {
  const { data } = await supabase
    .from('customer_product_vouchers')
    .select('balance, gift_balance')
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .single()
  return {
    balance: data?.balance ?? 0,
    gift_balance: data?.gift_balance ?? 0,
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
  new_balance: number
  new_gift_balance: number
}

type PricingBasis = 'purchase_weighted_avg' | 'package_fallback' | 'zero_unknown' | 'gift_zero'

async function resolveVoucherUnitAmount(
  supabase: SupabaseClient,
  customerId: string,
  productId: string,
): Promise<{ unit_amount: number; pricing_basis: PricingBasis }> {
  const { data: purchases } = await supabase
    .from('voucher_purchase_requests')
    .select('amount_paid, qty')
    .eq('customer_id', customerId)
    .eq('product_id', productId)
    .eq('status', 'confirmed')

  let totalPaid = 0
  let totalQty = 0
  for (const r of purchases || []) {
    totalPaid += r.amount_paid ?? 0
    totalQty += r.qty ?? 0
  }
  if (totalQty > 0) {
    return {
      unit_amount: Math.floor(totalPaid / totalQty),
      pricing_basis: 'purchase_weighted_avg',
    }
  }

  const { data: pkgs } = await supabase
    .from('voucher_packages')
    .select('price, qty')
    .eq('product_id', productId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (pkgs && pkgs.length > 0) {
    const p = pkgs[0]
    const q = p.qty > 0 ? p.qty : 1
    return {
      unit_amount: Math.floor((p.price ?? 0) / q),
      pricing_basis: 'package_fallback',
    }
  }

  return { unit_amount: 0, pricing_basis: 'zero_unknown' }
}

function buildItemCashUnits(
  items: OrderItem[],
  product_deductions: { product_id: string; quantity: number }[] | undefined,
): { product_id: string; quantity: number; by_voucher: number; by_qris: number }[] {
  const remaining = new Map<string, number>()
  for (const d of product_deductions ?? []) {
    if (d.quantity > 0) remaining.set(d.product_id, (remaining.get(d.product_id) ?? 0) + d.quantity)
  }
  return items.map((it) => {
    const pid = it.product
    const r = remaining.get(pid) ?? 0
    const by_v = Math.min(it.quantity, r)
    remaining.set(pid, r - by_v)
    return {
      product_id: pid,
      quantity: it.quantity,
      by_voucher: by_v,
      by_qris: it.quantity - by_v,
    }
  })
}

async function insertVoucherUsageLines(
  supabase: SupabaseClient,
  params: {
    orderId: string
    customerId: string
    branch: string
    splits: { product_id: string; from_gift: number; from_paid: number }[]
  },
): Promise<void> {
  const { orderId, customerId, branch, splits } = params
  for (const s of splits) {
    if (s.from_gift > 0) {
      const { error } = await supabase.from('voucher_usage_ledger').insert({
        order_id: orderId,
        customer_id: customerId,
        branch,
        product_id: s.product_id,
        voucher_qty: s.from_gift,
        unit_amount: 0,
        line_amount: 0,
        pricing_basis: 'gift_zero',
      })
      if (error) throw new Error('voucher_usage_ledger insert: ' + error.message)
    }
    if (s.from_paid > 0) {
      const { unit_amount, pricing_basis } = await resolveVoucherUnitAmount(
        supabase,
        customerId,
        s.product_id,
      )
      const line_amount = s.from_paid * unit_amount
      const { error } = await supabase.from('voucher_usage_ledger').insert({
        order_id: orderId,
        customer_id: customerId,
        branch,
        product_id: s.product_id,
        voucher_qty: s.from_paid,
        unit_amount,
        line_amount,
        pricing_basis,
      })
      if (error) throw new Error('voucher_usage_ledger insert: ' + error.message)
    }
  }
}

async function buildVoucherSplitPlans(
  supabase: SupabaseClient,
  customerId: string,
  product_deductions: ProductDeduction[] | undefined,
): Promise<VoucherSplitPlan[]> {
  const plans: VoucherSplitPlan[] = []
  for (const deduction of product_deductions || []) {
    if (!deduction.quantity || deduction.quantity <= 0) continue
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
      new_balance: row.balance - deduction.quantity,
      new_gift_balance: row.gift_balance - from_gift,
    })
  }
  return plans
}

async function validateGiftRowsMatchRealtimeSplits(
  supabase: SupabaseClient,
  items: OrderItem[],
  plans: VoucherSplitPlan[],
): Promise<void> {
  if (!plans.length) return
  const productIds = plans.map((p) => p.product_id)
  const { data: products } = await supabase
    .from('products')
    .select('id, name')
    .in('id', productIds)
  const byId = new Map<string, string>()
  for (const p of products || []) byId.set(p.id, (p.name || '').trim().toLowerCase())

  const observedGiftByProduct = new Map<string, number>()
  for (const p of plans) observedGiftByProduct.set(p.product_id, 0)
  for (const item of items) {
    if ((item.quantity ?? 0) <= 0) continue
    if ((item.unit_price ?? 0) !== 0) continue
    const key = String(item.product || '').trim().toLowerCase()
    if (!key) continue
    for (const p of plans) {
      const pname = byId.get(p.product_id) || ''
      if (key === p.product_id.toLowerCase() || (pname && key === pname)) {
        observedGiftByProduct.set(
          p.product_id,
          (observedGiftByProduct.get(p.product_id) ?? 0) + item.quantity,
        )
      }
    }
  }

  for (const p of plans) {
    const observed = observedGiftByProduct.get(p.product_id) ?? 0
    if (observed !== p.from_gift) {
      throw new Error('VOUCHER_GIFT_SPLIT_MISMATCH')
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, order, items, payment_amount, product_deductions } = await req.json()
    if (!token) throw new Error('Token required')
    if (!order || !items || items.length === 0) throw new Error('Order data required')

    // payment_amount is the QRIS charge (shortfall after vouchers); defaults to full order total
    const qrisAmount = payment_amount ?? order.total_amount

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
    const { data: customer } = await supabase
      .from('customers')
      .select('id, name, address, whatsapp, branch, discount, customer_type')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')
    if (customer.customer_type !== 'pre_pay') throw new Error('Only pre_pay customers use this payment path')

    const { data: branchRow } = await supabase
      .from('branches')
      .select('order_cutoff_hour, closed_weekdays')
      .eq('name', customer.branch)
      .maybeSingle()
    const cutoffHour = branchRow?.order_cutoff_hour ?? 16
    const closedW = Array.isArray(branchRow?.closed_weekdays) ? (branchRow!.closed_weekdays as number[]) : []
    const dErr = validateDeliveryDate(order.delivery_date, cutoffHour, closedW)
    if (dErr) throw new Error(dErr)

    const splitPlans = await buildVoucherSplitPlans(supabase, customer.id, product_deductions)
    await validateGiftRowsMatchRealtimeSplits(supabase, items, splitPlans)

    // Must be set before Snap + before any webhook can fire (avoids race: webhook could not find order → missing hq_midtrans_settlements).
    const midtransOrderId = `pop_${customer.id.slice(0, 8)}_${Date.now()}`

    // Create order with payment_status 'unpaid'
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customer.id,
        customer_name: customer.name,
        customer_address: customer.address,
        customer_whatsapp: customer.whatsapp,
        customer_discount: customer.discount || 0,
        branch: customer.branch,
        delivery_date: order.delivery_date,
        total_amount: order.total_amount,
        status: 'pending',
        payment_status: 'unpaid',
        midtrans_order_id: midtransOrderId,
        note: order.note || null,
        empty_gallons_returned: 0,
        borrowed_gallons: 0,
        created_by: null,
        created_by_display: customer.name,
        is_active: true,
      })
      .select()
      .single()
    if (orderError) throw new Error('Failed to create order: ' + orderError.message)

    // Create order items
    const { error: itemsError } = await supabase.from('order_items').insert(
      items.map((item: OrderItem) => ({ ...item, order_id: newOrder.id }))
    )
    if (itemsError) {
      const { error: rbErr } = await supabase.from('order_items').delete().eq('order_id', newOrder.id)
      if (rbErr) console.error('Rollback failed (order_items on itemsError):', rbErr.message)
      const { error: rbOrdErr } = await supabase.from('orders').delete().eq('id', newOrder.id)
      if (rbOrdErr) console.error('Rollback failed (orders on itemsError):', rbOrdErr.message)
      throw new Error('Failed to create order items: ' + itemsError.message)
    }

    for (const plan of splitPlans) {
      const { error: dErr } = await supabase.from('customer_product_vouchers').upsert({
        customer_id: customer.id,
        product_id: plan.product_id,
        balance: plan.new_balance,
        gift_balance: plan.new_gift_balance,
      })
      if (dErr) throw new Error('Failed to deduct vouchers: ' + dErr.message)
    }

    const prepay_breakdown = {
      catalog_total_idr: order.total_amount,
      qris_idr: qrisAmount,
      voucher_splits: splitPlans.map((p) => ({
        product_id: p.product_id,
        from_gift: p.from_gift,
        from_paid: p.from_paid,
      })),
      item_cash_units: buildItemCashUnits(items, product_deductions),
    }
    const { error: breakdownErr } = await supabase
      .from('orders')
      .update({
        qris_charged_idr: qrisAmount,
        prepay_breakdown,
      })
      .eq('id', newOrder.id)
    if (breakdownErr) throw new Error('Failed to save prepay breakdown: ' + breakdownErr.message)

    // Create Midtrans Snap transaction (QRIS only) — charge only the shortfall amount
    const mtResponse = await fetch(snapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`,
      },
      body: JSON.stringify({
        transaction_details: { order_id: midtransOrderId, gross_amount: qrisAmount },
        item_details: [{ id: newOrder.id, price: qrisAmount, quantity: 1, name: 'Order Payment' }],
        customer_details: { first_name: customer.name, phone: customer.whatsapp },
        enabled_payments: ['other_qris'],
        notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
      }),
    })

    const mtData = await mtResponse.json()
    if (!mtData.token) {
      // Rollback: delete order_items first (FK), then order
      const { error: rbItemsErr } = await supabase.from('order_items').delete().eq('order_id', newOrder.id)
      if (rbItemsErr) console.error('Rollback failed (order_items on Midtrans failure):', rbItemsErr.message)
      const { error: rbOrderErr } = await supabase.from('orders').delete().eq('id', newOrder.id)
      if (rbOrderErr) console.error('Rollback failed (orders on Midtrans failure):', rbOrderErr.message)
      throw new Error('Midtrans error: ' + JSON.stringify(mtData))
    }

    if (splitPlans.length > 0) {
      await insertVoucherUsageLines(supabase, {
        orderId: newOrder.id,
        customerId: customer.id,
        branch: customer.branch ?? '',
        splits: splitPlans.map((p) => ({
          product_id: p.product_id,
          from_gift: p.from_gift,
          from_paid: p.from_paid,
        })),
      })
    }

    return new Response(
      JSON.stringify({ success: true, snap_token: mtData.token, client_key: clientKey, snap_js_url: snapJsUrl, order_id: newOrder.id, midtrans_order_id: midtransOrderId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('submit-prepay-order error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
