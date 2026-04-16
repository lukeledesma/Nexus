import { Controller } from "@hotwired/stimulus"

/** Finder title bar: new folder at workspace root (dispatches nexus:finder-create-folder). */
export default class extends Controller {
  static values = { frameId: { type: String, default: "finder-pane" } }

  createInRoot(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(
      new CustomEvent("nexus:finder-create-folder", {
        detail: { frameId: this.frameIdValue, parentId: null }
      })
    )
  }
}
