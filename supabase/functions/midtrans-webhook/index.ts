import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

function parseGrossAmount(raw: unknown): number | null {
  const amount = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? Number(raw)
      : Number.NaN
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null
}

function parseSettledAt(body: Record<string, unknown>): string | null {
  const t = body.transaction_time
  if (typeof t === 'string' && t.length > 0) {
    const d = Date.parse(t)
    if (!Number.isNaN(d)) return new Date(d).toISOString()
  }
  return new Date().toISOString()
}

function isMidtransSuccess(body: Record<string, unknown>): boolean {
  const transactionStatus = normalizedString(body.transaction_status)
  const fraudStatus = normalizedString(body.fraud_status)
  return transactionStatus === 'settlement' ||
    (transactionStatus === 'capture' && fraudStatus === 'accept')
}

type PrepayReleaseReason =
  | 'payment_expired'
  | 'payment_cancelled'
  | 'payment_denied'
  | 'payment_failed'

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function releaseReasonForMidtransStatus(status: string): PrepayReleaseReason | null {
  if (status === 'expire') return 'payment_expired'
  if (status === 'cancel') return 'payment_cancelled'
  if (status === 'deny') return 'payment_denied'
  if (status === 'failure') return 'payment_failed'
  return null
}

function isVoucherReversalStatus(status: string): boolean {
  return status === 'refund' ||
    status === 'partial_refund' ||
    status === 'chargeback' ||
    status === 'partial_chargeback'
}

type ReconciliationSource = 'voucher_purchase' | 'prepay_order_qris' | 'later_pay_orders'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  }
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

async function recordReconciliationEvent(
  supabase: SupabaseClient,
  input: {
    midtransOrderId: string
    midtransTransactionId: string | null
    transactionStatus: string
    sourceType: ReconciliationSource
    grossAmount: number | null
    localReferenceId: string | null
    body: Record<string, unknown>
  },
): Promise<void> {
  const identity = JSON.stringify([
    input.midtransOrderId,
    input.transactionStatus,
    input.midtransTransactionId,
    input.sourceType,
    canonicalJson(input.body),
  ])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  const eventKey = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  const { error } = await supabase.from('midtrans_reconciliation_events').insert({
    event_key: eventKey,
    midtrans_order_id: input.midtransOrderId,
    midtrans_transaction_id: input.midtransTransactionId,
    transaction_status: input.transactionStatus,
    source_type: input.sourceType,
    gross_amount: input.grossAmount,
    local_reference_id: input.localReferenceId,
    raw_notification: input.body,
  })
  if (error?.code === '23505') {
    if (input.localReferenceId) {
      const { error: enrichmentError } = await supabase
        .from('midtrans_reconciliation_events')
        .update({ local_reference_id: input.localReferenceId })
        .eq('event_key', eventKey)
        .is('local_reference_id', null)
      if (enrichmentError) {
        throw new Error('MIDTRANS_RECONCILIATION_EVENT_ENRICH_FAILED: ' + enrichmentError.message)
      }
    }
    return
  }
  if (error) {
    throw new Error('MIDTRANS_RECONCILIATION_EVENT_INSERT_FAILED: ' + error.message)
  }
}

async function fetchVerifiedMidtransStatus(
  midtransOrderId: string,
  serverKey: string,
  midtransEnv: string,
): Promise<{
  body: Record<string, unknown>
  grossAmount: number | null
  paid: boolean
  transactionStatus: string
}> {
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
  if (
    (paid || releaseReasonForMidtransStatus(transactionStatus)) &&
    grossAmount === null
  ) {
    throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
  }
  return { body, grossAmount, paid, transactionStatus }
}

