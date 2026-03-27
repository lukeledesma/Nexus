import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["settingsToggle"]

  connect() {
    this.boundSettingsState = this.handleSettingsState.bind(this)
    window.addEventListener("settings:state", this.boundSettingsState)
    this.syncState(false)
  }

  disconnect() {
    window.removeEventListener("settings:state", this.boundSettingsState)
  }

  toggleSettings(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(new CustomEvent("settings:toggle"))
  }

  handleSettingsState(event) {
    const isOpen = Boolean(event?.detail?.open)
    this.syncState(isOpen)
  }

  syncState(isOpen) {
    if (!this.hasSettingsToggleTarget) return
    this.settingsToggleTarget.setAttribute("aria-expanded", isOpen ? "true" : "false")
    this.settingsToggleTarget.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.settingsToggleTarget.setAttribute("aria-label", isOpen ? "Close Settings" : "Open Settings")
  }
}
