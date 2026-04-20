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
import { dispatchSingularHostEvent, singularHostWindow } from "lib/singular_host_events"

function appKeyForLinkedFile(contentType, fileKind) {
  const ct = String(contentType || "").toLowerCase()
  const kind = String(fileKind || "").toLowerCase()
  if (ct === "task_list") return "singular-task-list"
  if (ct !== "asset") return null
  if (kind === "image") return "images"
  if (kind === "audio") return "loops"
  return null
}

const SINGULAR_FRAME_ID_BY_APP = {
  loops: "loops-pane",
  "singular-task-list": "singular-task-list-pane"
}

const SINGULAR_APP_LABEL = {
  loops: "Audio",
  "singular-task-list": "Tasks"
}

function finderDisplayTitleFromStorageName(title) {
  const s = String(title || "").trim()
  if (!s) return "Untitled"
  return s.replace(/\.(txt|nexus)$/i, "").trim() || "Untitled"
}

/**
 * Finder tree: create/rename/delete, open linked docs, Turbo frame refresh; read-only save-as flow for singular apps.
 */
export default class extends Controller {
  static values = {
    frameId: String,
    rootFolderId: Number,
    sectionKey: { type: String, default: "documents" },
    readOnly: { type: Boolean, default: false },
    singularSaveIcon: { type: String, default: "file_document" }
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
    }
  }

  disconnect() {
    if (this.boundChromeCreate) {
      window.removeEventListener("nexus:finder-create-folder", this.boundChromeCreate)
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
    const iconKey = this.singularSaveIconValue || "file_document"
    icon.innerHTML = materialSymbolSvg(iconKey, "sm") || materialSymbolSvg("file_document", "sm")

    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-tree__pending-name-input"
    input.maxLength = 255
    input.setAttribute("aria-label", "File name")
    input.autocomplete = "off"
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
        documentId = window.sessionStorage.getItem(`nexus.singularLinkedDocument.${this.frameIdValue}`)
      } catch (_e) {
        /* ignore */
      }

      const body = new FormData()
      body.set("folder_id", String(parentId))
      body.set("frame_id", this.frameIdValue)
      body.set("filename", trimmed)
      if (documentId) body.set("document_id", documentId)

      try {
        const response = await fetch("/apps/singular/save_file", {
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

        dispatchSingularHostEvent("nexus:singular-disk-saved", {
          frameId: this.frameIdValue,
          title: data.display_title || data.title || trimmed
        })
        if (data.document_id != null) {
          try {
            window.sessionStorage.setItem(`nexus.singularLinkedDocument.${this.frameIdValue}`, String(data.document_id))
          } catch (_e) {
            /* ignore */
          }
            try {
              window.localStorage.setItem(`nexus.singularLinkedDocument.${this.frameIdValue}`, String(data.document_id))
            } catch (_e) {
              /* ignore */
            }
        }

        dispatchSingularHostEvent("nexus:singular-save-picker-close", {
          frameId: this.frameIdValue,
          saved: true,
          documentId: data.document_id
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
    if (typeof event.preventDefault === "function") event.preventDefault()
    if (typeof event.stopPropagation === "function") event.stopPropagation()
    this.#openLinkedDocumentCommon(event.currentTarget, {})
  }

  #openLinkedDocumentCommon(el, options) {
    const documentId = el?.dataset?.documentId
    const contentType = el?.dataset?.contentType
    const fileKind = el?.dataset?.fileKind
    if (!documentId || !contentType) return

    const appKey = appKeyForLinkedFile(contentType, fileKind)
    if (!appKey) return

    this.element.querySelectorAll(".finder-tree__row-line.is-selected").forEach((line) => {
      line.classList.remove("is-selected")
    })
    el.closest(".finder-tree__row-line")?.classList.add("is-selected")

    const documentTitle = (el.dataset.documentTitle || "").trim()

    if (options.fromEmbeddedPicker) {
      dispatchSingularHostEvent("nexus:singular-open-from-embedded-finder", {
        frameId: this.frameIdValue,
        appKey,
        documentId: String(documentId),
        documentTitle
      })
      return
    }

    // Dispatch to parent/host window so content-window-controller can receive it.
    // Try dispatchSingularHostEvent first (escapes iframes), fallback to window dispatch.
    const event = new CustomEvent("app-window:open", {
      detail: {
        appKey,
        documentId: String(documentId),
        documentTitle
      }
    })
    const hostWindow = singularHostWindow()
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
        this.reloadFramePreservingBrowse()
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

    const storageName = li.dataset.storageName || ""
    const displayTitle = li.dataset.displayTitle || label.textContent || ""
    const input = document.createElement("input")
    input.type = "text"
    input.className = "finder-folder-name-input finder-tree__pending-name-input"
    input.value = isFolder ? displayTitle : finderDisplayTitleFromStorageName(storageName)
    input.maxLength = 255

    label.replaceWith(input)
    input.focus()
    input.select()

    const cancel = () => {
      input.replaceWith(label)
      label.textContent = displayTitle
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
      await response.json().catch(() => ({}))
      this.reloadFramePreservingBrowse()
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

  csrfToken() {
    return finderCsrfToken()
  }
}
