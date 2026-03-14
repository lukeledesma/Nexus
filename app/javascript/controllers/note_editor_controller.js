import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["title", "editor", "content", "status"]
  static values = { debounce: { type: Number, default: 400 } }

  connect() {
    this.pending = false
    this.timer = null
    this.hydrateEditor()
  }

  disconnect() {
    if (this.timer) clearTimeout(this.timer)
  }

  hydrateEditor() {
    if (!this.hasEditorTarget || !this.hasContentTarget) return
    this.editorTarget.innerHTML = this.contentTarget.value || ""
  }

  onTitleInput() {
    this.queueSave("Saving...")
  }

  onEditorInput() {
    this.syncEditorToHiddenField()
    this.queueSave("Saving...")
  }

  onPaste(event) {
    if (!this.hasEditorTarget) return

    event.preventDefault()
    const text = event.clipboardData?.getData("text/plain") || ""
    this.insertPlainTextAtCursor(text)
    this.syncEditorToHiddenField()
    this.queueSave("Saving...")
  }

  flush() {
    this.syncEditorToHiddenField()
    this.saveNow()
  }

  queueSave(statusText) {
    this.setStatus(statusText)
    this.pending = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), this.debounceValue)
  }

  syncEditorToHiddenField() {
    if (!this.hasEditorTarget || !this.hasContentTarget) return
    this.contentTarget.value = this.editorTarget.innerHTML
  }

  insertPlainTextAtCursor(text) {
    if (!text) return

    if (document.queryCommandSupported?.("insertText")) {
      document.execCommand("insertText", false, text)
      return
    }

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      this.editorTarget.appendChild(document.createTextNode(text))
      return
    }

    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  async saveNow() {
    if (!this.pending) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.pending = false
    this.syncEditorToHiddenField()

    const form = this.element
    const body = new FormData(form)
    if (!body.has("_method")) body.set("_method", "patch")

    const csrf = document.querySelector("meta[name='csrf-token']")
    if (csrf?.content && !body.has("authenticity_token")) {
      body.set("authenticity_token", csrf.content)
    }

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json",
          "X-CSRF-Token": csrf?.content || ""
        },
        credentials: "same-origin"
      })

      if (!response.ok) {
        this.setStatus("Save failed")
        return
      }

      this.setStatus("Saved")
    } catch (_error) {
      this.setStatus("Save failed")
    }
  }

  setStatus(message) {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = message
  }
}
