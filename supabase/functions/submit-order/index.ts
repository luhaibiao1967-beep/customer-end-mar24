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

interface RequestBody {
  token: string
  order: {
    delivery_date: string
    note?: string
    total_amount: number
    payment_status: string
  }
  items: OrderItem[]
  // New: per-product deductions. Legacy vouchers_to_deduct still accepted for backwards compat.
  product_deductions?: ProductDeduction[]
  vouchers_to_deduct?: number
  edit_order_id?: string
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: RequestBody = await req.json()
    const { token, order, items, product_deductions, edit_order_id } = body

    if (!token) throw new Error('Token is required')
    if (!order || !items || items.length === 0) throw new Error('Order data is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token and get customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) {
      throw new Error('Invalid or expired token')
    }

    const { data: branchRow } = await supabase
      .from('branches')
      .select('order_cutoff_hour, closed_weekdays')
      .eq('name', customer.branch)
      .maybeSingle()
    const cutoffHour = branchRow?.order_cutoff_hour ?? 16
    const closedW = Array.isArray(branchRow?.closed_weekdays) ? (branchRow!.closed_weekdays as number[]) : []
    const dErr = validateDeliveryDate(order.delivery_date, cutoffHour, closedW)
    if (dErr) throw new Error(dErr)

    const isPrePay = customer.customer_type === 'pre_pay'

    // pre_pay must not create unpaid orders via this function — unpaid pop_* only comes from submit-prepay-order + Snap.
    if (isPrePay && !edit_order_id && order.payment_status === 'unpaid') {
      throw new Error('PRE_PAY_REQUIRES_PAYMENT')
    }

    // Validate per-product voucher balances (all customer types)
    if (product_deductions && product_deductions.length > 0) {
      for (const deduction of product_deductions) {
        if (deduction.quantity <= 0) continue

        const row = await getProductVoucherRow(supabase, customer.id, deduction.product_id)
        const available = row.balance
        if (available < deduction.quantity) {
          throw new Error(`Insufficient vouchers for product (need ${deduction.quantity}, have ${available})`)
        }
      }
    }

    // Credit limit check for later_pay
    if (!isPrePay && customer.credit_limit != null && !edit_order_id) {
      const { data: unpaidRows } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('customer_id', customer.id)
        .eq('payment_status', 'unpaid')

      const unpaidSum = (unpaidRows || []).reduce((s: number, o: any) => s + (o.total_amount || 0), 0)
      if (unpaidSum + order.total_amount > customer.credit_limit) {
        throw new Error('CREDIT_LIMIT_EXCEEDED')
      }
    }

    // For later_pay daily: block new orders if there are unpaid delivered orders
    if (!isPrePay && customer.payment_term === 'daily' && !edit_order_id) {
      const { data: unpaidOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('customer_id', customer.id)
        .eq('payment_status', 'unpaid')
        .eq('status', 'delivered')
        .limit(1)

      if (unpaidOrders && unpaidOrders.length > 0) {
        throw new Error('UNPAID_ORDERS')
      }
    }

    if (edit_order_id) {
      // Update existing order
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          delivery_date: order.delivery_date,
          total_amount: order.total_amount,
          note: order.note || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', edit_order_id)
        .eq('customer_id', customer.id)

      if (updateError) throw new Error('Failed to update order: ' + updateError.message)

      await supabase.from('order_items').delete().eq('order_id', edit_order_id)

      const { error: itemsError } = await supabase.from('order_items').insert(
        items.map(item => ({ ...item, order_id: edit_order_id }))
      )
      if (itemsError) throw new Error('Failed to update order items: ' + itemsError.message)

    } else {
      // Create new order
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
          payment_status: order.payment_status,
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

      const { error: itemsError } = await supabase.from('order_items').insert(
        items.map(item => ({ ...item, order_id: newOrder.id }))
      )
      if (itemsError) throw new Error('Failed to create order items: ' + itemsError.message)

      // Deduct per-product vouchers (gift balance consumed first) + ledger
      const splitRows: { product_id: string; from_gift: number; from_paid: number }[] = []
      if (product_deductions && product_deductions.length > 0) {
        for (const deduction of product_deductions) {
          if (deduction.quantity <= 0) continue

          const row = await getProductVoucherRow(supabase, customer.id, deduction.product_id)
          if (row.balance < deduction.quantity) {
            throw new Error(
              `Insufficient vouchers for product (need ${deduction.quantity}, have ${row.balance})`,
            )
          }
          const { from_gift, from_paid } = splitGiftAndPaidVoucherQty(deduction.quantity, row.gift_balance)
          const newBalance = row.balance - deduction.quantity
          const newGiftBalance = row.gift_balance - from_gift

          const { error: deductErr } = await supabase
            .from('customer_product_vouchers')
            .upsert({
              customer_id: customer.id,
              product_id: deduction.product_id,
              balance: newBalance,
              gift_balance: newGiftBalance,
            })

          if (deductErr) throw new Error('Failed to deduct vouchers: ' + deductErr.message)
          splitRows.push({ product_id: deduction.product_id, from_gift, from_paid })
        }
      }

      if (splitRows.length > 0) {
        await insertVoucherUsageLines(supabase, {
          orderId: newOrder.id,
          customerId: customer.id,
          branch: customer.branch ?? '',
          splits: splitRows,
        })
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('submit-order error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
