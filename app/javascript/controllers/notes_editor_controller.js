import { Controller } from "@hotwired/stimulus"
import {
  LINKED_APP_BEFORE_SAVE_PICKER,
  clearLinkedAppPickerDraft,
  writeLinkedAppPickerDraft
} from "lib/linked_app_picker_draft"

export default class extends Controller {
  static values = {
    frameId: String
  }

  connect() {
    this.boundBeforeSavePicker = this.handleBeforeSavePicker.bind(this)
    window.addEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
  }

  disconnect() {
    window.removeEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
  }

  handleBeforeSavePicker(event) {
    const frameId = this.frameIdValue || this.closestFrameId()
    if (!frameId || event.detail?.frameId !== frameId) return

    const noteText = (this.element.value || "").toString()
    if (!noteText.trim()) {
      clearLinkedAppPickerDraft(frameId)
      return
    }

    writeLinkedAppPickerDraft(frameId, { app: "notes", noteText })
  }

  closestFrameId() {
    return this.element.closest("turbo-frame")?.id || ""
  }
}
