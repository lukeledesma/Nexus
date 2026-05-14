// Real-time sync via Action Cable.
//
// Subscribes to UserSyncChannel when a user is logged in and applies incoming
// changes in-place so no page refresh is needed on other devices.
//
// Three message types from the server:
//
//   state_changed     — a NexusUserState key changed on another device
//   document_changed  — document content saved (notes, tasks, calendar events, assets)
//   workspace_changed — finder structure or wallpaper changed
//
// Each is translated into a DOM CustomEvent so downstream controllers
// don't need to know about Action Cable directly.

import { createConsumer } from "@rails/actioncable"

function readMeta(name) {
  const el = document.querySelector(`meta[name="${name}"]`)
  return el ? el.getAttribute("content") : null
}

function currentUserId() {
  const raw = readMeta("nexus-user-id")
  if (!raw) return null
  const trimmed = String(raw).trim()
  return trimmed.length > 0 ? trimmed : null
}

let subscription = null
let consumer = null

function handleMessage(data) {
  if (data.type === "state_changed") {
    handleStateChanged(data)
  } else if (data.type === "document_changed") {
    handleDocumentChanged(data)
  } else if (data.type === "workspace_changed") {
    handleWorkspaceChanged(data)
  }
}

// Apply a remote NexusUserState key change. Writes to cache and fires the same
// event that bootstrap does, so all existing app controllers pick it up without
// any per-app changes.
function handleStateChanged({ key, value }) {
  if (!key) return
  try {
    const existing = window.NexusUserState?.get(key)
    const existingStr = JSON.stringify(existing)
    const newStr = JSON.stringify(value)
    if (existingStr === newStr) return // already up to date (our own write echoed back)
  } catch (_e) { /* non-blocking */ }

  // Write directly to localStorage cache to match bootstrap behaviour.
  try {
    const cacheKey = `nexus.userState.${key}`
    if (value === undefined || value === null) {
      window.localStorage.removeItem(cacheKey)
    } else {
      window.localStorage.setItem(cacheKey, JSON.stringify(value))
    }
  } catch (_e) { /* storage unavailable */ }

  window.dispatchEvent(new CustomEvent("nexus:user-state-loaded", {
    detail: { changedKeys: [key] }
  }))
}

// Dispatch a single nexus:document-remote-changed event. Downstream controllers
// filter by document_id and/or content_type to decide whether to act.
function handleDocumentChanged({ document_id, content_type, content, tasks, updated_at }) {
  window.dispatchEvent(new CustomEvent("nexus:document-remote-changed", {
    detail: { document_id, content_type, content, tasks, updated_at }
  }))
}

// Translate workspace_changed into the specific DOM event each downstream
// controller already listens for, so those controllers need no changes.
function handleWorkspaceChanged({ kind, section_key, wallpaper_background_kind, wallpaper_image_document_id }) {
  if (kind === "finder") {
    window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
      detail: { sectionKey: section_key || null }
    }))
  } else if (kind === "wallpaper") {
    window.dispatchEvent(new CustomEvent("nexus:wallpaper-changed", {
      detail: { wallpaper_background_kind, wallpaper_image_document_id }
    }))
  }
}

function connect() {
  if (!currentUserId()) return // not logged in
  if (subscription) return // already connected

  consumer = createConsumer()
  subscription = consumer.subscriptions.create({ channel: "UserSyncChannel" }, {
    received(data) {
      handleMessage(data)
    },
    rejected() {
      // If the server rejects the subscription (e.g. channel not loaded yet),
      // disconnect to avoid noisy reconnect loops in development logs.
      disconnect()
    },
    disconnected() {
      subscription = null
    }
  })
}

function disconnect() {
  if (subscription) {
    subscription.unsubscribe()
    subscription = null
  }
  if (consumer) {
    consumer.disconnect()
    consumer = null
  }
}

// Auto-connect on DOMContentLoaded.
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", connect, { once: true })
  } else {
    connect()
  }
}

export { connect, disconnect }
