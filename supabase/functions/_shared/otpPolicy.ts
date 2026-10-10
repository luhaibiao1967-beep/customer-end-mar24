export const PROVIDER_OTP_SENTINEL = '__FAZPASS_PROVIDER__'

export type OtpVerificationMode = 'provider' | 'development_plaintext' | 'reject'

/**
 * Provider-backed OTPs are always verified by Fazpass. Plaintext comparison is
 * permitted only for development OTP records that have no provider request id.
 */
export function getOtpVerificationMode(
  developmentMode: boolean,
  providerRequestId: unknown,
): OtpVerificationMode {
  if (String(providerRequestId ?? '').trim()) return 'provider'
  return developmentMode ? 'development_plaintext' : 'reject'
}
