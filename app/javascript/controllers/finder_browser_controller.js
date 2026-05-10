import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"
import {
  finderApiHeaders,
  finderCollectExpandedFolderIdsFromDom,
  finderCsrfToken,
  finderReadExpandedFolderIds,
  finderSanitizeDocumentId,
  finderWriteExpandedFolderIds
} from "lib/finder"
import { materialSymbolSvg } from "lib/material_symbols"
import { dispatchLinkedAppHostEvent, linkedAppHostWindow } from "lib/linked_app_host_events"
import { readLinkedAppPickerDraft } from "lib/linked_app_picker_draft"

function appKeyForLinkedFile(contentType, fileKind, sectionKey = "") {
  const ct = String(contentType || "").toLowerCase()
  const kind = String(fileKind || "").toLowerCase()
  const section = String(sectionKey || "").toLowerCase()
  if (ct === "note") return section === "time_card" ? "time-card" : "notes"
  if (ct === "task_list") return "tasks"
  if (ct !== "asset") return null
  if (kind === "image") return "images"
  if (kind === "audio") return "audio"
  return null
}
const LINKED_APP_FRAME_ID_BY_APP = {
  audio: "audio-pane",
  tasks: "tasks-pane"
}

const LINKED_APP_LABEL = {
  audio: "Audio",
  tasks: "Tasks"
}

function finderDisplayTitleFromStorageName(title) {
  const s = String(title || "").trim()
  if (!s) return "Untitled"
  return s.replace(/\.(txt|md|nexus|rtf)$/i, "").trim() || "Untitled"
}

/**
 * Finder tree: create/rename/delete, open linked docs, Turbo frame refresh; read-only save-as flow for linked apps.
 */
export default class extends Controller {
  static values = {
    frameId: String,
    rootFolderId: Number,
    sectionKey: { type: String, default: "documents" },
    readOnly: { type: Boolean, default: false },
    linkedAppSaveIcon: { type: String, default: "file_document" }
  }

  connect() {
    if (!this.readOnlyValue) {
      this.boundChromeCreate = (e) => {
        if (e.detail?.frameId !== this.frameIdValue) return
        const pid = e.detail?.parentId
        if (pid == null) this.startCreateFolder(this.rootFolderIdValue)
        else this.startCreateFolder(Number(pid))
      }
      window.addEventListener("nexus:finder-create-folder", this.boundChromeCreate)

      this.boundLinkedAppDocumentSaved = this.handleLinkedAppDocumentSaved.bind(this)
      window.addEventListener("nexus:linked-app-document-saved", this.boundLinkedAppDocumentSaved)

      this.boundFinderStructureChanged = this.handleFinderStructureChanged.bind(this)
      window.addEventListener("nexus:finder-structure-changed", this.boundFinderStructureChanged)
    }
  }

  disconnect() {
    if (this.boundChromeCreate) {
      window.removeEventListener("nexus:finder-create-folder", this.boundChromeCreate)
    }
    if (this.boundLinkedAppDocumentSaved) {
      window.removeEventListener("nexus:linked-app-document-saved", this.boundLinkedAppDocumentSaved)
    }
    if (this.boundFinderStructureChanged) {
      window.removeEventListener("nexus:finder-structure-changed", this.boundFinderStructureChanged)
    }
    if (this.liveRefreshTimer) {
      clearTimeout(this.liveRefreshTimer)
      this.liveRefreshTimer = null
    }
  }

