import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  token: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token }: RequestBody = await req.json()

    if (!token) {
      throw new Error('Token is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('auth_token', token)
      .single()

    if (customerError || !customer) {
      throw new Error('Invalid or expired token')
    }

    const tokenAge = Date.now() - new Date(customer.token_created_at).getTime()
    const maxTokenAge = 90 * 24 * 60 * 60 * 1000
    
    if (tokenAge > maxTokenAge) {
      return new Response(
        JSON.stringify({
          success: false,
          reauth_required: true,
          message: 'Token expired, OTP required',
          whatsapp: customer.whatsapp,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Sliding expiry: extend token validity on each successful use (3 months from last use)
    await supabase
      .from('customers')
      .update({
        last_login_at: new Date().toISOString(),
        token_created_at: new Date().toISOString(),
      })
      .eq('id', customer.id)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Token valid',
        customer: {
          id: customer.id,
          name: customer.name,
          address: customer.address,
          whatsapp: customer.whatsapp,
          customer_type: customer.customer_type,
          payment_term: customer.payment_term,
          voucher_balance: customer.voucher_balance,
          branch: customer.branch,
          discount: customer.discount,
          service_branch: customer.service_branch ?? null,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
