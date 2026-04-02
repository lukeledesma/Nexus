import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["container", "stateInput"]
  static values = {
    initialState: { type: String, default: "" }
  }

  connect() {
    this.syncTimer = null
    this.isHydrating = true

    if (!this.hasContainerTarget || !this.hasStateInputTarget) return

    const initialState = (this.initialStateValue || this.stateInputTarget.value || "").toString()
    const parsedState = this.parseState(initialState)

    // Create iframe to load Excalidraw web version
    const iframe = document.createElement("iframe")
    iframe.style.width = "100%"
    iframe.style.height = "100%"
    iframe.style.border = "none"
    iframe.style.display = "block"
    iframe.src = "https://excalidraw.com/"
    
    this.containerTarget.appendChild(iframe)

    // Store reference for later
    this.iframeElement = iframe
    this.isHydrating = false
  }

  disconnect() {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer)
      this.syncTimer = null
    }
  }

  parseState(stateJson) {
    if (!stateJson || stateJson.trim() === "") {
      return {
        elements: [],
        appState: {},
        files: {}
      }
    }

    try {
      const parsed = JSON.parse(stateJson)
      return {
        elements: Array.isArray(parsed.elements) ? parsed.elements : [],
        appState: parsed.appState || {},
        files: parsed.files || {}
      }
    } catch (_) {
      return {
        elements: [],
        appState: {},
        files: {}
      }
    }
  }
}
