import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { token, branch_name } = await req.json()
    if (!token) throw new Error('Token required')
    if (!branch_name) throw new Error('branch_name required')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Validate token and get customer
    const { data: customer } = await supabase
      .from('customers')
      .select('id, customer_type, service_branch, branch')
      .eq('auth_token', token)
      .single()
    if (!customer) throw new Error('Invalid token')

    const ct = (customer.customer_type || '').toLowerCase()
    if (ct === 'later_pay' || ct === 'later_paid') {
      throw new Error('LATER_PAY_BRANCH_LOCKED')
    }

    const { data: branchRow } = await supabase
      .from('branches')
      .select('internal_demo')
      .eq('name', branch_name)
      .eq('status', 'active')
      .maybeSingle()

    if (branchRow?.internal_demo) {
      const onDemoBranch = (customer.branch || '').trim().toLowerCase() === 'demo'
      const isDemoService =
        (customer.service_branch || '').trim().toLowerCase() === 'demo'
      if (!isDemoService && !onDemoBranch) throw new Error('DEMO_BRANCH_FORBIDDEN')
    }

    // Update branch
    const { error } = await supabase
      .from('customers')
      .update({ branch: branch_name })
      .eq('id', customer.id)
    if (error) throw new Error('Update failed: ' + error.message)

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
