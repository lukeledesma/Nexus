import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["window"]

  connect() {
    this.windowWidth = 320
    this.minimumWindowHeight = 125
    const actionCount = this.element.querySelectorAll(".settings-action").length || 1
    this.windowHeight = this.calculateCardGridWindowHeight(this.calculateGridRows(actionCount, 2))
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.activeDrag = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
    this.boundWindowInteraction = this.handleWindowInteraction.bind(this)

    this.restoreWindowBounds()
    window.addEventListener("settings:toggle", this.boundToggleRequest)
    this.windowTarget.addEventListener("mousedown", this.boundWindowInteraction)
  }

  disconnect() {
    this.stopDrag()
    window.removeEventListener("settings:toggle", this.boundToggleRequest)
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
    const z = Number.parseInt(this.windowTarget.style.zIndex || window.getComputedStyle(this.windowTarget).zIndex, 10)
    window.dispatchEvent(new CustomEvent("settings:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        z: Number.isFinite(z) ? z : 1500
      }
    }))
  }

  startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest(".settings-controls")) return

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

  resetLayout(event) {
    if (event) event.preventDefault()
    if (!window.confirm("Are you sure you want to reset the window layout?")) return
    window.dispatchEvent(new CustomEvent("nexus:layout-reset"))
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.settings.bounds")
    if (!bounds) { this.positionWindow(); return }
    this.windowTarget.style.left   = `${bounds.left}px`
    this.windowTarget.style.top    = `${bounds.top}px`
    this.windowTarget.style.width  = `${this.windowWidth}px`
    this.windowTarget.style.height = `${this.windowHeight}px`
  }

  saveWindowBounds() {
    const rect = this.windowTarget.getBoundingClientRect()
    const bounds = { left: Math.round(rect.left), top: Math.round(rect.top) }
    try { localStorage.setItem("nexus.window.settings.bounds", JSON.stringify(bounds)) } catch (_) {}
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

  positionWindow() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const defaultTop = this.viewportMargin
    const rowGap = 15
    const dbHealthHeight = 235
    const leftColumnLeft = this.dockLeftBoundary
    const width = Math.min(this.windowWidth, Math.max(260, vw - 40))
    const height = Math.min(this.windowHeight, Math.max(this.minimumWindowHeight, vh - 40))
    const desiredTop = defaultTop + dbHealthHeight + rowGap
    const left = Math.max(leftColumnLeft, Math.min(leftColumnLeft, vw - this.viewportMargin - width))
    const top = Math.max(this.viewportMargin, Math.min(desiredTop, vh - this.viewportMargin - height))

    this.windowTarget.style.width = `${width}px`
    this.windowTarget.style.height = `${height}px`
    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  bringToFront() {
    if (window.__nexusRestoringLayout) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.windowTarget.style.zIndex = String(next)
    this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
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
}
