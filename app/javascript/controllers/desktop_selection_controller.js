import { Controller } from "@hotwired/stimulus"

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
    this.element.appendChild(this.selectionBox)

    this.element.addEventListener("mousedown", this.handleMouseDown)
  }

  disconnect() {
    this.element.removeEventListener("mousedown", this.handleMouseDown)
    document.removeEventListener("mousemove", this.boundMouseMove)
    document.removeEventListener("mouseup", this.boundMouseUp)
    document.body.classList.remove("is-desktop-selecting")
    if (this.selectionBox?.parentNode) this.selectionBox.parentNode.removeChild(this.selectionBox)
  }

  handleMouseDown = (event) => {
    if (event.button !== 0) return
    if (event.target !== this.element) return
    event.preventDefault()

    const rect = this.element.getBoundingClientRect()
    this.originX = event.clientX - rect.left
    this.originY = event.clientY - rect.top
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

    const rect = this.element.getBoundingClientRect()
    const currentX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
    const currentY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height)

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
