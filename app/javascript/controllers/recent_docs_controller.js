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
    const csrf = document.querySelector("meta[name='csrf-token']")
    const headers = { "X-CSRF-Token": csrf?.content || "", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }
    fetch(url, { method: "DELETE", headers, credentials: "same-origin" }).then((res) => {
      if (res.ok) {
        row.classList.remove("doc-row--just-imported")
        row.classList.add("doc-row--deleting")
        const onDone = (e) => {
          if (e.animationName !== "doc-row-delete-poof") return
          row.removeEventListener("animationend", onDone)
          row.remove()
          if (this.element.querySelectorAll("[data-recent-docs-target='doc']").length === 0) {
            const wrapper = document.createElement("div")
            wrapper.className = "recent-docs__content"
            while (this.element.firstChild) wrapper.appendChild(this.element.firstChild)
            this.element.appendChild(wrapper)
            wrapper.classList.add("recent-docs__content--fade-out")
            const showEmpty = () => {
              wrapper.removeEventListener("animationend", showEmpty)
              const parent = this.element.parentNode
              const p = document.createElement("p")
              p.className = "empty-state empty-state--fade-in"
              p.innerHTML = "No documents yet. Use <strong>Import</strong> or <strong>New</strong> to get started."
              parent.replaceChild(p, this.element)
            }
            wrapper.addEventListener("animationend", showEmpty, { once: true })
          }
        }
        row.addEventListener("animationend", onDone, { once: true })
      } else {
        window.location.reload()
      }
    }).catch(() => window.location.reload())
  }
}
