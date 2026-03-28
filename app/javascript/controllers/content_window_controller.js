import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    this.currentUrl = null
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.windowWidth = 550
    this.windowHeight = 480
    this.minWindowWidth = 320
    this.minWindowHeight = 200
    this.activeDrag = null
    this.activeResize = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundResizeMove = this.handleResizeMove.bind(this)
    this.boundResizeEnd = this.stopResize.bind(this)
    this.boundOpen = this.handleOpenRequest.bind(this)

    window.addEventListener("content-window:open", this.boundOpen)
    this.element.addEventListener("mousedown", () => this.bringToFront())

    this.positionWindow()
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    window.removeEventListener("content-window:open", this.boundOpen)
  }

  handleOpenRequest(event) {
    const url = event.detail?.url
    if (!url) return

    // Toggle closed if same app is already showing
    if (!this.element.classList.contains("is-hidden") && this.currentUrl === url) {
      this.close()
      return
    }

    this.loadUrl(url)
    this.open()
  }

  loadUrl(url) {
    this.currentUrl = url
    const frame = this.element.querySelector("turbo-frame#app-pane")
    if (frame) frame.src = url
  }

  open() {
    this.positionWindow()
    this.element.classList.remove("is-hidden")
    this.bringToFront()
  }

  close() {
    this.element.classList.add("is-hidden")
  }

  // ── Drag ──────────────────────────────────────────────────────────────────

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
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

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
    if (edge.includes("right")) {
      width += deltaX
    }
    if (edge.includes("top")) {
      top += deltaY
      height -= deltaY
    }
    if (edge.includes("bottom")) {
      height += deltaY
    }

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
    this.activeResize = null
    document.removeEventListener("mousemove", this.boundResizeMove)
    document.removeEventListener("mouseup", this.boundResizeEnd)
    document.removeEventListener("touchmove", this.boundResizeMove)
    document.removeEventListener("touchend", this.boundResizeEnd)
  }

  // ── Position & z-index ────────────────────────────────────────────────────

  positionWindow() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(this.windowWidth, vw - 40)
    const height = Math.min(this.windowHeight, vh - 40)
    const left = Math.max(this.dockLeftBoundary, Math.round((vw - width) / 2))
    const top = Math.max(this.viewportMargin, Math.round((vh - height) / 2))

    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
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
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.element.style.zIndex = String(next)
  }

  getCoords(event) {
    if (event.touches) return { x: event.touches[0].clientX, y: event.touches[0].clientY }
    return { x: event.clientX, y: event.clientY }
  }
}
