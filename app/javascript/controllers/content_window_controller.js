import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["frame"]
  static values = {
    appKey: String,
    appUrl: String,
    storageKey: String,
    frameId: String,
    defaultWidth: Number,
    defaultHeight: Number,
    defaultOffsetX: Number,
    defaultOffsetY: Number
  }

  connect() {
    this.currentUrl = this.buildAppUrl()
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.windowWidth = this.hasDefaultWidthValue ? this.defaultWidthValue : 550
    this.windowHeight = this.hasDefaultHeightValue ? this.defaultHeightValue : 480
    this.minWindowWidth = 320
    this.minWindowHeight = 320
    this.activeDrag = null
    this.activeResize = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundResizeMove = this.handleResizeMove.bind(this)
    this.boundResizeEnd = this.stopResize.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)

    window.addEventListener("app-window:toggle", this.boundToggleRequest)
    this.element.addEventListener("mousedown", () => this.bringToFront())

    this.restoreWindowBounds()
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    window.removeEventListener("app-window:toggle", this.boundToggleRequest)
  }

  handleToggleRequest(event) {
    if (event.detail?.appKey !== this.appKeyValue) return
    this.toggle()
  }

  toggle() {
    if (this.element.classList.contains("is-hidden")) {
      this.open()
      return
    }

    this.close()
  }

  open() {
    this.ensureFrameLoaded()
    this.element.classList.remove("is-hidden")
    this.bringToFront()
    this.emitWindowState(true)
  }

  close() {
    this.emitWindowState(false)
    this.element.classList.add("is-hidden")
  }

  ensureFrameLoaded() {
    if (!this.hasFrameTarget) return
    if (this.frameTarget.getAttribute("src") === this.currentUrl) return
    this.frameTarget.src = this.currentUrl
  }

  buildAppUrl() {
    const url = new URL(this.appUrlValue, window.location.origin)
    if (this.hasFrameIdValue) url.searchParams.set("frame_id", this.frameIdValue)
    return `${url.pathname}${url.search}`
  }

  startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='button']")) return

    event.preventDefault()
    this.bringToFront()

    const rect = this.element.getBoundingClientRect()
    const coords = this.getCoords(event)

    this.activeDrag = { offsetX: coords.x - rect.left, offsetY: coords.y - rect.top }

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getCoords(event)
    const margin = this.viewportMargin
    const w = this.element.offsetWidth
    const h = this.element.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight

    const left = Math.min(Math.max(coords.x - this.activeDrag.offsetX, this.dockLeftBoundary), vw - margin - w)
    const top = Math.min(Math.max(coords.y - this.activeDrag.offsetY, margin), vh - margin - h)

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
  }

  stopDrag() {
    if (this.activeDrag) {
      this.saveWindowBounds()
      this.emitWindowState(!this.element.classList.contains("is-hidden"))
    }
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  startResize(event) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.bringToFront()

    const handle = event.currentTarget
    const rect = this.element.getBoundingClientRect()
    const coords = this.getCoords(event)

    this.activeResize = {
      edge: this.getEdgeFromHandle(handle),
      startX: coords.x,
      startY: coords.y,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height
    }

    document.addEventListener("mousemove", this.boundResizeMove)
    document.addEventListener("mouseup", this.boundResizeEnd)
    document.addEventListener("touchmove", this.boundResizeMove, { passive: false })
    document.addEventListener("touchend", this.boundResizeEnd)
  }

  handleResizeMove(event) {
    if (!this.activeResize) return
    if (event.touches) event.preventDefault()

    const coords = this.getCoords(event)
    const deltaX = coords.x - this.activeResize.startX
    const deltaY = coords.y - this.activeResize.startY
    const edge = this.activeResize.edge
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMargin

    let left = this.activeResize.startLeft
    let top = this.activeResize.startTop
    let width = this.activeResize.startWidth
    let height = this.activeResize.startHeight

    if (edge.includes("left")) {
      left += deltaX
      width -= deltaX
    }
    if (edge.includes("right")) width += deltaX
    if (edge.includes("top")) {
      top += deltaY
      height -= deltaY
    }
    if (edge.includes("bottom")) height += deltaY

    if (width < this.minWindowWidth) {
      if (edge.includes("left")) left = this.activeResize.startLeft + this.activeResize.startWidth - this.minWindowWidth
      width = this.minWindowWidth
    }
    if (height < this.minWindowHeight) {
      if (edge.includes("top")) top = this.activeResize.startTop + this.activeResize.startHeight - this.minWindowHeight
      height = this.minWindowHeight
    }

    left = Math.max(this.dockLeftBoundary, left)
    top = Math.max(margin, top)

    if (left + width > vw - margin) width = vw - margin - left
    if (top + height > vh - margin) height = vh - margin - top

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
  }

  stopResize() {
    if (this.activeResize) {
      this.saveWindowBounds()
      this.emitWindowState(!this.element.classList.contains("is-hidden"))
    }
    this.activeResize = null
    document.removeEventListener("mousemove", this.boundResizeMove)
    document.removeEventListener("mouseup", this.boundResizeEnd)
    document.removeEventListener("touchmove", this.boundResizeMove)
    document.removeEventListener("touchend", this.boundResizeEnd)
  }

  positionWindow() {
    const offsetX = this.hasDefaultOffsetXValue ? this.defaultOffsetXValue : 0
    const offsetY = this.hasDefaultOffsetYValue ? this.defaultOffsetYValue : 0
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.max(this.minWindowWidth, Math.min(this.windowWidth, vw - 40))
    const height = Math.max(this.minWindowHeight, Math.min(this.windowHeight, vh - 40))
    const centeredLeft = Math.round((vw - width) / 2) + offsetX
    const centeredTop = Math.round((vh - height) / 2) + offsetY
    const maxLeft = Math.max(this.dockLeftBoundary, vw - this.viewportMargin - width)
    const maxTop = Math.max(this.viewportMargin, vh - this.viewportMargin - height)
    const left = Math.min(Math.max(centeredLeft, this.dockLeftBoundary), maxLeft)
    const top = Math.min(Math.max(centeredTop, this.viewportMargin), maxTop)

    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds()
    if (!bounds) {
      this.positionWindow()
      this.saveWindowBounds()
      return
    }

    this.applyBounds(this.clampBounds(bounds))
  }

  readStoredBounds() {
    try {
      const raw = window.localStorage.getItem(this.storageKeyValue)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (![parsed?.left, parsed?.top, parsed?.width, parsed?.height].every(Number.isFinite)) return null
      return parsed
    } catch (_error) {
      return null
    }
  }

  saveWindowBounds() {
    const rect = this.element.getBoundingClientRect()
    const bounds = this.clampBounds({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })

    try {
      window.localStorage.setItem(this.storageKeyValue, JSON.stringify(bounds))
    } catch (_error) {
      // non-blocking
    }
  }

  clampBounds(bounds) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMargin
    const maxWidth = Math.max(this.minWindowWidth, vw - this.dockLeftBoundary - margin)
    const maxHeight = Math.max(this.minWindowHeight, vh - (margin * 2))
    const width = Math.min(Math.max(bounds.width, this.minWindowWidth), maxWidth)
    const height = Math.min(Math.max(bounds.height, this.minWindowHeight), maxHeight)
    const maxLeft = Math.max(this.dockLeftBoundary, vw - margin - width)
    const maxTop = Math.max(margin, vh - margin - height)
    const left = Math.min(Math.max(bounds.left, this.dockLeftBoundary), maxLeft)
    const top = Math.min(Math.max(bounds.top, margin), maxTop)

    return { left, top, width, height }
  }

  applyBounds(bounds) {
    this.element.style.left = `${bounds.left}px`
    this.element.style.top = `${bounds.top}px`
    this.element.style.width = `${bounds.width}px`
    this.element.style.height = `${bounds.height}px`
  }

  getEdgeFromHandle(handle) {
    if (handle.classList.contains("pane-resize-handle--top-left")) return "top-left"
    if (handle.classList.contains("pane-resize-handle--top-right")) return "top-right"
    if (handle.classList.contains("pane-resize-handle--bottom-left")) return "bottom-left"
    if (handle.classList.contains("pane-resize-handle--bottom-right")) return "bottom-right"
    if (handle.classList.contains("pane-resize-handle--top")) return "top"
    if (handle.classList.contains("pane-resize-handle--right")) return "right"
    if (handle.classList.contains("pane-resize-handle--bottom")) return "bottom"
    if (handle.classList.contains("pane-resize-handle--left")) return "left"
    return "right"
  }

  bringToFront() {
    if (window.__nexusRestoringLayout) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.element.style.zIndex = String(next)
    this.emitWindowState(!this.element.classList.contains("is-hidden"))
  }

  getCoords(event) {
    if (event.touches) return { x: event.touches[0].clientX, y: event.touches[0].clientY }
    return { x: event.clientX, y: event.clientY }
  }

  emitWindowState(isOpen) {
    const rect = this.element.getBoundingClientRect()
    const z = Number.parseInt(this.element.style.zIndex || window.getComputedStyle(this.element).zIndex, 10)
    window.dispatchEvent(new CustomEvent("app-window:state", {
      detail: {
        appKey: this.appKeyValue,
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        z: Number.isFinite(z) ? z : 1500,
        url: isOpen ? this.currentUrl : null
      }
    }))
  }
}
