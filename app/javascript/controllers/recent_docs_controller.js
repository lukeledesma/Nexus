import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["doc"]

  connect() {
    this.boundKeydown = this.handleKeydown.bind(this)
    this.element.addEventListener("keydown", this.boundKeydown, true)
  }

  disconnect() {
    this.element.removeEventListener("keydown", this.boundKeydown, true)
  }

  handleKeydown(e) {
    if (e.key !== "Delete" && e.key !== "Backspace") return
    const row = e.target.closest("[data-recent-docs-target='doc']")
    if (!row) return
    const url = row.dataset.deleteUrl
    if (!url) return
    e.preventDefault()
    const message = "Delete this document? This cannot be undone."
    if (!window.confirm(message)) return
    const form = document.createElement("form")
    form.method = "post"
    form.action = url
    const method = document.createElement("input")
    method.type = "hidden"
    method.name = "_method"
    method.value = "delete"
    form.appendChild(method)
    const csrf = document.querySelector("meta[name='csrf-token']")
    if (csrf) {
      const token = document.createElement("input")
      token.type = "hidden"
      token.name = "authenticity_token"
      token.value = csrf.content
      form.appendChild(token)
    }
    document.body.appendChild(form)
    form.submit()
  }
}
