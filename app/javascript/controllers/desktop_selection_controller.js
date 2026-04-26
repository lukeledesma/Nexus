import { Controller } from "@hotwired/stimulus"
import { getDesktopSidePanelBlockEndPx, getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"

export default class extends Controller {
  connect() {
    this.isDragging = false
    this.originX = 0
    this.originY = 0
    this.boundMouseMove = this.handleMouseMove.bind(this)
    this.boundMouseUp = this.handleMouseUp.bind(this)

    this.selectionBox = document.createElement("div")
    this.selectionBox.className = "desktop-selection-box"
    this.selectionBox.setAttribute("aria-hidden", "true")
    
    // Append to canvas so it scrolls with content
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
    document.body.classList.remove("is-desktop-selecting")
    if (this.selectionBox?.parentNode) this.selectionBox.parentNode.removeChild(this.selectionBox)
  }

  handleMouseDown = (event) => {
    if (event.button !== 0) return
    
    // Allow selection on desktop element or on shell canvas (empty space)
    const shell = document.getElementById("desktop-shell")
    const canvas = document.getElementById("desktop-shell-canvas")
    const isCanvas = event.target === canvas
    const isShell = event.target === shell || (shell && event.target === shell)
    const isDesktop = event.target === this.element
    
    if (!isDesktop && !isCanvas && !isShell) {
      return
    }
    if (event.target instanceof Element && event.target.closest("section.content-window")) {
      return
    }
    
    event.preventDefault()

    // Calculate position relative to shell (accounting for scroll)
    if (!shell) return
    
    const shellRect = shell.getBoundingClientRect()
    const scrollLeft = shell.scrollLeft
    const scrollTop = shell.scrollTop
    
    // Origin coordinates in scrollable canvas space
    this.originX = event.clientX - shellRect.left + scrollLeft
    this.originY = event.clientY - shellRect.top + scrollTop
    
    this.isDragging = true
    document.body.classList.add("is-desktop-selecting")

    this.selectionBox.style.left = `${this.originX}px`
    this.selectionBox.style.top = `${this.originY}px`
    this.selectionBox.style.width = "0px"
    this.selectionBox.style.height = "0px"
    this.selectionBox.classList.add("is-visible")
    
    document.addEventListener("mousemove", this.boundMouseMove)
    document.addEventListener("mouseup", this.boundMouseUp)
  }

  handleMouseMove(event) {
    if (!this.isDragging) return
    event.preventDefault()

    const shell = document.getElementById("desktop-shell")
    if (!shell) return
    
    const shellRect = shell.getBoundingClientRect()
    const scrollLeft = shell.scrollLeft
    const scrollTop = shell.scrollTop
    const panelBlockEnd = getDesktopSidePanelBlockEndPx()
    const margin = getNexusDesktopShellInsetPx()
    
    // Current position in scrollable canvas space
    let currentX = event.clientX - shellRect.left + scrollLeft
    let currentY = event.clientY - shellRect.top + scrollTop
    
    // Constrain to panel boundary and shell margins
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

  handleMouseUp() {
    if (!this.isDragging) return

    this.isDragging = false
    this.selectionBox.classList.remove("is-visible")
    this.selectionBox.style.width = "0px"
    this.selectionBox.style.height = "0px"
    document.body.classList.remove("is-desktop-selecting")

    document.removeEventListener("mousemove", this.boundMouseMove)
    document.removeEventListener("mouseup", this.boundMouseUp)
  }
}
