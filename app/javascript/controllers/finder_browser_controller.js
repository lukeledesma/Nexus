import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"
import { syncNexusDesktopWallpaper } from "lib/nexus_workspace_chrome"
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
  if (ct === "alchemy_tag_list") return "alchemy"
  if (ct === "note") {
    if (section === "quartz") return "quartz"
    return "quartz"
  }
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
const FINDER_SEARCH_DEBOUNCE_MS = 140

function finderDisplayTitleFromStorageName(title) {
  const s = String(title || "").trim()
  if (!s) return "Untitled"
  return s.replace(/\.(txt|md|nexus|rtf)$/i, "").trim() || "Untitled"
}

function quartzIconSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="quartz-gem-icon">' +
      '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5">' +
        '<path d="m18.612 10.82l-5.737-7.879a1.06 1.06 0 0 0-.382-.322a1.1 1.1 0 0 0-.986 0a1.06 1.06 0 0 0-.381.322l-5.738 7.88A2 2 0 0 0 5 12c0 .422.135.834.388 1.18l5.738 7.879c.098.135.229.246.38.322a1.1 1.1 0 0 0 .987 0c.152-.076.283-.187.381-.322l5.738-7.88a1.99 1.99 0 0 0 0-2.359" />' +
        '<path d="M5.015 12.195L12 15.078l6.985-2.883M12 2.5v19" />' +
      '</g>' +
    '</svg>'
  )
}

function alchemyIconSvg() {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="16" height="16" aria-hidden="true" class="alchemy-card-icon" fill="currentColor">' +
      '<path d="m608-368 46-166-142-98-46 166 142 98ZM160-207l-33-16q-31-13-42-44.5t3-62.5l72-156v279Zm160 87q-33 0-56.5-24T240-201v-239l107 294q3 7 5 13.5t7 12.5h-39Zm206-5q-31 11-62-3t-42-45L245-662q-11-31 3-61.5t45-41.5l301-110q31-11 61.5 3t41.5 45l178 489q11 31-3 61.5T827-235L526-125Zm-28-75 302-110-179-490-301 110 178 490Zm62-300Z" />' +
    '</svg>'
  )
}

/**
 * Finder tree: create/rename/delete, open linked docs, Turbo frame refresh; read-only save-as flow for linked apps.
 */
export default class extends Controller {
  static targets = [ "searchInput" ]

  static values = {
    frameId: String,
    rootFolderId: Number,
    sectionKey: { type: String, default: "documents" },
    searchMode: { type: Boolean, default: false },
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

      this.boundToggleFinderSearchMode = this.handleToggleFinderSearchMode.bind(this)
      window.addEventListener("nexus:finder-toggle-search-mode", this.boundToggleFinderSearchMode)
    }

