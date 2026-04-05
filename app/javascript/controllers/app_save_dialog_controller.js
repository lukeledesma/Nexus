import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["layer", "filenameInput", "folderList", "folderRowTemplate", "folderEmptyHint", "fileList", "fileEmptyHint"]
  static values = {
    frameId: String,
    defaultFilename: { type: String, default: "Untitled" }
  }

  connect() {
    this.boundKeydown = this.onDocumentKeydown.bind(this)
    this.selectedFolderId = null
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundKeydown)
  }

  open(event) {
    if (event) event.preventDefault()
    if (!this.hasLayerTarget) return
    this.layerTarget.hidden = false
    this.layerTarget.classList.add("is-visible")
    if (this.hasFilenameInputTarget) {
      this.filenameInputTarget.value = this.defaultFilenameValue
      this.filenameInputTarget.focus()
      this.filenameInputTarget.select()
    }
    this.restoreFolderSelection()
    document.addEventListener("keydown", this.boundKeydown)
  }

  close() {
    if (!this.hasLayerTarget) return
    this.layerTarget.hidden = true
    this.layerTarget.classList.remove("is-visible")
    document.removeEventListener("keydown", this.boundKeydown)
  }

  cancel(event) {
    if (event) event.preventDefault()
    this.close()
  }

  backdropClick(event) {
    if (event.target === event.currentTarget) this.cancel()
  }

  onDocumentKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.cancel()
    }
  }

  filenameKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.confirmSave(event)
    }
  }

  folderListClick(event) {
    const btn = event.target.closest("button[data-folder-id]")
    if (!btn || !this.hasFolderListTarget || !this.folderListTarget.contains(btn)) return
    event.preventDefault()
    this.applyFolderSelection(btn.dataset.folderId)
  }

  fileRowClick(event) {
    const row = event.target.closest(".app-save-dialog__file-row")
    if (!row || !this.hasFileListTarget || !this.fileListTarget.contains(row)) return
    const title = row.dataset.displayTitle
    if (!title || !this.hasFilenameInputTarget) return
    this.filenameInputTarget.value = title
    this.filenameInputTarget.select()
    this.filenameInputTarget.focus()
  }

  fileRowKeydown(event) {
    if (event.key !== "Enter") return
    const row = event.target.closest(".app-save-dialog__file-row")
    if (!row || !this.hasFileListTarget || !this.fileListTarget.contains(row)) return
    event.preventDefault()
    this.fileRowClick(event)
  }

  applyFolderSelection(folderIdStr) {
    const id = parseInt(folderIdStr, 10)
    if (!Number.isFinite(id)) return
    this.selectedFolderId = id
    if (this.hasFolderListTarget) {
      this.folderListTarget.querySelectorAll(".finder-folder-item").forEach((li) => {
        li.classList.toggle("is-active", li.dataset.folderId === String(id))
      })
    }
    try {
      window.localStorage.setItem(`nexus.saveDialog.folder.${this.frameIdValue}`, String(id))
    } catch (_) {}
    void this.refreshFolderFiles()
  }

  restoreFolderSelection() {
    if (!this.hasFolderListTarget) return
    const items = this.folderListTarget.querySelectorAll(".finder-folder-item")
    if (items.length === 0) {
      this.selectedFolderId = null
      void this.refreshFolderFiles()
      return
    }
    let preferred = null
    try {
      preferred = window.localStorage.getItem(`nexus.saveDialog.folder.${this.frameIdValue}`)
    } catch (_) {}
    const preferredId = preferred ? parseInt(preferred, 10) : NaN
    const match = Number.isFinite(preferredId)
      ? this.folderListTarget.querySelector(`.finder-folder-item[data-folder-id="${preferredId}"]`)
      : null
    const first = items[0]
    const li = match || first
    const id = li?.dataset?.folderId
    if (id) this.applyFolderSelection(id)
  }

  async refreshFolderFiles() {
    if (!this.hasFileListTarget) return
    if (!this.hasFileEmptyHintTarget) return

    if (this.selectedFolderId == null || !Number.isFinite(Number(this.selectedFolderId))) {
      this.fileListTarget.innerHTML = ""
      this.fileEmptyHintTarget.hidden = false
      this.fileEmptyHintTarget.textContent = "Select a folder to see existing files."
      return
    }

    const response = await fetch(
      `/apps/finder/folder_files?folder_id=${encodeURIComponent(String(this.selectedFolderId))}`,
      { headers: { Accept: "application/json" } }
    )
    if (!response.ok) {
      this.fileListTarget.innerHTML = ""
      this.fileEmptyHintTarget.hidden = false
      this.fileEmptyHintTarget.textContent = "Could not load files."
      return
    }

    const data = await response.json().catch(() => ({}))
    const files = data.files || []
    this.fileListTarget.innerHTML = ""

    if (files.length === 0) {
      this.fileEmptyHintTarget.hidden = false
      this.fileEmptyHintTarget.textContent = "No files in this folder."
      return
    }

    this.fileEmptyHintTarget.hidden = true
    files.forEach((f) => {
      const li = document.createElement("li")
      li.className = "app-save-dialog__file-row"
      li.setAttribute("role", "listitem")
      li.tabIndex = 0
      li.dataset.displayTitle = f.display_title

      const iconWrap = document.createElement("span")
      iconWrap.className = "app-save-dialog__file-icon"
      iconWrap.setAttribute("aria-hidden", "true")
      iconWrap.innerHTML = f.icon_html || ""

      const name = document.createElement("span")
      name.className = "finder-file-name"
      name.textContent = f.display_title || ""

      li.appendChild(iconWrap)
      li.appendChild(name)
      this.fileListTarget.appendChild(li)
    })
  }

  async createFolder(event) {
    if (event) event.preventDefault()
    const response = await fetch("/apps/finder/create_folder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": this.csrfToken()
      },
      body: JSON.stringify({ frame_id: this.frameIdValue })
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(data.error || "Could not create folder.")
      return
    }
    await this.refreshFolderListFromServer()
    if (data.folder_id) this.applyFolderSelection(String(data.folder_id))
  }

  async refreshFolderListFromServer() {
    const response = await fetch("/apps/finder/folders", {
      headers: { Accept: "application/json" }
    })
    if (!response.ok) return
    const data = await response.json().catch(() => ({}))
    const folders = data.folders || []
    if (!this.hasFolderListTarget) return

    this.folderListTarget.innerHTML = ""
    if (this.hasFolderEmptyHintTarget) {
      this.folderEmptyHintTarget.hidden = folders.length > 0
    }

    if (!this.hasFolderRowTemplateTarget) {
      folders.forEach((f) => {
        const li = document.createElement("li")
        li.className = "finder-folder-item"
        li.dataset.folderId = String(f.id)
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "finder-folder-link finder-folder-link--button"
        btn.dataset.folderId = String(f.id)
        btn.setAttribute("aria-label", `Save to ${f.title}`)
        const name = document.createElement("span")
        name.className = "finder-folder-name"
        name.textContent = f.title
        btn.appendChild(name)
        li.appendChild(btn)
        this.folderListTarget.appendChild(li)
      })
      return
    }

    const tmpl = this.folderRowTemplateTarget.content.firstElementChild
    folders.forEach((f) => {
      const li = tmpl.cloneNode(true)
      li.dataset.folderId = String(f.id)
      const btn = li.querySelector("button")
      if (btn) {
        btn.dataset.folderId = String(f.id)
        const label = `Save to ${f.title}`
        btn.setAttribute("aria-label", label)
        const nameEl = li.querySelector(".finder-folder-name")
        if (nameEl) nameEl.textContent = f.title
      }
      this.folderListTarget.appendChild(li)
    })
  }

  csrfToken() {
    return document.querySelector("meta[name='csrf-token']")?.content || ""
  }

  async confirmSave(event) {
    if (event) event.preventDefault()

    const frameId = this.frameIdValue
    const folderId = this.selectedFolderId
    if (folderId == null || !Number.isFinite(Number(folderId))) {
      window.alert("Choose a folder in Finder to save into.")
      return
    }

    const filename =
      (this.hasFilenameInputTarget ? this.filenameInputTarget.value : "").trim() ||
      this.defaultFilenameValue

    const frame = document.getElementById(frameId)
    const form = frame?.querySelector("form[data-controller*='autosave']")

    if (form) {
      await new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          window.removeEventListener("nexus:item-saved", onSaved)
          resolve()
        }, 10000)
        const onSaved = () => {
          window.clearTimeout(timeout)
          window.removeEventListener("nexus:item-saved", onSaved)
          resolve()
        }
        window.addEventListener("nexus:item-saved", onSaved, { once: true })
        document.dispatchEvent(
          new CustomEvent("nexus:request-save", {
            bubbles: true,
            detail: { frameId, folderId }
          })
        )
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            form.dispatchEvent(new CustomEvent("autosave:trigger", { bubbles: true }))
          })
        })
      })
    } else if (frameId.includes("sticky-notes")) {
      await new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          document.removeEventListener("nexus:sticky-save-complete", onSticky)
          resolve()
        }, 10000)
        const onSticky = (e) => {
          if (e.detail?.frameId !== frameId) return
          window.clearTimeout(timeout)
          document.removeEventListener("nexus:sticky-save-complete", onSticky)
          resolve()
        }
        document.addEventListener("nexus:sticky-save-complete", onSticky)
        document.dispatchEvent(
          new CustomEvent("nexus:request-save", {
            bubbles: true,
            detail: { frameId, folderId }
          })
        )
      })
    } else {
      document.dispatchEvent(
        new CustomEvent("nexus:request-save", {
          bubbles: true,
          detail: { frameId, folderId }
        })
      )
    }

    let linkedDocumentId = null
    try {
      linkedDocumentId = window.sessionStorage.getItem(`nexus.singularLinkedDocument.${frameId}`)
    } catch (_) {}

    const savePayload = { folder_id: folderId, frame_id: frameId, filename }
    if (linkedDocumentId) savePayload.document_id = linkedDocumentId

    const response = await fetch("/apps/singular/save_file", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRF-Token": this.csrfToken()
      },
      body: JSON.stringify(savePayload)
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const msg =
        data.error ||
        (Array.isArray(data.errors) ? data.errors.join(", ") : data.errors) ||
        "Could not save file."
      window.alert(typeof msg === "string" ? msg : "Could not save file.")
      return
    }

    const title =
      data.display_title != null && String(data.display_title).trim() !== ""
        ? String(data.display_title).trim()
        : data.title != null
          ? String(data.title).trim()
          : ""

    window.dispatchEvent(
      new CustomEvent("nexus:singular-disk-saved", {
        detail: { frameId, documentId: data.document_id, title }
      })
    )
    try {
      window.sessionStorage.setItem(`nexus.singularLinkedDocument.${frameId}`, String(data.document_id))
    } catch (_) {}
    this.reloadFinderTurboFrame()
    this.close()
  }

  reloadFinderTurboFrame() {
    const frame = document.getElementById("finder-pane")
    if (!frame) return
    const src = frame.getAttribute("src")
    if (!src) return
    frame.removeAttribute("src")
    void frame.offsetWidth
    frame.setAttribute("src", src)
  }
}
