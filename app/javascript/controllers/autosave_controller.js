import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { debounce: { type: Number, default: 150 } }

  connect() {
    this.boundDelegate = this.delegateSubmit.bind(this)
    this.element.addEventListener("focusout", this.boundDelegate, true)
    this.element.addEventListener("change", this.boundDelegate, true)
  }

  disconnect() {
    this.element.removeEventListener("focusout", this.boundDelegate, true)
    this.element.removeEventListener("change", this.boundDelegate, true)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }

  delegateSubmit(e) {
    const t = e.target
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) this.submit()
  }

  submit() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      const form = this.element
      if (form && form.action && form.tagName === "FORM") {
        const method = (form.getAttribute("method") || "get").toUpperCase()
        const cells = form.querySelectorAll("input.cell, select.cell")
        const wasDisabled = []
        cells.forEach((el, i) => { wasDisabled[i] = el.disabled; el.disabled = false })
        const body = new FormData(form)
        cells.forEach((el, i) => { if (wasDisabled[i]) el.disabled = true })
        if (!body.has("_method")) body.set("_method", "patch")
        const csrf = document.querySelector('meta[name="csrf-token"]')
        if (csrf && csrf.getAttribute("content") && !body.has("authenticity_token")) body.set("authenticity_token", csrf.getAttribute("content"))
        const headers = { "X-Requested-With": "XMLHttpRequest", "Accept": "text/html" }
        if (csrf && csrf.getAttribute("content")) headers["X-CSRF-Token"] = csrf.getAttribute("content")
        fetch(form.action, { method: method === "GET" ? "GET" : "POST", body: body, headers }).catch(() => {})
      }
      this.debounceTimer = null
    }, this.debounceValue)
  }
}
