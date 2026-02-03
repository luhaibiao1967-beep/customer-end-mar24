import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RequestBody {
  order_id: string
  dynamic_greeting?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { order_id, dynamic_greeting }: RequestBody = await req.json()

    if (!order_id) {
      throw new Error('Order ID is required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', order_id)
      .single()

    if (orderError || !order) {
      throw new Error('Order not found')
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', order.customer_id)
      .single()

    if (customerError || !customer) {
      throw new Error('Customer not found')
    }

    const totalQuantity = order.order_items.reduce((sum: number, item: any) => sum + item.quantity, 0)

    const deliveryDate = new Date(order.delivery_date).toLocaleDateString('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })

    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`

    const greeting = dynamic_greeting || getDefaultGreeting()

    const message = `✅ Pesanan Dikonfirmasi!

📦 Detail Pesanan:
- Jumlah: ${totalQuantity} galon
- Pengiriman: ${deliveryDate}
- Total: Rp ${formatCurrency(order.total_amount)}
- Status: ${getStatusEmoji(order.status)} ${order.status.toUpperCase()}

${greeting}

🔗 Pesan lagi dengan 1 klik:
${magicLink}

Terima kasih telah mempercayai layanan kami! 💧`

    const fazpassApiKey = Deno.env.get('FAZPASS_API_KEY')!
    const fazpassMerchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')!
    
    const fazpassUrl = 'https://api.fazpass.com/v1/message/send'
    
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${fazpassApiKey}`,
        'X-Merchant-Key': fazpassMerchantKey,
      },
      body: JSON.stringify({
        phone: customer.whatsapp,
        gateway: 'whatsapp',
        message: message,
        settings: {
          sender_name: 'Water Delivery',
          is_dev: Deno.env.get('ENVIRONMENT') !== 'production',
        }
      }),
    })

    const data = await response.json()

    await supabase.from('whatsapp_messages').insert({
      customer_id: customer.id,
      phone: customer.whatsapp,
      message_type: 'order_confirmation',
      message_content: message,
      status: response.ok ? 'sent' : 'failed',
      provider_response: JSON.stringify(data),
      order_id: order_id,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Order confirmation sent',
        sent_to: customer.whatsapp,
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

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
  }).format(amount)
}

function getStatusEmoji(status: string): string {
  const statusEmojis: Record<string, string> = {
    'pending': '⏳',
    'scheduled': '📅',
    'delivering': '🚚',
    'delivered': '✅',
    'cancelled': '❌',
  }
  return statusEmojis[status] || '📦'
}

function getDefaultGreeting(): string {
  const greetings = [
    '🎉 Promo Spesial: Beli 10 voucher dapat bonus 1!',
    '💧 Air berkualitas untuk kesehatan keluarga Anda!',
    '🎁 Dapatkan voucher gratis dengan setiap pembelian 20 voucher!',
    '⭐ Terima kasih telah menjadi pelanggan setia kami!',
    '🌟 Jangan lupa isi ulang voucher Anda!',
  ]
  
  return greetings[Math.floor(Math.random() * greetings.length)]
}
