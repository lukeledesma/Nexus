import { Controller } from "@hotwired/stimulus"

/** Finder title bar: new folder at workspace root (dispatches nexus:finder-create-folder). */
export default class extends Controller {
  static targets = [ "searchToggle" ]

  static values = { frameId: { type: String, default: "finder-pane" } }

  connect() {
    this.boundSearchModeChanged = this.handleSearchModeChanged.bind(this)
    window.addEventListener("nexus:finder-search-mode-changed", this.boundSearchModeChanged)
  }

  disconnect() {
    if (this.boundSearchModeChanged) {
      window.removeEventListener("nexus:finder-search-mode-changed", this.boundSearchModeChanged)
    }
  }

  createInRoot(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(
      new CustomEvent("nexus:finder-create-folder", {
        detail: { frameId: this.frameIdValue, parentId: null }
      })
    )
  }

  toggleSearchMode(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(
      new CustomEvent("nexus:finder-toggle-search-mode", {
        detail: { frameId: this.frameIdValue }
      })
    )
  }

  handleSearchModeChanged(event) {
    if (!this.hasSearchToggleTarget) return
    const { frameId, searchMode } = event.detail || {}
    if (frameId && frameId !== this.frameIdValue) return

    const active = searchMode === true
    this.searchToggleTarget.classList.toggle("is-active", active)
    this.searchToggleTarget.setAttribute("aria-pressed", active ? "true" : "false")
    this.searchToggleTarget.title = active ? "Exit search" : "Search all files"
    this.searchToggleTarget.setAttribute("aria-label", active ? "Exit search" : "Search all files")
  }
}
