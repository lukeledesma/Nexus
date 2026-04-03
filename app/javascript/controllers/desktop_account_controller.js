import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["settingsToggle"]

  connect() {
    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.syncState(false)
  }

  disconnect() {
    window.removeEventListener("app-window:state", this.boundAppWindowState)
  }

  toggleSettings(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "settings" } }))
  }

  handleAppWindowState(event) {
    if (event?.detail?.appKey !== "settings") return
    this.syncState(Boolean(event.detail.open))
  }

  syncState(isOpen) {
    if (!this.hasSettingsToggleTarget) return
    this.settingsToggleTarget.setAttribute("aria-expanded", isOpen ? "true" : "false")
    this.settingsToggleTarget.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.settingsToggleTarget.setAttribute("aria-label", isOpen ? "Close Settings" : "Open Settings")
  }
}
