import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OrderItem {
  product: string
  is_refill: boolean
  quantity: number
  unit_price: number
  discount: number
}

interface RequestBody {
  token: string
  order: {
    delivery_date: string
    note?: string
    total_amount: number
    payment_status: string
  }
  items: OrderItem[]
  vouchers_to_deduct: number
  edit_order_id?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body: RequestBody = await req.json()
    const { token, order, items, vouchers_to_deduct, edit_order_id } = body

    if (!token) throw new Error('Token is required')
    if (!order || !items || items.length === 0) throw new Error('Order data is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token and get customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) {
      throw new Error('Invalid or expired token')
    }

    // Check voucher balance if needed
    if (vouchers_to_deduct > 0) {
      if (customer.voucher_balance < vouchers_to_deduct) {
        throw new Error('Insufficient voucher balance')
      }
    }

    if (edit_order_id) {
      // Update existing order
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          delivery_date: order.delivery_date,
          total_amount: order.total_amount,
          note: order.note || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', edit_order_id)
        .eq('customer_id', customer.id) // safety check: only own orders

      if (updateError) throw new Error('Failed to update order: ' + updateError.message)

      // Replace order items
      await supabase.from('order_items').delete().eq('order_id', edit_order_id)

      const { error: itemsError } = await supabase.from('order_items').insert(
        items.map(item => ({ ...item, order_id: edit_order_id }))
      )
      if (itemsError) throw new Error('Failed to update order items: ' + itemsError.message)

    } else {
      // Create new order
      const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_address: customer.address,
          customer_whatsapp: customer.whatsapp,
          customer_discount: customer.discount || 0,
          branch: customer.branch,
          delivery_date: order.delivery_date,
          total_amount: order.total_amount,
          status: 'pending',
          payment_status: order.payment_status,
          note: order.note || null,
          empty_gallons_returned: 0,
          borrowed_gallons: 0,
          created_by: null,
          created_by_display: customer.name,
          is_active: true,
        })
        .select()
        .single()

      if (orderError) throw new Error('Failed to create order: ' + orderError.message)

      const { error: itemsError } = await supabase.from('order_items').insert(
        items.map(item => ({ ...item, order_id: newOrder.id }))
      )
      if (itemsError) throw new Error('Failed to create order items: ' + itemsError.message)

      // Deduct vouchers for pre_pay customers
      if (vouchers_to_deduct > 0) {
        const { error: voucherError } = await supabase
          .from('customers')
          .update({ voucher_balance: customer.voucher_balance - vouchers_to_deduct })
          .eq('id', customer.id)

        if (voucherError) throw new Error('Failed to deduct vouchers: ' + voucherError.message)
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    console.error('submit-order error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
