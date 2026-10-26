import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type LaterPayReservation = {
  payment_key: string
  customer_id: string
  midtrans_order_id: string
  gross_amount: number
  state: string
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function parseGrossAmount(raw: unknown): number | null {
  const amount = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isMidtransSuccess(body: Record<string, unknown>): boolean {
  const transactionStatus = normalizedString(body.transaction_status)
  const fraudStatus = normalizedString(body.fraud_status)
  return transactionStatus === 'settlement' ||
    (transactionStatus === 'capture' && fraudStatus === 'accept')
}

function releaseReasonForMidtransStatus(status: string): string | null {
  if (status === 'expire') return 'payment_expired'
  if (status === 'cancel') return 'payment_cancelled'
  if (status === 'deny') return 'payment_denied'
  if (status === 'failure') return 'payment_failed'
  return null
}

function parseSettledAt(body: Record<string, unknown>): string | null {
  for (const field of ['settlement_time', 'transaction_time']) {
    const raw = body[field]
    if (typeof raw !== 'string' || !raw.trim()) continue
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+07:00`
    const date = new Date(normalized)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

async function fetchVerifiedMidtransStatus(
  midtransOrderId: string,
): Promise<{
  body: Record<string, unknown>
  grossAmount: number | null
  paid: boolean
  transactionStatus: string
}> {
  const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY missing')

  const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
  const response = await fetch(`${base}/${encodeURIComponent(midtransOrderId)}/status`, {
    headers: { Authorization: `Basic ${btoa(serverKey + ':')}` },
  })
  if (!response.ok) throw new Error(`MIDTRANS_STATUS_HTTP_${response.status}`)

  const body = (await response.json()) as Record<string, unknown>
  if (body.order_id !== midtransOrderId) throw new Error('MIDTRANS_ORDER_ID_MISMATCH')

  const transactionStatus = normalizedString(body.transaction_status)
  if (!transactionStatus) throw new Error('INVALID_MIDTRANS_STATUS_RESPONSE')
  const paid = isMidtransSuccess(body)
  const grossAmount = parseGrossAmount(body.gross_amount)
  if ((paid || releaseReasonForMidtransStatus(transactionStatus)) && grossAmount === null) {
    throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
  }

  return { body, grossAmount, paid, transactionStatus }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405)

  try {
    const request = await req.json() as Record<string, unknown>
    const token = typeof request.token === 'string' ? request.token.trim() : ''
    const midtransOrderId = typeof request.midtrans_order_id === 'string'
      ? request.midtrans_order_id.trim()
      : ''
    if (!token) throw new Error('Token required')
    if (!midtransOrderId) throw new Error('midtrans_order_id required')
    if (!midtransOrderId.startsWith('pop_') && !midtransOrderId.startsWith('op_')) {
      throw new Error('UNSUPPORTED_MIDTRANS_ORDER_ID')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing required environment variables')
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .maybeSingle()
    if (customerError || !customer) throw new Error('Invalid token')

    if (midtransOrderId.startsWith('op_')) {
      const { data: reservationData, error: reservationError } = await supabase
        .from('later_pay_payment_reservations')
        .select('payment_key, customer_id, midtrans_order_id, gross_amount, state')
        .eq('midtrans_order_id', midtransOrderId)
        .eq('customer_id', customer.id)
        .maybeSingle()
      if (reservationError) throw new Error('PAYMENT_RESERVATION_LOOKUP_FAILED: ' + reservationError.message)
      if (!reservationData) throw new Error('PAYMENT_RESERVATION_NOT_FOUND')
      const reservation = reservationData as LaterPayReservation

      const expectedAmount = parseGrossAmount(reservation.gross_amount)
      if (expectedAmount === null || expectedAmount <= 0) {
        throw new Error('LOCAL_RESERVATION_AMOUNT_INVALID')
      }

      // The settlement RPC is the authoritative local commit. If a webhook
      // already completed it, a browser retry must not depend on Midtrans being
      // reachable again just to learn the payment is done.
      if (reservation.state === 'settled') {
        return jsonResponse({
          success: true,
          paid: true,
          already_paid: true,
          payment_disposition: 'discard_key',
        })
      }

      const verified = await fetchVerifiedMidtransStatus(midtransOrderId)
      const terminalReason = releaseReasonForMidtransStatus(verified.transactionStatus)
      if ((verified.paid || terminalReason) && verified.grossAmount !== expectedAmount) {
        throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
      }

      if (terminalReason) {
        const { data: releaseData, error: releaseError } = await supabase.rpc(
          'release_customer_later_pay_payment',
          {
            p_customer_id: customer.id,
            p_payment_key: reservation.payment_key,
            p_midtrans_order_id: midtransOrderId,
            p_gross_amount: expectedAmount,
            p_reason: terminalReason,
            p_midtrans_transaction_id:
              typeof verified.body.transaction_id === 'string'
                ? verified.body.transaction_id
                : null,
            p_transaction_status: verified.transactionStatus,
            p_payment_type:
              typeof verified.body.payment_type === 'string' ? verified.body.payment_type : null,
            p_raw_notification: verified.body,
            p_released_at: new Date().toISOString(),
          },
        )
        if (releaseError) throw new Error('PAYMENT_RESERVATION_RELEASE_FAILED: ' + releaseError.message)
        return jsonResponse({
          success: true,
          paid: false,
          released: true,
          payment_disposition: 'discard_key',
          release_reason: terminalReason,
          result: releaseData,
        })
      }

      if (!verified.paid) {
        return jsonResponse({
          success: true,
          paid: false,
          transaction_status: verified.transactionStatus,
          payment_key: reservation.payment_key,
          payment_disposition: 'retry_same_key',
        })
      }

      const { data: settlementData, error: settlementError } = await supabase.rpc(
        'settle_customer_later_pay_payment',
        {
          p_customer_id: customer.id,
          p_payment_key: reservation.payment_key,
          p_midtrans_order_id: midtransOrderId,
          p_gross_amount: expectedAmount,
          p_midtrans_transaction_id:
            typeof verified.body.transaction_id === 'string'
              ? verified.body.transaction_id
              : null,
          p_transaction_status: verified.transactionStatus,
          p_fraud_status:
            typeof verified.body.fraud_status === 'string' ? verified.body.fraud_status : null,
          p_payment_type:
            typeof verified.body.payment_type === 'string' ? verified.body.payment_type : null,
          p_raw_notification: verified.body,
          p_settled_at: parseSettledAt(verified.body),
        },
      )
      if (settlementError) throw new Error('PAYMENT_SETTLEMENT_FAILED: ' + settlementError.message)
      const settlement = settlementData as Record<string, unknown> | null
      if (settlement?.late_payment === true) {
        return jsonResponse({
          success: false,
          paid: false,
          external_payment_received: true,
          requires_reconciliation: true,
          payment_disposition: 'manual_reconcile',
          error: 'LATE_PAYMENT_REQUIRES_MANUAL_RECONCILIATION',
        })
      }
      if (settlement?.settled !== true) throw new Error('LATER_PAY_SETTLEMENT_FAILED')

      return jsonResponse({
        success: true,
        paid: true,
        already_paid: settlement.already_settled === true,
        payment_disposition: 'discard_key',
      })
    }

    const { data: orders, error: orderError } = await supabase
      .from('orders')
      .select('id, qris_charged_idr')
      .eq('midtrans_order_id', midtransOrderId)
      .eq('customer_id', customer.id)
    if (orderError) throw new Error(orderError.message)
    if (!orders || orders.length !== 1) throw new Error('PREPAY_ORDER_COUNT_INVALID')

    const expectedAmount = parseGrossAmount(orders[0].qris_charged_idr)
    if (expectedAmount === null || expectedAmount <= 0) throw new Error('LOCAL_QRIS_AMOUNT_INVALID')

    const verified = await fetchVerifiedMidtransStatus(midtransOrderId)
    if (!verified.paid) {
      return jsonResponse({
        success: true,
        paid: false,
        error: 'PAYMENT_NOT_SETTLED',
        transaction_status: verified.transactionStatus,
      })
    }
    if (verified.grossAmount !== expectedAmount) throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')

    const { data: settlementData, error: settlementError } = await supabase.rpc(
      'settle_customer_prepay_checkout',
      {
        p_midtrans_order_id: midtransOrderId,
        p_gross_amount: verified.grossAmount,
        p_midtrans_transaction_id:
          typeof verified.body.transaction_id === 'string' ? verified.body.transaction_id : null,
        p_transaction_status: verified.transactionStatus,
        p_payment_type:
          typeof verified.body.payment_type === 'string' ? verified.body.payment_type : null,
        p_raw_notification: verified.body,
        p_settled_at: parseSettledAt(verified.body),
      },
    )
    if (settlementError) throw new Error(settlementError.message)

    const settlement = settlementData as Record<string, unknown> | null
    if (settlement?.late_payment === true || settlement?.requires_refund === true) {
      console.error('confirm-snap-payment: PREPAY_LATE_PAYMENT_REQUIRES_REFUND', {
        midtrans_order_id: midtransOrderId,
        order_id: orders[0].id,
        gross_amount: verified.grossAmount,
        settlement,
      })
      return jsonResponse({
        success: false,
        paid: false,
        external_payment_received: true,
        order_settled: false,
        late_payment: true,
        requires_refund: true,
        error: 'PREPAY_LATE_PAYMENT_REQUIRES_REFUND',
        checkout_disposition: 'manual_reconcile',
        order_id: orders[0].id,
        midtrans_order_id: midtransOrderId,
      })
    }
    if (settlement?.settled !== true) throw new Error('PREPAY_SETTLEMENT_FAILED')

    return jsonResponse({
      success: true,
      paid: true,
      already_paid: settlement.already_settled === true,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('confirm-snap-payment error:', message)
    return jsonResponse({ success: false, error: message })
  }
})
