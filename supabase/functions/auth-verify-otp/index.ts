import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0'
import { buildBodyParams, sendTemplateMessage } from '../_shared/whatsappCloud.ts'
import { verifyOTPViaFazpass } from '../_shared/fazpass.ts'
import { normalizeIndonesianWhatsApp } from '../_shared/phone.ts'
import { getOtpVerificationMode } from '../_shared/otpPolicy.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEV_MODE = Deno.env.get('ENVIRONMENT') === 'development'

class OtpVerificationError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'OtpVerificationError'
    this.code = code
    this.status = status
  }
}

interface RequestBody {
  phone: string
  otp: string
  device_id?: string
  name?: string
  address?: string
  isRegistration?: boolean
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { phone, otp, device_id, name, address, isRegistration }: RequestBody = await req.json()

    if (!phone || !otp) {
      throw new OtpVerificationError('OTP_INPUT_REQUIRED', 'Phone and OTP are required')
    }

    if (isRegistration && (!name || !address)) {
      throw new OtpVerificationError(
        'REGISTRATION_FIELDS_REQUIRED',
        'Name and address are required for registration'
      )
    }

    const formattedPhone = normalizeIndonesianWhatsApp(phone)
    if (!formattedPhone) {
      throw new OtpVerificationError('INVALID_PHONE', 'Invalid phone number')
    }
    const otpTrimmed = String(otp || '').trim()
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // The newest live OTP defines the verification mechanism. Provider-backed
    // records must be verified by Fazpass and can never fall back to a local
    // plaintext comparison.
    const { data: liveOtpRecords, error: otpFetchError } = await supabase
      .from('auth_otps')
      .select('id, request_id, otp, created_at')
      .eq('phone', formattedPhone)
      .eq('verified', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(5)

    if (otpFetchError) {
      console.error('auth_otps fetch error:', otpFetchError)
      throw new OtpVerificationError(
        'OTP_LOOKUP_FAILED',
        'Unable to verify the code right now',
        500
      )
    }

    const latestOtpRecord = liveOtpRecords?.[0]
    if (!latestOtpRecord) {
      throw new OtpVerificationError(
        'INVALID_OR_EXPIRED_OTP',
        'Invalid or expired OTP. Please request a new code.'
      )
    }

    let otpRecord: any = latestOtpRecord

    const verificationMode = getOtpVerificationMode(DEV_MODE, latestOtpRecord.request_id)

    if (verificationMode === 'provider') {
      const merchantKey = Deno.env.get('FAZPASS_MERCHANT_KEY')?.trim()
      if (!merchantKey) {
        throw new OtpVerificationError(
          'OTP_PROVIDER_NOT_CONFIGURED',
          'WhatsApp verification is temporarily unavailable',
          503
        )
      }

      const fazpassResult = await verifyOTPViaFazpass(
        String(latestOtpRecord.request_id),
        otpTrimmed,
        merchantKey,
      )

      if (!fazpassResult.valid) {
        if (fazpassResult.reason === 'provider_error') {
          throw new OtpVerificationError(
            'OTP_PROVIDER_VERIFY_FAILED',
            'Unable to verify the WhatsApp code right now',
            502
          )
        }
        throw new OtpVerificationError('INVALID_OR_EXPIRED_OTP', 'Invalid or expired OTP')
      }
    } else if (verificationMode === 'reject') {
      throw new OtpVerificationError(
        'OTP_PROVIDER_SESSION_MISSING',
        'Verification session is unavailable. Please request a new code.'
      )
    } else {
      // Development-only plaintext comparison for locally generated OTPs.

      const records = liveOtpRecords ?? []

      const digitsOnly = (v: string) => String(v || '').replace(/\D/g, '')
      const normalizeOtp = (v: string) => {
        const s = String(v || '').trim()
        const digits = s.replace(/\D/g, '')
        return digits || s || '0'
      }
      const userDigits = digitsOnly(otpTrimmed)
      const record = records?.find((r) => {
        if (r.request_id) return false
        const storedRaw = String(r.otp ?? '')
        const storedDigits = digitsOnly(storedRaw)
        const storedNorm = normalizeOtp(storedRaw)
        const userNorm = normalizeOtp(otpTrimmed)
        return (
          userDigits === storedDigits ||
          userNorm === storedNorm ||
          otpTrimmed === storedRaw.trim()
        )
      })

      if (!record) {
        const hasRecords = (records?.length ?? 0) > 0
        const storedLen = records?.[0] ? String(records[0].otp ?? '').length : 0
        console.error('OTP mismatch:', {
          phoneLast4: formattedPhone.slice(-4),
          otpLen: otpTrimmed.length,
          storedLen,
          recordsCount: records?.length ?? 0,
        })
        throw new OtpVerificationError(
          'INVALID_OR_EXPIRED_OTP',
          hasRecords
            ? 'Invalid or expired OTP'
            : 'Invalid or expired OTP. Please request a new code.'
        )
      }
      otpRecord = record
    }

    const { data: existingCustomer, error: existingCustomerError } = await supabase
      .from('customers')
      .select('*')
      .eq('whatsapp', formattedPhone)
      .maybeSingle()

    if (existingCustomerError) {
      console.error('Customer lookup failed:', existingCustomerError)
      throw new OtpVerificationError(
        'CUSTOMER_LOOKUP_FAILED',
        'Unable to complete verification right now',
        500
      )
    }

    let customer
    let createdCustomer = false
    const warnings: string[] = []

    const refreshExistingCustomer = async (existing: any) => {
      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({
          auth_token: existing.auth_token || crypto.randomUUID(),
          last_login_at: new Date().toISOString(),
          token_created_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateError || !updatedCustomer) {
        console.error('Customer login refresh failed:', updateError)
        throw new OtpVerificationError(
          'CUSTOMER_SESSION_FAILED',
          'Unable to complete verification right now',
          500
        )
      }
      return updatedCustomer
    }

    if (isRegistration) {
      if (existingCustomer) {
        // A verified registration retry is an idempotent login. This recovers
        // attempts where customer creation succeeded before a later write.
        customer = await refreshExistingCustomer(existingCustomer)
      }

      if (!customer) {
        const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          name: name,
          address: address,
          whatsapp: formattedPhone,
          phone: formattedPhone,
          customer_type: 'pre_pay',
          voucher_balance: 0,
          discount: 0,
          branch: 'Pending',
          auth_token: crypto.randomUUID(),
          token_created_at: new Date().toISOString(),
          last_login_at: new Date().toISOString(),
        })
        .select()
        .single()

        if (customerError || !newCustomer) {
          if (customerError?.code === '23505') {
            const { data: racedCustomer, error: raceLookupError } = await supabase
              .from('customers')
              .select('*')
              .eq('whatsapp', formattedPhone)
              .maybeSingle()
            if (!raceLookupError && racedCustomer) {
              customer = await refreshExistingCustomer(racedCustomer)
            } else {
              console.error('Concurrent customer recovery failed:', raceLookupError)
            }
          }

          if (!customer) {
            console.error('Customer registration insert failed:', customerError)
            throw new OtpVerificationError(
              'CUSTOMER_REGISTRATION_FAILED',
              'Unable to create the customer account right now',
              500
            )
          }
        } else {
          customer = newCustomer
          createdCustomer = true
        }
      }

      // Grant welcome vouchers from app_settings
      const { data: settings, error: settingsError } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['welcome_voucher_qty', 'welcome_voucher_product_id'])