    this.announceSearchMode()
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
    if (this.boundToggleFinderSearchMode) {
      window.removeEventListener("nexus:finder-toggle-search-mode", this.boundToggleFinderSearchMode)
    }
    if (this.liveRefreshTimer) {
      clearTimeout(this.liveRefreshTimer)
      this.liveRefreshTimer = null
    }
    if (this.finderSearchTimer) {
      clearTimeout(this.finderSearchTimer)
      this.finderSearchTimer = null
    }
  }

  announceSearchMode() {
    window.dispatchEvent(new CustomEvent("nexus:finder-search-mode-changed", {
      detail: {
        frameId: this.frameIdValue,
        searchMode: this.searchModeValue === true
      }
    }))
  }

  handleToggleFinderSearchMode(event) {
    const { frameId } = event.detail || {}
    if (frameId && frameId !== this.frameIdValue) return
    if (this.readOnlyValue) return

    this.submitFinderSearchMode(!(this.searchModeValue === true))
  }

  submitFinderSearchMode(nextMode) {
    this.searchModeValue = nextMode === true
    this.announceSearchMode()

    if (!this.searchModeValue && this.hasSearchInputTarget) {
      this.searchInputTarget.value = ""
    }

    const nextBrowse = this.selectedBrowseId() || this.rootFolderIdValue
    this.reloadFrameWithBrowseId(nextBrowse)
  }

  queueFinderSearch(event) {
    const raw = event?.currentTarget?.value || ""
    const query = String(raw).trim()
    if (this.finderSearchTimer) clearTimeout(this.finderSearchTimer)
    this.finderSearchTimer = setTimeout(() => {
      this.finderSearchTimer = null
      this.submitFinderSearch(query)
    }, FINDER_SEARCH_DEBOUNCE_MS)
  }

  handleFinderSearchKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.currentTarget.value = ""
      this.submitFinderSearchMode(false)
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      this.submitFinderSearch((event.currentTarget?.value || "").trim())
    }
  }

  submitFinderSearch(rawQuery) {
    if (!(this.searchModeValue === true)) return
    const query = String(rawQuery || "").trim()
    const activeQuery = this.currentFinderSearchQuery()
    if (query === activeQuery) return

    if (this.hasSearchInputTarget) this.searchInputTarget.value = query

    const nextBrowse = this.selectedBrowseId() || this.rootFolderIdValue
    this.reloadFrameWithBrowseId(nextBrowse)
  }

  currentFinderSearchQuery() {
    if (this.hasSearchInputTarget) return (this.searchInputTarget.value || "").trim()
    return ""
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
    if (iconKey === "quartz_svg") {
      icon.innerHTML = quartzIconSvg()
    } else if (iconKey === "alchemy_svg") {
      icon.innerHTML = alchemyIconSvg()
    } else {
      icon.innerHTML = materialSymbolSvg(iconKey, "sm") || materialSymbolSvg("file_document", "sm")
    }

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

      const isQuartzFrame = this.frameIdValue === "quartz-pane"
      const isTaskFrame =
        this.frameIdValue === "tasks-pane" || String(this.frameIdValue || "").startsWith("task-spawn-")
      const isAlchemyFrame = this.frameIdValue === "alchemy-pane"

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
      } else if (isQuartzFrame) {
        let noteText = ""
        try {
          const draft = readLinkedAppPickerDraft(this.frameIdValue)
          if (draft?.app === "quartz") noteText = String(draft.noteText || "")
        } catch (_e) {
          // non-blocking
        }
        if (!noteText) {
          try {
            const host = linkedAppHostWindow()
            const frame = host?.document?.getElementById(this.frameIdValue)
            const textarea = frame?.querySelector(".quartz-notes-textarea")
            noteText = (textarea?.value || "").toString()
          } catch (_e) {
            // non-blocking
          }
        }
        body.set("note_text", noteText)
      } else if (isAlchemyFrame) {
        let xmlText = ""
        try {
          const host = linkedAppHostWindow()
          const frame = host?.document?.getElementById(this.frameIdValue)
          const sourceEl = frame?.querySelector("[data-alchemy-source-xml]")
          xmlText = (sourceEl?.value || sourceEl?.textContent || "").toString()
        } catch (_e) {
          // non-blocking
        }
        body.set("xml_text", xmlText)
      }

      try {
        const saveUrl = isAlchemyFrame ? "/apps/alchemy/save_file" : "/apps/tasks/save_file"
        const response = await fetch(saveUrl, {
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

  async restoreFromTrash(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const li = event.currentTarget.closest("li.finder-tree__node--file")
    if (!li) return

    const id = li.dataset.finderTreeNodeId
    if (!id) return

    const response = await fetch(`/documents/${id}/restore_from_trash`, {
      method: "PATCH",
      headers: finderApiHeaders({ jsonBody: false })
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not restore item.")
      return
    }

    // Removes the restored row from the Trash section immediately.
    li.remove()
    window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
      detail: { type: "file_restored", sectionKey: "trash" }
    }))
  }

  async permanentDeleteFromTrash(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()
    const btn = event.currentTarget
    const li = btn.closest("li.finder-tree__node--file")
    if (!li) return

    const id = li.dataset.finderTreeNodeId || btn.dataset.documentId
    if (!id) return

    const name = btn.dataset.displayTitle || li.dataset.displayTitle || "this item"
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return

    const response = await fetch(`/documents/${id}/permanent_delete`, {
      method: "DELETE",
      headers: finderApiHeaders({ jsonBody: false })
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not permanently delete item.")
      return
    }

    this.dispatchLinkedDocumentUnavailable(id, { reason: "permanent_delete" })
    li.remove()
    window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
      detail: { type: "file_permanently_deleted", sectionKey: "trash" }
    }))
  }

  // ── Drag-to-Trash ──────────────────────────────────────────────────────────
  // File rows in any section can be dragged onto the Trash sidebar item.

  fileDragStart(event) {
    const li = event.currentTarget.closest("li.finder-tree__node--file")
    if (!li) return
    const id = li.dataset.finderTreeNodeId
    if (!id) return
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("application/nexus-document-id", id)
    event.currentTarget.classList.add("finder-tree__row-line--dragging")
  }

  fileDragEnd(event) {
    event.currentTarget.classList.remove("finder-tree__row-line--dragging")
  }

  trashSidebarDragOver(event) {
    if (!event.dataTransfer.types.includes("application/nexus-document-id")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    event.currentTarget.classList.add("finder-folder-item--drag-over")
  }

  trashSidebarDragLeave(event) {
    event.currentTarget.classList.remove("finder-folder-item--drag-over")
  }

  async trashSidebarDrop(event) {
    event.currentTarget.classList.remove("finder-folder-item--drag-over")
    const id = event.dataTransfer.getData("application/nexus-document-id")
    if (!id) return
    event.preventDefault()

    const li = this.element.querySelector(`li[data-finder-tree-node-id="${id}"]`)
    const deleteUrl = li?.dataset.deleteUrl || `/documents/${id}`

    const response = await fetch(deleteUrl, {
      method: "DELETE",
      headers: finderApiHeaders({ jsonBody: false })
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      window.alert(payload.error || "Could not move item to Trash.")
      return
    }

    this.dispatchLinkedDocumentUnavailable(id, { reason: "trash" })
    if (li) li.remove()
    window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
      detail: { type: "file_trashed", sectionKey: this.sectionKeyValue }
    }))
  }

  // ── Drag-to-Favorites ─────────────────────────────────────────────────────
  // File rows can be dragged onto Favorites to add them without opening row actions.

  favoritesSidebarDragOver(event) {
    if (!event.dataTransfer.types.includes("application/nexus-document-id")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    event.currentTarget.classList.add("finder-folder-item--drag-over")
  }

  favoritesSidebarDragLeave(event) {
    event.currentTarget.classList.remove("finder-folder-item--drag-over")
  }

  async favoritesSidebarDrop(event) {
    event.currentTarget.classList.remove("finder-folder-item--drag-over")
    const id = event.dataTransfer.getData("application/nexus-document-id")
    if (!id) return
    event.preventDefault()

    const button = this.element.querySelector(`.item-action-favorite[data-document-id="${id}"]`)
    const knownFavoriteState = button?.dataset?.isFavorited
    if (knownFavoriteState === "true") return

    try {
      const response = await fetch(`/documents/${id}/toggle_favorite`, {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: false })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(payload.error || "Could not add item to Favorites.")
        return
      }

      let isFavorited = payload.is_favorited === true
      if (!isFavorited) {
        const secondResponse = await fetch(`/documents/${id}/toggle_favorite`, {
          method: "PATCH",
          headers: finderApiHeaders({ jsonBody: false })
        })
        const secondPayload = await secondResponse.json().catch(() => ({}))
        if (!secondResponse.ok) {
          window.alert(secondPayload.error || "Could not add item to Favorites.")
          return
        }
        isFavorited = secondPayload.is_favorited === true
      }

      this.updateFavoriteButtonState(button, isFavorited)
      window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
        detail: {
          type: "favorite_toggled",
          documentId: String(id),
          sectionKey: "favorites"
        }
      }))
    } catch (_error) {
      window.alert("Could not add item to Favorites.")
    }
  }

  async deleteItem(li, kind) {
    if (!li) return
    const deleteUrl = li.dataset.deleteUrl
    if (!deleteUrl) return
    const name = li.dataset.displayTitle || "this item"
    if (kind === "folder") {
      if (!window.confirm(`Delete "${name}" and everything inside it?`)) return
    }

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
    if (kind === "file" && deletedId) {
      this.dispatchLinkedDocumentUnavailable(deletedId, { reason: "trash" })
    }
    const currentBrowse = this.selectedBrowseId() || String(this.rootFolderIdValue || "")
    const nextBrowse = currentBrowse === deletedId ? this.rootFolderIdValue : currentBrowse
    this.reloadFrameWithBrowseId(nextBrowse, { pruneSubtreeLi: li })
    if (kind === "folder" && deletedId) {
      window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
        detail: { type: "folder_deleted", folderId: deletedId, sectionKey: this.sectionKeyValue }
      }))
    }
  }

  dispatchLinkedDocumentUnavailable(documentId, { reason = "trash" } = {}) {
    const id = String(documentId || "")
    if (!id) return

    window.dispatchEvent(new CustomEvent("nexus:linked-document-unavailable", {
      detail: { documentId: id, reason }
    }))
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
    const activeSearchQuery = this.currentFinderSearchQuery()
    const searchMode = this.searchModeValue === true
    url.searchParams.set("frame_id", frameId)
    if (this.sectionKeyValue) url.searchParams.set("section", this.sectionKeyValue)
    if (this.readOnlyValue) url.searchParams.set("mode", "save_as")
    if (searchMode) {
      url.searchParams.set("search_mode", "1")
      if (activeSearchQuery) url.searchParams.set("q", activeSearchQuery)
      else url.searchParams.delete("q")
      url.searchParams.delete("browse_id")
      url.searchParams.delete("expanded_ids")
    } else {
      url.searchParams.delete("search_mode")
      url.searchParams.delete("q")
      if (browseId) url.searchParams.set("browse_id", String(browseId))
      if (expanded.size > 0) url.searchParams.set("expanded_ids", [...expanded].sort().join(","))
      else url.searchParams.delete("expanded_ids")
    }
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
      this.updateFavoriteButtonState(button, isFavorited)

      // In Favorites view, remove the row immediately when unfavorited.
      if (this.sectionKeyValue === "favorites" && !isFavorited) {
        const li = button.closest("li.finder-tree__node--file")
        if (li instanceof Element) li.remove()
      }

      // Keep Favorites views in sync across open Finder windows.
      window.dispatchEvent(new CustomEvent("nexus:finder-structure-changed", {
        detail: {
          type: "favorite_toggled",
          documentId: String(documentId),
          sectionKey: "favorites"
        }
      }))
    } catch (_error) {
      window.alert("Could not update favorite status.")
    }
  }

  updateFavoriteButtonState(button, isFavorited) {
    if (!button) return
    button.dataset.isFavorited = String(isFavorited)

    const actionLabel = isFavorited ? "Remove from Favorites" : "Add to Favorites"
    button.title = actionLabel
    button.setAttribute("aria-label", actionLabel)
  }

  async setFileAsWallpaper(event) {
    if (this.readOnlyValue) return
    event.preventDefault()
    event.stopPropagation()

    const button = event.currentTarget
    const documentId = button?.dataset?.documentId
    if (!documentId) return

    try {
      const response = await fetch("/workspace_preferences", {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: true }),
        body: JSON.stringify({ apply_wallpaper_image: { document_id: Number(documentId) } })
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(payload.error || "Could not set wallpaper.")
        return
      }

      syncNexusDesktopWallpaper(payload || {})
    } catch (_error) {
      window.alert("Could not set wallpaper.")
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
