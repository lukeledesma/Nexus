import { Controller } from "@hotwired/stimulus"
import {
  finderApiHeaders,
  finderCollectExpandedFolderIdsFromDom,
  finderMultipartHeaders,
  finderQueryLiByNodeId,
  finderReadExpandedFolderIds,
  finderWriteExpandedFolderIds
} from "lib/finder"

/**
 * Finder 2 sidebar tree: folder disclosure, browse URL sync, keyboard nav, drag-reparent.
 * Pairs with finder-browser (same `section` host) for frame reloads after moves.
 */

const SEL = {
  rowLine: ".finder-tree__row-line",
  folderLi: "li.finder-tree__node--folder",
  fileLi: "li.finder-tree__node--file",
  ignoreClick: ".finder-tree__row-actions, .finder-folder-name-input, .finder-tree__row--pending",
  focusableRow: "a.finder-tree__row--folder, a.finder-tree__row--file, span.finder-tree__row--file"
}

const DRAG_KIND = { FOLDER: "folder", FILE: "file" }

function finderDroppedFilesFromDataTransfer(dt) {
  const files = dt?.files
  if (!files?.length) return []
  return Array.from(files)
}

export default class extends Controller {
  static values = { frameId: String }

  connect() {
    this._dragDocumentId = null
    this._dragKind = null
    this._dropTargetLine = null
    this._suppressNextFolderRowClick = false
    this._suppressNextFileRowClick = false

    this.boundSuppressClickAfterDrag = this._onSuppressClickAfterDrag.bind(this)
    this.boundFolderClick = this._onFolderClickCapture.bind(this)
    this.boundPointerDownCapture = this._onPointerDownCapture.bind(this)
    this.boundDragStart = this._onDragStart.bind(this)
    this.boundDragEnd = this._onDragEnd.bind(this)
    this.boundDragOver = this._onDragOver.bind(this)
    this.boundDrop = this._onDrop.bind(this)

    this.element.addEventListener("pointerdown", this.boundPointerDownCapture, true)
    this.element.addEventListener("click", this.boundSuppressClickAfterDrag, true)
    this.element.addEventListener("click", this.boundFolderClick, true)
    this.element.addEventListener("keydown", this._onKeydown)
    this.element.addEventListener("dragstart", this.boundDragStart)
    this.element.addEventListener("dragend", this.boundDragEnd)
    this.element.addEventListener("dragover", this.boundDragOver)
    this.element.addEventListener("drop", this.boundDrop)

    requestAnimationFrame(() => this._hydrateExpandedFromStorage())
  }

  disconnect() {
    this.element.removeEventListener("pointerdown", this.boundPointerDownCapture, true)
    this.element.removeEventListener("click", this.boundSuppressClickAfterDrag, true)
    this.element.removeEventListener("click", this.boundFolderClick, true)
    this.element.removeEventListener("keydown", this._onKeydown)
    this.element.removeEventListener("dragstart", this.boundDragStart)
    this.element.removeEventListener("dragend", this.boundDragEnd)
    this.element.removeEventListener("dragover", this.boundDragOver)
    this.element.removeEventListener("drop", this.boundDrop)
  }

  _browserController() {
    return this.application.getControllerForElementAndIdentifier(this.element, "finder-browser")
  }

  _readOnly() {
    return this._browserController()?.readOnlyValue === true
  }

  _folderLinkFromLi(li) {
    return (
      li.querySelector(":scope > .finder-tree__row-line a.finder-tree__row--folder") ||
      li.querySelector(":scope > a.finder-tree__row--folder")
    )
  }

  _rowLineInTree(eventTarget) {
    const line = eventTarget.closest?.(SEL.rowLine)
    if (!line || !this.element.contains(line)) return null
    return line
  }

  _focusIfNeeded(el) {
    if (el && typeof el.focus === "function") el.focus({ preventScroll: true })
  }

  _onPointerDownCapture(event) {
    const activeRenameInput = this.element.querySelector(".finder-tree__pending-name-input")
    if (!activeRenameInput) return
    // Any click while inline rename is active (inside or outside the input)
    // should not trigger folder/file row activation in the same interaction.
    this._suppressNextFolderRowClick = true
    this._suppressNextFileRowClick = true
  }

