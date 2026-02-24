/**
 * Fazpass OTP provider - modular for easy swap to WA_CLOUD_API
 */
export async function sendOTPViaFazpass(
  phone: string,
  gatewayKey: string,
  merchantKey: string
): Promise<{ success: boolean; data?: any; status?: number; error?: string }> {
  try {
    const fazpassUrl = 'https://api.fazpass.com/v1/otp/request'
    const authHeader = merchantKey.startsWith('Bearer ') ? merchantKey : `Bearer ${merchantKey}`
    const response = await fetch(fazpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        phone: phone.replace(/^\+/, ''),
        gateway_key: gatewayKey,
      }),
    })
    const data = await response.json()
    return {
      success: data.status === true,
      data: data,
      status: response.status,
    }
  } catch (error: any) {
    console.error('Fazpass error:', error)
    return {
      success: false,
      error: error?.message,
    }
  }
}
