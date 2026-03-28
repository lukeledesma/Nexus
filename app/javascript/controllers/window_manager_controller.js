import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    this.organizerWindow = document.getElementById("organizer-window")
    this.toolsDockButton = this.element.querySelector(".app-dock-button--tools")
    this.dbHealthDockButton = this.element.querySelector(".app-dock-button--db-health")
    this.settingsDockButton = this.element.querySelector(".app-dock-button--settings")
    this.stationaryDockButton = this.element.querySelector(".app-dock-button--stationary")

    this.minWindowHeight = 120
    this.viewportMarginPx = 6
    this.dockLeftBoundary = 41
    this.defaultOrganizerWidth = 320
    this.defaultOrganizerHeight = this.getToolsWindowHeight()

    this.activeDrag = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundDbHealthState = this.handleDbHealthState.bind(this)
    this.boundSettingsState = this.handleSettingsState.bind(this)
    this.boundStationaryState = this.handleStationaryState.bind(this)

    this.initializeWindows()

    window.addEventListener("db-health:state", this.boundDbHealthState)
    window.addEventListener("settings:state", this.boundSettingsState)
    window.addEventListener("stationary:state", this.boundStationaryState)

    if (this.organizerWindow) {
      this.organizerWindow.addEventListener("mousedown", () => this.bringToolsToFront())
    }
    this.updateDbHealthDockState(false)
    this.updateSettingsDockState(false)
    this.updateStationaryDockState(false)
  }

  disconnect() {
    this.stopDrag()
    window.removeEventListener("db-health:state", this.boundDbHealthState)
    window.removeEventListener("settings:state", this.boundSettingsState)
    window.removeEventListener("stationary:state", this.boundStationaryState)
  }

  toggleDbHealth(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("db-health:toggle"))
  }

  toggleSettings(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("settings:toggle"))
  }

  toggleStationary(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("stationary:toggle"))
  }

  handleDbHealthState(event) { this.updateDbHealthDockState(Boolean(event?.detail?.open)) }
  handleSettingsState(event) { this.updateSettingsDockState(Boolean(event?.detail?.open)) }
  handleStationaryState(event) { this.updateStationaryDockState(Boolean(event?.detail?.open)) }

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════

  initializeWindows() {
    if (!this.organizerWindow) return
    this.positionToolsWindow()
    this.organizerWindow.classList.add("is-hidden")
    this.updateToolsDockState(false)
  }

  positionToolsWindow() {
    if (!this.organizerWindow) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMarginPx
    const columnGap = 15
    const rowGap = 15
    const defaultTop = margin
    const leftColumnLeft = this.dockLeftBoundary
    const leftColumnWidth = 320
    const organizerWidth = this.defaultOrganizerWidth
    const maxWindowHeight = Math.max(this.minWindowHeight, vh - (margin * 2))
    const windowHeight = Math.max(
      this.minWindowHeight,
      Math.min(this.defaultOrganizerHeight, maxWindowHeight)
    )

    const rightColumnLeft = leftColumnLeft + leftColumnWidth + columnGap
    const desiredLeft = rightColumnLeft
    const desiredTop = defaultTop + 125 + rowGap

    const organizerLeft = Math.max(this.dockLeftBoundary, Math.min(desiredLeft, vw - margin - organizerWidth))
    const organizerTop = Math.max(margin, Math.min(desiredTop, vh - margin - windowHeight))

    this.organizerWindow.style.left = organizerLeft + "px"
    this.organizerWindow.style.top = organizerTop + "px"
    this.organizerWindow.style.width = organizerWidth + "px"
    this.organizerWindow.style.height = windowHeight + "px"
  }

  getToolsWindowHeight() {
    const count = this.organizerWindow?.querySelectorAll(".organizer-tools-grid .finder-item")?.length || 0
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
    this.bringToolsToFront()

    const orgRect = this.organizerWindow.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)

    this.activeDrag = {
      startX: coords.x,
      startY: coords.y,
      orgStartLeft: orgRect.left,
      orgStartTop: orgRect.top
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

    let newOrgLeft = d.orgStartLeft + deltaX
    let newOrgTop = d.orgStartTop + deltaY

    newOrgLeft = Math.max(this.dockLeftBoundary, Math.min(newOrgLeft, vw - margin - this.organizerWindow.offsetWidth))
    newOrgTop = Math.max(margin, Math.min(newOrgTop, vh - margin - this.organizerWindow.offsetHeight))

    this.organizerWindow.style.left = newOrgLeft + "px"
    this.organizerWindow.style.top = newOrgTop + "px"
  }

  stopDrag() {
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TOOLS toggle
  // ════════════════════════════════════════════════════════════════════════════

  toggleTools(event) {
    if (event) event.preventDefault()
    if (!this.organizerWindow) return
    const isHidden = this.organizerWindow.classList.contains("is-hidden")
    if (isHidden) { this.openTools() } else { this.closeTools() }
  }

  openTools() {
    this.organizerWindow.classList.remove("is-hidden")
    this.bringToolsToFront()
    this.updateToolsDockState(true)
  }

  closeTools() {
    this.organizerWindow.classList.add("is-hidden")
    this.updateToolsDockState(false)
  }

  bringToolsToFront() {
    if (!this.organizerWindow || this.organizerWindow.classList.contains("is-hidden")) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.organizerWindow.style.zIndex = String(next)
  }

  updateToolsDockState(isOpen) {
    if (!this.toolsDockButton) return
    this.toolsDockButton.classList.toggle("is-active", isOpen)
    this.toolsDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.toolsDockButton.setAttribute("aria-label", isOpen ? "Hide TOOLS" : "Open TOOLS")
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

  updateStationaryDockState(isOpen) {
    if (!this.stationaryDockButton) return
    this.stationaryDockButton.classList.toggle("is-active", isOpen)
    this.stationaryDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.stationaryDockButton.setAttribute("aria-label", isOpen ? "Hide Stationary" : "Open Stationary")
  }
}

