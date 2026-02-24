/**
 * Device ID for binding: localStorage first, ThumbmarkJS fingerprint fallback.
 * ThumbmarkJS runs in background; excludes slow components (permissions, plugins).
 * Typical: localStorage = instant; ThumbmarkJS = ~200-500ms.
 */
const STORAGE_KEY = 'wd_device_id'

function randomFallback(): string {
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`
}

/** Sync check - returns stored ID if available, else null */
export function getStoredDeviceId(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    if (id && id.length >= 8) return id
  } catch {}
  return null
}

let deviceIdPromise: Promise<string> | null = null

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
      const id = res?.thumbmark
      if (id && typeof id === 'string' && id.length >= 8) {
        try {
          localStorage.setItem(STORAGE_KEY, id)
        } catch {}
        return id
      }
    } catch {}
    return randomFallback()
  })()

  return deviceIdPromise
}
