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
    source_type: 'voucher_purchase'
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

/** If webhook never reached Supabase, backfill hq_midtrans_settlements from Midtrans Status API (same shape as midtrans-webhook vpc_). */
async function ensureHqVoucherPurchaseSettlement(
  supabase: SupabaseClient,
  midtrans_order_id: string,
): Promise<void> {
  if (!midtrans_order_id.startsWith('vpc_')) return

  const { data: existing } = await supabase
    .from('hq_midtrans_settlements')
    .select('id')
    .eq('midtrans_order_id', midtrans_order_id)
    .maybeSingle()
  if (existing) return

  const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
  if (!serverKey) {
    console.error('confirm-voucher-payment: MIDTRANS_SERVER_KEY missing')
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
      'confirm-voucher-payment: Midtrans status not success yet',
      midtrans_order_id,
      body.transaction_status,
    )
    return
  }

  const gAmt = parseGrossAmount(body.gross_amount)
  const txId = typeof body.transaction_id === 'string' ? body.transaction_id : null
  const txStatus = typeof body.transaction_status === 'string' ? body.transaction_status : null
  const payType = typeof body.payment_type === 'string' ? body.payment_type : null
  const settledAt = parseSettledAt(body)

  const { data: reqRow } = await supabase
    .from('voucher_purchase_requests')
    .select('id, customer_id')
    .eq('midtrans_order_id', midtrans_order_id)
    .maybeSingle()
  if (!reqRow) {
    console.error('confirm-voucher-payment: no voucher_purchase_requests for', midtrans_order_id)
    return
  }

  const { data: cust } = await supabase
    .from('customers')
    .select('branch')
    .eq('id', reqRow.customer_id)
    .single()

  await insertHqSettlement(supabase, {
    midtrans_order_id,
    midtrans_transaction_id: txId,
    gross_amount: gAmt,
    transaction_status: txStatus,
    payment_type: payType,
    source_type: 'voucher_purchase',
    customer_id: reqRow.customer_id,
    branch: cust?.branch ?? null,
    order_id: null,
    voucher_purchase_request_id: reqRow.id,
    metadata: { source: 'confirm_voucher_payment_status_api' },
    raw_notification: body,
    settled_at: settledAt,
  })
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

    const { data: request } = await supabase
      .from('voucher_purchase_requests')
      .update({ status: 'confirmed' })
      .eq('midtrans_order_id', midtrans_order_id)
      .eq('customer_id', customer.id)
      .eq('status', 'pending')
      .select('product_id, qty')
      .single()

    if (!request) {
      await ensureHqVoucherPurchaseSettlement(supabase, midtrans_order_id)
      return new Response(
        JSON.stringify({ success: true, already_confirmed: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const { data: existing } = await supabase
      .from('customer_product_vouchers')
      .select('balance, gift_balance')
      .eq('customer_id', customer.id)
      .eq('product_id', request.product_id)
      .single()

    await supabase
      .from('customer_product_vouchers')
      .upsert({
        customer_id: customer.id,
        product_id: request.product_id,
        balance: (existing?.balance ?? 0) + request.qty,
        gift_balance: existing?.gift_balance ?? 0,
      })

    await ensureHqVoucherPurchaseSettlement(supabase, midtrans_order_id)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('confirm-voucher-payment error:', msg)
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
