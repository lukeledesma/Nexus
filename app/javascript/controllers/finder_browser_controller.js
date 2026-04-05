import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

const CONTENT_TYPE_TO_APP_KEY = {
  note: "singular-note",
  task_list: "singular-task-list",
  stickynotes: "singular-sticky-notes"
}

const SINGULAR_FRAME_ID_BY_APP = {
  "singular-note": "singular-note-pane",
  "singular-task-list": "singular-task-list-pane",
  "singular-sticky-notes": "singular-sticky-notes-pane"
}

function finderDisplayTitleFromStorageName(title) {
  const s = String(title || "").trim()
  if (!s) return "Untitled"
  return s.replace(/\.(txt|nexus)$/i, "").trim() || "Untitled"
}

export default class extends Controller {
  static values = {
    frameId: String
  }

  connect() {
    this.boundChromeCreateFolder = (e) => {
      if (e.detail?.frameId !== (this.frameIdValue || "app-pane")) return
      this.createFolder(e)
    }
    window.addEventListener("nexus:finder-create-folder", this.boundChromeCreateFolder)

    const autoRenameItem = this.element.querySelector(".finder-folder-item[data-auto-rename='true']")
    if (autoRenameItem && autoRenameItem.dataset.systemFolder !== "true") this.startInlineRename(autoRenameItem)
  }

  disconnect() {
    if (this.boundChromeCreateFolder) {
      window.removeEventListener("nexus:finder-create-folder", this.boundChromeCreateFolder)
    }
  }

  onFinderFileRowKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    this.openFinderFile(event)
  }

  /** Whole row opens the file (same idea as Tasks); action buttons opt out. */
  onFinderFileRowClick(event) {
    if (event.target.closest(".item-action-btn")) return
    this.openFinderFile(event)
  }

  /** Finder file rows launch Notepad / Tasks / Sticky Notes with this document loaded — not the generic document editor. */
  openFinderFile(event) {
    event.preventDefault()

    if (window.nexusWorkspaceUnsaved) {
      const proceed = window.confirm(
        "You have unsaved changes in Notepad, Tasks, or Sticky Notes. Save from the app’s Save dialog first if you want those changes on disk.\n\nOpen this file anyway? Unsaved edits may be lost if you continue."
      )
      if (!proceed) return
      window.nexusWorkspaceUnsaved = false
    }

    const item = event.currentTarget.closest(".finder-file-item")
    if (!item) return
    if (item.querySelector(".finder-file-name-input")) return

    const documentId = item.dataset.documentId
    const contentType = item.dataset.contentType
    if (!documentId || !contentType) return

    const appKey = CONTENT_TYPE_TO_APP_KEY[contentType]
    if (!appKey) {
      window.alert("This file type does not have a linked app.")
      return
    }

    this.element.querySelectorAll(".finder-file-item.is-selected").forEach((el) => {
      el.classList.remove("is-selected")
    })
    item.classList.add("is-selected")

    const paneId = SINGULAR_FRAME_ID_BY_APP[appKey]
    if (paneId) {
      try {
        window.sessionStorage.setItem(`nexus.singularLinkedDocument.${paneId}`, String(documentId))
      } catch (_) {}
    }

    const documentTitle = (item.dataset.documentTitle || "").trim()

    window.dispatchEvent(
      new CustomEvent("app-window:open", {
        detail: {
          appKey,
          documentId: String(documentId),
          documentTitle
        }
      })
    )
  }

  renameFile(event) {
    event.preventDefault()
    event.stopPropagation()

    const item = event.currentTarget.closest(".finder-file-item")
    if (!item) return

    this.startInlineFileRename(item)
  }

  startInlineFileRename(item) {
    if (!item) return

    const renameUrl = item.dataset.renameUrl
    if (!renameUrl) return

    const label = item.querySelector("[data-finder-file-name-label]")
    if (!label) return

    if (item.querySelector(".finder-file-name-input")) return

    const currentStorageName = item.dataset.fileName || ""
    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-file-name-input"
    input.value = finderDisplayTitleFromStorageName(currentStorageName)
    input.maxLength = 255

    label.replaceWith(input)
    input.focus()
    input.select()

    const cancelEdit = () => {
      input.replaceWith(label)
      label.textContent = item.dataset.documentTitle || finderDisplayTitleFromStorageName(currentStorageName)
    }

    const saveEdit = async () => {
      const trimmedName = input.value.trim()
      if (!trimmedName || trimmedName === finderDisplayTitleFromStorageName(currentStorageName)) {
        cancelEdit()
        return
      }

      const response = await fetch(renameUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-CSRF-Token": this.csrfToken()
        },
        body: JSON.stringify({ name: trimmedName })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        window.alert(payload.error || "Could not rename file.")
        cancelEdit()
        return
      }

      await response.json().catch(() => ({}))
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

  async deleteFile(event) {
    event.preventDefault()
    event.stopPropagation()

    const item = event.currentTarget.closest(".finder-file-item")
    if (!item) return

    const deleteUrl = item.dataset.deleteUrl
    if (!deleteUrl) return

    const name = item.dataset.documentTitle || "this file"
    if (!window.confirm(`Delete \"${name}\"?`)) return

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": this.csrfToken()
      }
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not delete file.")
      return
    }

    this.reloadFrameWithSelection()
  }

  async createFolder(event) {
    if (event?.preventDefault) event.preventDefault()
    const frameId = this.frameIdValue || "app-pane"
    const response = await fetch("/apps/finder/create_folder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": this.csrfToken()
      },
      body: JSON.stringify({ frame_id: frameId })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(data.error || "Could not create folder.")
      return
    }
    if (data.redirect_url) {
      const frame = document.getElementById(frameId)
      if (frame && frame.tagName === "TURBO-FRAME") {
        frame.src = data.redirect_url
        return
      }
      Turbo.visit(data.redirect_url, { frame: frameId })
    }
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
    if (item.dataset.systemFolder === "true") return

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
    if (item.dataset.systemFolder === "true") return

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