      if (createdCustomer && settingsError) {
        console.error('Welcome voucher settings lookup failed:', settingsError)
        warnings.push('WELCOME_VOUCHER_CONFIGURATION_UNAVAILABLE')
      } else if (createdCustomer) {
        const settingsMap: Record<string, string> = {}
        for (const row of settings || []) settingsMap[row.key] = row.value

        const welcomeQty = parseInt(settingsMap['welcome_voucher_qty'] || '0', 10)
        const welcomeProductId = settingsMap['welcome_voucher_product_id']

        if (welcomeQty > 0 && welcomeProductId) {
          const { error: welcomeVoucherError } = await supabase
            .from('customer_product_vouchers')
            .upsert({
              customer_id: customer.id,
              product_id: welcomeProductId,
              balance: welcomeQty,
              gift_balance: welcomeQty,
            })
          if (welcomeVoucherError) {
            console.error('Welcome voucher grant failed:', welcomeVoucherError)
            warnings.push('WELCOME_VOUCHER_GRANT_FAILED')
          }
        }
      }

    } else {
      if (!existingCustomer) {
        throw new OtpVerificationError(
          'CUSTOMER_NOT_FOUND',
          'Customer not found. Please register first.'
        )
      }
      customer = await refreshExistingCustomer(existingCustomer)
    }

    // Create device binding after successful verification
    if (device_id && device_id.length >= 8) {
      const { error: bindingError } = await supabase.from('device_whatsapp_bindings').upsert(
        {
          device_id,
          whatsapp: formattedPhone,
          customer_id: customer.id,
        },
        { onConflict: 'device_id,whatsapp' }
      )
      if (bindingError) {
        console.error('Device binding failed:', bindingError)
        throw new OtpVerificationError(
          'DEVICE_BINDING_FAILED',
          'Verification succeeded, but this device could not be remembered',
          500
        )
      }
    }

    // Consume the OTP only after customer/session and trusted-device writes
    // succeed, so transient downstream failures remain retryable.
    const { error: otpMarkError } = await supabase
      .from('auth_otps')
      .update({ verified: true })
      .eq('id', otpRecord.id)
    if (otpMarkError) {
      console.error('OTP consume failed:', otpMarkError)
      throw new OtpVerificationError(
        'OTP_CONSUME_FAILED',
        'Unable to finalize verification right now',
        500
      )
    }

    if (createdCustomer) {
      if (DEV_MODE) {
        console.log('🔧 DEV MODE: Skipping welcome WhatsApp message')
        console.log(`Magic link: ${Deno.env.get('APP_URL')}/home?token=${customer.auth_token}`)
      } else {
        await sendWelcomeMessage(customer, supabase)
      }
    }

    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`

    return new Response(
      JSON.stringify({
        success: true,
        message: isRegistration ? 'Registration successful' : 'Login successful',
        customer: {
          id: customer.id,
          name: customer.name,
          address: customer.address,
          whatsapp: customer.whatsapp,
          customer_type: customer.customer_type,
          payment_term: customer.payment_term,
          credit_limit: customer.credit_limit,
          voucher_balance: customer.voucher_balance,
          branch: customer.branch,
          discount: customer.discount,
          service_branch: customer.service_branch ?? null,
        },
        magic_link: magicLink,
        auth_token: customer.auth_token,
        dev_mode: DEV_MODE,
        already_registered: Boolean(isRegistration && !createdCustomer),
        warnings,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error: any) {
    const publicError = error instanceof OtpVerificationError
      ? error
      : new OtpVerificationError(
        'OTP_VERIFICATION_FAILED',
        'Unable to complete verification right now',
        500
      )
    console.error('auth-verify-otp error:', {
      code: publicError.code,
      internalMessage: error?.message,
    })
    return new Response(
      JSON.stringify({
        success: false,
        code: publicError.code,
        error: publicError.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: publicError.status,
      }
    )
  }
})

async function sendWelcomeMessage(customer: any, supabase: any) {
  try {
    const appUrl = Deno.env.get('APP_URL') || 'https://order.waterapp.com'
    const magicLink = `${appUrl}/home?token=${customer.auth_token}`
    const templateName = Deno.env.get('WA_TEMPLATE_WELCOME') || ''
    const languageCode = Deno.env.get('WA_TEMPLATE_LANGUAGE') || 'id'

    const message = `👋 Selamat datang ${customer.name}!

Akun Anda telah aktif di layanan pengiriman air kami.
✅ Status: Aktif
🎫 Saldo voucher: ${customer.voucher_balance}

🔗 LINK PESANAN ANDA:
${magicLink}

⭐ PENTING:
- SIMPAN pesan ini dengan baik
- Klik link di atas kapan saja untuk pesan air
- TIDAK PERLU LOGIN lagi - cukup klik link!
- Link ini berlaku selamanya

Butuh bantuan? Hubungi support kami.
Terima kasih! 💧`

    const result = await sendTemplateMessage({
      to: customer.whatsapp,
      templateName,
      languageCode,
      components: buildBodyParams([
        customer.name,
        customer.voucher_balance,
        magicLink,
      ]),
    })

    await supabase.from('whatsapp_messages').insert({
      customer_id: customer.id,
      phone: customer.whatsapp,
      message_type: 'welcome',
      message_content: message,
      status: result.ok ? 'sent' : 'failed',
      provider_response: result.data ?? {},
    })

    console.log('Welcome message sent:', result.data)
  } catch (error: any) {
    console.error('Failed to send welcome message:', error)
  }
}
