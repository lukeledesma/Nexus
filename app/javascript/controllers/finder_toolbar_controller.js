import { Controller } from "@hotwired/stimulus"

/** Title-bar actions for the Finder window (outside the turbo-frame). */
export default class extends Controller {
  static values = {
    frameId: { type: String, default: "finder-pane" }
  }

  createFolder(event) {
    if (event) event.preventDefault()
    window.dispatchEvent(
      new CustomEvent("nexus:finder-create-folder", {
        detail: { frameId: this.frameIdValue }
      })
    )
  }
}
