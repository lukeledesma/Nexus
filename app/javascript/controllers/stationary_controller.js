import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["window", "notesSize", "tasksSize", "stamp"]

  connect() {
    this.windowWidth = 320
    this.minimumWindowHeight = 125
    this.windowHeight = 125
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.activeDrag = null
    this.latestUpdateAt = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
    this.boundWindowInteraction = this.handleWindowInteraction.bind(this)
    this.boundSavedState = this.handleSavedState.bind(this)
    this.boundAppWindowState = this.handleAppWindowState.bind(this)

    this.restoreWindowBounds()
    window.addEventListener("stationary:toggle", this.boundToggleRequest)
    window.addEventListener("nexus:item-saved", this.boundSavedState)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.windowTarget.addEventListener("mousedown", this.boundWindowInteraction)

    this.loadFileSizes()
    this.loadPersistedStamp()
    this.clearLauncherState()
  }

  disconnect() {
    this.stopDrag()
    window.removeEventListener("stationary:toggle", this.boundToggleRequest)
    window.removeEventListener("nexus:item-saved", this.boundSavedState)
    window.removeEventListener("app-window:state", this.boundAppWindowState)
    this.windowTarget.removeEventListener("mousedown", this.boundWindowInteraction)
  }

  handleWindowInteraction() {
    this.bringToFront()
  }

  handleToggleRequest() {
    this.toggle()
  }

  toggle() {
    const shouldOpen = this.windowTarget.classList.contains("is-hidden")
    if (shouldOpen) {
      this.open()
      return
    }
    this.close()
  }

  open() {
    this.windowTarget.classList.remove("is-hidden")
    this.bringToFront()
    this.emitWindowState(true)
  }

  close(event) {
    if (event) event.preventDefault()
    this.emitWindowState(false)
    this.windowTarget.classList.add("is-hidden")
  }

  emitWindowState(isOpen) {
    const rect = this.windowTarget.getBoundingClientRect()
    window.dispatchEvent(new CustomEvent("stationary:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top)
      }
    }))
  }

  openApp(event) {
    const appId = event.currentTarget.dataset.appId
    if (!appId) return
    window.dispatchEvent(new CustomEvent("stationary:open-app", { detail: { appId } }))
  }

  // ── Stamp ──────────────────────────────────────────────────────────────────

  handleSavedState(event) {
    const itemType = event.detail?.itemType
    const timestamp = event.detail?.timestamp
    const label = this.labelForItemType(itemType)
    if (!label || !this.hasStampTarget) return
    this.applyStamp(label, timestamp)
  }

  applyStamp(label, timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return
    if (this.latestUpdateAt && date <= this.latestUpdateAt) return
    this.latestUpdateAt = date
    this.stampTarget.textContent = `${label} Updated ${this.formatTimestamp(timestamp)}`
  }

  async loadPersistedStamp() {
    if (!this.hasStampTarget) return
    try {
      const response = await fetch("/db_health", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return
      const payload = await response.json()
      const lastUpdated = payload?.organizer?.last_updated
      if (!lastUpdated?.label || !lastUpdated?.updated_at) return
      this.applyStamp(lastUpdated.label, lastUpdated.updated_at)
    } catch (_error) {
      // non-blocking
    }
  }

  // ── File sizes ─────────────────────────────────────────────────────────────

  async loadFileSizes() {
    try {
      const response = await fetch("/db_health", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return
      const payload = await response.json()
      const organizer = payload?.organizer
      if (!organizer) return

      if (this.hasNotesSizeTarget && organizer.note_size_bytes) {
        this.notesSizeTarget.textContent = this.formatBytes(organizer.note_size_bytes)
      }
      if (this.hasTasksSizeTarget && organizer.task_size_bytes) {
        this.tasksSizeTarget.textContent = this.formatBytes(organizer.task_size_bytes)
      }
    } catch (_error) {
      // non-blocking
    }
  }

  // ── Drag ───────────────────────────────────────────────────────────────────

  startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest(".stationary-controls")) return
    this.beginDrag(event)
  }

  beginDrag(event) {
    if (this.windowTarget.classList.contains("is-hidden")) return
    event.preventDefault()
    this.bringToFront()

    const rect = this.windowTarget.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)
    this.activeDrag = {
      offsetX: coords.x - rect.left,
      offsetY: coords.y - rect.top
    }

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getEventCoordinates(event)
    const margin = this.viewportMargin
    const width = this.windowTarget.offsetWidth
    const height = this.windowTarget.offsetHeight
    const maxLeft = window.innerWidth - width - margin
    const maxTop = window.innerHeight - height - margin

    const left = Math.min(Math.max(coords.x - this.activeDrag.offsetX, this.dockLeftBoundary), Math.max(this.dockLeftBoundary, maxLeft))
    const top = Math.min(Math.max(coords.y - this.activeDrag.offsetY, margin), Math.max(margin, maxTop))

    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  stopDrag() {
    if (this.activeDrag) {
      this.saveWindowBounds()
      this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
    }
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.stationary.bounds")
    if (!bounds) { this.positionWindow(); return }
    this.windowTarget.style.left   = `${bounds.left}px`
    this.windowTarget.style.top    = `${bounds.top}px`
    this.windowTarget.style.width  = `${this.windowWidth}px`
    this.windowTarget.style.height = `${this.windowHeight}px`
  }

  saveWindowBounds() {
    const rect = this.windowTarget.getBoundingClientRect()
    const bounds = { left: Math.round(rect.left), top: Math.round(rect.top) }
    try { localStorage.setItem("nexus.window.stationary.bounds", JSON.stringify(bounds)) } catch (_) {}
  }

  readStoredBounds(key) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.left !== "number" || typeof parsed?.top !== "number") return null
      return parsed
    } catch (_) { return null }
  }

  getEventCoordinates(event) {
    if (event.touches) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }
    return { x: event.clientX, y: event.clientY }
  }

  // ── Positioning ────────────────────────────────────────────────────────────

  positionWindow() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const defaultTop = this.viewportMargin
    const columnGap = 15
    const leftColumnLeft = this.dockLeftBoundary
    const leftColumnWidth = 320
    const width = Math.min(this.windowWidth, Math.max(260, vw - 40))
    const height = Math.min(this.windowHeight, Math.max(this.minimumWindowHeight, vh - 40))
    const desiredLeft = leftColumnLeft + leftColumnWidth + columnGap
    const left = Math.max(this.dockLeftBoundary, Math.min(desiredLeft, vw - this.viewportMargin - width))
    const top = Math.max(this.viewportMargin, Math.min(defaultTop, vh - this.viewportMargin - height))

    this.windowTarget.style.width = `${width}px`
    this.windowTarget.style.height = `${height}px`
    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  bringToFront() {
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.windowTarget.style.zIndex = String(next)
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  labelForItemType(itemType) {
    if (itemType === "note") return "Notes"
    if (itemType === "task_list") return "Tasks"
    return null
  }

  launchApp(event) {
    const appKey = event.currentTarget.dataset.windowKey
    if (!appKey) return
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
  }

  handleAppWindowState(event) {
    this.updateLauncherState(event.detail?.appKey, Boolean(event.detail?.open))
  }

  updateLauncherState(appKey, isOpen) {
    const button = this.element.querySelector(`[data-window-key="${appKey}"]`)
    if (!button) return
    button.classList.toggle("is-active", isOpen)
    button.setAttribute("aria-pressed", isOpen ? "true" : "false")
  }

  clearLauncherState() {
    this.element.querySelectorAll("[data-window-key]").forEach((button) => {
      button.classList.remove("is-active")
      button.setAttribute("aria-pressed", "false")
    })
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return "-"
    const units = ["B", "KB", "MB", "GB"]
    const index = Math.floor(Math.log(bytes) / Math.log(1024))
    const value = (bytes / Math.pow(1024, index)).toFixed(0)
    return `${value} ${units[index] || "B"}`
  }

  formatTimestamp(value) {
    if (!value) return "just now"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "just now"
    return date.toLocaleString()
  }
}