  /** Save-as picker: start naming a new file under this folder (read-only mode only). */
  beginSaveFileHere(event) {
    if (!this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    if (this.element.querySelector("[data-pending-save-file='true']")) return

    const raw = event.currentTarget?.dataset?.parentId
    const parentId = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(parentId)) return

    const safeId = finderSanitizeDocumentId(parentId)
    if (!safeId) return
    const parentLi = this.element.querySelector(`li[data-finder-tree-node-id="${safeId}"]`)
    let childUl = parentLi?.querySelector(":scope > ul.finder-tree")

    if (!childUl && parentLi) {
      childUl = document.createElement("ul")
      childUl.className = "finder-tree"
      childUl.setAttribute("role", "group")
      parentLi.appendChild(childUl)
    }

    if (!childUl && parentId === this.rootFolderIdValue) {
      childUl = this.element.querySelector("ul.finder-tree--root")
    }

    if (!childUl) return

    if (parentLi) {
      parentLi.classList.remove("is-collapsed")
      const link = parentLi.querySelector(":scope > .finder-tree__row-line a.finder-tree__row--folder")
      if (link) link.setAttribute("aria-expanded", "true")
    }

    const li = document.createElement("li")
    li.className = "finder-tree__node finder-tree__node--file finder-tree__node--connector-end"
    li.dataset.pendingSaveFile = "true"

    const line = document.createElement("div")
    line.className = "finder-tree__row-line"
    line.setAttribute("draggable", "false")

    const row = document.createElement("div")
    row.className = "finder-tree__row finder-tree__row--file finder-tree__row--pending"

    const icon = document.createElement("span")
    icon.className = "finder-tree__icon finder-tree__icon--file"
    icon.setAttribute("aria-hidden", "true")
    const iconKey = this.linkedAppSaveIconValue || "file_document"
    icon.innerHTML = materialSymbolSvg(iconKey, "sm") || materialSymbolSvg("file_document", "sm")

    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-tree__pending-name-input"
    input.maxLength = 255
    input.setAttribute("aria-label", "File name")
    input.autocomplete = "off"
    input.spellcheck = false
    input.setAttribute("autocorrect", "off")
    input.setAttribute("autocapitalize", "off")
    input.placeholder = "Name…"

    row.appendChild(icon)
    row.appendChild(input)
    line.appendChild(row)
    li.appendChild(line)
    childUl.insertBefore(li, childUl.firstChild)
    input.focus()

    let finished = false
    let submitting = false

    const cleanup = () => {
      if (finished) return
      finished = true
      li.remove()
    }

    const submitSave = async () => {
      if (finished || submitting) return
      const trimmed = input.value.trim()
      if (!trimmed) {
        cleanup()
        return
      }
      submitting = true

      let documentId = null
      try {
        documentId = window.sessionStorage.getItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
      } catch (_e) {
        /* ignore */
      }

      const body = new FormData()
      body.set("folder_id", String(parentId))
      body.set("frame_id", this.frameIdValue)
      body.set("filename", trimmed)
      if (documentId) body.set("document_id", documentId)

      const isNotesFrame =
        this.frameIdValue === "notes-pane" || String(this.frameIdValue || "").startsWith("note-spawn-")
      const isTimeCardFrame = this.frameIdValue === "time-card-pane"
      const isTaskFrame =
        this.frameIdValue === "tasks-pane" || String(this.frameIdValue || "").startsWith("task-spawn-")
      
      if (isTaskFrame) {
        let taskPayload = ""
        try {
          const host = linkedAppHostWindow()
          const frame = host?.document?.getElementById(this.frameIdValue)
          if (frame) {
            const payloadEl = frame.querySelector('[data-task-list-editor-target="payload"]')
            taskPayload = (payloadEl?.value || "").toString()
          }
        } catch (_e) {
          // non-blocking
        }
        if (taskPayload) body.set("task_payload", taskPayload)
      } else if (isNotesFrame || isTimeCardFrame) {
        let noteText = ""
        try {
          const draft = readLinkedAppPickerDraft(this.frameIdValue)
          if (draft?.app === "notes") noteText = String(draft.noteText || "")
          if (draft?.app === "time_card") noteText = String(draft.noteText || "")
        } catch (_e) {
          // non-blocking
        }
        if (!noteText) {
          try {
            const host = linkedAppHostWindow()
            const frame = host?.document?.getElementById(this.frameIdValue)
            if (isNotesFrame) {
              const textarea = frame?.querySelector(".notes-app__textarea")
              noteText = (textarea?.value || "").toString()
            } else if (isTimeCardFrame) {
              const contentInput = frame?.querySelector('[data-time-card-target="serializedContent"]')
              noteText = (contentInput?.value || "").toString()
            }
          } catch (_e) {
            // non-blocking
          }
        }
        body.set("note_text", noteText)
      }

      try {
        const response = await fetch("/apps/tasks/save_file", {
          method: "POST",
          headers: { "X-CSRF-Token": finderCsrfToken() },
          body
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          submitting = false
          window.alert(data.error || (Array.isArray(data.errors) ? data.errors.join(", ") : null) || "Could not save.")
          input.focus()
          return
        }
        finished = true
        li.remove()

        dispatchLinkedAppHostEvent("nexus:linked-app-document-saved", {
          frameId: this.frameIdValue,
          documentId: data.document_id,
          title: data.display_title || data.title || trimmed
        })
        
        // Only persist as linked document if this wasn't an embedded draft save.
        // Embedded draft saves should not become the "linked document" for the next session.
        if (data.document_id != null) {
          try {
            window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(data.document_id))
          } catch (_e) {
            /* ignore */
          }
            try {
              window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(data.document_id))
            } catch (_e) {
              /* ignore */
            }
        }

        dispatchLinkedAppHostEvent("nexus:linked-app-save-picker-close", {
          frameId: this.frameIdValue,
          saved: true,
          documentId: data.document_id,
          clearedEmbeddedDraft: data.cleared_embedded_draft
        })
      } catch (_e) {
        submitting = false
        window.alert("Could not save.")
        input.focus()
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        void submitSave()
      } else if (e.key === "Escape") {
        e.preventDefault()
        cleanup()
      }
    })

    input.addEventListener("blur", () => {
      requestAnimationFrame(() => {
        if (finished || submitting || !li.isConnected) return
        if (!input.value.trim()) cleanup()
      })
    })
  }

  createSubfolder(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const raw = event.currentTarget?.dataset?.parentId
    const parentId = raw != null && raw !== "" ? Number.parseInt(raw, 10) : NaN
    if (!Number.isFinite(parentId)) return
    this.startCreateFolder(parentId)
  }

  activateRowLine(event) {
    const line = event.currentTarget
    if (!(line instanceof Element)) return

    const target = event.target instanceof Element ? event.target : null
    if (!target) return
    if (target.closest(".finder-tree__row-actions")) return
    if (target.closest("button, input, textarea, select")) return
    if (target.closest("a.finder-tree__row")) return

    const row = line.querySelector("a.finder-tree__row")
    if (!row) return
    row.click()
  }

  openLinkedFileKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    this.openLinkedFile(event)
  }

  openLinkedFileInAppKey(event) {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    this.openLinkedFileInApp(event)
  }

  /** Toolbar control: open linked doc in Tasks, optionally close Finder or exit save picker. */
  openLinkedFileInApp(event) {
    if (this.element.querySelector(".finder-tree__pending-name-input")) {
      if (typeof event.preventDefault === "function") event.preventDefault()
      if (typeof event.stopPropagation === "function") event.stopPropagation()
      return
    }
    if (typeof event.preventDefault === "function") event.preventDefault()
    if (typeof event.stopPropagation === "function") event.stopPropagation()
    const el = event.currentTarget
    if (this.readOnlyValue) {
      this.#openLinkedDocumentCommon(el, { fromEmbeddedPicker: true })
      return
    }
    this.#openLinkedDocumentCommon(el, { closeFinderWindow: true })
  }

  openLinkedFile(event) {
    if (this.readOnlyValue) return
    if (this.element.querySelector(".finder-tree__pending-name-input")) {
      if (typeof event.preventDefault === "function") event.preventDefault()
      if (typeof event.stopPropagation === "function") event.stopPropagation()
      return
    }
    if (typeof event.preventDefault === "function") event.preventDefault()
    if (typeof event.stopPropagation === "function") event.stopPropagation()
    this.#openLinkedDocumentCommon(event.currentTarget, {})
  }

  #openLinkedDocumentCommon(el, options) {
    const documentId = el?.dataset?.documentId
    const contentType = el?.dataset?.contentType
    const fileKind = el?.dataset?.fileKind
    if (!documentId || !contentType) return

    const sectionKey = el?.dataset?.sectionKey || this.sectionKeyValue
    const appKey = appKeyForLinkedFile(contentType, fileKind, sectionKey)
    if (!appKey) return

    this.element.querySelectorAll(".finder-tree__row-line.is-selected").forEach((line) => {
      line.classList.remove("is-selected")
    })
    el.closest(".finder-tree__row-line")?.classList.add("is-selected")

    const documentTitle = (el.dataset.documentTitle || "").trim()

    if (options.fromEmbeddedPicker) {
      dispatchLinkedAppHostEvent("nexus:linked-app-open-from-embedded-finder", {
        frameId: this.frameIdValue,
        appKey,
        documentId: String(documentId),
        documentTitle
      })
      return
    }

    // Dispatch to parent/host window so content-window-controller can receive it.
    // Try dispatchLinkedAppHostEvent first (escapes iframes), fallback to window dispatch.
    const event = new CustomEvent("app-window:open", {
      detail: {
        appKey,
        documentId: String(documentId),
        documentTitle
      }
    })
    const hostWindow = linkedAppHostWindow()
    if (hostWindow && hostWindow !== window) {
      hostWindow.dispatchEvent(event)
    } else {
      window.dispatchEvent(event)
    }

    if (options.closeFinderWindow) {
      window.dispatchEvent(new CustomEvent("app-window:close", { detail: { appKey: "finder" } }))
    }
  }

  startCreateFolder(parentDocumentId) {
    if (this.readOnlyValue) return
    if (!parentDocumentId) return
    const url = `/documents/${parentDocumentId}/create_subfolder`
    const safeId = finderSanitizeDocumentId(parentDocumentId)
    if (!safeId) return
    const parentLi = this.element.querySelector(`li[data-finder-tree-node-id="${safeId}"]`)
    let childUl = parentLi?.querySelector(":scope > ul.finder-tree")

    if (!childUl && parentLi) {
      childUl = document.createElement("ul")
      childUl.className = "finder-tree"
      childUl.setAttribute("role", "group")
      parentLi.appendChild(childUl)
    }

    if (!childUl && parentDocumentId === this.rootFolderIdValue) {
      childUl = this.element.querySelector("ul.finder-tree--root")
    }

    if (!childUl) return

    if (parentLi) {
      parentLi.classList.remove("is-collapsed")
      const link = parentLi.querySelector(":scope > .finder-tree__row-line a.finder-tree__row--folder")
      if (link) link.setAttribute("aria-expanded", "true")
    }

    if (childUl.querySelector("[data-pending-new-folder='true']")) {
      childUl.querySelector("[data-pending-new-folder='true'] input")?.focus()
      return
    }

    const li = document.createElement("li")
    li.className = "finder-tree__node finder-tree__node--folder finder-tree__node--connector-end"
    li.dataset.pendingNewFolder = "true"

    const line = document.createElement("div")
    line.className = "finder-tree__row-line"
    line.setAttribute("draggable", "false")

    const row = document.createElement("div")
    row.className = "finder-tree__row finder-tree__row--folder finder-tree__row--pending"

    const icon = document.createElement("span")
    icon.className = "finder-tree__icon finder-tree__icon--folder finder-tree__icon--folder-empty"
    icon.setAttribute("aria-hidden", "true")
    icon.innerHTML = materialSymbolSvg("folder", "sm")

    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-tree__pending-name-input"
    input.maxLength = 255
    input.setAttribute("aria-label", "New folder name")
    input.autocomplete = "off"
    input.spellcheck = false
    input.setAttribute("autocorrect", "off")
    input.setAttribute("autocapitalize", "off")

    row.appendChild(icon)
    row.appendChild(input)
    line.appendChild(row)
    li.appendChild(line)
    childUl.insertBefore(li, childUl.firstChild)
    input.focus()

    let finished = false
    let submitting = false

    const cleanup = () => {
      if (finished) return
      finished = true
      li.remove()
    }

    const submit = async () => {
      if (finished || submitting) return
      const trimmed = input.value.trim()
      if (!trimmed) {
        cleanup()
        return
      }
      submitting = true
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: finderApiHeaders({ jsonBody: true }),
          body: JSON.stringify({ title: trimmed })
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          submitting = false
          window.alert(data.error || "Could not create folder.")
          input.focus()
          return
        }
        finished = true
        li.remove()
        const folderId = data.id
        this.reloadFramePreservingBrowse()
        if (folderId) {
          window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
            detail: { type: "folder_created", folderId, sectionKey: this.sectionKeyValue }
          }))
        }
      } catch (_e) {
        submitting = false
        window.alert("Could not create folder.")
        input.focus()
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        void submit()
      } else if (e.key === "Escape") {
        e.preventDefault()
        cleanup()
      }
    })

    input.addEventListener("blur", () => {
      requestAnimationFrame(() => {
        if (finished || submitting || !li.isConnected) return
        if (!input.value.trim()) cleanup()
        else void submit()
      })
    })
  }

  renameFolder(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const li = event.currentTarget.closest("li.finder-tree__node--folder")
    if (!li?.dataset.finderTreeNodeId) return
    this.startRename(li, { isFolder: true })
  }

  renameFile(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const li = event.currentTarget.closest("li.finder-tree__node--file")
    if (!li?.dataset.finderTreeNodeId) return
    this.startRename(li, { isFolder: false })
  }

  startRename(li, { isFolder }) {
    const renameUrl = li.dataset.renameUrl
    if (!renameUrl) return
    const label = li.querySelector("[data-finder-tree-label]")
    if (!label || li.querySelector(".finder-tree__pending-name-input")) return
    const originalRow = label.closest(".finder-tree__row")
    if (!originalRow) return

    const storageName = li.dataset.storageName || ""
    const displayTitle = li.dataset.displayTitle || label.textContent || ""
    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-tree__pending-name-input"
    input.value = isFolder ? displayTitle : finderDisplayTitleFromStorageName(storageName)
    input.maxLength = 255
    input.autocomplete = "off"
    input.spellcheck = false
    input.setAttribute("autocorrect", "off")
    input.setAttribute("autocapitalize", "off")

    // Disable draggable on the row-line while editing — Chrome/Safari swallow
    // spacebar keypresses inside any input that is a descendant of draggable="true".
    const rowLine = li.querySelector(":scope > .finder-tree__row-line")
    const prevDraggable = rowLine?.getAttribute("draggable")
    if (rowLine) rowLine.setAttribute("draggable", "false")

    const editingRow = document.createElement("div")
    editingRow.className = `${originalRow.className} finder-tree__row--editing`
    editingRow.setAttribute("role", "presentation")
    const rowIcon = originalRow.querySelector(".finder-tree__icon")
    if (rowIcon) editingRow.appendChild(rowIcon.cloneNode(true))
    editingRow.appendChild(input)

    const restoreDraggable = () => {
      if (!rowLine) return
      if (prevDraggable != null) rowLine.setAttribute("draggable", prevDraggable)
      else rowLine.removeAttribute("draggable")
    }

    originalRow.replaceWith(editingRow)
    input.focus()
    input.select()

    const cancel = () => {
      restoreDraggable()
      if (editingRow.isConnected) editingRow.replaceWith(originalRow)
    }

    const save = async () => {
      const trimmed = input.value.trim()
      const cmp = isFolder ? displayTitle : finderDisplayTitleFromStorageName(storageName)
      if (!trimmed || trimmed === cmp) {
        cancel()
        return
      }
      const response = await fetch(renameUrl, {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: true }),
        body: JSON.stringify({ name: trimmed })
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        window.alert(payload.error || "Could not rename.")
        cancel()
        return
      }
      restoreDraggable()
      const data = await response.json().catch(() => ({}))
      const itemId = li?.dataset?.finderTreeNodeId
      const newName = trimmed
      this.reloadFramePreservingBrowse()
      if (itemId) {
        window.dispatchEvent(new CustomEvent("nexus:finder-item-renamed", {
          detail: { 
            itemId, 
            newName,
            isFolder,
            sectionKey: this.sectionKeyValue 
          }
        }))
      }
    }

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        void save()
      } else if (e.key === "Escape") {
        e.preventDefault()
        cancel()
      }
    })
    input.addEventListener("blur", () => {
      void save()
    })
  }

  async deleteFolder(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const li = event.currentTarget.closest("li.finder-tree__node--folder")
    await this.deleteItem(li, "folder")
  }

  async deleteFile(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const li = event.currentTarget.closest("li.finder-tree__node--file")
    await this.deleteItem(li, "file")
  }

  async deleteItem(li, kind) {
    if (!li) return
    const deleteUrl = li.dataset.deleteUrl
    if (!deleteUrl) return
    const name = li.dataset.displayTitle || "this item"
    const msg =
      kind === "folder"
        ? `Delete "${name}" and everything inside it?`
        : `Delete "${name}"?`
    if (!window.confirm(msg)) return

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: finderApiHeaders({ jsonBody: false })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not delete.")
      return
    }

    const deletedId = li.dataset.finderTreeNodeId
    const currentBrowse = this.selectedBrowseId() || String(this.rootFolderIdValue || "")
    const nextBrowse = currentBrowse === deletedId ? this.rootFolderIdValue : currentBrowse
    this.reloadFrameWithBrowseId(nextBrowse, { pruneSubtreeLi: li })
    if (kind === "folder" && deletedId) {
      window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
        detail: { type: "folder_deleted", folderId: deletedId, sectionKey: this.sectionKeyValue }
      }))
    }
  }

  selectedBrowseId() {
    const line = this.element.querySelector(".finder-tree__row-line.is-selected")
    const folderLink = line?.querySelector("a.finder-tree__row--folder")
    if (folderLink) {
      return folderLink.closest("li")?.dataset?.finderTreeNodeId ?? null
    }
    return null
  }

  reloadFramePreservingBrowse() {
    const id = this.selectedBrowseId() || this.rootFolderIdValue
    this.reloadFrameWithBrowseId(id)
  }

  reloadFrameWithBrowseId(browseId, { pruneSubtreeLi = null } = {}) {
    const frameId = this.frameIdValue
    const frame = document.getElementById(frameId)
    if (!frame) return
    const rootId = this.rootFolderIdValue

    let expanded = new Set([
      ...finderCollectExpandedFolderIdsFromDom(this.element),
      ...(rootId ? finderReadExpandedFolderIds(rootId) : [])
    ])

    if (pruneSubtreeLi) {
      const doomed = new Set()
      pruneSubtreeLi.querySelectorAll("[data-finder-tree-node-id]").forEach((el) => {
        const id = el.dataset.finderTreeNodeId
        if (id) doomed.add(String(id))
      })
      expanded = new Set([...expanded].filter((id) => !doomed.has(String(id))))
    }

    if (rootId) finderWriteExpandedFolderIds(rootId, [...expanded])

    const url = new URL("/apps/finder", window.location.origin)
    url.searchParams.set("frame_id", frameId)
    if (this.sectionKeyValue) url.searchParams.set("section", this.sectionKeyValue)
    if (this.readOnlyValue) url.searchParams.set("mode", "save_as")
    if (browseId) url.searchParams.set("browse_id", String(browseId))
    if (expanded.size > 0) url.searchParams.set("expanded_ids", [...expanded].sort().join(","))
    else url.searchParams.delete("expanded_ids")
    const next = `${url.pathname}${url.search}`
    if (frame.tagName === "TURBO-FRAME") {
      frame.src = next
      return
    }
    Turbo.visit(next, { frame: frameId })
  }

  async toggleFavorite(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()

    const button = event.currentTarget
    const documentId = button?.dataset?.documentId
    if (!documentId) return

    try {
      const response = await fetch(`/documents/${documentId}/toggle_favorite`, {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: false })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(payload.error || "Could not update favorite status.")
        return
      }

      const isFavorited = payload.is_favorited === true
      button.dataset.isFavorited = String(isFavorited)

      const actionLabel = isFavorited ? "Remove from Favorites" : "Add to Favorites"
      button.title = actionLabel
      button.setAttribute("aria-label", actionLabel)
    } catch (_error) {
      window.alert("Could not update favorite status.")
    }
  }

  handleLinkedAppDocumentSaved(event) {
    const { frameId, documentId } = event.detail || {}
    if (!documentId) return
    if (frameId && frameId === this.frameIdValue) return
    this.scheduleLiveRefresh()
  }

  handleFinderStructureChanged(event) {
    const { sectionKey } = event.detail || {}
    if (sectionKey && sectionKey !== this.sectionKeyValue) return
    this.scheduleLiveRefresh()
  }

  scheduleLiveRefresh(delay = 90) {
    if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer)
    this.liveRefreshTimer = setTimeout(() => {
      this.liveRefreshTimer = null
      this.reloadFramePreservingBrowse()
    }, delay)
  }

  csrfToken() {
    return finderCsrfToken()
  }
}
