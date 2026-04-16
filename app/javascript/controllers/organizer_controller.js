import { Controller } from "@hotwired/stimulus"

/** App launcher rows (side panel): toggle windows + reflect `app-window:state`. */
export default class extends Controller {
  connect() {
    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.clearRowActiveState()
  }

  disconnect() {
    window.removeEventListener("app-window:state", this.boundAppWindowState)
  }

  launchApp(event) {
    const appKey = event.currentTarget.dataset.windowKey
    if (!appKey) {
      return
    }
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
  }

  handleAppWindowState(event) {
    this.updateRowState(event.detail?.appKey, Boolean(event.detail?.open))
  }

  updateRowState(appKey, isOpen) {
    if (!appKey) return
    const button = this.element.querySelector(`[data-window-key="${appKey}"]`)
    if (!button) return
    button.classList.toggle("is-active", isOpen)
    button.setAttribute("aria-pressed", isOpen ? "true" : "false")
  }

  clearRowActiveState() {
    this.element.querySelectorAll("[data-window-key]").forEach((button) => {
      button.classList.remove("is-active")
      button.setAttribute("aria-pressed", "false")
    })
  }
}
