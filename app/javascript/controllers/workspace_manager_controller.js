import { Controller } from "@hotwired/stimulus"

// All localStorage keys owned by the window system — cleared on RESET.
const ALL_BOUNDS_KEYS = [
  "nexus.window.dbHealth.bounds",
  "nexus.window.settings.bounds",
  "nexus.window.launcher.bounds",
  "nexus.window.stationary.bounds",
  "nexus.window.tools.bounds",
  "nexus.contentWindow.conversionChart.bounds",
  "nexus.contentWindow.timer.bounds",
  "nexus.contentWindow.singularNote.bounds",
  "nexus.contentWindow.singularTaskList.bounds",
  "nexus.contentWindow.singularWhiteboard.bounds",
  "nexus.contentWindow.themeBuilder.bounds"
]

const WINDOW_BOUNDS_KEY_MAP = {
  "db-health": "nexus.window.dbHealth.bounds",
  "settings": "nexus.window.settings.bounds",
  "launcher": "nexus.window.launcher.bounds",
  "conversion-chart": "nexus.contentWindow.conversionChart.bounds",
  "timer": "nexus.contentWindow.timer.bounds",
  "singular-note": "nexus.contentWindow.singularNote.bounds",
  "singular-task-list": "nexus.contentWindow.singularTaskList.bounds",
  "singular-whiteboard": "nexus.contentWindow.singularWhiteboard.bounds",
  "theme-builder": "nexus.contentWindow.themeBuilder.bounds"
}

const OS_WINDOW_IDS = new Set(["db-health", "settings", "launcher"])

// Maps custom event name → stable window ID.
// For "app-window:state" the ID comes from event.detail.appKey instead.
const STATE_EVENT_MAP = {
  "db-health:state" : "db-health",
  "settings:state"  : "settings",
  "launcher:state"  : "launcher"
}

export default class extends Controller {
  static values = { url: String }

  connect() {
    this.windowState = {}
    this.saveTimer   = null

    this.boundHandleState  = this.handleStateEvent.bind(this)
    this.boundHandleReset  = this.reset.bind(this)

    Object.keys(STATE_EVENT_MAP).forEach(name => {
      window.addEventListener(name, this.boundHandleState)
    })
    window.addEventListener("app-window:state",  this.boundHandleState)
    window.addEventListener("nexus:layout-reset", this.boundHandleReset)

    // Restore layout after a short tick so all other Stimulus controllers
    // have had a chance to connect and bind their toggle listeners.
    setTimeout(() => this.restoreLayout(), 180)
  }

  disconnect() {
    Object.keys(STATE_EVENT_MAP).forEach(name => {
      window.removeEventListener(name, this.boundHandleState)
    })
    window.removeEventListener("app-window:state",  this.boundHandleState)
    window.removeEventListener("nexus:layout-reset", this.boundHandleReset)

    if (this.saveTimer) clearTimeout(this.saveTimer)
  }

  // ── State tracking ─────────────────────────────────────────────────────────

