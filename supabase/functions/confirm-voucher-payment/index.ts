import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
  const transaction_status = body.transaction_status
  const fraud_status = body.fraud_status
  return (
    transaction_status === 'settlement' ||
    (transaction_status === 'capture' && fraud_status === 'accept')
  )
}

async function fetchVerifiedMidtransStatus(
  midtrans_order_id: string,
): Promise<{
  body: Record<string, unknown>
  gross_amount: number | null
  paid: boolean
}> {
  const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY')
  if (!serverKey) throw new Error('MIDTRANS_SERVER_KEY missing')

  const midtransEnv = (Deno.env.get('MIDTRANS_ENV') || 'sandbox').toLowerCase()
  const base = midtransEnv === 'production'
    ? 'https://api.midtrans.com/v2'
    : 'https://api.sandbox.midtrans.com/v2'
  const response = await fetch(`${base}/${encodeURIComponent(midtrans_order_id)}/status`, {
    headers: { Authorization: `Basic ${btoa(serverKey + ':')}` },
  })
  if (!response.ok) throw new Error(`MIDTRANS_STATUS_HTTP_${response.status}`)

  const body = (await response.json()) as Record<string, unknown>
  if (body.order_id !== midtrans_order_id) throw new Error('MIDTRANS_ORDER_ID_MISMATCH')

  const paid = isMidtransSuccess(body)
  const gross_amount = parseGrossAmount(body.gross_amount)
  if (paid && gross_amount === null) throw new Error('MIDTRANS_GROSS_AMOUNT_INVALID')
  return { body, gross_amount, paid }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, midtrans_order_id } = await req.json()
    if (!token) throw new Error('Token required')
    if (typeof midtrans_order_id !== 'string' || !midtrans_order_id.startsWith('vpc_')) {
      throw new Error('Invalid midtrans_order_id')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Missing required environment variables')

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    const { data: request, error: requestError } = await supabase
      .from('voucher_purchase_requests')
      .select('id, customer_id, product_id, qty, amount_paid, status')
      .eq('midtrans_order_id', midtrans_order_id)
      .eq('customer_id', customer.id)
      .maybeSingle()
    if (requestError) throw new Error(requestError.message)
    if (!request) throw new Error('Purchase request not found')

    // Snap onSuccess is client-controlled. Trust only Midtrans's server-to-server
    // Status API and require identity plus exact IDR amount before confirming.
    const verified = await fetchVerifiedMidtransStatus(midtrans_order_id)
    if (!verified.paid) {
      return new Response(
        JSON.stringify({
          success: true,
          paid: false,
          error: 'PAYMENT_NOT_SETTLED',
          transaction_status: verified.body.transaction_status ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
      )
    }
    const expectedAmount = parseGrossAmount(request.amount_paid)
    if (verified.gross_amount === null || expectedAmount === null || expectedAmount !== verified.gross_amount) {
      throw new Error('MIDTRANS_GROSS_AMOUNT_MISMATCH')
    }

    // The database function locks the purchase request, increments the balance,
    // and marks it confirmed in one transaction. Webhook/client races therefore
    // credit this purchase exactly once, with no confirmed-but-uncredited window.
    const { data: confirmationData, error: confirmationError } = await supabase.rpc(
      'confirm_paid_voucher_purchase',
      {
        p_request_id: request.id,
        p_customer_id: request.customer_id,
        p_midtrans_order_id: midtrans_order_id,
        p_midtrans_transaction_id:
          typeof verified.body.transaction_id === 'string' ? verified.body.transaction_id : null,
        p_gross_amount: verified.gross_amount,
        p_transaction_status:
          typeof verified.body.transaction_status === 'string'
            ? verified.body.transaction_status
            : null,
        p_fraud_status:
          typeof verified.body.fraud_status === 'string' ? verified.body.fraud_status : null,
        p_payment_type:
          typeof verified.body.payment_type === 'string' ? verified.body.payment_type : null,
        p_raw_notification: verified.body,
        p_settled_at: parseSettledAt(verified.body),
        p_metadata: { source: 'confirm_voucher_payment_status_api' },
      },
    )
    if (confirmationError) throw new Error(confirmationError.message)

    const confirmation = confirmationData as Record<string, unknown> | null
    if (confirmation?.confirmed !== true) throw new Error('PURCHASE_CONFIRMATION_FAILED')

    return new Response(
      JSON.stringify({
        success: true,
        paid: true,
        already_confirmed: confirmation.already_confirmed === true,
      }),
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
