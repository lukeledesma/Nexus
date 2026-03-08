import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  connect() {
    this.activeEdit = null
  }

  startInline(e) {
    e.preventDefault()
    e.stopPropagation()

    if (this.activeEdit) this.cancelActiveEdit()

    const button = e.currentTarget
    const row = button.closest("[data-recent-docs-target='doc']")
    const left = row?.querySelector(".row-left")
    const label = left?.querySelector("[data-rename-target='label']")
    const renameUrl = button.dataset.renameUrl
    if (!row || !left || !label || !renameUrl) return

    const originalName = (button.dataset.currentName || label.textContent || "").trim()
    const input = document.createElement("input")
    input.type = "text"
    input.className = "inline-rename-input"
    input.value = originalName
    input.setAttribute("aria-label", "Rename")

    label.classList.add("inline-rename-hidden")
    label.insertAdjacentElement("afterend", input)

    this.activeEdit = {
      row,
      label,
      input,
      button,
      renameUrl,
      originalName,
      committed: false,
      canceled: false
    }

    input.addEventListener("keydown", this.onInputKeydown)
    input.addEventListener("blur", this.onInputBlur)

    requestAnimationFrame(() => {
      input.focus()
      const docKind = String(button.dataset.docKind || "").trim().toLowerCase()
      const value = input.value || ""
      if (docKind === "file") {
        const lastDot = value.lastIndexOf(".")
        const hasBase = lastDot > 0
        if (hasBase) {
          input.setSelectionRange(0, lastDot)
          return
        }
      }

      // Folders (or extensionless names) keep full-name selection behavior.
      input.select()
    })
  }

  onInputKeydown = (e) => {
    if (!this.activeEdit || e.target !== this.activeEdit.input) return

    if (e.key === "Escape") {
      e.preventDefault()
      this.cancelActiveEdit()
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      this.commitActiveEdit()
      return
    }

    if (e.key === "Tab") {
      this.commitActiveEdit()
    }
  }

  onInputBlur = (e) => {
    if (!this.activeEdit || e.target !== this.activeEdit.input) return
    if (this.activeEdit.canceled || this.activeEdit.committed) return
    this.commitActiveEdit()
  }

  commitActiveEdit() {
    const edit = this.activeEdit
    if (!edit) return

    edit.committed = true
    const nextName = edit.input.value.trim()
    if (!nextName || nextName === edit.originalName) {
      this.cleanupEditor(edit)
      this.activeEdit = null
      return
    }

    // Optimistic UI update before backend confirmation.
    edit.label.textContent = nextName
    edit.button.dataset.currentName = nextName
    this.cleanupEditor(edit)
    this.activeEdit = null

    this.patchRename(edit.renameUrl, nextName, edit).catch((message) => {
      edit.label.textContent = edit.originalName
      edit.button.dataset.currentName = edit.originalName
      window.alert(message)
    })
  }

  cancelActiveEdit() {
    const edit = this.activeEdit
    if (!edit) return

    edit.canceled = true
    this.cleanupEditor(edit)
    this.activeEdit = null
  }

  cleanupEditor(edit) {
    if (!edit) return
    edit.input.removeEventListener("keydown", this.onInputKeydown)
    edit.input.removeEventListener("blur", this.onInputBlur)
    if (edit.input.isConnected) edit.input.remove()
    edit.label.classList.remove("inline-rename-hidden")
  }

  async patchRename(url, name, edit) {
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
      let resolvedName = name
      try {
        const data = await res.json()
        if (data?.name) resolvedName = String(data.name)
      } catch (_err) {}

      await this.refreshOrganizerSection(edit, resolvedName)
      return
    }

    let message = "Rename failed."
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch (_err) {}
    throw message
  }

  async refreshOrganizerSection(edit, renamedTo) {
    const organizerWrapper = document.querySelector("#organizer-wrapper[data-controller~='recent-docs']")
      || this.element.closest("#organizer-wrapper[data-controller~='recent-docs']")
    if (!organizerWrapper) return

    const recentDocs = this.recentDocsController(organizerWrapper)
    if (!recentDocs) return

    const docKind = String(edit?.button?.dataset.docKind || "").trim().toLowerCase()
    const folderRow = edit?.row?.closest("[data-folder-row='true']")
    const expandedFolderName = recentDocs.getExpandedFolderName()
    let firstRect = null
    let collapsedFolderBar = null

    if (docKind === "file" && folderRow?.dataset.folderId) {
      const fileRow = edit?.row?.closest(".organizer-row.plc-file-row")
      firstRect = fileRow?.getBoundingClientRect() || null
      await this.animateCollapse(fileRow)

      const html = await this.fetchHtml(`/documents/${folderRow.dataset.folderId}/file_list`)
      const result = recentDocs.updateFileList(folderRow.dataset.folderId, html, { suppressAppear: true })
      const fileList = result?.fileList || null
      const newFileRow = this.findFileRowForRename(fileList, renamedTo, edit?.row?.dataset?.deleteUrl)
      await this.playFileRenameFlip(newFileRow, firstRect)
      return
    }

    if (docKind === "folder") {
      collapsedFolderBar = edit?.row?.querySelector(".organizer-row.folder-toggle") || null
      firstRect = collapsedFolderBar?.getBoundingClientRect() || null
      await this.animateCollapse(collapsedFolderBar)
    }

    const html = await this.fetchHtml("/documents/organizer_fragment")
    const replaced = recentDocs.updateOrganizer(html)
    const targetContent = replaced || organizerWrapper.querySelector("#organizer-content") || document.querySelector("#organizer-content")
    const nextRecentDocs = await this.waitForRecentDocsController(organizerWrapper)
    if (!nextRecentDocs) return

    if (docKind === "folder") {
      const newFolderRow = this.findFolderRowByDataName(targetContent, renamedTo)
      await this.playFolderRenameFlip(newFolderRow, firstRect)
      nextRecentDocs.reopenFolderByName(renamedTo)
      return
    }

    if (expandedFolderName) nextRecentDocs.reopenFolderByName(expandedFolderName)
  }

  async playFileRenameFlip(newFileRow, firstRect) {
    if (!newFileRow || !firstRect) return

    const lastRect = newFileRow.getBoundingClientRect()
    const deltaY = firstRect.top - lastRect.top

    newFileRow.style.transition = "none"
    newFileRow.style.transform = `translateY(${deltaY}px)`
    newFileRow.getBoundingClientRect()

    await new Promise((resolve) => {
      const finalize = () => {
        newFileRow.removeEventListener("transitionend", onDone)
        clearTimeout(timeoutId)
        newFileRow.style.transition = ""
        newFileRow.style.transform = ""
        resolve()
      }

      const onDone = (event) => {
        if (event.propertyName && event.propertyName !== "transform") return
        finalize()
      }

      const timeoutId = setTimeout(finalize, 180)
      newFileRow.addEventListener("transitionend", onDone, { once: true })
      requestAnimationFrame(() => {
        newFileRow.style.transition = "transform 150ms ease"
        newFileRow.style.transform = "translateY(0)"
      })
    })
  }

  findFileRowForRename(fileList, name, deleteUrl) {
    if (!fileList) return null

    const normalized = String(name || "").trim()
    if (normalized) {
      const escaped = window.CSS?.escape ? window.CSS.escape(normalized) : normalized.replace(/"/g, "\\\"")
      const byName = fileList.querySelector(`.plc-file-row[data-file-name="${escaped}"]`)
      if (byName) return byName
    }

    if (deleteUrl) {
      const escapedUrl = window.CSS?.escape ? window.CSS.escape(deleteUrl) : deleteUrl.replace(/"/g, "\\\"")
      return fileList.querySelector(`.plc-file-row[data-delete-url="${escapedUrl}"]`)
    }

    return null
  }

  async playFolderRenameFlip(newFolderRow, firstRect) {
    if (!newFolderRow || !firstRect) return

    const lastRect = newFolderRow.getBoundingClientRect()
    const deltaY = firstRect.top - lastRect.top
    if (Math.abs(deltaY) < 1) return

    newFolderRow.style.transition = "none"
    newFolderRow.style.transform = `translateY(${deltaY}px)`
    newFolderRow.getBoundingClientRect()

    await new Promise((resolve) => {
      const finalize = () => {
        newFolderRow.removeEventListener("transitionend", onDone)
        clearTimeout(timeoutId)
        newFolderRow.style.transition = ""
        newFolderRow.style.transform = ""
        resolve()
      }

      const onDone = (event) => {
        if (event.propertyName && event.propertyName !== "transform") return
        finalize()
      }

      const timeoutId = setTimeout(finalize, 180)
      newFolderRow.addEventListener("transitionend", onDone, { once: true })
      requestAnimationFrame(() => {
        newFolderRow.style.transition = "transform 150ms ease"
        newFolderRow.style.transform = "translateY(0)"
      })
    })
  }

  findFolderRowByDataName(organizer, name) {
    if (!organizer) return null
    const normalized = String(name || "").trim()
    if (!normalized) return null

    const escaped = window.CSS?.escape ? window.CSS.escape(normalized) : normalized.replace(/"/g, "\\\"")
    return organizer.querySelector(`.organizer-row.folder-toggle[data-folder-name="${escaped}"]`)
  }

  async waitForRecentDocsController(element, timeoutMs = 300) {
    const start = Date.now()
    while (Date.now() - start <= timeoutMs) {
      const controller = this.recentDocsController(element)
      if (controller) return controller
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return this.recentDocsController(element)
  }

  animateCollapse(element) {
    return new Promise((resolve) => {
      if (!element || !element.isConnected) {
        resolve()
        return
      }

      const currentHeight = element.offsetHeight
      element.style.height = `${currentHeight}px`
      element.style.overflow = "hidden"
      // Force style flush so transition starts from the current rendered height.
      void element.offsetHeight
      element.classList.add("collapsing")

      const finalize = () => {
        element.removeEventListener("transitionend", onDone)
        element.removeEventListener("animationend", onDone)
        clearTimeout(timeoutId)
        resolve()
      }

      const onDone = () => finalize()
      const timeoutId = setTimeout(finalize, 220)
      element.addEventListener("transitionend", onDone, { once: true })
      element.addEventListener("animationend", onDone, { once: true })
    })
  }

  recentDocsController(element) {
    if (!element) return null
    return this.application.getControllerForElementAndIdentifier(element, "recent-docs")
  }

  async fetchHtml(url) {
    const res = await fetch(url, {
      headers: { "Accept": "text/html", "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin"
    })

    if (!res.ok) throw "Refresh failed."
    return res.text()
  }
}
