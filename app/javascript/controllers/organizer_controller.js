import { Controller } from "@hotwired/stimulus"

/** App launcher rows (side panel): toggle windows + reflect `app-window:state`. */
export default class extends Controller {
  connect() {
    console.log("[organizer] controller connecting")
    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.clearRowActiveState()
    console.log("[organizer] controller connected, listening for app-window:state")
  }

  disconnect() {
    window.removeEventListener("app-window:state", this.boundAppWindowState)
  }

  launchApp(event) {
    const appKey = event.currentTarget.dataset.windowKey
    console.log("[organizer] launchApp clicked:", appKey)
    if (!appKey) {
      console.log("[organizer] ERROR: no appKey found on button")
      return
    }
    console.log("[organizer] Dispatching app-window:toggle for:", appKey)
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
