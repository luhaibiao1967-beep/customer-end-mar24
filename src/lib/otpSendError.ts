export type OtpSendFailureKind =
  | 'rate_limited'
  | 'service_unavailable'
  | 'invalid_device'
  | 'network'
  | 'generic'

export interface OtpSendFailure {
  kind: OtpSendFailureKind
  code: string | null
  message: string | null
  retryAfter: number
}

const SERVICE_UNAVAILABLE_CODES = new Set([
  'OTP_PROVIDER_NOT_CONFIGURED',
  'OTP_PROVIDER_RESPONSE_INVALID',
  'OTP_PROVIDER_REQUEST_FAILED',
  'OTP_RATE_LIMIT_UNAVAILABLE',
  'OTP_STORAGE_FAILED',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRetryAfter(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  // Keep a malformed server response from locking the UI indefinitely.
  return Math.min(3600, Math.max(1, Math.ceil(parsed)))
}

/**
 * Converts the public auth-send-otp response into a small, safe UI error model.
 * Provider messages are retained only for diagnostics and are never rendered.
 */
export async function parseOtpSendFailure(
  error: unknown,
  data: unknown,
): Promise<OtpSendFailure> {
  let body = asRecord(data)
  const errorRecord = asRecord(error)
  const errorName = readString(errorRecord.name)

  // Supabase leaves non-2xx JSON on FunctionsHttpError.context (a Response).
  if (errorName === 'FunctionsHttpError') {
    const context = asRecord(errorRecord.context)
    if (typeof context.json === 'function') {
      try {
        const readJson = context.json as (this: unknown) => Promise<unknown>
        body = {
          ...body,
          ...asRecord(await readJson.call(errorRecord.context)),
        }
      } catch {
        // A missing or non-JSON response is handled by the generic fallback.
      }
    }
  }

  const code = readString(body.code)?.toUpperCase() ?? null
  const message = readString(body.error) ?? readString(errorRecord.message)
  const retryAfter = readRetryAfter(body.retry_after)

  if (code === 'OTP_RATE_LIMITED') {
    return {
      kind: 'rate_limited',
      code,
      message,
      retryAfter: retryAfter || 60,
    }
  }
  if (code === 'INVALID_DEVICE_ID') {
    return { kind: 'invalid_device', code, message, retryAfter: 0 }
  }
  if (code && SERVICE_UNAVAILABLE_CODES.has(code)) {
    return { kind: 'service_unavailable', code, message, retryAfter: 0 }
  }
  if (errorName === 'FunctionsFetchError') {
    return { kind: 'network', code, message, retryAfter: 0 }
  }
  if (errorName === 'FunctionsRelayError') {
    return { kind: 'service_unavailable', code, message, retryAfter: 0 }
  }
  return { kind: 'generic', code, message, retryAfter: 0 }
}

export function otpSendFailureTranslationKey(
  failure: OtpSendFailure,
  genericFallback: 'register.processFailed' | 'register.resendFailed',
): string {
  switch (failure.kind) {
    case 'rate_limited':
      return 'register.otpRateLimited'
    case 'service_unavailable':
      return 'register.otpServiceUnavailable'
    case 'invalid_device':
      return 'register.invalidDevice'
    case 'network':
      return 'register.networkFailed'
    default:
      return genericFallback
  }
}
