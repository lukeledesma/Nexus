import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["display", "input"]

  connect() {
    this.editing = false
  }

  startEdit(event) {
    event.preventDefault()
    if (this.editing) return

    const original = this.displayTarget.textContent.trim()
    this.editing = true

    const editor = document.createElement("input")
    editor.type = "text"
    editor.value = original
    editor.className = "app-inline-title-input"

    this.displayTarget.replaceWith(editor)
    editor.focus()
    editor.select()

    let settled = false
    const finish = (save) => {
      if (settled) return
      settled = true

      const nextValue = editor.value.trim() || original
      const span = document.createElement("span")
      span.dataset.titleEditorTarget = "display"
      span.textContent = save ? nextValue : original

      if (this.hasInputTarget) this.inputTarget.value = save ? nextValue : original

      if (save && this.hasInputTarget) {
        this.inputTarget.dispatchEvent(new Event("input", { bubbles: true }))
        this.inputTarget.dispatchEvent(new Event("change", { bubbles: true }))
        const form = this.inputTarget.closest("form")
        if (form) form.dispatchEvent(new Event("autosave:trigger", { bubbles: true }))
      }

      editor.replaceWith(span)
      this.editing = false
    }

    editor.addEventListener("blur", () => finish(true))
    editor.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault()
        editor.blur()
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault()
        finish(false)
      }
    })
  }
}
