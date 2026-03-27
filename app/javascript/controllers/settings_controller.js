import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["window"]

  connect() {
    this.windowWidth = 300
    this.windowHeight = 200
    this.viewportMargin = 20
    this.activeDrag = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
    this.boundWindowInteraction = this.handleWindowInteraction.bind(this)

    this.positionWindow()
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
    this.windowTarget.classList.add("is-hidden")
    this.emitWindowState(false)
  }

  emitWindowState(isOpen) {
    window.dispatchEvent(new CustomEvent("settings:state", {
      detail: { open: Boolean(isOpen) }
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

    const left = Math.min(Math.max(coords.x - this.activeDrag.offsetX, margin), Math.max(margin, maxLeft))
    const top = Math.min(Math.max(coords.y - this.activeDrag.offsetY, margin), Math.max(margin, maxTop))

    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  stopDrag() {
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
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
    const width = Math.min(this.windowWidth, Math.max(260, vw - 40))
    const height = Math.min(this.windowHeight, Math.max(170, vh - 40))
    const left = Math.max(this.viewportMargin, Math.round((vw - width) / 2) - 140)
    const top = Math.max(this.viewportMargin, Math.round((vh - height) / 2) - 30)

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
}
