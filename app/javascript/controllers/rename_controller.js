import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["modalBackdrop", "modal", "modalTitle", "modalInput", "modalSave", "modalDelete"]

  connect() {
    this.activeContext = null
    this.boundKeydown = this.handleKeydown.bind(this)
    this.boundInput = this.handleInput.bind(this)
    document.addEventListener("keydown", this.boundKeydown)
    if (this.hasModalInputTarget) this.modalInputTarget.addEventListener("input", this.boundInput)
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundKeydown)
    if (this.hasModalInputTarget) this.modalInputTarget.removeEventListener("input", this.boundInput)
  }

  openModal(e) {
    e.preventDefault()
    e.stopPropagation()

    const button = e.currentTarget
    const name = String(button.dataset.currentName || "").trim()
    const renameUrl = button.dataset.renameUrl
    const deleteUrl = button.dataset.deleteUrl
    const docKind = String(button.dataset.docKind || "file").trim().toLowerCase()
    const folderRow = button.closest("[data-folder-row='true']")
    const folderId = String(folderRow?.dataset?.folderId || "").trim()

    if (!renameUrl || !deleteUrl) return

    this.activeContext = { name, renameUrl, deleteUrl, docKind, folderId }
    this.modalTitleTarget.textContent = docKind === "folder" ? "Edit Folder" : "Edit Note"
    this.modalInputTarget.value = name
    this.updateNameValidity()
    this.open()
  }

  closeModal(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    this.close()
  }

  clickBackdrop(e) {
    if (e.target !== this.modalBackdropTarget) return
    this.close()
  }

  async save(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (!this.activeContext) return

    const nextName = this.modalInputTarget.value.trim()
    const currentName = this.activeContext.name
    if (!nextName) {
      window.alert("Name cannot be blank")
      return
    }
    if (this.startsWithDot(nextName)) {
      this.updateNameValidity()
      return
    }

    if (nextName === currentName) {
      this.close()
      return
    }

    this.setBusy(true)
    try {
      const activeContext = this.activeContext
      const folderWasOpen = this.folderWasOpen(activeContext.folderId)
      const moveFirstRect = this.folderFirstRect(activeContext.folderId)
      const resolvedName = await this.patchRename(activeContext.renameUrl, nextName)
      this.close()
      await this.refreshOrganizer({
        renamedTo: resolvedName || nextName,
        docKind: activeContext.docKind,
        folderId: activeContext.folderId,
        folderWasOpen,
        moveFirstRect
      })
    } catch (message) {
      window.alert(message)
    } finally {
      this.setBusy(false)
    }
  }

  async remove(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    if (!this.activeContext) return

    this.setBusy(true)
    try {
      await this.deleteItem(this.activeContext.deleteUrl)
      this.close()
      await this.refreshOrganizer()
    } catch (message) {
      window.alert(message)
    } finally {
      this.setBusy(false)
    }
  }

  handleKeydown(e) {
    if (!this.modalBackdropTarget || this.modalBackdropTarget.classList.contains("hidden")) return

    if (e.key === "Escape") {
      e.preventDefault()
      this.close()
      return
    }

    if (e.key === "Enter") {
      const targetTag = String(e.target?.tagName || "").toLowerCase()
      if (targetTag === "button") return
      e.preventDefault()
      this.save()
    }
  }

  open() {
    this.modalBackdropTarget.classList.remove("hidden")
    this.modalBackdropTarget.setAttribute("aria-hidden", "false")
    requestAnimationFrame(() => {
      this.modalInputTarget.focus()
      const end = this.defaultSelectionEnd(this.modalInputTarget.value, this.activeContext?.docKind)
      this.modalInputTarget.setSelectionRange(0, end)
    })
  }

  close() {
    this.activeContext = null
    this.modalBackdropTarget.classList.add("hidden")
    this.modalBackdropTarget.setAttribute("aria-hidden", "true")
  }

  setBusy(busy) {
    this.modalSaveTarget.disabled = busy || this.invalidName
    this.modalDeleteTarget.disabled = busy
  }

  handleInput() {
    this.updateNameValidity()
  }

  defaultSelectionEnd(name, docKind) {
    const text = String(name || "")
    if (docKind !== "file") return text.length
    const dotIndex = text.lastIndexOf(".")
    if (dotIndex <= 0) return text.length
    return dotIndex
  }

  startsWithDot(name) {
    return String(name || "").trim().startsWith(".")
  }

  updateNameValidity() {
    const value = this.modalInputTarget.value
    const invalid = this.startsWithDot(value)
    this.invalidName = invalid
    this.modalInputTarget.classList.toggle("cell-invalid", invalid)
    this.modalSaveTarget.disabled = invalid
  }

  async patchRename(url, name) {
    const csrf = document.querySelector("meta[name='csrf-token']")
    const headers = {
      "X-CSRF-Token": csrf?.content || "",
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    }

    const res = await fetch(url, {
      method: "PATCH",
      headers,
      credentials: "same-origin",
      body: JSON.stringify({ name })
    })

    if (res.ok) {
      try {
        const data = await res.json()
        return String(data?.name || name)
      } catch (_) {
        return name
      }
    }

    let message = "Rename failed."
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch (_) {}
    throw message
  }

  async deleteItem(url) {
    const csrf = document.querySelector("meta[name='csrf-token']")
    const headers = {
      "X-CSRF-Token": csrf?.content || "",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    }

    const res = await fetch(url, {
      method: "DELETE",
      headers,
      credentials: "same-origin"
    })

    if (res.ok) return
    throw "Delete failed."
  }

  async refreshOrganizer(options = {}) {
    const docKind = String(options.docKind || "").trim().toLowerCase()
    const folderId = String(options.folderId || "").trim()
    const folderWasOpen = !!options.folderWasOpen
    const moveFirstRect = options.moveFirstRect || null
    const organizerWrapper = document.querySelector("#organizer-wrapper[data-controller~='recent-docs']")
    if (!organizerWrapper) {
      window.location.reload()
      return
    }

    const currentRecentDocs = this.application.getControllerForElementAndIdentifier(organizerWrapper, "recent-docs")
    const folderStates = this.captureFolderStates(currentRecentDocs)
    if (docKind === "folder" && folderId) folderStates.set(folderId, folderWasOpen)

    const res = await fetch("/documents/organizer_fragment", {
      headers: { "Accept": "text/html", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin"
    })
    if (!res.ok) {
      window.location.reload()
      return
    }

    const html = await res.text()
    const recentDocs = this.application.getControllerForElementAndIdentifier(organizerWrapper, "recent-docs")
    if (recentDocs && typeof recentDocs.updateOrganizer === "function") {
      recentDocs.updateOrganizer(html)
      this.restoreFolderStates(recentDocs, folderStates)
      if (docKind === "folder" && folderId && moveFirstRect) {
        this.animateFolderMoveFlip(recentDocs, folderId, moveFirstRect)
      }
      return
    }

    const content = organizerWrapper.querySelector("#organizer-content")
    if (content) content.innerHTML = html
  }

  folderRowById(folderId, scope = document) {
    if (!folderId) return null
    return scope.querySelector(`[data-folder-row='true'][data-folder-id='${folderId}']`)
  }

  folderWasOpen(folderId) {
    const row = this.folderRowById(folderId)
    return !!row && row.dataset.expanded === "true"
  }

  folderFirstRect(folderId) {
    const row = this.folderRowById(folderId)
    return row ? row.getBoundingClientRect() : null
  }

  captureFolderStates(recentDocs) {
    const states = new Map()
    if (!recentDocs?.element) return states

    recentDocs.element.querySelectorAll("[data-folder-row='true']").forEach((row) => {
      const id = String(row.dataset.folderId || "").trim()
      if (!id) return
      states.set(id, row.dataset.expanded === "true")
    })
    return states
  }

  restoreFolderStates(recentDocs, states) {
    if (!recentDocs?.element || !states || typeof recentDocs.setFolderExpanded !== "function") return

    recentDocs.element.querySelectorAll("[data-folder-row='true']").forEach((row) => {
      const id = String(row.dataset.folderId || "").trim()
      if (!id || !states.has(id)) return
      recentDocs.setFolderExpanded(row, !!states.get(id), false)
    })
  }

  animateFolderMoveFlip(recentDocs, folderId, firstRect) {
    const row = this.folderRowById(folderId, recentDocs?.element)
    if (!row || !firstRect) return

    const lastRect = row.getBoundingClientRect()
    const deltaX = firstRect.left - lastRect.left
    const deltaY = firstRect.top - lastRect.top
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return

    row.style.transition = "none"
    row.style.transform = `translate(${deltaX}px, ${deltaY}px)`
    row.getBoundingClientRect()

    requestAnimationFrame(() => {
      row.style.transition = "transform 180ms ease"
      row.style.transform = "translate(0, 0)"

      const cleanup = () => {
        row.removeEventListener("transitionend", onDone)
        clearTimeout(timeoutId)
        row.style.transition = ""
        row.style.transform = ""
      }

      const onDone = (event) => {
        if (event.propertyName && event.propertyName !== "transform") return
        cleanup()
      }

      const timeoutId = setTimeout(cleanup, 260)
      row.addEventListener("transitionend", onDone, { once: true })
    })
  }
}
