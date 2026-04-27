import { Controller } from "@hotwired/stimulus"
import { getDesktopSidePanelBlockEndPx, getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"

const AUTO_SCROLL_EDGE_PX = 28
const AUTO_SCROLL_MAX_STEP_PX = 22

export default class extends Controller {
  connect() {
    this.isDragging = false
    this.originX = 0
    this.originY = 0
    this.pointerClientX = 0
    this.pointerClientY = 0
    this.autoScrollFrame = null
    this.boundMouseMove = this.handleMouseMove.bind(this)
    this.boundMouseUp = this.handleMouseUp.bind(this)

    this.selectionBox = document.createElement("div")
    this.selectionBox.className = "desktop-selection-box"
    this.selectionBox.setAttribute("aria-hidden", "true")

    // Append to canvas so it scrolls with content.
    const canvas = document.getElementById("desktop-shell-canvas")
    if (canvas) {
      canvas.appendChild(this.selectionBox)
    } else {
      this.element.appendChild(this.selectionBox)
    }

    this.desktopShell = document.getElementById("desktop-shell")
    this.desktopCanvas = document.getElementById("desktop-shell-canvas")

    // Desktop background clicks now land on the scroll shell/canvas layer.
    this.element.addEventListener("mousedown", this.handleMouseDown)
    this.desktopShell?.addEventListener("mousedown", this.handleMouseDown)
    this.desktopCanvas?.addEventListener("mousedown", this.handleMouseDown)
  }

  disconnect() {
    this.element.removeEventListener("mousedown", this.handleMouseDown)
    this.desktopShell?.removeEventListener("mousedown", this.handleMouseDown)
    this.desktopCanvas?.removeEventListener("mousedown", this.handleMouseDown)
    document.removeEventListener("mousemove", this.boundMouseMove)
    document.removeEventListener("mouseup", this.boundMouseUp)
    if (this.autoScrollFrame) cancelAnimationFrame(this.autoScrollFrame)
    document.body.classList.remove("is-desktop-selecting")
    if (this.selectionBox?.parentNode) this.selectionBox.parentNode.removeChild(this.selectionBox)
  }

  handleMouseDown = (event) => {
    if (event.button !== 0) return

    const shell = document.getElementById("desktop-shell")
    const canvas = document.getElementById("desktop-shell-canvas")
    const isCanvas = event.target === canvas
    const isShell = event.target === shell || (shell && event.target === shell)
    const isDesktop = event.target === this.element

    if (!isDesktop && !isCanvas && !isShell) return
    if (event.target instanceof Element && event.target.closest("section.content-window")) return

    this.blurActiveEditableElement()
    event.preventDefault()
    if (!shell) return

    const shellRect = shell.getBoundingClientRect()
    const scrollLeft = shell.scrollLeft
    const scrollTop = shell.scrollTop

    this.pointerClientX = event.clientX
    this.pointerClientY = event.clientY
    this.originX = event.clientX - shellRect.left + scrollLeft
    this.originY = event.clientY - shellRect.top + scrollTop

    this.isDragging = true
    document.body.classList.add("is-desktop-selecting")
    this.selectionBox.style.zIndex = ""
    this.selectionBox.style.left = `${this.originX}px`
    this.selectionBox.style.top = `${this.originY}px`
    this.selectionBox.style.width = "0px"
    this.selectionBox.style.height = "0px"
    this.selectionBox.classList.add("is-visible")

    document.addEventListener("mousemove", this.boundMouseMove)
    document.addEventListener("mouseup", this.boundMouseUp)
    this.startAutoScrollLoop()
  }

  blurActiveEditableElement() {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (active === document.body) return

    const isEditable =
      active.matches("input, textarea, select") ||
      active.isContentEditable ||
      active.getAttribute("role") === "textbox"

    if (isEditable) active.blur()
  }

  handleMouseMove(event) {
    if (!this.isDragging) return
    event.preventDefault()

    this.pointerClientX = event.clientX
    this.pointerClientY = event.clientY
    this.updateSelectionBox()
  }

  updateSelectionBox() {
    const shell = document.getElementById("desktop-shell")
    if (!shell) return

    const shellRect = shell.getBoundingClientRect()
    const scrollLeft = shell.scrollLeft
    const scrollTop = shell.scrollTop
    const panelBlockEnd = getDesktopSidePanelBlockEndPx()
    const margin = getNexusDesktopShellInsetPx()

    let currentX = this.pointerClientX - shellRect.left + scrollLeft
    let currentY = this.pointerClientY - shellRect.top + scrollTop

    const minX = Math.max(margin, panelBlockEnd)
    currentX = Math.max(currentX, minX)
    currentY = Math.max(currentY, margin)

    const left = Math.min(this.originX, currentX)
    const top = Math.min(this.originY, currentY)
    const width = Math.abs(currentX - this.originX)
    const height = Math.abs(currentY - this.originY)

    this.selectionBox.style.left = `${left}px`
    this.selectionBox.style.top = `${top}px`
    this.selectionBox.style.width = `${width}px`
    this.selectionBox.style.height = `${height}px`
  }

  startAutoScrollLoop() {
    if (this.autoScrollFrame) cancelAnimationFrame(this.autoScrollFrame)

    const tick = () => {
      if (!this.isDragging) {
        this.autoScrollFrame = null
        return
      }

      this.autoScrollIfNeeded()
      this.autoScrollFrame = requestAnimationFrame(tick)
    }

    this.autoScrollFrame = requestAnimationFrame(tick)
  }

  autoScrollIfNeeded() {
    const shell = document.getElementById("desktop-shell")
    if (!shell) return

    const shellRect = shell.getBoundingClientRect()

    // Calculate actual content bounds from visible windows
    const windows = document.querySelectorAll("section.content-window.os-window:not(.is-hidden)")
    let contentMaxRight = shell.clientWidth
    let contentMaxBottom = shell.clientHeight

    windows.forEach(window => {
      const windowRect = window.getBoundingClientRect()
      const windowRightInCanvas = windowRect.right - shellRect.left + shell.scrollLeft
      const windowBottomInCanvas = windowRect.bottom - shellRect.top + shell.scrollTop
      contentMaxRight = Math.max(contentMaxRight, windowRightInCanvas)
      contentMaxBottom = Math.max(contentMaxBottom, windowBottomInCanvas)
    })

    const maxScrollLeft = Math.max(0, contentMaxRight - shell.clientWidth)
    const maxScrollTop = Math.max(0, contentMaxBottom - shell.clientHeight)

    let deltaX = 0
    let deltaY = 0

    const rightDistance = shellRect.right - this.pointerClientX
    const leftDistance = this.pointerClientX - shellRect.left
    const bottomDistance = shellRect.bottom - this.pointerClientY
    const topDistance = this.pointerClientY - shellRect.top

    if (rightDistance < AUTO_SCROLL_EDGE_PX && shell.scrollLeft < maxScrollLeft) {
      deltaX = Math.min(AUTO_SCROLL_MAX_STEP_PX, AUTO_SCROLL_EDGE_PX - rightDistance, maxScrollLeft - shell.scrollLeft)
    } else if (leftDistance < AUTO_SCROLL_EDGE_PX && shell.scrollLeft > 0) {
      deltaX = -Math.min(AUTO_SCROLL_MAX_STEP_PX, AUTO_SCROLL_EDGE_PX - leftDistance, shell.scrollLeft)
    }

    if (bottomDistance < AUTO_SCROLL_EDGE_PX && shell.scrollTop < maxScrollTop) {
      deltaY = Math.min(AUTO_SCROLL_MAX_STEP_PX, AUTO_SCROLL_EDGE_PX - bottomDistance, maxScrollTop - shell.scrollTop)
    } else if (topDistance < AUTO_SCROLL_EDGE_PX && shell.scrollTop > 0) {
      deltaY = -Math.min(AUTO_SCROLL_MAX_STEP_PX, AUTO_SCROLL_EDGE_PX - topDistance, shell.scrollTop)
    }

    if (deltaX === 0 && deltaY === 0) return

    shell.scrollLeft += deltaX
    shell.scrollTop += deltaY
    this.updateSelectionBox()
  }

  handleMouseUp() {
    if (!this.isDragging) return

    this.isDragging = false
    if (this.autoScrollFrame) {
      cancelAnimationFrame(this.autoScrollFrame)
      this.autoScrollFrame = null
    }
    this.selectionBox.classList.remove("is-visible")
    this.selectionBox.style.width = "0px"
    this.selectionBox.style.height = "0px"
    this.selectionBox.style.zIndex = ""
    document.body.classList.remove("is-desktop-selecting")

    document.removeEventListener("mousemove", this.boundMouseMove)
    document.removeEventListener("mouseup", this.boundMouseUp)
  }
}
