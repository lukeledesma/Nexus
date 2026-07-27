import { NexusUserState } from "lib/nexus_user_state"

export function readRegistry(key, legacyKey) {
  const synced = NexusUserState.get(key)
  if (Array.isArray(synced)) return synced
  if (NexusUserState.has(key)) return []
  try {
    const raw = window.localStorage.getItem(legacyKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      NexusUserState.set(key, parsed)
      return parsed
    }
  } catch (_e) {
    /* ignore */
  }
  return []
}

export function writeRegistry(key, entries) {
  NexusUserState.set(key, entries)
}

export function getTitleSnapGhostEl() {
  if (!window.__nexusTitleSnapGhostEl?.isConnected) {
    const ghost = document.createElement("div")
    ghost.className = "content-window-title-snap-ghost"
    ghost.setAttribute("aria-hidden", "true")
    const container =
      document.getElementById("desktop-shell-canvas") ||
      document.getElementById("desktop-shell") ||
      document.body
    container.appendChild(ghost)
    window.__nexusTitleSnapGhostEl = ghost
  }
  return window.__nexusTitleSnapGhostEl
}

export function hideTitleSnapGhostEl() {
  const ghost = window.__nexusTitleSnapGhostEl
  if (ghost) ghost.style.display = "none"
}

export function readSessionThenLocalStorage(key) {
  const storageKey = String(key || "")
  if (!storageKey) return null
  try {
    const value = window.sessionStorage.getItem(storageKey)
    if (value) return value
  } catch (_error) {
    // non-blocking
  }
  try {
    const value = window.localStorage.getItem(storageKey)
    return value || null
  } catch (_error) {
    // non-blocking
  }
  return null
}

export function writeSessionAndLocalStorage(key, value) {
  const storageKey = String(key || "")
  if (!storageKey) return
  const nextValue = String(value || "")
  try {
    window.sessionStorage.setItem(storageKey, nextValue)
  } catch (_error) {
    // non-blocking
  }
  try {
    window.localStorage.setItem(storageKey, nextValue)
  } catch (_error) {
    // non-blocking
  }
}

export function removeSessionAndLocalStorage(key) {
  const storageKey = String(key || "")
  if (!storageKey) return
  try {
    window.sessionStorage.removeItem(storageKey)
  } catch (_error) {
    // non-blocking
  }
  try {
    window.localStorage.removeItem(storageKey)
  } catch (_error) {
    // non-blocking
  }
}
