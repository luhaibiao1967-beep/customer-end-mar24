import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const isDevelopment = Deno.env.get('ENVIRONMENT') === 'development'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') throw new Error('Method not allowed')

    const { token, order_id } = await req.json()
    if (!token || typeof token !== 'string') throw new Error('Token is required')
    if (!order_id || typeof order_id !== 'string') throw new Error('Order ID is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) throw new Error('Server configuration is incomplete')

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, is_active')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer || customer.is_active === false) {
      throw new Error('Invalid or expired token')
    }

    // All writes happen in the database function's single transaction.
    // Any voucher, ledger, or order failure rolls the whole operation back.
    const { data: result, error: cancelError } = await supabase.rpc(
      'cancel_customer_pending_order',
      {
        p_customer_id: customer.id,
        p_order_id: order_id,
      },
    )

    if (cancelError) {
      const safeMessages: Record<string, string> = {
        ORDER_NOT_FOUND: 'Order not found',
        ONLY_PENDING_ORDERS_CAN_BE_CANCELLED: 'Only pending orders can be cancelled',
        ORDER_IS_INACTIVE: 'Inactive orders cannot be cancelled',
        PAYMENT_REFUND_REQUIRED: 'This paid order requires a staff-managed payment refund',
        VOUCHER_USAGE_NOT_FOUND: 'Voucher usage record was not found; cancellation was not applied',
        INVALID_VOUCHER_LEDGER_STATE: 'Voucher ledger is inconsistent; cancellation was not applied',
        ORDER_DEACTIVATION_FAILED: 'Order could not be deactivated; cancellation was not applied',
      }
      const code = Object.keys(safeMessages).find((key) => cancelError.message.includes(key))
      console.error('cancel-order RPC failed:', {
        code: cancelError.code,
        message: cancelError.message,
        details: cancelError.details,
        hint: cancelError.hint,
        order_id,
        customer_id: customer.id,
      })
      const diagnostic = [
        cancelError.code,
        cancelError.message,
        cancelError.details,
        cancelError.hint,
      ].filter(Boolean).join(' | ')
      throw new Error(
        code
          ? safeMessages[code]
          : isDevelopment && diagnostic
            ? `Failed to cancel order: ${diagnostic}`
            : 'Failed to cancel order',
      )
    }

    return new Response(
      JSON.stringify({ success: true, result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 },
    )
  }
})
