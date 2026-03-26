import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  connect() {
    // Window references
    this.organizerWindow = document.getElementById("organizer-window")
    this.mainWindow = document.getElementById("main-window")

    // State
    this.openApp = null
    this.minWindowWidth = 300
    this.sharedContentMinWidth = 432
    this.minWindowHeight = 200
    this.viewportMarginPx = 40

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

    // Initialize layout
    this.initializeWindows()

    // Listen for app open/close events
    window.addEventListener("app:opened", this.boundAppOpened)
    window.addEventListener("app:closed", this.boundAppClosed)
    document.addEventListener("turbo:frame-load", this.boundFrameLoad)
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    window.removeEventListener("app:opened", this.boundAppOpened)
    window.removeEventListener("app:closed", this.boundAppClosed)
    document.removeEventListener("turbo:frame-load", this.boundFrameLoad)
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

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════

  initializeWindows() {
    if (!this.organizerWindow) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const sideMargin = this.viewportMarginPx
    const topOffset = 60
    const bottomOffset = 80
    const orgWidth = 320
    const windowHeight = Math.max(this.minWindowHeight, vh - topOffset - bottomOffset)
    const mainWidth = Math.max(this.getMainMinWidth(), vw - (sideMargin + orgWidth) - sideMargin)

    // Set organizer initial position/size
    this.organizerWindow.style.left = sideMargin + "px"
    this.organizerWindow.style.top = topOffset + "px"
    this.organizerWindow.style.width = orgWidth + "px"
    this.organizerWindow.style.height = windowHeight + "px"

    // Seam lock: main window left = organizer left + organizer width (no gap)
    this.mainWindow.style.left = (sideMargin + orgWidth) + "px"
    this.mainWindow.style.top = topOffset + "px"
    this.mainWindow.style.width = mainWidth + "px"
    this.mainWindow.style.height = windowHeight + "px"

    // Initialize as closed: main window hidden
    this.mainWindow.classList.remove("visible")
    this.mainWindow.classList.remove("is-opening")
    this.mainWindow.classList.remove("is-closing")
    this.organizerWindow.classList.remove("pane-open")
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

    // Skip if mouse event and it's not the primary button
    if (event.button !== undefined && event.button !== 0) return

    event.preventDefault()
    event.stopPropagation()

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
}

