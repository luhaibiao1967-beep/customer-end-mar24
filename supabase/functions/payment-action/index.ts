import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, action, order_id, file_base64, file_type } = await req.json()

    if (!token) throw new Error('Token is required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) throw new Error('Invalid or expired token')

    // Upload payment evidence
    if (action === 'upload') {
      if (!order_id || !file_base64) throw new Error('order_id and file required')

      // Verify order belongs to customer
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id')
        .eq('id', order_id)
        .eq('customer_id', customer.id)
        .single()

      if (orderError || !order) throw new Error('Order not found')

      // Decode base64 to binary
      const base64Data = file_base64.includes(',') ? file_base64.split(',')[1] : file_base64
      const binaryStr = atob(base64Data)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
      }

      const ext = file_type?.includes('png') ? 'png' : 'jpg'
      const filePath = `${order_id}_${Date.now()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('payment-evidence')
        .upload(filePath, bytes, { contentType: file_type || 'image/jpeg', upsert: true })

      if (uploadError) throw new Error('Upload failed: ' + uploadError.message)

      const { error: updateError } = await supabase
        .from('orders')
        .update({ payment_evidence: filePath })
        .eq('id', order_id)

      if (updateError) throw new Error('Failed to update order: ' + updateError.message)

      return new Response(
        JSON.stringify({ success: true, path: filePath }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Get signed URL to view payment evidence
    if (action === 'view') {
      if (!order_id) throw new Error('order_id required')

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('payment_evidence')
        .eq('id', order_id)
        .eq('customer_id', customer.id)
        .single()

      if (orderError || !order) throw new Error('Order not found')
      if (!order.payment_evidence) throw new Error('No payment evidence uploaded')

      const { data: signedData, error: urlError } = await supabase.storage
        .from('payment-evidence')
        .createSignedUrl(order.payment_evidence, 3600)

      if (urlError) throw new Error('Failed to get URL: ' + urlError.message)

      return new Response(
        JSON.stringify({ success: true, url: signedData.signedUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    throw new Error('Invalid action')

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
