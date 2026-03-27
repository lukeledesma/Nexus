import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["sunToggle", "userChip", "overlay"]

  connect() {
    this.boundHandleEscape = this.handleEscape.bind(this)
    document.addEventListener("keydown", this.boundHandleEscape)
    this.syncSunState(false)
    this.closePanel()
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundHandleEscape)
  }

  toggleName() {
    const willOpen = !this.element.classList.contains("is-name-open")
    this.element.classList.toggle("is-name-open", willOpen)
    this.syncSunState(willOpen)

    if (!willOpen) this.closePanel()
  }

  openPanel() {
    if (!this.element.classList.contains("is-name-open")) return
    if (!this.hasOverlayTarget) return

    this.overlayTarget.classList.remove("hidden")
  }

  closePanel() {
    if (!this.hasOverlayTarget) return
    this.overlayTarget.classList.add("hidden")
  }

  backdropClick(event) {
    if (event.target !== this.overlayTarget) return
    this.closePanel()
  }

  handleEscape(event) {
    if (event.key !== "Escape") return

    if (this.hasOverlayTarget && !this.overlayTarget.classList.contains("hidden")) {
      this.closePanel()
      return
    }

    if (this.element.classList.contains("is-name-open")) {
      this.element.classList.remove("is-name-open")
      this.syncSunState(false)
    }
  }

  syncSunState(isOpen) {
    if (!this.hasSunToggleTarget) return
    this.sunToggleTarget.setAttribute("aria-expanded", isOpen ? "true" : "false")
  }
}
