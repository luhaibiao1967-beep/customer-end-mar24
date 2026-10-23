/**
 * Device ID for binding: localStorage first, ThumbmarkJS fingerprint fallback.
 * ThumbmarkJS runs in background; excludes slow components (permissions, plugins).
 * Typical: localStorage = instant; ThumbmarkJS = ~200-500ms.
 */
const STORAGE_KEY = 'wd_device_id'

let deviceIdPromise: Promise<string> | null = null

export function normalizeDeviceId(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (
    normalized.length < 8 ||
    normalized.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null
  return normalized
}

function randomFallback(): string {
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`
}

/** Sync check - returns stored ID if available, else null */
export function getStoredDeviceId(): string | null {
  try {
    return normalizeDeviceId(localStorage.getItem(STORAGE_KEY))
  } catch {}
  return null
}

/**
 * Clears only this app's device binding. The caller must require an explicit
 * retry afterwards; resetting a device ID must never trigger an OTP request.
 */
export function resetDeviceId(): void {
  deviceIdPromise = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

/**
 * Returns device ID: localStorage (instant) > ThumbmarkJS (~200-500ms) > random.
 * Caches the promise so concurrent calls share the same result.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const stored = getStoredDeviceId()
  if (stored) return stored

  if (deviceIdPromise) return deviceIdPromise

  deviceIdPromise = (async () => {
    try {
      const { Thumbmark } = await import('@thumbmarkjs/thumbmarkjs')
      const tm = new Thumbmark({
        exclude: ['permissions', 'plugins'],
        timeout: 2500,
        logging: false,
      })
      const res = await tm.get()
      const id = normalizeDeviceId(res?.thumbmark)
      if (id) {
        try {
          localStorage.setItem(STORAGE_KEY, id)
        } catch {}
        return id
      }
    } catch {}
    const fallbackId = randomFallback()
    try {
      localStorage.setItem(STORAGE_KEY, fallbackId)
    } catch {}
    return fallbackId
  })()

  return deviceIdPromise
}
