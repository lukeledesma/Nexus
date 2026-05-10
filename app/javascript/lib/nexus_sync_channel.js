// Real-time sync via Action Cable.
//
// Subscribes to UserSyncChannel when a user is logged in and applies incoming
// changes in-place so no page refresh is needed on other devices.
//
// Message types handled:
//   state_changed  — a NexusUserState key was updated on another device
//   calendar_changed — Calendar.txt was updated on another device

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
  } else if (data.type === "calendar_changed") {
    handleCalendarChanged(data)
  } else if (data.type === "task_list_changed") {
    handleTaskListChanged(data)
  } else if (data.type === "document_changed") {
    handleDocumentChanged(data)
  } else if (data.type === "finder_changed") {
    handleFinderChanged(data)
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

// Signal the calendar controller that a remote change happened.
// The controller already knows how to re-fetch and re-render.
function handleCalendarChanged({ updated_at }) {
  window.dispatchEvent(new CustomEvent("nexus:calendar-remote-changed", {
    detail: { updated_at }
  }))
}

function handleTaskListChanged({ document_id, tasks, updated_at }) {
  window.dispatchEvent(new CustomEvent("nexus:task-list-remote-changed", {
    detail: { document_id, tasks, updated_at }
  }))
}

function handleDocumentChanged({ document_id, content_type, content, tasks, updated_at }) {
  window.dispatchEvent(new CustomEvent("nexus:document-remote-changed", {
    detail: { document_id, content_type, content, tasks, updated_at }
  }))
}

function handleFinderChanged({ section_key }) {
  window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
    detail: { sectionKey: section_key || null }
  }))
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
