import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static values = {
    frameId: String
  }

  connect() {
    const autoRenameItem = this.element.querySelector(".finder-folder-item[data-auto-rename='true']")
    if (autoRenameItem) this.startInlineRename(autoRenameItem)
  }

  async renameFolder(event) {
    event.preventDefault()
    event.stopPropagation()

    const item = event.currentTarget.closest(".finder-folder-item")
    if (!item) return

    this.startInlineRename(item)
  }

  startInlineRename(item) {
    if (!item) return

    const renameUrl = item.dataset.renameUrl
    if (!renameUrl) return

    const label = item.querySelector("[data-folder-name-label]")
    if (!label) return

    if (item.querySelector(".finder-folder-name-input")) return

    const currentName = item.dataset.folderName || label.textContent || ""
    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input"
    input.value = currentName
    input.maxLength = 255

    label.replaceWith(input)
    input.focus()
    input.select()

    const cancelEdit = () => {
      input.replaceWith(label)
      label.textContent = currentName
    }

    const saveEdit = async () => {
      const trimmedName = input.value.trim()
      if (!trimmedName || trimmedName === currentName) {
        cancelEdit()
        return
      }

      const response = await fetch(renameUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": this.csrfToken()
        },
        body: JSON.stringify({ name: trimmedName })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        window.alert(payload.error || "Could not rename folder.")
        cancelEdit()
        return
      }

      item.dataset.folderName = trimmedName
      this.reloadFrameWithSelection()
    }

    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault()
        saveEdit()
      }

      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault()
        cancelEdit()
      }
    })

    input.addEventListener("blur", () => {
      saveEdit()
    })
  }

  async deleteFolder(event) {
    event.preventDefault()
    event.stopPropagation()

    const item = event.currentTarget.closest(".finder-folder-item")
    if (!item) return

    const deleteUrl = item.dataset.deleteUrl
    if (!deleteUrl) return

    const name = item.dataset.folderName || "this folder"
    if (!window.confirm(`Delete \"${name}\" and all of its items?`)) return

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": this.csrfToken()
      }
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not delete folder.")
      return
    }

    this.reloadFrameAfterDelete(item)
  }

  reloadFrameWithSelection() {
    const frameId = this.frameIdValue || "app-pane"
    const activeOpenButton = this.element.querySelector(".finder-folder-item.is-active .finder-folder-link")
    const activeUrl = activeOpenButton?.getAttribute("href")
    const fallbackButton = this.element.querySelector(".finder-folder-link")
    const nextUrl = activeUrl || fallbackButton?.getAttribute("href") || `/apps/finder?frame_id=${encodeURIComponent(frameId)}`
    const frame = document.getElementById(frameId)
    if (frame && frame.tagName === "TURBO-FRAME") {
      frame.src = nextUrl
      return
    }

    Turbo.visit(nextUrl, { frame: frameId })
  }

  reloadFrameAfterDelete(deletedItem) {
    const frameId = this.frameIdValue || "app-pane"
    const candidates = Array.from(this.element.querySelectorAll(".finder-folder-link"))
    const nextButton = candidates.find((link) => link.closest(".finder-folder-item") !== deletedItem)
    const nextUrl = nextButton?.getAttribute("href") || `/apps/finder?frame_id=${encodeURIComponent(frameId)}`
    const frame = document.getElementById(frameId)
    if (frame && frame.tagName === "TURBO-FRAME") {
      frame.src = nextUrl
      return
    }

    Turbo.visit(nextUrl, { frame: frameId })
  }

  csrfToken() {
    return document.querySelector("meta[name='csrf-token']")?.content || ""
  }
}
