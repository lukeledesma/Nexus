import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  connect() {
    // Window references
    this.organizerWindow = document.getElementById("organizer-window")
    this.mainWindow = document.getElementById("main-window")
    this.windowManagerShell = this.organizerWindow?.closest(".window-manager-shell") || null
    this.toolsDockButton = this.element.querySelector(".app-dock-button--tools")
    this.dbHealthDockButton = this.element.querySelector(".app-dock-button--db-health")
    this.settingsDockButton = this.element.querySelector(".app-dock-button--settings")

    // State
    this.openApp = null
    this.minWindowWidth = 300
    this.sharedContentMinWidth = 432
    this.minWindowHeight = 200
    this.viewportMarginPx = 20
    this.defaultOrganizerWidth = 320
    this.defaultOrganizerHeight = 360

    this.activeDrag = null
    this.activeResize = null

    // Bind methods
    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundResizeMove = this.handleResizeMove.bind(this)
    this.boundResizeEnd = this.stopResize.bind(this)
    this.boundAppOpened = this.onAppOpened.bind(this)
    this.boundAppClosed = this.onAppClosed.bind(this)
    this.boundFrameLoad = this.onFrameLoad.bind(this)
    this.boundToolsInteraction = this.handleToolsInteraction.bind(this)
    this.boundDbHealthState = this.handleDbHealthState.bind(this)
    this.boundSettingsState = this.handleSettingsState.bind(this)

    // Initialize layout
    this.initializeWindows()

    // Listen for app open/close events
    window.addEventListener("app:opened", this.boundAppOpened)
    window.addEventListener("app:closed", this.boundAppClosed)
    document.addEventListener("turbo:frame-load", this.boundFrameLoad)
    window.addEventListener("db-health:state", this.boundDbHealthState)
    window.addEventListener("settings:state", this.boundSettingsState)

      this.bindToolsInteractionListeners()
    this.updateDbHealthDockState(false)
    this.updateSettingsDockState(false)
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    window.removeEventListener("app:opened", this.boundAppOpened)
    window.removeEventListener("app:closed", this.boundAppClosed)
    document.removeEventListener("turbo:frame-load", this.boundFrameLoad)
    window.removeEventListener("db-health:state", this.boundDbHealthState)
    window.removeEventListener("settings:state", this.boundSettingsState)
      this.unbindToolsInteractionListeners()
  }

  toggleDbHealth(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("db-health:toggle"))
  }

  toggleSettings(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("settings:toggle"))
  }

  handleDbHealthState(event) {
    const isOpen = Boolean(event?.detail?.open)
    this.updateDbHealthDockState(isOpen)
  }

  handleSettingsState(event) {
    const isOpen = Boolean(event?.detail?.open)
    this.updateSettingsDockState(isOpen)
  }

    bindToolsInteractionListeners() {
      if (this.organizerWindow) {
        this.organizerWindow.addEventListener("mousedown", this.boundToolsInteraction)
      }
      if (this.mainWindow) {
        this.mainWindow.addEventListener("mousedown", this.boundToolsInteraction)
      }
    }

    unbindToolsInteractionListeners() {
      if (this.organizerWindow) {
        this.organizerWindow.removeEventListener("mousedown", this.boundToolsInteraction)
      }
      if (this.mainWindow) {
        this.mainWindow.removeEventListener("mousedown", this.boundToolsInteraction)
      }
    }

    handleToolsInteraction() {
      this.bringToolsToFront()
    }

    bringToolsToFront() {
        if (!this.organizerWindow || !this.mainWindow || !this.windowManagerShell) return
        if (this.organizerWindow.classList.contains("is-hidden")) return

        const next = Number(window.__nexusDesktopZIndex || 1500) + 1
        window.__nexusDesktopZIndex = next

        // Lift the entire TOOLS app stack (shell) above other desktop windows.
        this.windowManagerShell.style.zIndex = String(next)

        // Keep internal pane ordering controlled by stylesheet defaults.
        this.mainWindow.style.removeProperty("z-index")
        this.organizerWindow.style.removeProperty("z-index")
      }

  getMainMinWidth() {
    const baseMin = this.minWindowWidth

    // Shared content floor for all apps (Journal, Task List, Conversion, and future panes).
    // Conversion still gets an exact content-based minimum if its view is present.
    let sharedMin = this.sharedContentMinWidth
    const appSurface = this.mainWindow?.querySelector(".app-surface")
    if (appSurface) {
      const appSurfaceStyles = globalThis.getComputedStyle(appSurface)
      const cssSharedMin = parseFloat(appSurfaceStyles.getPropertyValue("--app-main-min-content-width"))
      if (!Number.isNaN(cssSharedMin) && cssSharedMin > 0) {
        sharedMin = cssSharedMin
      }
    }

    if (this.openApp === "conversion_chart") {
      const chartView = this.mainWindow?.querySelector(".conversion-chart-view")
      if (chartView) {
        const chartStyles = globalThis.getComputedStyle(chartView)
        const appSurfaceStyles = appSurface ? globalThis.getComputedStyle(appSurface) : null

        const cardMin = parseFloat(chartStyles.getPropertyValue("--conversion-card-min-width")) || 320
        const chartPadLeft = parseFloat(chartStyles.paddingLeft) || 0
        const chartPadRight = parseFloat(chartStyles.paddingRight) || 0
        const appPadLeft = appSurfaceStyles ? (parseFloat(appSurfaceStyles.paddingLeft) || 0) : 0
        const appPadRight = appSurfaceStyles ? (parseFloat(appSurfaceStyles.paddingRight) || 0) : 0
        const conversionContentMin = Math.ceil(cardMin + chartPadLeft + chartPadRight + appPadLeft + appPadRight)
        return Math.max(baseMin, sharedMin, conversionContentMin)
      }
    }

    return Math.max(baseMin, sharedMin)
  }

  enforceMainWindowMinimumWidth() {
    if (!this.mainWindow || !this.organizerWindow) return

    const margin = this.viewportMarginPx
    const vw = globalThis.innerWidth
    const minMainWidth = this.getMainMinWidth()

    const orgLeft = parseFloat(this.organizerWindow.style.left) || this.organizerWindow.getBoundingClientRect().left
    const orgWidth = parseFloat(this.organizerWindow.style.width) || this.organizerWindow.offsetWidth
    const mainLeft = orgLeft + orgWidth

    const available = Math.max(this.minWindowWidth, vw - margin - mainLeft)
    const clampedMin = Math.min(minMainWidth, available)

    const currentMainWidth = parseFloat(this.mainWindow.style.width) || this.mainWindow.offsetWidth
    if (currentMainWidth < clampedMin) {
      this.mainWindow.style.width = clampedMin + "px"
    }
  }

  sizeMainWindowToCompactWidth() {
    if (!this.mainWindow || !this.organizerWindow) return

    const margin = this.viewportMarginPx
    const vw = globalThis.innerWidth
    const minMainWidth = this.getMainMinWidth()
    const orgLeft = parseFloat(this.organizerWindow.style.left) || this.organizerWindow.getBoundingClientRect().left
    const orgWidth = parseFloat(this.organizerWindow.style.width) || this.organizerWindow.offsetWidth
    const mainLeft = orgLeft + orgWidth
    const available = Math.max(this.minWindowWidth, vw - margin - mainLeft)
    const compactWidth = Math.min(minMainWidth, available)

    this.mainWindow.style.left = mainLeft + "px"
    this.mainWindow.style.width = compactWidth + "px"
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════

  initializeWindows() {
    if (!this.organizerWindow) return
    this.positionToolsWindow()

    // Initialize as closed: main window hidden
    this.mainWindow.classList.remove("visible")
    this.mainWindow.classList.remove("is-opening")
    this.mainWindow.classList.remove("is-closing")
    this.organizerWindow.classList.remove("pane-open")
    this.mainWindow.classList.add("is-hidden")
    this.organizerWindow.classList.add("is-hidden")
    this.updateToolsDockState(false)
  }

  positionToolsWindow() {
    if (!this.organizerWindow || !this.mainWindow) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMarginPx
    const minMainWidth = this.getMainMinWidth()

    const maxOrganizerWidth = Math.max(
      this.minWindowWidth,
      vw - (margin * 2) - minMainWidth
    )
    const organizerWidth = Math.max(
      this.minWindowWidth,
      Math.min(this.defaultOrganizerWidth, maxOrganizerWidth)
    )

    const maxWindowHeight = Math.max(this.minWindowHeight, vh - (margin * 2))
    const windowHeight = Math.max(
      this.minWindowHeight,
      Math.min(this.defaultOrganizerHeight, maxWindowHeight)
    )

    let organizerLeft = Math.round((vw - organizerWidth) / 2)
    const maxOrganizerLeft = vw - margin - organizerWidth - minMainWidth
    if (maxOrganizerLeft >= margin) {
      organizerLeft = Math.min(organizerLeft, maxOrganizerLeft)
    }
    organizerLeft = Math.max(margin, Math.min(organizerLeft, vw - margin - organizerWidth))

    const organizerTop = Math.max(
      margin,
      Math.min(Math.round((vh - windowHeight) / 2), vh - margin - windowHeight)
    )

    const mainLeft = organizerLeft + organizerWidth
    const mainWidth = Math.min(minMainWidth, Math.max(this.minWindowWidth, vw - margin - mainLeft))

    this.organizerWindow.style.left = organizerLeft + "px"
    this.organizerWindow.style.top = organizerTop + "px"
    this.organizerWindow.style.width = organizerWidth + "px"
    this.organizerWindow.style.height = windowHeight + "px"

    this.mainWindow.style.left = mainLeft + "px"
    this.mainWindow.style.top = organizerTop + "px"
    this.mainWindow.style.width = mainWidth + "px"
    this.mainWindow.style.height = windowHeight + "px"
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Helper: Extract coordinates from mouse or touch event
  // ════════════════════════════════════════════════════════════════════════════

  getEventCoordinates(event) {
    if (event.touches) {
      // Touch event
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      }
    }
    // Mouse event
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

    // Allow interactive controls inside draggable headers without triggering drag.
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='button']")) {
      return
    }

    // Skip if mouse event and it's not the primary button
    if (event.button !== undefined && event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()
    this.bringToolsToFront()

    // Always anchor on organizer — both windows move as one fused unit
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

    // Prevent scrolling while dragging on touch devices
    if (event.touches) {
      event.preventDefault()
    }

    const d = this.activeDrag
    const coords = this.getEventCoordinates(event)
    const deltaX = coords.x - d.startX
    const deltaY = coords.y - d.startY

    const margin = this.viewportMarginPx
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Both windows always move as one fused unit — organizer is the anchor
    let newOrgLeft = d.orgStartLeft + deltaX
    let newOrgTop = d.orgStartTop + deltaY

    // Clamp organizer to viewport
    newOrgLeft = Math.max(margin, Math.min(newOrgLeft, vw - margin - this.organizerWindow.offsetWidth))
    newOrgTop = Math.max(margin, Math.min(newOrgTop, vh - margin - this.organizerWindow.offsetHeight))

    this.organizerWindow.style.left = newOrgLeft + "px"
    this.organizerWindow.style.top = newOrgTop + "px"

    // Seam always locked — main window follows instantly
    this.mainWindow.style.left = (newOrgLeft + this.organizerWindow.offsetWidth) + "px"
    this.mainWindow.style.top = newOrgTop + "px"
  }

  stopDrag() {
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Resize Logic
  // ════════════════════════════════════════════════════════════════════════════

  startResize(event) {
    const handle = event.currentTarget
    const window = handle.closest(".os-window")

    if (!window) return

    // Skip if mouse event and it's not the primary button
    if (event.button !== undefined && event.button !== 0) return

    // Determine edge from handle classes
    const edge = this.getEdgeFromHandle(handle)
    if (!edge) return

    event.preventDefault()
    event.stopPropagation()
    this.bringToolsToFront()

    const rect = window.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)

    this.activeResize = {
      window,
      edge,
      startX: coords.x,
      startY: coords.y,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height,
      isOrganizer: window === this.organizerWindow,
      isMain: window === this.mainWindow
    }

    document.addEventListener("mousemove", this.boundResizeMove)
    document.addEventListener("mouseup", this.boundResizeEnd)
    document.addEventListener("touchmove", this.boundResizeMove, { passive: false })
    document.addEventListener("touchend", this.boundResizeEnd)
  }

  getEdgeFromHandle(handle) {
    // Determine resize edge from handle element classes
    if (handle.classList.contains("top-left")) return "top-left"
    if (handle.classList.contains("top-right")) return "top-right"
    if (handle.classList.contains("bottom-left")) return "bottom-left"
    if (handle.classList.contains("bottom-right")) return "bottom-right"
    if (handle.classList.contains("top")) return "top"
    if (handle.classList.contains("bottom")) return "bottom"
    if (handle.classList.contains("left")) return "left"
    if (handle.classList.contains("right")) return "right"
    return null
  }

  handleResizeMove(event) {
    if (!this.activeResize) return

    // Prevent scrolling while resizing on touch devices
    if (event.touches) {
      event.preventDefault()
    }

    const r = this.activeResize
    const coords = this.getEventCoordinates(event)
    const deltaX = coords.x - r.startX
    const deltaY = coords.y - r.startY

    let newWidth = r.startWidth
    let newHeight = r.startHeight
    let newLeft = r.startLeft
    let newTop = r.startTop

    // Parse edge flags
    const isLeft = r.edge.includes("left")
    const isRight = r.edge.includes("right")
    const isTop = r.edge.includes("top")
    const isBottom = r.edge.includes("bottom")
    const minMainWidth = this.getMainMinWidth()

    // Horizontal
    if (isLeft) {
      newLeft += deltaX
      newWidth -= deltaX
    }
    if (isRight) {
      newWidth += deltaX
    }

    // Vertical
    if (isTop) {
      newTop += deltaY
      newHeight -= deltaY
    }
    if (isBottom) {
      newHeight += deltaY
    }

    // Organizer can only resize vertically, never horizontally
    if (r.isOrganizer) {
      // Organizer width is always locked; horizontal edge drags move the seam
      if (isLeft || isRight) {
        newLeft = r.startLeft + deltaX
      } else {
        newLeft = r.startLeft
      }
      newWidth = r.startWidth
    }

    // Enforce minimums
    if (!r.isOrganizer && newWidth < minMainWidth) {
      if (isLeft) {
        newLeft = r.startLeft + r.startWidth - minMainWidth
      }
      newWidth = minMainWidth
    }

    if (newHeight < this.minWindowHeight) {
      if (isTop) {
        newTop = r.startTop + r.startHeight - this.minWindowHeight
      }
      newHeight = this.minWindowHeight
    }

    this.applyResize(r.window, newLeft, newTop, newWidth, newHeight, r.isOrganizer)
  }

  applyResize(windowElement, left, top, width, height, isOrganizer) {
    const margin = this.viewportMarginPx
    const vw = globalThis.innerWidth
    const vh = globalThis.innerHeight
    const minMainWidth = this.getMainMinWidth()

    // Clamp to viewport
    left = Math.max(margin, left)
    top = Math.max(margin, top)

    // Keep minimum-width behavior stable even when a pane is partially off-screen.
    // Do not force-fit main width to viewport here; clamp via explicit minimums instead.
    if (isOrganizer && left + width > vw - margin) {
      width = vw - margin - left
    }
    if (top + height > vh - margin) {
      height = vh - margin - top
    }

    if (isOrganizer) {
      // Organizer width is always fixed; horizontal edge drag moves the seam
      const orgWidth = parseFloat(this.organizerWindow.style.width) || this.organizerWindow.offsetWidth || width

      // Clamp organizer itself to viewport; do not snap based on main pane minimum width.
      left = Math.min(left, vw - margin - orgWidth)
      left = Math.max(margin, left)

      // Apply organizer size/position (width stays locked, height can change)
      this.organizerWindow.style.left = left + "px"
      this.organizerWindow.style.top = top + "px"
      this.organizerWindow.style.width = orgWidth + "px"
      this.organizerWindow.style.height = height + "px"

      // Keep main window in sync with organizer seam (glued to right edge of organizer)
      const mainLeft = left + orgWidth
      const mainWidth = Math.max(minMainWidth, vw - margin - mainLeft)
      this.mainWindow.style.left = mainLeft + "px"
      this.mainWindow.style.top = top + "px"
      this.mainWindow.style.width = mainWidth + "px"
      this.mainWindow.style.height = height + "px"
    } else {
      width = Math.max(width, minMainWidth)

      // Main resizes: organizer width adjusts to keep seam
      this.mainWindow.style.left = left + "px"
      this.mainWindow.style.top = top + "px"
      this.mainWindow.style.width = width + "px"
      this.mainWindow.style.height = height + "px"

      // Glue seam: org width = main left - org left
      const orgLeft = parseInt(this.organizerWindow.style.left, 10)
      this.organizerWindow.style.width = (left - orgLeft) + "px"
      this.organizerWindow.style.top = top + "px"
      this.organizerWindow.style.height = height + "px"
    }
  }

  stopResize() {
    this.activeResize = null
    document.removeEventListener("mousemove", this.boundResizeMove)
    document.removeEventListener("mouseup", this.boundResizeEnd)
    document.removeEventListener("touchmove", this.boundResizeMove)
    document.removeEventListener("touchend", this.boundResizeEnd)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // App Visibility (Mechanical seam lock only, no visual state)
  // ════════════════════════════════════════════════════════════════════════════

  onAppOpened(event) {
    this.openApp = event.detail?.appId
    if (this.mainWindow) {
      const isAlreadyOpen =
        this.mainWindow.classList.contains("visible") &&
        !this.mainWindow.classList.contains("is-closing")

      // Cancel any pending close sequence
      clearTimeout(this._cornerResetTimer)

      if (isAlreadyOpen) {
        this.mainWindow.classList.remove("is-opening")
        this.mainWindow.classList.remove("is-closing")
        this.mainWindow.classList.add("visible")
        this.organizerWindow.classList.add("pane-open")
        globalThis.setTimeout(() => this.enforceMainWindowMinimumWidth(), 0)
        return
      }

      this.mainWindow.classList.remove("visible")
      this.mainWindow.classList.remove("is-closing")
      this.mainWindow.classList.add("is-opening")
      this.sizeMainWindowToCompactWidth()
      globalThis.requestAnimationFrame(() => {
        globalThis.requestAnimationFrame(() => {
          this.mainWindow.classList.add("visible")
          this.mainWindow.classList.remove("is-opening")
        })
      })
      this.organizerWindow.classList.add("pane-open")
      globalThis.setTimeout(() => this.enforceMainWindowMinimumWidth(), 0)
    }
  }

  onFrameLoad(event) {
    const frame = event.target
    if (!(frame instanceof Element)) return
    if (frame.id !== "app-pane") return
    this.enforceMainWindowMinimumWidth()
  }

  onAppClosed(event) {
    this.openApp = null
    if (this.mainWindow) {
      // Keep the shell visible during the close reveal so no transparent footprint appears.
      this.mainWindow.classList.remove("is-opening")
      this.mainWindow.classList.add("is-closing")
      this.mainWindow.classList.remove("visible")

      // Step 2: after slide completes (0.25s), round organizer corners
      // and notify listeners that close is complete.
      clearTimeout(this._cornerResetTimer)
      this._cornerResetTimer = setTimeout(() => {
        this.mainWindow.classList.remove("is-closing")
        this.organizerWindow.classList.remove("pane-open")
        window.dispatchEvent(new Event("app:closed:complete"))
      }, 250)
    }
  }

  toggleTools(event) {
    if (event) event.preventDefault()
    if (!this.organizerWindow || !this.mainWindow) return

    const isHidden = this.organizerWindow.classList.contains("is-hidden")
    if (isHidden) {
      this.openTools()
      return
    }

    this.closeTools()
  }

  openTools() {
    this.organizerWindow.classList.remove("is-hidden")
    this.mainWindow.classList.remove("is-hidden")
    this.mainWindow.classList.remove("visible")
    this.mainWindow.classList.remove("is-opening")
    this.mainWindow.classList.remove("is-closing")
    this.organizerWindow.classList.remove("pane-open")
    this.organizerWindow.classList.add("is-focused")
    clearTimeout(this._organizerFocusTimer)
    this._organizerFocusTimer = setTimeout(() => {
      this.organizerWindow.classList.remove("is-focused")
    }, 260)
      this.bringToolsToFront()
    this.updateToolsDockState(true)
  }

  closeTools() {
    this.mainWindow.classList.remove("visible")
    this.mainWindow.classList.remove("is-opening")
    this.mainWindow.classList.remove("is-closing")
    this.organizerWindow.classList.remove("pane-open")
    this.mainWindow.classList.add("is-hidden")
    this.organizerWindow.classList.add("is-hidden")
    this.updateToolsDockState(false)
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
}

