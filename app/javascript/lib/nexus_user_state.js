// User-scoped, server-synced JSON state with a localStorage cache.
//
// Reads are always synchronous against the cache (so existing controllers don't
// need to become async). Writes are persisted to the cache immediately and
// PATCH'd to the server with a small debounce. On boot we fetch every value the
// server has and merge it into the cache; any keys that differ trigger a
// `nexus:user-state-loaded` window event so controllers can re-render.
//
// Falls back transparently to localStorage-only behaviour when no user is
// logged in (the meta[name="nexus-user-id"] tag is missing).

const CACHE_PREFIX = "nexus.userState."
const CACHE_OWNER_KEY = "nexus.userState.__owner"
const SYNC_DEBOUNCE_MS = 350

const pending = new Map() // key -> { value, timer, inFlight }
let bootstrapped = false
let bootstrapPromise = null

function readMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`)
  return el ? el.getAttribute("content") : null
}

function csrfToken() {
  return readMeta("csrf-token") || ""
}

function currentUserId() {
  const raw = readMeta("nexus-user-id")
  if (!raw) return null
  const trimmed = String(raw).trim()
  return trimmed.length > 0 ? trimmed : null
}

function cacheKey(key) {
  return `${CACHE_PREFIX}${key}`
}

function readCache(key) {
  try {
    const raw = window.localStorage.getItem(cacheKey(key))
    if (raw == null) return undefined
    return JSON.parse(raw)
  } catch (_e) {
    return undefined
  }
}

function writeCache(key, value) {
  try {
    if (value === undefined) {
      window.localStorage.removeItem(cacheKey(key))
    } else {
      window.localStorage.setItem(cacheKey(key), JSON.stringify(value))
    }
  } catch (_e) {
    // Storage may be full or unavailable; non-blocking.
  }
}

function purgeCacheForOtherOwner(currentOwner) {
  const previous = window.localStorage.getItem(CACHE_OWNER_KEY)
  if (previous === currentOwner) return
  // Wipe any cache entries that belonged to a different account on this device.
  const remove = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k && k.startsWith(CACHE_PREFIX) && k !== CACHE_OWNER_KEY) remove.push(k)
  }
  remove.forEach((k) => window.localStorage.removeItem(k))
  if (currentOwner) {
    window.localStorage.setItem(CACHE_OWNER_KEY, currentOwner)
  } else {
    window.localStorage.removeItem(CACHE_OWNER_KEY)
  }
}

function shallowEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch (_e) {
    return false
  }
}

async function fetchAllStates() {
  const headers = { Accept: "application/json" }
  const response = await fetch("/user_app_states", { headers, credentials: "same-origin" })
  if (!response.ok) throw new Error(`user_app_states load failed: ${response.status}`)
  const json = await response.json()
  return (json && json.states) || {}
}

async function pushOne(key, value) {
  const token = csrfToken()
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest"
  }
  if (token) headers["X-CSRF-Token"] = token

  if (value === undefined) {
    await fetch(`/user_app_states/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers,
      credentials: "same-origin"
    })
    return
  }

  await fetch(`/user_app_states/${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({ value })
  })
}

function schedulePush(key) {
  const entry = pending.get(key)
  if (!entry) return
  if (entry.timer) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => flushKey(key), SYNC_DEBOUNCE_MS)
}

async function flushKey(key) {
  const entry = pending.get(key)
  if (!entry) return
  if (entry.inFlight) return
  entry.timer = null
  entry.inFlight = true
  const value = entry.value
  try {
    await pushOne(key, value)
  } catch (_e) {
    // Swallow; cache still holds the value and the next mutation/boot retries.
  } finally {
    entry.inFlight = false
    if (entry.value !== value) {
      schedulePush(key)
    } else {
      pending.delete(key)
    }
  }
}

export const NexusUserState = {
  isEnabled() {
    return Boolean(currentUserId())
  },

  // Synchronous cache read. `defaultValue` is returned when nothing is cached.
  get(key, defaultValue = undefined) {
    const cached = readCache(key)
    return cached === undefined ? defaultValue : cached
  },

  // Set a value. Updates cache immediately, debounces a server write.
  set(key, value) {
    writeCache(key, value)
    if (!this.isEnabled()) return
    pending.set(key, { ...(pending.get(key) || {}), value, inFlight: pending.get(key)?.inFlight ?? false })
    schedulePush(key)
  },

  // Remove a key. Same semantics as set(key, undefined).
  remove(key) {
    this.set(key, undefined)
  },

  // Whether a value is present in cache (including bootstrap result).
  has(key) {
    return readCache(key) !== undefined
  },

  // Force-flush any pending writes (e.g. before logout). Returns a promise.
  async flush() {
    const keys = Array.from(pending.keys())
    await Promise.all(keys.map((k) => flushKey(k)))
  },

  // Initial bootstrap. Safe to call multiple times; only fetches once.
  bootstrap() {
    if (bootstrapPromise) return bootstrapPromise
    const owner = currentUserId()
    purgeCacheForOtherOwner(owner)
    if (!owner) {
      bootstrapped = true
      bootstrapPromise = Promise.resolve(new Set())
      return bootstrapPromise
    }

    bootstrapPromise = (async () => {
      const changedKeys = new Set()
      try {
        const states = await fetchAllStates()
        Object.entries(states).forEach(([key, value]) => {
          const before = readCache(key)
          if (!shallowEqual(before, value)) {
            writeCache(key, value)
            changedKeys.add(key)
          }
        })
      } catch (_e) {
        // Network failure is OK: we keep using the cache and try again later.
      } finally {
        bootstrapped = true
        window.dispatchEvent(new CustomEvent("nexus:user-state-loaded", {
          detail: { changedKeys: Array.from(changedKeys) }
        }))
      }
      return changedKeys
    })()
    return bootstrapPromise
  },

  isBootstrapped() {
    return bootstrapped
  }
}

if (typeof window !== "undefined") {
  window.NexusUserState = NexusUserState
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => NexusUserState.bootstrap(), { once: true })
  } else {
    NexusUserState.bootstrap()
  }
  window.addEventListener("beforeunload", () => {
    // Best-effort flush; will fall through fast if nothing is pending.
    NexusUserState.flush()
  })
}

export default NexusUserState
