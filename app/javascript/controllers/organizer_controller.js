import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static targets = ["newFolderForm", "newFolderInput"]

  toggleNewFolder(event) {
    event.stopPropagation()
    const form = this.newFolderFormTarget
    if (form.classList.contains("hidden")) {
      form.classList.remove("hidden")
      this.newFolderInputTarget.value = ""
      this.newFolderInputTarget.focus()
      this.newFolderInputTarget.select()
    } else {
      form.classList.add("hidden")
      this.newFolderInputTarget.value = ""
    }
  }

  newFolderKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.newFolderFormTarget.classList.add("hidden")
      this.newFolderInputTarget.value = ""
    }
  }

  async submitNewFolder(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const resp = await fetch(form.action, {
      method: "POST",
      headers: { "Accept": "application/json", "X-CSRF-Token": this.#csrf() },
      body: data
    })

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}))
      alert(json.errors?.join(", ") || "Could not create folder.")
      return
    }

    this.newFolderFormTarget.classList.add("hidden")
    this.newFolderInputTarget.value = ""
    Turbo.visit("/")
  }

  renameFolder(event) {
    event.preventDefault()
    event.stopPropagation()
    const btn = event.currentTarget.closest(".finder-item")
    const label = btn.querySelector(".finder-item-label")
    const folderId = btn.dataset.folderId
    const original = label.textContent.trim()

    btn.disabled = true
    this.#inlineInput(original, label, {
      onSave: (newName) => {
        btn.disabled = false
        if (newName !== original) {
          this.#patch(`/apps/folders/${folderId}`, { folder: { name: newName } })
        }
      },
      onCancel: () => { btn.disabled = false }
    })
  }

  async deleteFolder(event) {
    event.preventDefault()
    event.stopPropagation()
    const btn = event.currentTarget.closest(".finder-item")
    const folderId = btn.dataset.folderId
    const name = btn.querySelector(".finder-item-label").textContent.trim()

    if (!confirm(`Delete "${name}" and all its items?`)) return

    await this.#delete(`/apps/folders/${folderId}`)
    Turbo.visit("/")
  }

  #inlineInput(value, node, { onSave, onCancel }) {
    const input = document.createElement("input")
    input.type = "text"
    input.value = value
    input.className = "finder-rename-input"
    node.replaceWith(input)
    input.focus()
    input.select()

    let settled = false
    const finish = (save) => {
      if (settled) return
      settled = true
      const newVal = input.value.trim() || value
      node.textContent = newVal
      input.replaceWith(node)
      if (save) onSave(newVal)
      else onCancel()
    }

    input.addEventListener("blur", () => finish(true))
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault()
        input.blur()
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault()
        settled = true
        node.textContent = value
        input.replaceWith(node)
        onCancel()
      }
    })
  }

  #csrf() {
    return document.querySelector("meta[name='csrf-token']")?.content
  }

  async #patch(path, body) {
    const response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": this.#csrf() },
      body: JSON.stringify(body)
    })

    if (!response.ok) return null
    return response.json().catch(() => ({}))
  }

  async #delete(path) {
    const response = await fetch(path, { method: "DELETE", headers: { "X-CSRF-Token": this.#csrf() } })
    return response.ok
  }
}