serve(async (req) => {
  try {
    const notification = (await req.json()) as Record<string, unknown>
    const { order_id, status_code, gross_amount, signature_key } = notification

    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!serverKey || !supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables')
    }

    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const isSandboxTest = notification.sandbox_test === true && midtransEnv === 'sandbox'

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

    if (typeof order_id !== 'string' || !order_id.trim()) {
      return new Response('Missing order id', { status: 400 })
    }

    // Notification fields are only used for signature validation. Always resolve
    // the authoritative state server-to-server before deciding any mutation.
    const verified = await fetchVerifiedMidtransStatus(order_id, serverKey, midtransEnv)

    const body = verified.body
    const supabase = createClient(supabaseUrl, supabaseKey)
    const gAmt = verified.grossAmount
    const txId = typeof body.transaction_id === 'string' ? body.transaction_id : null
    const settledAt = parseSettledAt(body)
    const payType = typeof body.payment_type === 'string' ? body.payment_type : null
    const txStatus = verified.transactionStatus

    // ── Voucher purchase (order_id starts with "vpc_") ──
    if (order_id.startsWith('vpc_')) {
      const { data: request, error: requestError } = await supabase
        .from('voucher_purchase_requests')
        .select('id, customer_id, product_id, qty, amount_paid, status')
        .eq('midtrans_order_id', order_id)
        .maybeSingle()
      if (requestError) throw new Error(requestError.message)

      if (!request) {
        if (isVoucherReversalStatus(verified.transactionStatus)) {
          await recordReconciliationEvent(supabase, {
            midtransOrderId: order_id,
            midtransTransactionId: txId,
            transactionStatus: verified.transactionStatus,
            sourceType: 'voucher_purchase',
            grossAmount: gAmt,
            localReferenceId: null,
            body,
          })
        }
        console.error('midtrans-webhook vpc_: no local purchase request for', order_id)
        return new Response('OK', { status: 200 })
      }

      if (isVoucherReversalStatus(verified.transactionStatus)) {
        await recordReconciliationEvent(supabase, {
          midtransOrderId: order_id,
          midtransTransactionId: txId,
          transactionStatus: verified.transactionStatus,
          sourceType: 'voucher_purchase',
          grossAmount: gAmt,
          localReferenceId: request.id,
          body,
        })
        // Purchased vouchers may already be partly consumed. Without a locked,
        // idempotent reconciliation RPC, an automatic rollback could overdraw
        // the balance or reverse the wrong cost basis.
        console.error('VOUCHER_PAYMENT_REVERSAL_REQUIRES_MANUAL_RECONCILIATION', {
          midtrans_order_id: order_id,
          midtrans_transaction_id: txId,
          transaction_status: verified.transactionStatus,
          gross_amount: gAmt,
          voucher_purchase_request_id: request.id,
          customer_id: request.customer_id,
          purchase_status: request.status,
          action_taken: 'none',
          persistence_recommendation:
            'Record a dedicated idempotent refund/chargeback event before implementing voucher reversal.',
        })
        return new Response('Voucher reversal requires manual reconciliation', { status: 200 })
      }

      if (!verified.paid) return new Response('Payment not settled', { status: 200 })
      if (gAmt === null) throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')

      const expectedAmount = parseGrossAmount(request.amount_paid)
      if (expectedAmount === null || expectedAmount !== gAmt) {
        console.error('midtrans-webhook vpc_: gross amount mismatch', {
          midtrans_order_id: order_id,
          gross_amount: gAmt,
          expected_amount: request.amount_paid,
        })
        return new Response('Gross amount mismatch', { status: 200 })
      }

      // Credit and confirm inside one locked database transaction. This is
      // idempotent across webhook retries and races with the browser callback.
      const { data: confirmationData, error: confirmationError } = await supabase.rpc(
        'confirm_paid_voucher_purchase',
        {
          p_request_id: request.id,
          p_customer_id: request.customer_id,
          p_midtrans_order_id: order_id,
          p_midtrans_transaction_id: txId,
          p_gross_amount: gAmt,
          p_transaction_status: txStatus,
          p_fraud_status:
            typeof body.fraud_status === 'string' ? body.fraud_status : null,
          p_payment_type: payType,
          p_raw_notification: body,
          p_settled_at: settledAt,
          p_metadata: { source: 'midtrans_webhook_status_api' },
        },
      )
      if (confirmationError) throw new Error(confirmationError.message)
      const confirmation = confirmationData as Record<string, unknown> | null
      if (confirmation?.confirmed !== true) throw new Error('PURCHASE_CONFIRMATION_FAILED')
    }

    // ── Later-pay order payment (order_id starts with "op_") ──
    // The reservation is the immutable source of truth. Never reconstruct a
    // batch from mutable orders and never update orders outside the settlement
    // RPC: the RPC closes the reservation, marks every exact member paid, and
    // writes HQ accounting in one customer-locked transaction.
    if (order_id.startsWith('op_')) {
      const { data: reservationData, error: reservationError } = await supabase
        .from('later_pay_payment_reservations')
        .select('payment_key, customer_id, midtrans_order_id, gross_amount, state')
        .eq('midtrans_order_id', order_id)
        .maybeSingle()
      if (reservationError) throw new Error(reservationError.message)

      if (!reservationData) {
        if (isVoucherReversalStatus(verified.transactionStatus)) {
          await recordReconciliationEvent(supabase, {
            midtransOrderId: order_id,
            midtransTransactionId: txId,
            transactionStatus: verified.transactionStatus,
            sourceType: 'later_pay_orders',
            grossAmount: gAmt,
            localReferenceId: null,
            body,
          })
        }
        console.error('midtrans-webhook op_: no immutable reservation for', order_id)
        return new Response('Later-pay reservation not found', { status: 200 })
      }

      const reservation = reservationData as {
        payment_key: string
        customer_id: string
        midtrans_order_id: string
        gross_amount: number
        state: string
      }
      const expectedAmount = parseGrossAmount(reservation.gross_amount)
      if (expectedAmount === null || expectedAmount <= 0) {
        throw new Error('LOCAL_RESERVATION_AMOUNT_INVALID')
      }

      if (isVoucherReversalStatus(verified.transactionStatus)) {
        await recordReconciliationEvent(supabase, {
          midtransOrderId: order_id,
          midtransTransactionId: txId,
          transactionStatus: verified.transactionStatus,
          sourceType: 'later_pay_orders',
          grossAmount: gAmt,
          localReferenceId: reservation.payment_key,
          body,
        })
        console.error('LATER_PAY_REVERSAL_REQUIRES_MANUAL_RECONCILIATION', {
          midtrans_order_id: order_id,
          transaction_status: verified.transactionStatus,
          gross_amount: gAmt,
        })
        return new Response('Payment reversal recorded for reconciliation', { status: 200 })
      }

      const terminalReason = releaseReasonForMidtransStatus(verified.transactionStatus)
      if (terminalReason) {
        if (gAmt !== expectedAmount) {
          console.error('midtrans-webhook op_: terminal amount mismatch; reservation retained', {
            midtrans_order_id: order_id,
            gross_amount: gAmt,
            expected_amount: expectedAmount,
          })
          return new Response('Gross amount mismatch', { status: 200 })
        }

        const { data: releaseData, error: releaseError } = await supabase.rpc(
          'release_customer_later_pay_payment',
          {
            p_customer_id: reservation.customer_id,
            p_payment_key: reservation.payment_key,
            p_midtrans_order_id: order_id,
            p_gross_amount: expectedAmount,
            p_reason: terminalReason,
            p_midtrans_transaction_id: txId,
            p_transaction_status: txStatus,
            p_payment_type: payType,
            p_raw_notification: body,
            p_released_at: new Date().toISOString(),
          },
        )
        if (releaseError) {
          if (releaseError.message.includes('LATER_PAY_PAYMENT_ALREADY_SETTLED')) {
            await recordReconciliationEvent(supabase, {
              midtransOrderId: order_id,
              midtransTransactionId: txId,
              transactionStatus: verified.transactionStatus,
              sourceType: 'later_pay_orders',
              grossAmount: gAmt,
              localReferenceId: reservation.payment_key,
              body,
            })
            return new Response('Terminal event recorded for settled payment', { status: 200 })
          }
          throw new Error('LATER_PAY_PAYMENT_RELEASE_FAILED: ' + releaseError.message)
        }
        const release = releaseData as Record<string, unknown> | null
        if (release?.released !== true) throw new Error('LATER_PAY_PAYMENT_RELEASE_FAILED')
        return new Response('Later-pay payment reservation released', { status: 200 })
      }

      if (!verified.paid) return new Response('Payment not settled', { status: 200 })
      if (gAmt !== expectedAmount) {
        console.error('midtrans-webhook op_: immutable reservation amount mismatch', {
          midtrans_order_id: order_id,
          gross_amount: gAmt,
          expected_amount: expectedAmount,
        })
        return new Response('Gross amount mismatch', { status: 200 })
      }

      const { data: settlementData, error: settlementError } = await supabase.rpc(
        'settle_customer_later_pay_payment',
        {
          p_customer_id: reservation.customer_id,
          p_payment_key: reservation.payment_key,
          p_midtrans_order_id: order_id,
          p_gross_amount: expectedAmount,
          p_midtrans_transaction_id: txId,
          p_transaction_status: txStatus,
          p_fraud_status:
            typeof body.fraud_status === 'string' ? body.fraud_status : null,
          p_payment_type: payType,
          p_raw_notification: body,
          p_settled_at: settledAt,
        },
      )
      if (settlementError) throw new Error('LATER_PAY_PAYMENT_SETTLEMENT_FAILED: ' + settlementError.message)
      const settlement = settlementData as Record<string, unknown> | null
      if (settlement?.late_payment === true) {
        await recordReconciliationEvent(supabase, {
          midtransOrderId: order_id,
          midtransTransactionId: txId,
          transactionStatus: verified.transactionStatus,
          sourceType: 'later_pay_orders',
          grossAmount: gAmt,
          localReferenceId: reservation.payment_key,
          body,
        })
        console.error('LATER_PAY_LATE_PAYMENT_REQUIRES_MANUAL_RECONCILIATION', {
          midtrans_order_id: order_id,
          payment_key: reservation.payment_key,
          gross_amount: gAmt,
        })
        return new Response('Late payment recorded for reconciliation', { status: 200 })
      }
      if (settlement?.settled !== true) throw new Error('LATER_PAY_PAYMENT_SETTLEMENT_FAILED')
    }

    // ── Pre-pay order payment (order_id starts with "pop_") ──
    if (order_id.startsWith('pop_')) {
      const { data: ord, error: orderError } = await supabase
        .from('orders')
        .select('id, customer_id, branch, qris_charged_idr')
        .eq('midtrans_order_id', order_id)
        .maybeSingle()
      if (orderError) throw new Error(orderError.message)

      if (!ord) {
        if (isVoucherReversalStatus(verified.transactionStatus)) {
          await recordReconciliationEvent(supabase, {
            midtransOrderId: order_id,
            midtransTransactionId: txId,
            transactionStatus: verified.transactionStatus,
            sourceType: 'prepay_order_qris',
            grossAmount: gAmt,
            localReferenceId: null,
            body,
          })
        }
        console.error('midtrans-webhook pop_: no local order for', order_id)
        return new Response('OK', { status: 200 })
      }

      const expectedAmount = parseGrossAmount(ord.qris_charged_idr)
      if (isVoucherReversalStatus(verified.transactionStatus)) {
        await recordReconciliationEvent(supabase, {
          midtransOrderId: order_id,
          midtransTransactionId: txId,
          transactionStatus: verified.transactionStatus,
          sourceType: 'prepay_order_qris',
          grossAmount: gAmt,
          localReferenceId: ord.id,
          body,
        })
        console.error('PREPAY_ORDER_REVERSAL_REQUIRES_MANUAL_RECONCILIATION', {
          midtrans_order_id: order_id,
          order_id: ord.id,
          transaction_status: verified.transactionStatus,
          gross_amount: gAmt,
        })
        return new Response('Prepay payment reversal recorded for reconciliation', { status: 200 })
      }

      if (expectedAmount === null || expectedAmount <= 0) {
        throw new Error('LOCAL_QRIS_AMOUNT_INVALID')
      }

      const releaseReason = releaseReasonForMidtransStatus(verified.transactionStatus)
      if (releaseReason) {
        if (gAmt !== expectedAmount) {
          console.error('midtrans-webhook pop_: terminal status amount mismatch; checkout retained', {
            midtrans_order_id: order_id,
            transaction_status: verified.transactionStatus,
            gross_amount: gAmt,
            expected_qris_charged_idr: ord.qris_charged_idr,
          })
          return new Response('Gross amount mismatch', { status: 200 })
        }

        const { data: releaseData, error: releaseError } = await supabase.rpc(
          'release_customer_prepay_checkout',
          {
            p_customer_id: ord.customer_id,
            p_order_id: ord.id,
            p_reason: releaseReason,
          },
        )
        if (releaseError) throw new Error(releaseError.message)
        const release = releaseData as Record<string, unknown> | null
        if (release?.released !== true) throw new Error('PREPAY_CHECKOUT_RELEASE_FAILED')

        console.info('midtrans-webhook pop_: released verified terminal checkout', {
          midtrans_order_id: order_id,
          order_id: ord.id,
          transaction_status: verified.transactionStatus,
          release_reason: releaseReason,
          already_released: release.already_released === true,
        })
        return new Response('Prepay checkout released', { status: 200 })
      }

      // Pending and other non-terminal states retain the checkout and voucher
      // reservation. Only verified success or a mapped terminal state acts.
      if (!verified.paid) return new Response('Payment not settled', { status: 200 })
      if (gAmt === null) throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
      if (expectedAmount !== gAmt) {
        console.error('midtrans-webhook pop_: gross amount mismatch', {
          midtrans_order_id: order_id,
          gross_amount: gAmt,
          expected_qris_charged_idr: ord.qris_charged_idr,
        })
        return new Response('Gross amount mismatch', { status: 200 })
      }

      const { data: settlementData, error: settlementError } = await supabase.rpc(
        'settle_customer_prepay_checkout',
        {
          p_midtrans_order_id: order_id,
          p_gross_amount: gAmt,
          p_midtrans_transaction_id: txId,
          p_transaction_status: txStatus,
          p_payment_type: payType,
          p_raw_notification: body,
          p_settled_at: settledAt,
        },
      )
      if (settlementError) throw new Error(settlementError.message)
      const settlement = settlementData as Record<string, unknown> | null
      if (settlement?.late_payment === true || settlement?.requires_refund === true) {
        console.error('PREPAY_LATE_PAYMENT_REQUIRES_REFUND', {
          midtrans_order_id: order_id,
          order_id: ord.id,
          midtrans_transaction_id: txId,
          gross_amount: gAmt,
          settlement,
        })
        // This is a completed reconciliation outcome, not a transient webhook
        // failure. A 2xx prevents retry storms while the refund is handled.
        return new Response('Late prepay payment recorded; refund required', { status: 200 })
      }
      if (settlement?.settled !== true) throw new Error('PREPAY_SETTLEMENT_FAILED')
    }

    return new Response('OK', { status: 200 })
  } catch (error: unknown) {
    console.error('Webhook error:', error)
    return new Response('Error', { status: 500 })
  }
})
