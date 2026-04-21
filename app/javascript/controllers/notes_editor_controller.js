import { Controller } from "@hotwired/stimulus"
import {
  SINGULAR_BEFORE_SAVE_PICKER,
  clearSingularPickerDraft,
  writeSingularPickerDraft
} from "lib/singular_finder_picker_draft"

export default class extends Controller {
  static values = {
    frameId: String
  }

  connect() {
    this.boundBeforeSavePicker = this.handleBeforeSavePicker.bind(this)
    window.addEventListener(SINGULAR_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    this.restoreDraft()
    this.element.addEventListener("input", this.persistDraft)
  }

  disconnect() {
    window.removeEventListener(SINGULAR_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    this.element.removeEventListener("input", this.persistDraft)
  }

  persistDraft = () => {
    const frameId = this.frameIdValue || this.closestFrameId()
    if (!frameId) return

    try {
      window.sessionStorage.setItem(`nexus.notesDraft.${frameId}`, this.element.value || "")
    } catch (_e) {
      // non-blocking
    }
  }

  restoreDraft() {
    const frameId = this.frameIdValue || this.closestFrameId()
    if (!frameId) return

    try {
      const value = window.sessionStorage.getItem(`nexus.notesDraft.${frameId}`)
      if (typeof value === "string" && value.length > 0) this.element.value = value
    } catch (_e) {
      // non-blocking
    }
  }

  handleBeforeSavePicker(event) {
    const frameId = this.frameIdValue || this.closestFrameId()
    if (!frameId || event.detail?.frameId !== frameId) return

    const noteText = (this.element.value || "").toString()
    if (!noteText.trim()) {
      clearSingularPickerDraft(frameId)
      return
    }

    writeSingularPickerDraft(frameId, { app: "notes", noteText })
  }

  closestFrameId() {
    return this.element.closest("turbo-frame")?.id || ""
  }
}
