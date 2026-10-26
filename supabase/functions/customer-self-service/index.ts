import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const responseHeaders = {
  ...corsHeaders,
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_ADDRESS_LENGTH = 500
const MAX_TOKEN_AGE_MS = 90 * 24 * 60 * 60 * 1000

type Action = 'update_address' | 'confirm_delivery'

interface RequestBody {
  token?: unknown
  action?: unknown
  address?: unknown
  order_id?: unknown
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: responseHeaders, status })
}

function jakartaTodayYmd(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { success: false, code: 'METHOD_NOT_ALLOWED', error: 'Only POST requests are allowed' },
      405,
    )
  }

  try {
    let body: RequestBody
    try {
      body = await req.json() as RequestBody
    } catch {
      throw new RequestError(400, 'INVALID_JSON', 'A valid JSON request body is required')
    }
    const token = typeof body.token === 'string' ? body.token.trim() : ''
    const action = body.action as Action

    if (!UUID_RE.test(token)) {
      throw new RequestError(401, 'INVALID_TOKEN', 'Invalid or expired token')
    }
    if (action !== 'update_address' && action !== 'confirm_delivery') {
      throw new RequestError(400, 'INVALID_ACTION', 'Unsupported customer action')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase service configuration is missing')
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_type, token_created_at')
      .eq('auth_token', token)
      .eq('is_active', true)
      .maybeSingle()

    if (customerError) {
      console.error('customer-self-service: customer lookup failed', customerError.message)
      throw new Error('Customer lookup failed')
    }
    if (!customer) {
      throw new RequestError(401, 'INVALID_TOKEN', 'Invalid or expired token')
    }

    const tokenCreatedAt = new Date(customer.token_created_at ?? '').getTime()
    if (!Number.isFinite(tokenCreatedAt) || Date.now() - tokenCreatedAt > MAX_TOKEN_AGE_MS) {
      throw new RequestError(401, 'TOKEN_EXPIRED', 'Token expired, OTP required')
    }

    if (action === 'update_address') {
      const address = typeof body.address === 'string' ? body.address.trim() : ''
      if (!address) {
        throw new RequestError(400, 'ADDRESS_REQUIRED', 'Address is required')
      }
      if (address.length > MAX_ADDRESS_LENGTH) {
        throw new RequestError(
          400,
          'ADDRESS_TOO_LONG',
          `Address must be ${MAX_ADDRESS_LENGTH} characters or fewer`,
        )
      }

      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({ address })
        .eq('id', customer.id)
        .eq('auth_token', token)
        .eq('is_active', true)
        .select('id, address')
        .maybeSingle()

      if (updateError) {
        console.error('customer-self-service: address update failed', updateError.message)
        throw new Error('Address update failed')
      }
      if (!updatedCustomer) {
        throw new RequestError(409, 'CUSTOMER_NOT_ACTIVE', 'Customer session is no longer active')
      }

      return jsonResponse({ success: true, address: updatedCustomer.address })
    }

    const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : ''
    if (!UUID_RE.test(orderId)) {
      throw new RequestError(400, 'INVALID_ORDER_ID', 'A valid order ID is required')
    }
    if (customer.customer_type !== 'pre_pay' && customer.customer_type !== 'later_pay') {
      throw new RequestError(403, 'CUSTOMER_TYPE_NOT_ALLOWED', 'Customer type cannot confirm delivery')
    }

    const deliveredDate = jakartaTodayYmd()
    const { data: confirmation, error: confirmError } = await supabase.rpc(
      'confirm_customer_order_delivery_atomic',
      {
        p_customer_id: customer.id,
        p_order_id: orderId,
        p_delivered_date: deliveredDate,
      },
    )

    if (confirmError) {
      console.error('customer-self-service: delivery confirmation failed', confirmError.message)
      if (confirmError.message.includes('INVALID_CUSTOMER_DELIVERY_CONFIRMATION')) {
        throw new RequestError(400, 'INVALID_DELIVERY_CONFIRMATION', 'Invalid delivery confirmation request')
      }
      if (confirmError.message.includes('CUSTOMER_NOT_ELIGIBLE_FOR_DELIVERY_CONFIRMATION')) {
        throw new RequestError(403, 'CUSTOMER_NOT_ELIGIBLE', 'Customer cannot confirm this delivery')
      }
      if (confirmError.message.includes('ORDER_NOT_CONFIRMABLE')) {
        throw new RequestError(
          409,
          'ORDER_NOT_CONFIRMABLE',
          'Order cannot be confirmed. It must be your active scheduled delivery; prepaid orders must also be paid.',
        )
      }
      throw new Error('Delivery confirmation failed')
    }
    if (!confirmation?.confirmed) {
      throw new RequestError(
        409,
        'ORDER_NOT_CONFIRMABLE',
        'Order cannot be confirmed. It must be your active scheduled delivery; prepaid orders must also be paid.',
      )
    }

    return jsonResponse({
      success: true,
      order: {
        id: confirmation.order_id,
        status: confirmation.status,
        delivered_date: confirmation.delivered_date,
      },
    })
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      return jsonResponse(
        { success: false, code: error.code, error: error.message },
        error.status,
      )
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error('customer-self-service: unexpected error', message)
    return jsonResponse(
      { success: false, code: 'INTERNAL_ERROR', error: 'Unable to complete customer request' },
      500,
    )
  }
})