  _onSuppressClickAfterDrag(event) {
    if (!this._suppressNextFileRowClick) return
    const line = this._rowLineInTree(event.target)
    if (!line) return
    const li = line.parentElement
    if (!li?.matches?.(SEL.fileLi)) return
    this._suppressNextFileRowClick = false
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  _onFolderClickCapture(event) {
    if (this._suppressNextFolderRowClick) {
      this._suppressNextFolderRowClick = false
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    if (event.button !== 0) return
    if (event.target.closest?.(SEL.ignoreClick)) return

    const line = this._rowLineInTree(event.target)
    if (!line) return

    const li = line.parentElement
    if (!li?.matches?.(SEL.folderLi) || li.dataset.pendingNewFolder === "true") return

    const link = this._folderLinkFromLi(li)
    if (!link) return

    event.preventDefault()
    event.stopImmediatePropagation()

    const nested = li.querySelector(":scope > ul.finder-tree")
    if (nested) {
      if (li.classList.contains("is-collapsed")) {
        this._activateFolder(link, li)
      } else {
        this.element.querySelectorAll(".finder-tree__row-line.is-selected").forEach((l) => l.classList.remove("is-selected"))
        this._setFolderCollapsed(li, true)
        const id = li.dataset.finderTreeNodeId
        if (id) this._syncBrowseUrl(id)
      }
      this._focusIfNeeded(link)
      return
    }

    this._activateFolder(link, li)
    this._focusIfNeeded(link)
  }

  _activateFolder(link, li) {
    this.element.querySelectorAll(".finder-tree__row-line.is-selected").forEach((l) => l.classList.remove("is-selected"))
    link.closest(SEL.rowLine)?.classList.add("is-selected")
    this._expandPathToFolder(li)
    const id = li.dataset.finderTreeNodeId
    if (id) this._syncBrowseUrl(id)
  }

  _expandPathToFolder(li) {
    let cur = li
    while (cur?.matches?.("li.finder-tree__node")) {
      if (cur.classList.contains("finder-tree__node--folder")) {
        const nested = cur.querySelector(":scope > ul.finder-tree")
        if (nested) this._setFolderCollapsed(cur, false, { skipPersist: true })
      }
      const ul = cur.parentElement
      if (!ul?.classList.contains("finder-tree")) break
      cur = ul.parentElement
    }
  }

  _syncBrowseUrl(browseId) {
    const rootId = this._browserController()?.rootFolderIdValue
    if (rootId) finderWriteExpandedFolderIds(rootId, finderCollectExpandedFolderIdsFromDom(this.element))

    if (this._readOnly()) return

    let url
    try {
      url = new URL(window.location.href)
    } catch (_e) {
      return
    }
    const fid = this.frameIdValue
    if (fid) url.searchParams.set("frame_id", fid)
    url.searchParams.set("browse_id", String(browseId))
    this._applyExpandedIdsToUrl(url)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }

  _persistExpandedToStorageAndUrl() {
    const rootId = this._browserController()?.rootFolderIdValue
    if (!rootId) return
    const expanded = finderCollectExpandedFolderIdsFromDom(this.element)
    finderWriteExpandedFolderIds(rootId, expanded)
    if (this._readOnly()) return

    let url
    try {
      url = new URL(window.location.href)
    } catch (_e) {
      return
    }
    this._applyExpandedIdsToUrl(url)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }

  _applyExpandedIdsToUrl(url) {
    const expanded = finderCollectExpandedFolderIdsFromDom(this.element)
    if (expanded.length > 0) url.searchParams.set("expanded_ids", [...new Set(expanded)].sort().join(","))
    else url.searchParams.delete("expanded_ids")
  }

  /** When the frame loads without expanded_ids (e.g. cold navigation), reopen folders from sessionStorage. */
  _hydrateExpandedFromStorage() {
    const rootId = this._browserController()?.rootFolderIdValue
    if (!rootId) return
    const stored = new Set(finderReadExpandedFolderIds(rootId))
    if (stored.size === 0) return

    stored.forEach((id) => {
      const li = finderQueryLiByNodeId(this.element, id)
      if (!li?.matches?.("li.finder-tree__node--folder")) return
      let cur = li
      while (cur) {
        if (cur.classList.contains("finder-tree__node--folder")) {
          const link = this._folderLinkFromLi(cur)
          const nested = cur.querySelector(":scope > ul.finder-tree")
          if (nested && link) {
            cur.classList.remove("is-collapsed")
            link.setAttribute("aria-expanded", "true")
          }
        }
        const ul = cur.parentElement
        if (!ul?.classList.contains("finder-tree")) break
        cur = ul.parentElement
        if (!cur?.matches?.("li.finder-tree__node--folder")) break
      }
    })

    this._persistExpandedToStorageAndUrl()
  }

  _setFolderCollapsed(li, collapsed, { skipPersist = false } = {}) {
    const nested = li.querySelector(":scope > ul.finder-tree")
    const link = this._folderLinkFromLi(li)
    if (!nested || !link) return false
    li.classList.toggle("is-collapsed", collapsed)
    link.setAttribute("aria-expanded", String(!collapsed))
    if (collapsed) li.querySelector(":scope > .finder-tree__row-line")?.classList.remove("is-selected")
    if (!skipPersist) this._persistExpandedToStorageAndUrl()
    return true
  }

  _onKeydown = (event) => {
    const key = event.key
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "ArrowLeft" && key !== "ArrowRight") return

    const target = event.target
    if (target.closest?.("input, textarea, select, [contenteditable]")) return
    if (!this.element.contains(target)) return

    if (key === "ArrowLeft" || key === "ArrowRight") {
      const link = target.closest?.("a.finder-tree__row--folder")
      const li = link?.closest?.(SEL.folderLi)
      if (!li || !this.element.contains(li) || li.dataset.pendingNewFolder === "true") return
      const nested = li.querySelector(":scope > ul.finder-tree")
      if (!nested) return

      event.preventDefault()
      const collapsed = li.classList.contains("is-collapsed")
      if (key === "ArrowRight") {
        if (collapsed) this._setFolderCollapsed(li, false)
      } else if (!collapsed) {
        this._setFolderCollapsed(li, true)
      }
      return
    }

    const rows = this._visibleRows()
    if (rows.length === 0) return

    event.preventDefault()

    let i = rows.findIndex((row) => row === document.activeElement || row.contains(document.activeElement))
    if (i < 0) {
      const sel = rows.find((row) => row.closest(SEL.rowLine)?.classList.contains("is-selected"))
      i = sel ? rows.indexOf(sel) : 0
    }

    if (event.key === "ArrowDown") i = Math.min(rows.length - 1, i + 1)
    else i = Math.max(0, i - 1)

    const next = rows[i]
    this._focusIfNeeded(next)
    next?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }

  _visibleRows() {
    return [...this.element.querySelectorAll(SEL.focusableRow)].filter((row) => row.offsetParent !== null)
  }

  _onDragStart(event) {
    if (this._readOnly()) return

    if (event.target.closest?.(".finder-tree__row-actions")) {
      event.preventDefault()
      return
    }

    const line = this._rowLineInTree(event.target)
    if (!line || line.getAttribute("draggable") !== "true") return

    const li = line.parentElement
    if (li.dataset.pendingNewFolder === "true") {
      event.preventDefault()
      return
    }

    const isFolder = li.matches(SEL.folderLi)
    const isFile = li.matches(SEL.fileLi)
    if (!isFolder && !isFile) {
      event.preventDefault()
      return
    }

    const id = li.dataset.finderTreeNodeId
    if (!id) {
      event.preventDefault()
      return
    }

    this._dragDocumentId = id
    this._dragKind = isFolder ? DRAG_KIND.FOLDER : DRAG_KIND.FILE
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", id)
    line.classList.add("finder-tree__row-line--dragging")
  }

  _onDragEnd(event) {
    this._clearDropTargetLine()
    const kind = this._dragKind
    this._dragDocumentId = null
    this._dragKind = null
    this.element.querySelectorAll(".finder-tree__row-line--dragging").forEach((l) => l.classList.remove("finder-tree__row-line--dragging"))

    const effect = event.dataTransfer?.dropEffect
    if (effect === "move" || effect === "copy") {
      if (kind === DRAG_KIND.FILE) this._suppressNextFileRowClick = true
      else if (kind === DRAG_KIND.FOLDER) this._suppressNextFolderRowClick = true
    }
  }

  _folderDropTargetFromEvent(event) {
    const line = this._rowLineInTree(event.target)
    if (line) {
      const li = line.parentElement
      if (!li?.matches?.(SEL.folderLi) || li.dataset.pendingNewFolder === "true") return null
      const targetId = li.dataset.finderTreeNodeId
      if (!targetId) return null
      if (li.dataset.finderFolderWritable === "false") return null
      return { li, line, targetId }
    }

    return null
  }

  _dropWouldReparent(dragKind, dragId, targetId, draggedLi, targetLi) {
    if (dragKind === DRAG_KIND.FOLDER) {
      if (String(targetId) === String(dragId)) return false
      if (draggedLi?.contains(targetLi)) return false
      return true
    }
    const curParent = this._parentFolderIdForTreeLi(draggedLi)
    if (curParent != null && String(curParent) === String(targetId)) return false
    return true
  }

  _onDragOver(event) {
    if (this._readOnly()) return

    const dt = event.dataTransfer
    const types = dt?.types ? Array.from(dt.types) : []
    const hasExternalFiles = types.includes("Files")

    if (hasExternalFiles) {
      const target = this._folderDropTargetFromEvent(event)
      if (!target) {
        this._clearDropTargetLine()
        return
      }
      event.preventDefault()
      dt.dropEffect = "copy"
      this._setDropTargetLine(target.line)
      return
    }

    if (!this._dragDocumentId || !this._dragKind) return

    const target = this._folderDropTargetFromEvent(event)
    if (!target) {
      this._clearDropTargetLine()
      return
    }

    const draggedLi = finderQueryLiByNodeId(this.element, this._dragDocumentId)
    if (!this._dropWouldReparent(this._dragKind, this._dragDocumentId, target.targetId, draggedLi, target.li)) {
      this._clearDropTargetLine()
      return
    }

    event.preventDefault()
    dt.dropEffect = "move"
    this._setDropTargetLine(target.line)
  }

  async _onDrop(event) {
    if (this._readOnly()) return

    const dt = event.dataTransfer
    const target = this._folderDropTargetFromEvent(event)
    const droppedFiles = finderDroppedFilesFromDataTransfer(dt)
    const hasDroppedFiles = dt?.files?.length > 0

    if (hasDroppedFiles) {
      if (!target) {
        this._clearDropTargetLine()
        return
      }
      event.preventDefault()
      event.stopPropagation()
      this._clearDropTargetLine()

      if (droppedFiles.length === 0) {
        return
      }

      const formData = new FormData()
      droppedFiles.forEach((file) => formData.append("files[]", file))

      const response = await fetch(`/documents/${encodeURIComponent(target.targetId)}/upload_images`, {
        method: "POST",
        headers: finderMultipartHeaders(),
        body: formData
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        window.alert(data.error || "Could not upload files.")
        return
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        window.alert(data.errors.join("\n"))
      }

      this._browserController()?.reloadFramePreservingBrowse?.()
      return
    }

    if (!this._dragDocumentId || !this._dragKind) return

    if (!target) return

    const draggedLi = finderQueryLiByNodeId(this.element, this._dragDocumentId)
    if (!this._dropWouldReparent(this._dragKind, this._dragDocumentId, target.targetId, draggedLi, target.li)) return

    event.preventDefault()
    event.stopPropagation()

    const draggedId = this._dragDocumentId
    const kind = this._dragKind
    this._clearDropTargetLine()

    const action = kind === DRAG_KIND.FOLDER ? "move_folder" : "move_file"
    const response = await fetch(`/documents/${encodeURIComponent(draggedId)}/${action}`, {
      method: "POST",
      headers: finderApiHeaders({ jsonBody: true }),
      body: JSON.stringify({ parent_id: Number(target.targetId) })
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(data.error || (kind === DRAG_KIND.FOLDER ? "Could not move folder." : "Could not move file."))
      return
    }

    this._browserController()?.reloadFramePreservingBrowse?.()
  }

  _setDropTargetLine(line) {
    if (this._dropTargetLine === line) return
    this._clearDropTargetLine()
    this._dropTargetLine = line
    line.classList.add("finder-tree__row-line--drop-target")
  }

  _clearDropTargetLine() {
    if (this._dropTargetLine) {
      this._dropTargetLine.classList.remove("finder-tree__row-line--drop-target")
      this._dropTargetLine = null
    }
  }

  /** Parent folder document id for a tree `li`, or Finder 2 root id when the row is under the root `<ul>`. */
  _parentFolderIdForTreeLi(li) {
    if (!li) return null
    const ul = li.parentElement
    if (!ul?.classList.contains("finder-tree")) return null
    const parentLi = ul.parentElement
    if (parentLi?.matches?.(SEL.folderLi)) {
      const pid = parentLi.dataset.finderTreeNodeId
      return pid != null ? String(pid) : null
    }
    if (ul.classList.contains("finder-tree--root")) {
      const rid = this._browserController()?.rootFolderIdValue
      return rid != null ? String(rid) : null
    }
    return null
  }
}
