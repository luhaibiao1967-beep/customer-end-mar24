const STORAGE_KEY = 'wd_device_id'

export function getOrCreateDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id || id.length < 8) {
      id = crypto.randomUUID?.() ?? `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    return `d-${Date.now()}-${Math.random().toString(36).slice(2, 15)}`
  }
}
