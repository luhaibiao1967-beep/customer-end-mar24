import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function parseGrossAmount(raw: unknown): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return Math.round(raw)
  if (typeof raw === 'string') {
    const n = parseFloat(raw)
    return Number.isNaN(n) ? 0 : Math.round(n)
  }
  return 0
}

function parseSettledAt(body: Record<string, unknown>): string | null {
  const t = body.transaction_time
  if (typeof t === 'string' && t.length > 0) {
    const d = Date.parse(t)
    if (!Number.isNaN(d)) return new Date(d).toISOString()
  }
  return new Date().toISOString()
}

async function insertHqSettlement(
  supabase: SupabaseClient,
  row: {
    midtrans_order_id: string
    midtrans_transaction_id: string | null
    gross_amount: number
    transaction_status: string | null
    payment_type: string | null
    source_type: 'prepay_order_qris' | 'voucher_purchase' | 'later_pay_orders'
    customer_id: string | null
    branch: string | null
    order_id: string | null
    voucher_purchase_request_id: string | null
    metadata: Record<string, unknown> | null
    raw_notification: Record<string, unknown>
    settled_at: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('hq_midtrans_settlements').insert(row)
  if (error) {
    if (error.code === '23505') return
    console.error('hq_midtrans_settlements insert:', error.message)
  }
}

function isMidtransSuccess(body: Record<string, unknown>): boolean {
  const transaction_status = body.transaction_status
  const fraud_status = body.fraud_status
  return (
    transaction_status === 'settlement' ||
    (transaction_status === 'capture' && fraud_status === 'accept')
  )
}

/** When Snap onSuccess runs before/with webhook — backfill hq_midtrans_settlements from Midtrans Status API (server-side, trusted). */
async function ensureHqSettlementFromMidtransStatus(
  supabase: SupabaseClient,
  midtrans_order_id: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('hq_midtrans_settlements')
    .select('id')
    .eq('midtrans_order_id', midtrans_order_id)
    .maybeSingle()
  if (existing) return

  const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
  if (!serverKey) {
    console.error('confirm-snap-payment: MIDTRANS_SERVER_KEY missing')
    return
  }
  const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
  const url = `${base}/${encodeURIComponent(midtrans_order_id)}/status`
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${btoa(serverKey + ':')}` },
  })
  const body = (await res.json()) as Record<string, unknown>
  if (!isMidtransSuccess(body)) {
    console.warn(
      'confirm-snap-payment: Midtrans status not success yet',
      midtrans_order_id,
      body.transaction_status,
    )
    return
  }

  const order_id = typeof body.order_id === 'string' ? body.order_id : midtrans_order_id
  const gAmt = parseGrossAmount(body.gross_amount)
  const txId = typeof body.transaction_id === 'string' ? body.transaction_id : null
  const txStatus = typeof body.transaction_status === 'string' ? body.transaction_status : null
  const payType = typeof body.payment_type === 'string' ? body.payment_type : null
  const settledAt = parseSettledAt(body)

  if (order_id.startsWith('pop_')) {
    const { data: ord } = await supabase
      .from('orders')
      .select('id, customer_id, branch')
      .eq('midtrans_order_id', order_id)
      .maybeSingle()
    if (!ord) {
      console.error('confirm-snap-payment: no order for pop_', order_id)
      return
    }
    await insertHqSettlement(supabase, {
      midtrans_order_id: order_id,
      midtrans_transaction_id: txId,
      gross_amount: gAmt,
      transaction_status: txStatus,
      payment_type: payType,
      source_type: 'prepay_order_qris',
      customer_id: ord.customer_id,
      branch: ord.branch ?? null,
      order_id: ord.id,
      voucher_purchase_request_id: null,
      metadata: { source: 'confirm_snap_payment_status_api' },
      raw_notification: body,
      settled_at: settledAt,
    })
    return
  }

  if (order_id.startsWith('op_')) {
    const { data: ords } = await supabase
      .from('orders')
      .select('id, branch, customer_id, total_amount')
      .eq('midtrans_order_id', order_id)
    if (!ords?.length) {
      console.error('confirm-snap-payment: no orders for op_', order_id)
      return
    }
    const first = ords[0]
    const order_allocations = ords.map((o) => ({
      order_id: o.id,
      branch: o.branch,
      customer_id: o.customer_id,
      amount_idr: o.total_amount,
    }))
    await insertHqSettlement(supabase, {
      midtrans_order_id: order_id,
      midtrans_transaction_id: txId,
      gross_amount: gAmt,
      transaction_status: txStatus,
      payment_type: payType,
      source_type: 'later_pay_orders',
      customer_id: first.customer_id,
      branch: first.branch ?? null,
      order_id: null,
      voucher_purchase_request_id: null,
      metadata: {
        later_pay_batch: true,
        order_allocations,
        orders: ords,
        source: 'confirm_snap_payment_status_api',
      },
      raw_notification: body,
      settled_at: settledAt,
    })
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, midtrans_order_id } = await req.json()
    if (!token) throw new Error('Token required')
    if (!midtrans_order_id) throw new Error('midtrans_order_id required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    const { data: orders, error: ordErr } = await supabase
      .from('orders')
      .select('id, payment_status')
      .eq('midtrans_order_id', midtrans_order_id)
      .eq('customer_id', customer.id)

    if (ordErr) throw new Error(ordErr.message)
    if (!orders || orders.length === 0) throw new Error('Order not found')

    const allPaid = orders.every((o) => o.payment_status === 'paid')
    if (!allPaid) {
      const today = new Date().toISOString().split('T')[0]
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          paid_date: today,
          payment_confirmation_type: 'qris',
        })
        .eq('midtrans_order_id', midtrans_order_id)
        .eq('customer_id', customer.id)
        .eq('payment_status', 'unpaid')

      if (updateError) throw new Error('Failed to update order: ' + updateError.message)
    }

    await ensureHqSettlementFromMidtransStatus(supabase, midtrans_order_id)

    return new Response(
      JSON.stringify({ success: true, paid: true, already_paid: allPaid }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('confirm-snap-payment error:', msg)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
