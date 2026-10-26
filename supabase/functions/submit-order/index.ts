import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface OrderItem {
  product_id?: string
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
    total_amount?: number
    payment_status?: string
  }
  items: OrderItem[]
  product_deductions?: ProductDeduction[]
  vouchers_to_deduct?: number
  edit_order_id?: string
  voucher_order_key?: string
  later_pay_order_key?: string
}

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  })
}

function rpcErrorDisposition(
  message: string,
  code: string,
  conflictMarker: string,
): 'manual_reconcile' | 'discard_key' | 'retry_same_key' {
  if (message.includes(conflictMarker)) return 'manual_reconcile'
  if (
    code === 'P0001' ||
    code.startsWith('22') ||
    code.startsWith('23') ||
    code.startsWith('42') ||
    code.startsWith('55')
  ) return 'discard_key'
  return 'retry_same_key'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') throw new Error('Method not allowed')

    const body: RequestBody = await req.json()
    const {
      token,
      order,
      items,
      product_deductions,
      edit_order_id,
      voucher_order_key,
      later_pay_order_key,
    } = body

    if (!token) throw new Error('Token is required')
    if (!order || !Array.isArray(items) || items.length === 0) {
      throw new Error('Order data is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // The opaque token is authenticated at the Edge boundary. The database
    // RPC re-locks and re-validates every mutable customer attribute used by
    // the order, so this lookup is identity resolution only.
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_type')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) {
      throw new Error('Invalid or expired token')
    }

    // Fully voucher-funded pre-pay orders retain their existing dedicated
    // transaction and response contract.
    if (voucher_order_key !== undefined) {
      if (edit_order_id) throw new Error('ORDER_NOT_EDITABLE')
      const voucherOrderKey = typeof voucher_order_key === 'string'
        ? voucher_order_key.trim().toLowerCase()
        : ''
      if (!UUID_RE.test(voucherOrderKey)) throw new Error('VOUCHER_ORDER_KEY_REQUIRED')

      const { data: created, error: createError } = await supabase.rpc(
        'create_customer_voucher_only_order',
        {
          p_customer_id: customer.id,
          p_order_key: voucherOrderKey,
          p_delivery_date: order.delivery_date,
          p_note: order.note || null,
          p_items: items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
          })),
          p_product_deductions: product_deductions || [],
        },
      )

      if (createError) {
        const errorMessage = createError.message || 'VOUCHER_ONLY_ORDER_CREATE_FAILED'
        const errorCode = typeof createError.code === 'string' ? createError.code : ''
        return jsonResponse({
          success: false,
          error: errorMessage,
          voucher_order_disposition: rpcErrorDisposition(
            errorMessage,
            errorCode,
            'VOUCHER_ORDER_KEY_CONFLICT',
          ),
        })
      }
      if (
        !created ||
        (created.created !== true && created.already_created !== true) ||
        typeof created.order_id !== 'string' ||
        !UUID_RE.test(created.order_id)
      ) {
        throw new Error('INVALID_VOUCHER_ONLY_ORDER_RESPONSE')
      }
      if (created.is_active !== true) {
        return jsonResponse({
          success: false,
          error: 'VOUCHER_ORDER_ALREADY_INACTIVE',
          voucher_order_disposition: 'discard_key',
        })
      }
      return jsonResponse({ success: true })
    }

    if (customer.customer_type === 'pre_pay') {
      throw new Error(edit_order_id ? 'ORDER_NOT_EDITABLE' : 'VOUCHER_ORDER_KEY_REQUIRED')
    }

    let createKey: string | null = null
    let editOrderId: string | null = null
    if (edit_order_id) {
      if (!UUID_RE.test(edit_order_id)) throw new Error('ORDER_NOT_FOUND')
      if (later_pay_order_key !== undefined) {
        throw new Error('LATER_PAY_CREATE_OR_EDIT_IDENTITY_REQUIRED')
      }
      editOrderId = edit_order_id.toLowerCase()
    } else {
      createKey = typeof later_pay_order_key === 'string'
        ? later_pay_order_key.trim().toLowerCase()
        : ''
      if (!UUID_RE.test(createKey)) throw new Error('LATER_PAY_ORDER_KEY_REQUIRED')
    }

    // This is the sole write call for an ordinary later-pay create/edit. The
    // RPC owns all locks, validation and order/item writes. Later-pay voucher
    // deductions fail closed until settlement has a separate cash-due amount.
    const { data: submitted, error: submitError } = await supabase.rpc(
      'submit_customer_later_pay_order',
      {
        p_customer_id: customer.id,
        p_order_key: createKey,
        p_edit_order_id: editOrderId,
        p_delivery_date: order.delivery_date,
        p_note: order.note || null,
        p_items: items.map((item) => ({
          product_id: item.product_id,
          product: item.product,
          is_refill: item.is_refill,
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount: item.discount,
        })),
        p_product_deductions: product_deductions || [],
      },
    )

    if (submitError) {
      const errorMessage = submitError.message || 'LATER_PAY_ORDER_SUBMIT_FAILED'
      const errorCode = typeof submitError.code === 'string' ? submitError.code : ''
      return jsonResponse({
        success: false,
        error: errorMessage,
        later_pay_order_disposition: createKey
          ? rpcErrorDisposition(
            errorMessage,
            errorCode,
            'LATER_PAY_ORDER_KEY_CONFLICT',
          )
          : undefined,
      })
    }
    if (
      !submitted ||
      typeof submitted.order_id !== 'string' ||
      !UUID_RE.test(submitted.order_id) ||
      submitted.is_active !== true ||
      (
        createKey !== null &&
        submitted.created !== true &&
        submitted.already_created !== true
      ) ||
      (editOrderId !== null && submitted.edited !== true)
    ) {
      throw new Error('INVALID_LATER_PAY_ORDER_RESPONSE')
    }

    return jsonResponse({ success: true })
  } catch (error: any) {
    console.error('submit-order error:', error)
    return jsonResponse({ success: false, error: error.message })
  }
})
