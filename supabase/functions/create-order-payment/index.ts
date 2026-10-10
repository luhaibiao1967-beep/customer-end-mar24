import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Reservation = {
  reserved?: boolean
  created?: boolean
  should_create?: boolean
  already_finalized?: boolean
  paid?: boolean
  released?: boolean
  legacy_imported?: boolean
  payment_disposition?: string
  state?: string
  payment_key: string
  midtrans_order_id: string
  gross_amount: number
  order_ids?: string[]
  order_allocations?: Array<{
    order_id: string
    customer_id: string
    branch: string
    amount_idr: number
  }>
  snap_token?: string | null
  snap_redirect_url?: string | null
  customer_name?: string | null
  customer_whatsapp?: string | null
  release_reason?: string | null
}

type ProviderStatus = {
  kind: 'not_found' | 'verified'
  body?: Record<string, unknown>
  grossAmount?: number | null
  transactionStatus?: string
  paid?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })
}

function canonicalOrderIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new Error('order_ids must contain between 1 and 100 orders')
  }
  if (value.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) {
    throw new Error('order_ids contains an invalid order id')
  }
  const ids = [...new Set(value as string[])].sort()
  if (ids.length !== value.length) throw new Error('order_ids contains duplicates')
  return ids
}

function parsePositiveInteger(value: unknown): number | null {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isPaidStatus(body: Record<string, unknown>): boolean {
  const status = normalizedString(body.transaction_status)
  const fraud = normalizedString(body.fraud_status)
  return status === 'settlement' || (status === 'capture' && fraud === 'accept')
}

function releaseReason(status: string): string | null {
  if (status === 'expire') return 'payment_expired'
  if (status === 'cancel') return 'payment_cancelled'
  if (status === 'deny') return 'payment_denied'
  if (status === 'failure') return 'payment_failed'
  return null
}

function parseSettledAt(body: Record<string, unknown>): string | null {
  for (const field of ['settlement_time', 'transaction_time']) {
    const value = body[field]
    if (typeof value !== 'string' || !value.trim()) continue
    const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '+07:00'
    const date = new Date(normalized)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return null
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  } catch (_) {
    return {}
  }
}

async function fetchProviderStatus(
  midtransOrderId: string,
  serverKey: string,
  midtransEnv: string,
): Promise<ProviderStatus> {
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
  const response = await fetch(`${base}/${encodeURIComponent(midtransOrderId)}/status`, {
    headers: { Authorization: `Basic ${btoa(serverKey + ':')}` },
  })
  if (response.status === 404) return { kind: 'not_found' }
  if (!response.ok) throw new Error(`MIDTRANS_STATUS_HTTP_${response.status}`)

  const body = await readJson(response)
  if (body.order_id !== midtransOrderId) throw new Error('MIDTRANS_ORDER_ID_MISMATCH')
  const transactionStatus = normalizedString(body.transaction_status)
  if (!transactionStatus) throw new Error('INVALID_MIDTRANS_STATUS_RESPONSE')
  const grossAmount = parsePositiveInteger(body.gross_amount)
  const paid = isPaidStatus(body)
  if ((paid || releaseReason(transactionStatus)) && grossAmount === null) {
    throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
  }
  return { kind: 'verified', body, grossAmount, transactionStatus, paid }
}

async function resolveExistingPaymentKey(
  supabase: SupabaseClient,
  customerId: string,
  orderIds: string[],
): Promise<string | null> {
  const { data: matches, error } = await supabase
    .from('later_pay_payment_reservation_orders')
    .select('payment_key, order_id')
    .eq('customer_id', customerId)
    .eq('is_open', true)
    .in('order_id', orderIds)
  if (error) throw new Error('PAYMENT_RESERVATION_LOOKUP_FAILED: ' + error.message)
  if (!matches?.length) return null

  const keys = [...new Set(matches.map((row) => String(row.payment_key)))]
  if (keys.length !== 1) throw new Error('ORDERS_HAVE_MULTIPLE_OPEN_PAYMENT_ATTEMPTS')

  const paymentKey = keys[0]
  const { data: members, error: membersError } = await supabase
    .from('later_pay_payment_reservation_orders')
    .select('order_id')
    .eq('payment_key', paymentKey)
    .eq('is_open', true)
    .order('order_id', { ascending: true })
  if (membersError) {
    throw new Error('PAYMENT_RESERVATION_MEMBERSHIP_LOOKUP_FAILED: ' + membersError.message)
  }

  const memberIds = (members ?? []).map((row) => String(row.order_id)).sort()
  if (memberIds.length !== orderIds.length || memberIds.some((id, index) => id !== orderIds[index])) {
    throw new Error('PAYMENT_ALREADY_IN_PROGRESS_FOR_DIFFERENT_ORDER_SET')
  }
  return paymentKey
}

async function settleReservation(
  supabase: SupabaseClient,
  customerId: string,
  reservation: Reservation,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const grossAmount = parsePositiveInteger(body.gross_amount)
  if (grossAmount !== reservation.gross_amount) throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
  const { data, error } = await supabase.rpc('settle_customer_later_pay_payment', {
    p_customer_id: customerId,
    p_payment_key: reservation.payment_key,
    p_midtrans_order_id: reservation.midtrans_order_id,
    p_gross_amount: grossAmount,
    p_midtrans_transaction_id:
      typeof body.transaction_id === 'string' ? body.transaction_id : null,
    p_transaction_status:
      typeof body.transaction_status === 'string' ? normalizedString(body.transaction_status) : null,
    p_fraud_status: typeof body.fraud_status === 'string' ? normalizedString(body.fraud_status) : null,
    p_payment_type: typeof body.payment_type === 'string' ? body.payment_type : null,
    p_raw_notification: body,
    p_settled_at: parseSettledAt(body),
  })
  if (error) throw new Error('PAYMENT_SETTLEMENT_FAILED: ' + error.message)
  return data as Record<string, unknown>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405)

  try {
    const request = await req.json() as Record<string, unknown>
    const token = typeof request.token === 'string' ? request.token.trim() : ''
    if (!token) throw new Error('Token required')
    const orderIds = canonicalOrderIds(request.order_ids)

    const suppliedPaymentKey = typeof request.payment_key === 'string'
      ? request.payment_key.trim()
      : ''
    if (!UUID_RE.test(suppliedPaymentKey)) throw new Error('payment_key must be a UUID')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
    const clientKey = Deno.env.get('MIDTRANS_CLIENT_KEY')
    if (!supabaseUrl || !supabaseKey || !serverKey || !clientKey) {
      throw new Error('Missing required payment environment variables')
    }

    const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
    const snapUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/v1/transactions'
      : 'https://app.sandbox.midtrans.com/snap/v1/transactions'
    const snapJsUrl = midtransEnv === 'production'
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js'

    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_type')
      .eq('auth_token', token)
      .maybeSingle()
    if (customerError || !customer) throw new Error('Invalid token')
    if (customer.customer_type !== 'later_pay') {
      throw new Error('Only later-pay customers may use batch order payment')
    }

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, total_amount')
      .eq('customer_id', customer.id)
      .in('id', orderIds)
    if (ordersError) throw new Error('ORDER_LOOKUP_FAILED: ' + ordersError.message)
    if (!orders || orders.length !== orderIds.length) throw new Error('ORDER_SET_NOT_FOUND')

    let grossAmount = 0
    for (const order of orders) {
      const amount = parsePositiveInteger(order.total_amount)
      if (amount === null) throw new Error('ORDER_AMOUNT_INVALID')
      grossAmount += amount
    }
    if (!Number.isSafeInteger(grossAmount) || grossAmount <= 0) throw new Error('ORDER_AMOUNT_INVALID')

    const existingKey = await resolveExistingPaymentKey(supabase, customer.id, orderIds)
    const paymentKey = existingKey ?? suppliedPaymentKey

    const { data: reservationData, error: reservationError } = await supabase.rpc(
      'reserve_customer_later_pay_payment',
      {
        p_customer_id: customer.id,
        p_payment_key: paymentKey,
        p_order_ids: orderIds,
        p_expected_amount: grossAmount,
        p_payment_rail: 'other_qris',
      },
    )
    if (reservationError) throw new Error('PAYMENT_RESERVATION_FAILED: ' + reservationError.message)
    const reservation = reservationData as Reservation

    const responseBase = {
      payment_key: reservation.payment_key,
      midtrans_order_id: reservation.midtrans_order_id,
      total: reservation.gross_amount,
      payment_disposition: reservation.payment_disposition ?? 'retry_same_key',
      client_key: clientKey,
      snap_js_url: snapJsUrl,
    }

    if (reservation.paid || reservation.state === 'settled') {
      return jsonResponse({ success: true, paid: true, ...responseBase, payment_disposition: 'discard_key' })
    }
    if (reservation.released || reservation.state === 'released') {
      return jsonResponse({
        success: false,
        paid: false,
        error: 'PAYMENT_RESERVATION_RELEASED',
        release_reason: reservation.release_reason ?? null,
        ...responseBase,
        payment_disposition: 'discard_key',
      })
    }
    if (reservation.snap_token) {
      return jsonResponse({
        success: true,
        paid: false,
        snap_token: reservation.snap_token,
        redirect_url: reservation.snap_redirect_url ?? null,
        resumed: true,
        ...responseBase,
      })
    }
    if (reservation.legacy_imported) {
      return jsonResponse({
        success: false,
        paid: false,
        error: 'LEGACY_PAYMENT_REQUIRES_MANUAL_RECONCILIATION',
        ...responseBase,
        payment_disposition: 'manual_reconcile',
      })
    }

    // A retry without a stored Snap token must first inspect the original
    // provider id. Only a verified 404 permits recreating the same id.
    if (reservation.created === false || reservation.should_create === false) {
      try {
        const provider = await fetchProviderStatus(reservation.midtrans_order_id, serverKey, midtransEnv)
        if (provider.kind === 'verified') {
          const providerBody = provider.body!
          if (provider.paid) {
            const settlement = await settleReservation(supabase, customer.id, reservation, providerBody)
            if (settlement.late_payment === true) {
              return jsonResponse({
                success: false,
                paid: false,
                error: 'LATE_PAYMENT_REQUIRES_MANUAL_RECONCILIATION',
                ...responseBase,
                payment_disposition: 'manual_reconcile',
              })
            }
            return jsonResponse({ success: true, paid: true, ...responseBase, payment_disposition: 'discard_key' })
          }

          const terminalReason = releaseReason(provider.transactionStatus ?? '')
          if (terminalReason) {
            if (provider.grossAmount !== reservation.gross_amount) {
              throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
            }
            const { error: releaseError } = await supabase.rpc('release_customer_later_pay_payment', {
              p_customer_id: customer.id,
              p_payment_key: reservation.payment_key,
              p_midtrans_order_id: reservation.midtrans_order_id,
              p_gross_amount: reservation.gross_amount,
              p_reason: terminalReason,
              p_midtrans_transaction_id:
                typeof providerBody.transaction_id === 'string' ? providerBody.transaction_id : null,
              p_transaction_status: provider.transactionStatus,
              p_payment_type: typeof providerBody.payment_type === 'string' ? providerBody.payment_type : null,
              p_raw_notification: providerBody,
              p_released_at: new Date().toISOString(),
            })
            if (releaseError) throw new Error('PAYMENT_RESERVATION_RELEASE_FAILED: ' + releaseError.message)
            return jsonResponse({
              success: false,
              paid: false,
              error: 'PAYMENT_ATTEMPT_TERMINAL',
              release_reason: terminalReason,
              ...responseBase,
              payment_disposition: 'discard_key',
            })
          }

          return jsonResponse({
            success: false,
            paid: false,
            error: 'PAYMENT_SESSION_STATUS_UNCERTAIN',
            provider_status: provider.transactionStatus ?? null,
            ...responseBase,
            payment_disposition: 'retry_same_key',
          })
        }
        // A provider 404 is the sole safe signal to retry creation below,
        // using the exact same deterministic Midtrans order id.
      } catch (statusError) {
        console.error('create-order-payment: original provider status is uncertain', {
          midtrans_order_id: reservation.midtrans_order_id,
          error: statusError instanceof Error ? statusError.message : String(statusError),
        })
        return jsonResponse({
          success: false,
          paid: false,
          error: 'PAYMENT_PROVIDER_STATUS_UNAVAILABLE',
          ...responseBase,
          payment_disposition: 'retry_same_key',
        })
      }
    }

    const allocations = Array.isArray(reservation.order_allocations)
      ? reservation.order_allocations
      : []
    if (allocations.length !== orderIds.length) throw new Error('PAYMENT_RESERVATION_SNAPSHOT_INVALID')

    let mtResponse: Response
    try {
      mtResponse = await fetch(snapUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa(serverKey + ':')}`,
        },
        body: JSON.stringify({
          transaction_details: {
            order_id: reservation.midtrans_order_id,
            gross_amount: reservation.gross_amount,
          },
          item_details: allocations.map((item) => ({
            id: item.order_id,
            price: item.amount_idr,
            quantity: 1,
            name: `Order #${item.order_id.slice(0, 8)}`,
          })),
          customer_details: {
            first_name: reservation.customer_name ?? 'Customer',
            phone: reservation.customer_whatsapp ?? undefined,
          },
          enabled_payments: ['other_qris'],
          notification_url: `${supabaseUrl}/functions/v1/midtrans-webhook`,
        }),
      })
    } catch (networkError) {
      console.error('create-order-payment: Midtrans create outcome uncertain', {
        midtrans_order_id: reservation.midtrans_order_id,
        error: networkError instanceof Error ? networkError.message : String(networkError),
      })
      return jsonResponse({
        success: false,
        paid: false,
        error: 'PAYMENT_CREATE_OUTCOME_UNCERTAIN',
        ...responseBase,
        payment_disposition: 'retry_same_key',
      })
    }

    const mtData = await readJson(mtResponse)
    const snapToken = typeof mtData.token === 'string' ? mtData.token.trim() : ''
    const redirectUrl = typeof mtData.redirect_url === 'string' ? mtData.redirect_url.trim() : ''

    if (!mtResponse.ok || !snapToken) {
      const deterministicRejection = [400, 401, 403, 404, 422].includes(mtResponse.status)
      if (deterministicRejection) {
        const { error: releaseError } = await supabase.rpc('release_customer_later_pay_payment', {
          p_customer_id: customer.id,
          p_payment_key: reservation.payment_key,
          p_midtrans_order_id: reservation.midtrans_order_id,
          p_gross_amount: reservation.gross_amount,
          p_reason: 'snap_create_failed',
          p_midtrans_transaction_id: null,
          p_transaction_status: null,
          p_payment_type: null,
          p_raw_notification: mtData,
          p_released_at: new Date().toISOString(),
        })
        if (releaseError) throw new Error('PAYMENT_RESERVATION_RELEASE_FAILED: ' + releaseError.message)
      }
      return jsonResponse({
        success: false,
        paid: false,
        error: deterministicRejection
          ? 'MIDTRANS_REJECTED_PAYMENT_CREATION'
          : 'PAYMENT_CREATE_OUTCOME_UNCERTAIN',
        provider_http_status: mtResponse.status,
        ...responseBase,
        payment_disposition: deterministicRejection ? 'discard_key' : 'retry_same_key',
      })
    }

    const { data: finalizedData, error: finalizedError } = await supabase.rpc(
      'finalize_customer_later_pay_payment',
      {
        p_customer_id: customer.id,
        p_payment_key: reservation.payment_key,
        p_midtrans_order_id: reservation.midtrans_order_id,
        p_gross_amount: reservation.gross_amount,
        p_snap_token: snapToken,
        p_snap_redirect_url: redirectUrl || null,
      },
    )
    if (finalizedError) {
      console.error('create-order-payment: provider session exists but local persistence failed', {
        midtrans_order_id: reservation.midtrans_order_id,
        error: finalizedError.message,
      })
      return jsonResponse({
        success: false,
        paid: false,
        error: 'PAYMENT_SESSION_PERSISTENCE_UNCERTAIN',
        ...responseBase,
        payment_disposition: 'retry_same_key',
      })
    }

    const finalized = finalizedData as Reservation
    return jsonResponse({
      success: true,
      paid: false,
      snap_token: finalized.snap_token,
      redirect_url: finalized.snap_redirect_url ?? null,
      resumed: finalized.already_finalized === true,
      ...responseBase,
      payment_disposition: 'retry_same_key',
    })
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
