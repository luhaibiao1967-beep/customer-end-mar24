export type FazpassRequestResult = {
  success: boolean
  requestId?: string
  status?: number
  providerMessage?: string
  error?: string
}

export type FazpassVerificationResult = {
  valid: boolean
  reason?: 'invalid' | 'provider_error'
  status?: number
  providerMessage?: string
}

function authorizationHeader(merchantKey: string): string {
  return merchantKey.startsWith('Bearer ') ? merchantKey : `Bearer ${merchantKey}`
}

function extractRequestId(payload: any): string | undefined {
  const providerData = payload?.data ?? payload
  const candidate =
    providerData?.otp_id ??
    providerData?.request_id ??
    providerData?.id ??
    providerData?.ref_id ??
    providerData?.ref ??
    payload?.otp_id ??
    payload?.request_id ??
    payload?.id ??
    payload?.ref_id ??
    payload?.ref

  const requestId = String(candidate ?? '').trim()
  return requestId || undefined
}

async function readJsonResponse(response: Response): Promise<any | null> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function sendOTPViaFazpass(
  phone: string,
  gatewayKey: string,
  merchantKey: string
): Promise<FazpassRequestResult> {
  try {
    const fazpassUrl = 'https://api.fazpass.com/v1/otp/request'
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorizationHeader(merchantKey),
      },
      body: JSON.stringify({
        phone: phone.replace(/^\+/, ''),
        gateway_key: gatewayKey,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await readJsonResponse(response)
    const requestId = extractRequestId(data)
    const providerAccepted = response.ok && data?.status === true

    return {
      success: providerAccepted && Boolean(requestId),
      requestId,
      status: response.status,
      providerMessage: typeof data?.message === 'string' ? data.message : undefined,
      error: providerAccepted && !requestId ? 'missing_request_id' : undefined,
    }
  } catch (error: any) {
    console.error('Fazpass error:', error)
    return {
      success: false,
      error: error?.message,
    }
  }
}

export async function verifyOTPViaFazpass(
  otpId: string,
  otp: string,
  merchantKey: string,
): Promise<FazpassVerificationResult> {
  try {
    const response = await fetch('https://api.fazpass.com/v1/otp/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorizationHeader(merchantKey),
      },
      body: JSON.stringify({ otp_id: otpId, otp }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await readJsonResponse(response)
    const valid = response.ok && (
      data?.status === true ||
      data?.data?.status === true ||
      data?.data?.verified === true
    )

    return {
      valid,
      reason: valid ? undefined : (response.ok ? 'invalid' : 'provider_error'),
      status: response.status,
      providerMessage: typeof data?.message === 'string' ? data.message : undefined,
    }
  } catch (error: any) {
    console.error('Fazpass verification error:', error?.message)
    return { valid: false, reason: 'provider_error' }
  }
}
