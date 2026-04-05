import { Controller } from "@hotwired/stimulus"

/**
 * Tracks unsaved edits in singular apps (Notepad, Tasks, Sticky Notes) for Finder navigation guard.
 * Relies on data-singular-draft-root on the turbo-frame; nexus:item-saved / nexus:singular-disk-saved clear the flag.
 */
export default class extends Controller {
  connect() {
    this.markDirty = this.markDirty.bind(this)
    this.clear = this.clear.bind(this)
    window.nexusWorkspaceUnsaved = false
    document.addEventListener("input", this.markDirty, true)
    document.addEventListener("change", this.markDirty, true)
    window.addEventListener("nexus:item-saved", this.clear)
    window.addEventListener("nexus:singular-disk-saved", this.clear)
  }

  disconnect() {
    document.removeEventListener("input", this.markDirty, true)
    document.removeEventListener("change", this.markDirty, true)
    window.removeEventListener("nexus:item-saved", this.clear)
    window.removeEventListener("nexus:singular-disk-saved", this.clear)
  }

  markDirty(event) {
    const t = event.target
    if (!t || typeof t.closest !== "function") return
    if (!t.closest("[data-singular-draft-root]")) return
    window.nexusWorkspaceUnsaved = true
  }

  clear() {
    window.nexusWorkspaceUnsaved = false
  }
}
