import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    this.launcherWindow = document.getElementById("organizer-window")
    this.launcherDockButton = this.element.querySelector(".app-dock-button--launcher")
    this.dbHealthDockButton = this.element.querySelector(".app-dock-button--db-health")
    this.settingsDockButton = this.element.querySelector(".app-dock-button--settings")

    this.minWindowHeight = 120
    this.viewportMarginPx = 6
    this.dockLeftBoundary = 41
    this.defaultOrganizerWidth = 320
    this.defaultOrganizerHeight = this.getLauncherWindowHeight()

    this.activeDrag = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundDbHealthState = this.handleDbHealthState.bind(this)
    this.boundSettingsState = this.handleSettingsState.bind(this)
    this.boundLauncherToggle = this.toggleLauncher.bind(this)

    this.initializeWindows()

    window.addEventListener("db-health:state", this.boundDbHealthState)
    window.addEventListener("settings:state", this.boundSettingsState)
    window.addEventListener("launcher:toggle", this.boundLauncherToggle)

    if (this.launcherWindow) {
      this.launcherWindow.addEventListener("mousedown", () => this.bringLauncherToFront())
    }
    this.updateDbHealthDockState(false)
    this.updateSettingsDockState(false)
  }

  disconnect() {
    this.stopDrag()
    window.removeEventListener("db-health:state", this.boundDbHealthState)
    window.removeEventListener("settings:state", this.boundSettingsState)
    window.removeEventListener("launcher:toggle", this.boundLauncherToggle)
  }

  toggleDbHealth(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("db-health:toggle"))
  }

  toggleSettings(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("settings:toggle"))
  }

  toggleLauncher(event) {
    if (event) event.preventDefault()
    if (!this.launcherWindow) return
    const isHidden = this.launcherWindow.classList.contains("is-hidden")
    if (isHidden) { this.openLauncher() } else { this.closeLauncher() }
  }

  handleDbHealthState(event) { this.updateDbHealthDockState(Boolean(event?.detail?.open)) }
  handleSettingsState(event) { this.updateSettingsDockState(Boolean(event?.detail?.open)) }

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════

  initializeWindows() {
    if (!this.launcherWindow) return
    this.restoreLauncherWindowBounds()
    this.launcherWindow.classList.add("is-hidden")
    this.updateLauncherDockState(false)
  }

  positionLauncherWindow() {
    if (!this.launcherWindow) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMarginPx
    const columnGap = 15
    const rowGap = 15
    const defaultTop = margin
    const leftColumnLeft = this.dockLeftBoundary
    const leftColumnWidth = 320
    const launcherWidth = this.defaultOrganizerWidth
    const maxWindowHeight = Math.max(this.minWindowHeight, vh - (margin * 2))
    const windowHeight = Math.max(
      this.minWindowHeight,
      Math.min(this.defaultOrganizerHeight, maxWindowHeight)
    )

    const rightColumnLeft = leftColumnLeft + leftColumnWidth + columnGap
    const desiredLeft = rightColumnLeft
    const desiredTop = defaultTop + 125 + rowGap

    const launcherLeft = Math.max(this.dockLeftBoundary, Math.min(desiredLeft, vw - margin - launcherWidth))
    const launcherTop = Math.max(margin, Math.min(desiredTop, vh - margin - windowHeight))

    this.launcherWindow.style.left = launcherLeft + "px"
    this.launcherWindow.style.top = launcherTop + "px"
    this.launcherWindow.style.width = launcherWidth + "px"
    this.launcherWindow.style.height = windowHeight + "px"
  }

  getLauncherWindowHeight() {
    const count = this.launcherWindow?.querySelectorAll(".organizer-tools-grid .os-window-card")?.length || 0
    const rows = this.calculateGridRows(count || 3, 2)
    return this.calculateCardGridWindowHeight(rows)
  }

  calculateGridRows(itemCount, columns = 2) {
    return Math.max(1, Math.ceil(itemCount / columns))
  }

  calculateCardGridWindowHeight(rows) {
    const baseChromeHeight = 75
    const cardHeight = 50
    const rowGap = 5
    return baseChromeHeight + (rows * cardHeight) + (Math.max(0, rows - 1) * rowGap)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Helper: Extract coordinates from mouse or touch event
  // ════════════════════════════════════════════════════════════════════════════

  getEventCoordinates(event) {
    if (event.touches) {
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      }
    }
    return {
      x: event.clientX,
      y: event.clientY
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Drag Logic
  // ════════════════════════════════════════════════════════════════════════════

  startDrag(event) {
    const titleBar = event.currentTarget
    const win = titleBar.closest(".os-window")

    if (!win) return

    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='button']")) {
      return
    }

    if (event.button !== undefined && event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    this.bringLauncherToFront()

    const orgRect = this.launcherWindow.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)

    this.activeDrag = {
      startX: coords.x,
      startY: coords.y,
      launcherStartLeft: orgRect.left,
      launcherStartTop: orgRect.top
    }

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const d = this.activeDrag
    const coords = this.getEventCoordinates(event)
    const deltaX = coords.x - d.startX
    const deltaY = coords.y - d.startY

    const margin = this.viewportMarginPx
    const vw = window.innerWidth
    const vh = window.innerHeight

    let newOrgLeft = d.launcherStartLeft + deltaX
    let newOrgTop = d.launcherStartTop + deltaY

    newOrgLeft = Math.max(this.dockLeftBoundary, Math.min(newOrgLeft, vw - margin - this.launcherWindow.offsetWidth))
    newOrgTop = Math.max(margin, Math.min(newOrgTop, vh - margin - this.launcherWindow.offsetHeight))

    this.launcherWindow.style.left = newOrgLeft + "px"
    this.launcherWindow.style.top = newOrgTop + "px"
  }

  stopDrag() {
    if (this.activeDrag) {
      this.saveLauncherWindowBounds()
      this.emitLauncherState(!this.launcherWindow.classList.contains("is-hidden"))
    }
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  restoreLauncherWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.launcher.bounds")
    if (!bounds) { this.positionLauncherWindow(); return }
    this.launcherWindow.style.left   = `${bounds.left}px`
    this.launcherWindow.style.top    = `${bounds.top}px`
    this.launcherWindow.style.width  = `${this.defaultOrganizerWidth}px`
    this.launcherWindow.style.height = `${this.defaultOrganizerHeight}px`
  }

  saveLauncherWindowBounds() {
    if (!this.launcherWindow) return
    const rect = this.launcherWindow.getBoundingClientRect()
    const bounds = { left: Math.round(rect.left), top: Math.round(rect.top) }
    try { localStorage.setItem("nexus.window.launcher.bounds", JSON.stringify(bounds)) } catch (_) {}
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

  // ════════════════════════════════════════════════════════════════════════════
  // LAUNCHER toggle
  // ════════════════════════════════════════════════════════════════════════════

  openLauncher() {
    this.launcherWindow.classList.remove("is-hidden")
    this.bringLauncherToFront()
    this.updateLauncherDockState(true)
    this.emitLauncherState(true)
  }

  closeLauncher() {
    this.emitLauncherState(false)
    this.launcherWindow.classList.add("is-hidden")
    this.updateLauncherDockState(false)
  }

  emitLauncherState(isOpen) {
    const rect = this.launcherWindow.getBoundingClientRect()
    const z = Number.parseInt(this.launcherWindow.style.zIndex || window.getComputedStyle(this.launcherWindow).zIndex, 10)
    window.dispatchEvent(new CustomEvent("launcher:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        z: Number.isFinite(z) ? z : 1500
      }
    }))
  }

  bringLauncherToFront() {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    if (window.__nexusRestoringLayout) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.launcherWindow.style.zIndex = String(next)
    this.emitLauncherState(true)
  }

  updateLauncherDockState(isOpen) {
    if (!this.launcherDockButton) return
    this.launcherDockButton.classList.toggle("is-active", isOpen)
    this.launcherDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.launcherDockButton.setAttribute("aria-label", isOpen ? "Hide Launcher" : "Open Launcher")
  }

  updateDbHealthDockState(isOpen) {
    if (!this.dbHealthDockButton) return
    this.dbHealthDockButton.classList.toggle("is-active", isOpen)
    this.dbHealthDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.dbHealthDockButton.setAttribute("aria-label", isOpen ? "Hide DB Health" : "Open DB Health")
  }

  updateSettingsDockState(isOpen) {
    if (!this.settingsDockButton) return
    this.settingsDockButton.classList.toggle("is-active", isOpen)
    this.settingsDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.settingsDockButton.setAttribute("aria-label", isOpen ? "Hide Settings" : "Open Settings")
  }

}

