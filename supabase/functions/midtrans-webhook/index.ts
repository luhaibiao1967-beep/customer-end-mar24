import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

function parseGrossAmount(raw: unknown): number {
  if (typeof raw === 'number' && !Number.isNaN(raw)) return Math.round(raw)
  if (typeof raw === 'string') {
    const n = parseFloat(raw)
    return Number.isNaN(n) ? 0 : Math.round(n)
  }
  return 0
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

function parseSettledAt(body: Record<string, unknown>): string | null {
  const t = body.transaction_time
  if (typeof t === 'string' && t.length > 0) {
    const d = Date.parse(t)
    if (!Number.isNaN(d)) return new Date(d).toISOString()
  }
  return new Date().toISOString()
}

serve(async (req) => {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
    } = body

    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')!
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const isSandboxTest = body.sandbox_test === true && midtransEnv === 'sandbox'

    if (!isSandboxTest && typeof order_id === 'string') {
      const rawString = String(order_id) + String(status_code ?? '') + String(gross_amount ?? '') + serverKey
      const hashBuffer = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(rawString))
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      if (hashHex !== signature_key) {
        console.error('Invalid signature')
        return new Response('Invalid signature', { status: 403 })
      }
    }

    const isSuccess =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept')

    if (!isSuccess || typeof order_id !== 'string') {
      return new Response('Not a success notification', { status: 200 })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const gAmt = parseGrossAmount(gross_amount)
    const txId = typeof body.transaction_id === 'string' ? body.transaction_id : null
    const settledAt = parseSettledAt(body)
    const payType = typeof body.payment_type === 'string' ? body.payment_type : null
    const txStatus = typeof transaction_status === 'string' ? transaction_status : null

    // ── Voucher purchase (order_id starts with "vpc_") ──
    if (order_id.startsWith('vpc_')) {
      const { data: request } = await supabase
        .from('voucher_purchase_requests')
        .select('id, customer_id, product_id, qty')
        .eq('midtrans_order_id', order_id)
        .eq('status', 'pending')
        .maybeSingle()

      if (request) {
        const { data: row } = await supabase
          .from('customer_product_vouchers')
          .select('balance, gift_balance')
          .eq('customer_id', request.customer_id)
          .eq('product_id', request.product_id)
          .single()

        await supabase
          .from('customer_product_vouchers')
          .upsert({
            customer_id: request.customer_id,
            product_id: request.product_id,
            balance: (row?.balance ?? 0) + request.qty,
            gift_balance: row?.gift_balance ?? 0,
          })

        await supabase
          .from('voucher_purchase_requests')
          .update({ status: 'confirmed' })
          .eq('id', request.id)
      }

      const { data: reqRow } = await supabase
        .from('voucher_purchase_requests')
        .select('id, customer_id')
        .eq('midtrans_order_id', order_id)
        .maybeSingle()

      if (reqRow) {
        const { data: cust } = await supabase
          .from('customers')
          .select('branch')
          .eq('id', reqRow.customer_id)
          .single()
        await insertHqSettlement(supabase, {
          midtrans_order_id: order_id,
          midtrans_transaction_id: txId,
          gross_amount: gAmt,
          transaction_status: txStatus,
          payment_type: payType,
          source_type: 'voucher_purchase',
          customer_id: reqRow.customer_id,
          branch: cust?.branch ?? null,
          order_id: null,
          voucher_purchase_request_id: reqRow.id,
          metadata: null,
          raw_notification: body,
          settled_at: settledAt,
        })
      }
    }

    // ── Order payment (order_id starts with "op_") — later_pay batch QRIS; each order row shares midtrans_order_id ──
    if (order_id.startsWith('op_')) {
      await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('midtrans_order_id', order_id)
        .eq('payment_status', 'unpaid')

      const { data: ords } = await supabase
        .from('orders')
        .select('id, branch, customer_id, total_amount')
        .eq('midtrans_order_id', order_id)

      if (!ords?.length) {
        console.error('midtrans-webhook op_: no orders tagged with midtrans_order_id=', order_id)
        return new Response('OK', { status: 200 })
      }

      const first = ords[0]
      const sumOrders = ords.reduce((s, o) => s + (o.total_amount ?? 0), 0)
      if (sumOrders !== gAmt) {
        console.warn(
          'midtrans-webhook op_: gross_amount vs sum(order totals)',
          { midtrans_order_id: order_id, gross_amount: gAmt, sum_order_totals: sumOrders },
        )
      }

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
        },
        raw_notification: body,
        settled_at: settledAt,
      })
    }

    // ── Pre-pay order payment (order_id starts with "pop_") ──
    if (order_id.startsWith('pop_')) {
      await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('midtrans_order_id', order_id)
        .eq('payment_status', 'unpaid')

      const { data: ord } = await supabase
        .from('orders')
        .select('id, customer_id, branch')
        .eq('midtrans_order_id', order_id)
        .maybeSingle()

      if (ord) {
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
          metadata: null,
          raw_notification: body,
          settled_at: settledAt,
        })
      }
    }

    return new Response('OK', { status: 200 })
  } catch (error: unknown) {
    console.error('Webhook error:', error)
    return new Response('Error', { status: 500 })
  }
})