  handleStateEvent(event) {
    const mappedId = STATE_EVENT_MAP[event.type]
    // "app-window:state" carries appKey in detail; named events use the map.
    const windowId = mappedId !== undefined ? mappedId : event.detail?.appKey
    if (!windowId) return

    const prev = this.windowState[windowId] || {}
    const isOsWindow = OS_WINDOW_IDS.has(windowId)
    const bounds = this.readBoundsForWindow(windowId)
    const detailX = Number(event.detail?.x)
    const detailY = Number(event.detail?.y)
    const detailWidth = Number(event.detail?.width)
    const detailHeight = Number(event.detail?.height)
    const detailZ = Number(event.detail?.z ?? event.detail?.layer)
    const coords = {
      x: Number.isFinite(detailX) ? Math.round(detailX) : bounds.x,
      y: Number.isFinite(detailY) ? Math.round(detailY) : bounds.y,
      width: Number.isFinite(detailWidth) ? Math.round(detailWidth) : bounds.width,
      height: Number.isFinite(detailHeight) ? Math.round(detailHeight) : bounds.height,
      z: Number.isFinite(detailZ) ? Math.round(detailZ) : bounds.z
    }

    this.windowState[windowId] = {
      ...prev,
      x: Number.isFinite(coords.x) ? coords.x : (prev.x || 0),
      y: Number.isFinite(coords.y) ? coords.y : (prev.y || 0),
      ...(isOsWindow ? {} : {
        width: Number.isFinite(coords.width) ? coords.width : (prev.width || 407),
        height: Number.isFinite(coords.height) ? coords.height : (prev.height || 407)
      }),
      z: Number.isFinite(coords.z) ? coords.z : (prev.z || 1500),
      open: Boolean(event.detail?.open)
    }
    this.scheduleSave()
  }

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveToServer(), 800)
  }

  // ── Server sync ────────────────────────────────────────────────────────────

  async restoreLayout() {
    if (!this.hasUrlValue) return

    try {
      const response = await fetch(this.urlValue, {
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return

      const data    = await response.json()
      const windows = data?.windows || {}
      const entries = Object.entries(windows)
      let maxZ = Number(window.__nexusDesktopZIndex || 1500)

      entries.forEach(([windowId, state]) => {
        this.applyPositionFromServer(windowId, state)
        const z = Number(state?.z ?? state?.layer)
        if (Number.isFinite(z)) maxZ = Math.max(maxZ, Math.round(z))
      })

      window.__nexusDesktopZIndex = maxZ

      const openEntries = entries
        .filter(([, state]) => Boolean(state?.open))
        .sort(([, a], [, b]) => {
          const la = Number(a?.z ?? a?.layer)
          const lb = Number(b?.z ?? b?.layer)
          return (Number.isFinite(la) ? la : 1500) - (Number.isFinite(lb) ? lb : 1500)
        })

      window.__nexusRestoringLayout = true
      try {
        openEntries.forEach(([windowId]) => this.openWindow(windowId))
      } finally {
        window.__nexusRestoringLayout = false
      }
    } catch (_err) {
      // Non-blocking — workspace restoration is best-effort.
    }
  }

  async saveToServer() {
    if (!this.hasUrlValue) return

    try {
      const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
      await fetch(this.urlValue, {
        method : "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ windows: this.windowState })
      })
    } catch (_err) {
      // Non-blocking
    }
  }

  // ── Open a single window by ID ──────────────────────────────────────────────

  openWindow(windowId) {
    // Named windows use dedicated toggle events.
    const namedToggleMap = {
      "db-health" : "db-health:toggle",
      "settings"  : "settings:toggle",
      "launcher"  : "launcher:toggle"
    }

    const toggleEvent = namedToggleMap[windowId]
    if (toggleEvent) {
      window.dispatchEvent(new CustomEvent(toggleEvent))
      return
    }

    // Content windows (conversion-chart, timer, singular-note, singular-task-list)
    // use the shared app-window:toggle event with an appKey discriminator.
    window.dispatchEvent(new CustomEvent("app-window:toggle", {
      detail: { appKey: windowId }
    }))
  }

  applyPositionFromServer(windowId, state) {
    const x = Number(state?.x)
    const y = Number(state?.y)
    const width = Number(state?.width)
    const height = Number(state?.height)
    const z = Number(state?.z ?? state?.layer)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return

    const element = this.findWindowElement(windowId)
    if (!element) return

    element.style.left = `${Math.round(x)}px`
    element.style.top = `${Math.round(y)}px`
    const isOsWindow = OS_WINDOW_IDS.has(windowId)
    if (!isOsWindow && Number.isFinite(width) && width > 0) element.style.width = `${Math.round(width)}px`
    if (!isOsWindow && Number.isFinite(height) && height > 0) element.style.height = `${Math.round(height)}px`
    if (Number.isFinite(z) && z > 0) element.style.zIndex = String(Math.round(z))

    const storageKey = WINDOW_BOUNDS_KEY_MAP[windowId]
    if (!storageKey) return

    const existing = this.readLocalStorageJson(storageKey) || {}
    const next = {
      ...existing,
      left: Math.round(x),
      top: Math.round(y),
      width: isOsWindow ? existing.width : (Number.isFinite(width) && width > 0 ? Math.round(width) : existing.width),
      height: isOsWindow ? existing.height : (Number.isFinite(height) && height > 0 ? Math.round(height) : existing.height),
      z: Number.isFinite(z) && z > 0 ? Math.round(z) : (existing.z ?? existing.layer)
    }

    // Content windows expect width/height in localStorage. If absent, use
    // current rendered dimensions so restore parsers stay valid.
    if (storageKey.startsWith("nexus.contentWindow.")) {
      const rect = element.getBoundingClientRect()
      if (!Number.isFinite(next.width)) next.width = Math.round(rect.width)
      if (!Number.isFinite(next.height)) next.height = Math.round(rect.height)
    }

    try { window.localStorage.setItem(storageKey, JSON.stringify(next)) } catch (_) {}
  }

  readBoundsForWindow(windowId) {
    const element = this.findWindowElement(windowId)
    if (!element) return { x: 0, y: 0, width: 407, height: 407 }

    const rect = element.getBoundingClientRect()
    const z = Number.parseInt(element.style.zIndex || window.getComputedStyle(element).zIndex, 10)
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      z: Number.isFinite(z) ? z : 1500
    }
  }

  findWindowElement(windowId) {
    if (windowId === "db-health") return document.querySelector(".db-health-window")
    if (windowId === "settings") return document.querySelector(".settings-window")
    if (windowId === "launcher") return document.getElementById("organizer-window")
    if (windowId === "conversion-chart") return document.querySelector("[data-content-window-app-key-value='conversion-chart']")
    if (windowId === "timer") return document.querySelector("[data-content-window-app-key-value='timer']")
    if (windowId === "singular-note") return document.querySelector("[data-content-window-app-key-value='singular-note']")
    if (windowId === "singular-task-list") return document.querySelector("[data-content-window-app-key-value='singular-task-list']")
    if (windowId === "singular-whiteboard") return document.querySelector("[data-content-window-app-key-value='singular-whiteboard']")
    if (windowId === "theme-builder") return document.querySelector("[data-content-window-app-key-value='theme-builder']")
    return null
  }

  readLocalStorageJson(key) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      return JSON.parse(raw)
    } catch (_) {
      return null
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────

  reset() {
    // Wipe all known position keys from localStorage.
    ALL_BOUNDS_KEYS.forEach(key => {
      try { window.localStorage.removeItem(key) } catch (_) {}
    })

    // Clear server-side rows, then hard-reload for a clean slate.
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    fetch(this.urlValue, {
      method : "DELETE",
      headers: { "X-CSRF-Token": csrfToken }
    }).finally(() => window.location.reload())
  }
}
