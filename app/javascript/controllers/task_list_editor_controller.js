import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"
import { NEXUS_CLICKABLE_ROW_MAIN_CLASS } from "lib/nexus_ui"
import {
  clearLinkedAppPickerDraft,
  readLinkedAppPickerDraft,
  LINKED_APP_BEFORE_SAVE_PICKER,
  writeLinkedAppPickerDraft
} from "lib/linked_app_picker_draft"

const TASK_ROW_DRAG_MIME = "application/x-nexus-task-row"

// Landing marker is updated in dragover; source commits the move on dragend.
let activeDrag = null

function taskToggleMarkup(checked) {
  return checked ? materialSymbolSvg("check", "xs") : materialSymbolSvg("circle_outline", "xs")
}

export default class extends Controller {
  static targets = ["contentShell", "list", "payload"]

  connect() {
    this.boundWindowState = this.handleWindowState.bind(this)
    this.boundRequestSave = this.handleRequestSave.bind(this)
    this.boundTaskListAddFromChrome = this.handleTaskListAddFromChrome.bind(this)
    this.boundBeforeSavePicker = this.handleBeforeSavePicker.bind(this)
    this.boundRemoteTaskListChanged = this.handleRemoteTaskListChanged.bind(this)
    this.boundSyncPayloadInput = () => this.#syncPayload()
    window.addEventListener("app-window:state", this.boundWindowState)
    window.addEventListener("nexus:task-list-add-task", this.boundTaskListAddFromChrome)
    window.addEventListener("nexus:task-list-remote-changed", this.boundRemoteTaskListChanged)
    window.addEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    document.addEventListener("nexus:request-save", this.boundRequestSave)
    if (this.hasListTarget) {
      this.listTarget.addEventListener("input", this.boundSyncPayloadInput, true)
      this.boundListPointerDownCapture = this.handleListPointerDownCapture.bind(this)
      this.boundListPointerMove = this.handleListPointerMove.bind(this)
      this.boundListPointerLeave = this.handleListPointerLeave.bind(this)
      this.listTarget.addEventListener("pointerdown", this.boundListPointerDownCapture, true)
      this.listTarget.addEventListener("pointermove", this.boundListPointerMove)
      this.listTarget.addEventListener("pointerleave", this.boundListPointerLeave)
    }
    this.dragState = null
    this.suppressNextClick = false
    this.hoveredRow = null
    this.pointerTrackingSuspended = false
    this.lastPointerX = null
    this.lastPointerY = null
    this.awaitingFreshPointerMove = false
    if (!this.#restorePickerDraftIfAny()) this.#refreshAll()
    this.#normalizeEmptyMarker()
  }

  disconnect() {
    document.removeEventListener("nexus:request-save", this.boundRequestSave)
    window.removeEventListener("nexus:task-list-add-task", this.boundTaskListAddFromChrome)
    window.removeEventListener("nexus:task-list-remote-changed", this.boundRemoteTaskListChanged)
    window.removeEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    if (this.hasListTarget && this.boundSyncPayloadInput) {
      this.listTarget.removeEventListener("input", this.boundSyncPayloadInput, true)
    }
    if (this.hasListTarget && this.boundListPointerDownCapture) {
      this.listTarget.removeEventListener("pointerdown", this.boundListPointerDownCapture, true)
    }
    if (this.hasListTarget && this.boundListPointerMove) {
      this.listTarget.removeEventListener("pointermove", this.boundListPointerMove)
    }
    if (this.hasListTarget && this.boundListPointerLeave) {
      this.listTarget.removeEventListener("pointerleave", this.boundListPointerLeave)
    }
    if (this.autosaveTimer) {
      window.clearTimeout(this.autosaveTimer)
      this.autosaveTimer = null
    }
    if (activeDrag && activeDrag.sourceController === this) activeDrag = null
    if (activeDrag?.marker?.controller === this) activeDrag.marker = null
    this.#clearHover()
    this.#clearDragVisualState()
    window.removeEventListener("app-window:state", this.boundWindowState)
  }

  handleListPointerMove(event) {
    if (this.pointerTrackingSuspended) return
    if (typeof event?.clientX === "number") this.lastPointerX = event.clientX
    if (typeof event?.clientY === "number") this.lastPointerY = event.clientY
    this.awaitingFreshPointerMove = false
    const row = event?.target?.closest?.(".task-item-row") || null
    this.#setHovered(row)
  }

  handleListPointerLeave() {
    this.lastPointerX = null
    this.lastPointerY = null
    this.#setHovered(null)
  }

  handleListPointerDownCapture(event) {
    const activeInput = this.#activeEditInput()
    if (!activeInput) return
    if (event.target instanceof Element && event.target.closest(".task-edit-input")) return
    // Allow blur/commit to run, but suppress the click that would otherwise toggle/select the row.
    this.suppressNextClick = true
  }

  #setHovered(row) {
    if (this.hoveredRow === row) return
    if (this.pointerTrackingSuspended && row) return
    this.#clearHover()
    this.hoveredRow = row && row.isConnected ? row : null
    if (this.hoveredRow) this.hoveredRow.classList.add("is-hovered")
  }

  #clearHover() {
    if (this.hasListTarget) {
      this.listTarget.querySelectorAll(".task-item-row.is-hovered").forEach((r) => {
        r.classList.remove("is-hovered")
      })
    }
    this.hoveredRow = null
  }

  #reevaluateHoverAtPointer() {
    if (!this.hasListTarget || this.pointerTrackingSuspended) return
    const prev = this.listTarget.style.pointerEvents
    this.listTarget.style.pointerEvents = "none"
    void this.listTarget.offsetHeight
    this.listTarget.style.pointerEvents = prev
    if (this.hasContentShellTarget && !this.contentShellTarget.matches(":hover")) {
      this.#setHovered(null)
      return
    }
    if (this.awaitingFreshPointerMove) {
      this.#setHovered(null)
      return
    }
    if (this.lastPointerX == null || this.lastPointerY == null) {
      this.#setHovered(null)
      return
    }
    const element = document.elementFromPoint(this.lastPointerX, this.lastPointerY)
    if (!element || !this.listTarget.contains(element)) {
      this.#setHovered(null)
      return
    }
    const row = element.closest(".task-item-row")
    this.#setHovered(row && this.listTarget.contains(row) ? row : null)
  }

  handleDragLeave(event) {
    if (!this.hasContentShellTarget) return
    if (event.currentTarget !== this.contentShellTarget) return
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && this.contentShellTarget.contains(nextTarget)) return
    this.#clearDropIndicators()
    this.#clearActiveMarkerForSelf()
    if (!this.dragState) this.#clearDragVisualState()
    this.#setHovered(null)
  }

  handleTaskListAddFromChrome(event) {
    const frame = this.element.closest("turbo-frame")
    const id = event.detail?.frameId
    if (id && frame && frame.id !== id) return
    if (!this.hasListTarget) return
    this.addTask({ preventDefault() {} })
  }

  handleRemoteTaskListChanged(event) {
    const detail = event?.detail || {}
    const incomingDocumentId = Number(detail.document_id)
    const linkedDocumentId = Number(this.element.dataset.taskListLinkedDocumentId || 0)
    if (!Number.isInteger(incomingDocumentId) || incomingDocumentId <= 0) return
    if (!Number.isInteger(linkedDocumentId) || linkedDocumentId <= 0) return
    if (incomingDocumentId !== linkedDocumentId) return
    if (!Array.isArray(detail.tasks)) return

    // Avoid clobbering local in-progress edits; next remote save will deliver again.
    if (this.#activeEditInput()) return
    if (this.autosaveTimer) return

    this.#applyRemoteTasks(detail.tasks)
  }

  handleRequestSave(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id) return
    this.#flushAllPendingEdits()
    this.#refreshAll()
  }

  handleBeforeSavePicker(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id || !this.hasListTarget || !this.hasPayloadTarget) return
    if (frame.getAttribute("data-linked-app-has-linked-document") === "true") {
      clearLinkedAppPickerDraft(frame.id)
      return
    }
    this.#flushAllPendingEdits()
    this.#syncPayload()
    writeLinkedAppPickerDraft(frame.id, { app: "task_list", tasksPayload: this.payloadTarget.value })
  }

  /** Commit every in-progress row edit (main or subtask) so payload + picker snapshot match the UI. */
  #flushAllPendingEdits() {
    if (!this.hasListTarget) return
    for (let i = 0; i < 32; i += 1) {
      const input = this.listTarget.querySelector(".task-edit-input")
      if (!input) break
      this.#finishEdit(input, true)
    }
  }

  #restorePickerDraftIfAny() {
    const frame = this.element.closest("turbo-frame")
    if (!frame || !this.hasListTarget || frame.getAttribute("data-linked-app-has-linked-document") === "true")
      return false
    const data = readLinkedAppPickerDraft(frame.id)
    if (!data || data.app !== "task_list" || data.tasksPayload == null) return false
    let tasks
    try {
      tasks = JSON.parse(data.tasksPayload)
    } catch (_e) {
      return false
    }
    if (!Array.isArray(tasks)) return false

    clearLinkedAppPickerDraft(frame.id)

    while (this.listTarget.firstChild) this.listTarget.removeChild(this.listTarget.firstChild)
    tasks.forEach((t) => {
      const subs = (Array.isArray(t?.subtasks) ? t.subtasks : []).map((s) => ({
        text: String(s?.text ?? ""),
        checked: Boolean(s?.checked)
      }))
      this.listTarget.appendChild(
        this.#buildMainTaskRow(String(t?.text ?? ""), Boolean(t?.checked), subs)
      )
    })
    this.#refreshAll()
    this.#triggerAutosave(0)
    if (this.#restoredTasksLookSubstantive(tasks)) window.nexusWorkspaceUnsaved = true
    return true
  }

  #restoredTasksLookSubstantive(tasks) {
    return tasks.some((t) => {
      if (String(t?.text ?? "").trim().length > 0) return true
      const subs = Array.isArray(t?.subtasks) ? t.subtasks : []
      return subs.some((s) => String(s?.text ?? "").trim().length > 0)
    })
  }

  handleWindowState(event) {
    if (event.detail?.appKey !== "tasks") return
    if (event.detail?.open !== false) return
    this.#flushAllPendingEdits()
  }

  addTask(event) {
    event.preventDefault()
    if (!this.#commitActiveEditIfAny()) return

    const existingUnnamedMain = this.#findUnnamedMainRow()
    if (existingUnnamedMain) {
      this.#startEditRow(existingUnnamedMain)
      this.#refreshAll()
      return
    }

    const row = this.#buildMainTaskRow("", false, [])
    this.listTarget.appendChild(row)
    this.#startEditRow(row)
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  handleListClick(event) {
    if (this.suppressNextClick) {
      this.suppressNextClick = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const row = event.target.closest(".task-item-row")
    if (!row) return

    const actionTarget = event.target.closest(".row-plus, .item-action-btn, .task-toggle")

    if (actionTarget?.matches(".row-plus")) {
      this.addSubtask(event)
      return
    }

    if (actionTarget?.matches(".item-action-delete")) {
      this.removeTask(event)
      return
    }

    if (actionTarget?.matches(".item-action-btn") && !actionTarget.classList.contains("item-action-delete")) {
      this.startEdit(event)
      return
    }

    this.#commitActiveEditIfAny(row)

    if (row.querySelector(".task-edit-input")) return

    event.preventDefault()
    
    // For main tasks with subtasks, toggle collapsed state instead of completion
    if (row.matches(".task-item-row--main")) {
      const subtasks = this.#subtasksFor(row)
      if (subtasks.length > 0) {
        this.#toggleCollapsed(row)
        this.#refreshAll()
        return
      }
    }

    this.#toggleRowComplete(row)
    this.#refreshAll()
    this.#triggerAutosave()
  }

  handleListKeydown(event) {
    const input = event.target.closest(".task-edit-input")
    if (!input) return

    if (event.key === "Enter") {
      event.preventDefault()
      this.#finishEdit(input, true)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      this.#finishEdit(input, false)
    }
  }

  handleDragStart(event) {
    activeDrag = null
    this.#ensureRowUids()
    const row = event.target.closest(".task-item-row")
    if (!row || row.querySelector(".task-edit-input")) {
      event.preventDefault()
      return
    }
    if (event.target.closest(".task-toggle, .row-plus, .item-action-btn, .task-edit-input")) {
      event.preventDefault()
      return
    }

    const mode = row.matches(".task-item-row--main") ? "main" : "subtask"
    if (mode === "subtask") {
      const mainRow = this.#findMainRowForSubtask(row)
      if (!mainRow) {
        event.preventDefault()
        return
      }
      this.dragState = { mode, row, mainRow, rows: [row] }
    } else {
      this.dragState = { mode, row, rows: this.#mainGroupRows(row) }
    }

    row.classList.add("task-item-row--dragging")
    this.#markDragActive()
    this.pointerTrackingSuspended = true
    this.lastPointerX = null
    this.lastPointerY = null
    this.awaitingFreshPointerMove = true
    this.#clearHover()

    activeDrag = {
      sourceController: this,
      mode,
      marker: null
    }

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move"
      event.dataTransfer.setData(TASK_ROW_DRAG_MIME, "1")
      event.dataTransfer.setData("text/plain", "task-row")
    }
  }

  handleDragOver(event) {
    if (this.dragState) {
      this.#markDragActive()
      const drop = this.#resolveDrop(event, this.dragState.rows, this.dragState.mode, false)
      this.#clearDropIndicators()
      if (!drop) {
        this.#clearActiveMarkerForSelf()
        return
      }
      event.preventDefault()
      this.#renderDropIndicator(drop)
      this.#setActiveMarkerForSelf(drop)
      return
    }

    if (!this.#canAcceptExternalDrag(event)) return
    this.#markDragActive()
    const drop = this.#resolveDrop(event, [], "main", true)
    this.#clearDropIndicators()
    if (!drop) {
      this.#clearActiveMarkerForSelf()
      return
    }
    event.preventDefault()
    this.#renderDropIndicator(drop)
    this.#setActiveMarkerForSelf(drop)
  }

  handleDrop(event) {
    if (this.dragState || this.#canAcceptExternalDrag(event)) event.preventDefault()
    this.#clearDropIndicators()
  }

  handleDragEnd() {
    const moved = this.#commitActiveDragMarker()
    if (moved) {
      this.suppressNextClick = true
      this.#refreshAll()
      this.#triggerAutosave(0)
    }
    this.#endSourceDrag({ clearRegistry: true })
    window.setTimeout(() => {
      this.pointerTrackingSuspended = false
      this.awaitingFreshPointerMove = true
      this.#reevaluateHoverAtPointer()
    }, 0)
  }

  #canAcceptExternalDrag(event) {
    const mimeAnnounced = event.dataTransfer?.types?.includes(TASK_ROW_DRAG_MIME)
    return Boolean(
      mimeAnnounced &&
      activeDrag &&
      activeDrag.sourceController !== this &&
      activeDrag.mode === "main"
    )
  }

  removeMainGroupByUid(mainUid) {
    if (!this.hasListTarget || !mainUid) return false
    const escaped = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
      ? CSS.escape(mainUid)
      : String(mainUid).replace(/"/g, "\\\"")
    const mainRow = this.listTarget.querySelector(`.task-item-row--main[data-row-uid="${escaped}"]`)
    if (!mainRow) return false

    this.#mainGroupRows(mainRow).forEach((r) => r.remove())
    this.#clearHover()
    this.#clearDragVisualState()
    this.#refreshAll()
    this.#triggerAutosave(0)
    this.pointerTrackingSuspended = false
    this.awaitingFreshPointerMove = true
    window.setTimeout(() => this.#reevaluateHoverAtPointer(), 0)
    return true
  }

  #setActiveMarkerForSelf(drop) {
    if (!activeDrag) return
    activeDrag.marker = {
      controller: this,
      where: drop.where,
      mode: drop.mode,
      row: drop.row || null,
      insertBeforeNode: drop.insertBeforeNode || null,
      isEmpty: Boolean(drop.isEmpty)
    }
  }

  #clearActiveMarkerForSelf() {
    if (!activeDrag?.marker) return
    if (activeDrag.marker.controller === this) activeDrag.marker = null
  }

  #commitActiveDragMarker() {
    if (!this.dragState || !activeDrag || activeDrag.sourceController !== this) return false
    const marker = activeDrag.marker
    if (!marker) return false
    if (marker.mode !== this.dragState.mode) return false

    if (marker.controller === this) {
      this.#applyWithinListDrop(marker)
      return true
    }

    if (this.dragState.mode !== "main") return false
    const destination = marker.controller
    if (!destination?.hasListTarget || !destination.element?.isConnected) return false
    return this.#applyCrossListDrop(destination, marker)
  }

  #applyCrossListDrop(destination, marker) {
    if (!this.dragState) return false
    const rows = [...this.dragState.rows].filter((r) => r && r.isConnected)
    if (rows.length === 0) return false

    let insertBeforeNode = marker.insertBeforeNode
    if (!(insertBeforeNode instanceof Node) || insertBeforeNode.parentElement !== destination.listTarget) {
      insertBeforeNode = null
    }

    rows.forEach((r) => {
      r.classList.remove("task-item-row--dragging", "is-hovered")
      r.remove()
    })
    rows.forEach((r) => destination.listTarget.insertBefore(r, insertBeforeNode))

    destination.pointerTrackingSuspended = true
    destination.#clearHover()
    destination.#clearDropIndicators()
    destination.#clearDragVisualState()
    destination.#refreshAll()
    destination.#triggerAutosave(0)
    window.setTimeout(() => {
      destination.pointerTrackingSuspended = false
      destination.awaitingFreshPointerMove = true
      destination.#reevaluateHoverAtPointer()
    }, 0)
    return true
  }

  #resolveDrop(event, excludeRows, mode, external) {
    if (!this.hasListTarget) return null
    const target = event.target.closest(".task-item-row")
    const clientY = event.clientY

    if (mode === "subtask") {
      if (external) return null
      if (!target) return null

      if (target.matches(".task-item-row--main")) {
        const rect = target.getBoundingClientRect()
        const where = clientY < rect.top + rect.height / 2 ? "before" : "after"
        if (where === "before") return null
        const anchor = this.#lastSubtaskFor(target) || target
        if (anchor === excludeRows[0]) return null
        return {
          row: anchor,
          where: "after",
          mode: "subtask",
          insertBeforeNode: anchor.nextElementSibling
        }
      }

      if (!target.matches(".task-item-row--subtask")) return null
      if (target === excludeRows[0]) return null

      const rect = target.getBoundingClientRect()
      const where = clientY < rect.top + rect.height / 2 ? "before" : "after"
      const insertBeforeNode = where === "before" ? target : target.nextElementSibling
      if (insertBeforeNode === excludeRows[0]) return null
      return { row: target, where, mode: "subtask", insertBeforeNode }
    }

    const allMain = Array.from(this.listTarget.querySelectorAll(".task-item-row--main"))
    const candidateMain = allMain.filter((r) => !excludeRows.includes(r))

    if (candidateMain.length === 0) {
      return {
        row: null,
        where: "empty",
        mode: "main",
        insertBeforeNode: null,
        isEmpty: true
      }
    }

    let anchorMain = null
    if (target) {
      const targetMain = target.matches(".task-item-row--main")
        ? target
        : this.#findMainRowForSubtask(target)
      if (targetMain && !excludeRows.includes(targetMain)) {
        anchorMain = targetMain
      }
    }
    if (!anchorMain) {
      let best = Number.POSITIVE_INFINITY
      candidateMain.forEach((main) => {
        const rect = main.getBoundingClientRect()
        const center = rect.top + rect.height / 2
        const dist = Math.abs(clientY - center)
        if (dist < best) {
          best = dist
          anchorMain = main
        }
      })
    }
    if (!anchorMain) return null

    const anchorRect = anchorMain.getBoundingClientRect()
    const where = clientY < anchorRect.top + anchorRect.height / 2 ? "before" : "after"
    const tail = this.#mainGroupTail(anchorMain)
    const nextMain = this.#nextMainRowSkipping(anchorMain, excludeRows)

    let drop
    if (where === "before") {
      drop = { row: anchorMain, where: "before", mode: "main", insertBeforeNode: anchorMain }
    } else if (nextMain) {
      drop = { row: tail, where: "gap-after", mode: "main", insertBeforeNode: nextMain }
    } else {
      drop = { row: tail, where: "tail", mode: "main", insertBeforeNode: null }
    }

    if (!external && excludeRows.length > 0) {
      const firstExcluded = excludeRows[0]
      const lastExcluded = excludeRows[excludeRows.length - 1]
      if (drop.insertBeforeNode === firstExcluded) return null
      if (drop.insertBeforeNode === lastExcluded.nextElementSibling) return null
    }
    return drop
  }

  #nextMainRowSkipping(mainRow, excludeRows) {
    let cursor = this.#mainGroupTail(mainRow).nextElementSibling
    while (cursor) {
      if (cursor.matches(".task-item-row--main") && !excludeRows.includes(cursor)) {
        return cursor
      }
      cursor = cursor.nextElementSibling
    }
    return null
  }

  #markDragActive() {
    if (this.hasListTarget) this.listTarget.classList.add("task-list-rows--drag-active")
    if (this.hasContentShellTarget) this.contentShellTarget.classList.add("task-list-content-shell--drag-active")
  }

  #clearDragVisualState() {
    if (this.hasListTarget) {
      this.listTarget.classList.remove("task-list-rows--drag-active", "task-list-rows--drop-tail")
    }
    if (this.hasContentShellTarget) {
      this.contentShellTarget.classList.remove("task-list-content-shell--drag-active", "task-list-content-shell--drop-empty")
    }
    this.#normalizeEmptyMarker()
  }

  #normalizeEmptyMarker() {
    if (!this.hasListTarget) return
    const hasRows = Boolean(this.listTarget.querySelector(".task-item-row"))
    this.listTarget.classList.toggle("task-list-rows--is-empty", !hasRows)
  }

  #renderDropIndicator(drop) {
    if (!drop) return
    if (drop.isEmpty) {
      if (this.hasContentShellTarget) this.contentShellTarget.classList.add("task-list-content-shell--drop-empty")
      this.listTarget.classList.add("task-list-rows--drop-tail")
      return
    }
    if (drop.where === "before" && drop.row) {
      drop.row.classList.add("task-item-row--drop-before")
      return
    }
    if (drop.mode === "subtask" && drop.where === "after" && drop.row) {
      drop.row.classList.add("task-item-row--drop-gap-after")
      return
    }
    if (drop.where === "gap-after") {
      const boundary = drop.insertBeforeNode
      if (boundary && boundary.classList?.contains("task-item-row")) {
        boundary.classList.add("task-item-row--drop-before")
      } else if (drop.row) {
        drop.row.classList.add("task-item-row--drop-gap-after")
      }
      return
    }
    if (drop.where === "tail") {
      this.listTarget.classList.add("task-list-rows--drop-tail")
    }
  }

  #clearDropIndicators() {
    if (this.hasContentShellTarget) this.contentShellTarget.classList.remove("task-list-content-shell--drop-empty")
    if (this.hasListTarget) {
      this.listTarget.classList.remove("task-list-rows--drop-tail")
      this.listTarget.querySelectorAll(".task-item-row--drop-before, .task-item-row--drop-after, .task-item-row--drop-gap-after").forEach((r) => {
        r.classList.remove("task-item-row--drop-before", "task-item-row--drop-after", "task-item-row--drop-gap-after")
      })
    }
  }

  #endSourceDrag({ clearRegistry }) {
    if (this.dragState?.rows?.length) {
      this.dragState.rows.forEach((r) => r.classList.remove("task-item-row--dragging", "is-hovered"))
    }
    if (this.hasListTarget) {
      this.listTarget.querySelectorAll(".task-item-row--dragging").forEach((r) => {
        r.classList.remove("task-item-row--dragging")
      })
    }
    this.#clearDropIndicators()
    this.#clearDragVisualState()
    this.#clearHover()
    this.dragState = null
    if (clearRegistry && activeDrag && activeDrag.sourceController === this) {
      activeDrag = null
    }
  }

  #applyWithinListDrop(drop) {
    if (!this.dragState) return

    if (drop.mode === "main") {
      const rows = [...this.dragState.rows]
      let insertBeforeNode = drop.insertBeforeNode
      while (insertBeforeNode && rows.includes(insertBeforeNode)) {
        insertBeforeNode = insertBeforeNode.nextElementSibling
      }
      rows.forEach((r) => r.remove())
      rows.forEach((r) => this.listTarget.insertBefore(r, insertBeforeNode))
      return
    }

    const row = this.dragState.row
    let insertBeforeNode = drop.insertBeforeNode
    if (insertBeforeNode === row) insertBeforeNode = row.nextElementSibling
    row.remove()
    this.listTarget.insertBefore(row, insertBeforeNode || null)
  }

  startEdit(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.target.closest(".task-item-row")
    if (!row) return

    const activeInput = row.querySelector(".task-edit-input")
    if (activeInput) {
      this.#finishEdit(activeInput, true)
      return
    }

    this.#startEditRow(row)
  }

  addSubtask(event) {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#commitActiveEditIfAny()) return

    const mainRow = event.target.closest(".task-item-row--main")
    if (!mainRow) return

    const existingUnnamedSubtask = this.#findUnnamedSubtaskRow(mainRow)
    if (existingUnnamedSubtask) {
      this.#startEditRow(existingUnnamedSubtask)
      this.#refreshAll()
      return
    }

    const subtaskRow = this.#buildSubtaskRow("", false)
    const insertionPoint = this.#lastSubtaskFor(mainRow)

    if (insertionPoint) {
      insertionPoint.insertAdjacentElement("afterend", subtaskRow)
    } else {
      mainRow.insertAdjacentElement("afterend", subtaskRow)
    }

    // Always expand parent when adding a subtask so the new row is visible.
    mainRow.dataset.collapsed = "false"


    this.#startEditRow(subtaskRow)
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  removeTask(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.target.closest(".task-item-row")
    if (!row) return

    const taskName = row.querySelector("[data-role='task-text']")?.textContent?.trim() || "task"
    if (!confirm(`Delete "${taskName}"?`)) return

    if (row.matches(".task-item-row--main")) {
      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
    } else if (row.matches(".task-item-row--subtask")) {
      // If removing last subtask, remove group classes from main
      const mainRow = this.#findMainRowForSubtask(row)
      row.remove()
      if (mainRow && this.#subtasksFor(mainRow).length === 0) {
        mainRow.classList.remove("task-item-group--head")
        mainRow.dataset.collapsed = "false"
      }
      this.#refreshAll()
      this.#triggerAutosave()
      return
    }

    row.remove()
    this.#refreshAll()
    this.#triggerAutosave()
  }

  #startEditRow(row) {
    const rowInput = row.querySelector(".task-edit-input")
    if (rowInput) {
      rowInput.focus()
      rowInput.select()
      return
    }

    this.#commitActiveEditIfAny(row)

    this.#clearEditingState()
    row.classList.add("is-editing")

    const textNode = row.querySelector("[data-role='task-text']")
    if (!textNode) return

    const currentValue = textNode.textContent.trim()
    const input = document.createElement("input")
    input.type = "text"
    input.className = "task-edit-input"
    input.value = currentValue
    input.dataset.originalValue = currentValue
    input.placeholder = row.matches(".task-item-row--subtask") ? "Subtask..." : "Task..."

    textNode.replaceWith(input)
    input.focus()
    input.select()

    this.#bindEditBlur(input)
  }

  #finishEdit(input, save) {
    const row = input.closest(".task-item-row")
    if (!row) return

    const originalValue = (input.dataset.originalValue || "").trim()
    let value = save ? input.value.trim() : originalValue

    // Finalization rule:
    // 1) Blank with original -> revert to original
    // 2) Blank without original (new row) -> delete row
    // 3) Non-blank -> save new value
    if (save && value.length === 0) {
      value = originalValue
    }

    if (value.length === 0) {
      this.#removeEditingRow(input)
      return
    }

    const text = document.createElement("span")
    text.dataset.role = "task-text"
    text.className = row.matches(".task-item-row--subtask") ? "task-item-text task-item-text--subtask" : "task-item-text"
    text.textContent = value

    input.replaceWith(text)

    row.classList.remove("is-editing")
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  #bindEditBlur(input) {
    input.addEventListener("blur", () => this.#finishEdit(input, true), { once: true })
  }

  #clearEditingState() {
    this.listTarget.querySelectorAll(".task-item-row.is-editing").forEach((row) => {
      row.classList.remove("is-editing")
    })
  }

  #activeEditInput(excludeRow = null) {
    const inputs = Array.from(this.listTarget.querySelectorAll(".task-edit-input"))
    if (!excludeRow) return inputs[0] || null
    return inputs.find((input) => !excludeRow.contains(input)) || null
  }

  #commitActiveEditIfAny(excludeRow = null) {
    const activeInput = this.#activeEditInput(excludeRow)
    if (!activeInput) return true
    this.#finishEdit(activeInput, true)
    return !activeInput.isConnected
  }

  #rowValue(row) {
    const input = row.querySelector(".task-edit-input")
    if (input) return input.value.trim()
    return row.querySelector("[data-role='task-text']")?.textContent.trim() || ""
  }

  #findUnnamedMainRow() {
    const mainRows = Array.from(this.listTarget.querySelectorAll(".task-item-row--main"))
    return mainRows.find((row) => this.#rowValue(row).length === 0) || null
  }

  #findUnnamedSubtaskRow(mainRow) {
    const subtasks = this.#subtasksFor(mainRow)
    return subtasks.find((row) => this.#rowValue(row).length === 0) || null
  }

  #removeEditingRow(input) {
    const row = input.closest(".task-item-row")
    if (!row) return

    if (row.matches(".task-item-row--main")) {
      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
      row.remove()
      this.#refreshAll()
      this.#triggerAutosave(0)
      return
    }

    if (row.matches(".task-item-row--subtask")) {
      const mainRow = this.#findMainRowForSubtask(row)
      row.remove()
      if (mainRow && this.#subtasksFor(mainRow).length === 0) {
        mainRow.classList.remove("task-item-group--head")
        mainRow.dataset.collapsed = "false"
      }
      this.#refreshAll()
      this.#triggerAutosave(0)
    }
  }

  #toggleRowComplete(row) {
    if (row.matches(".task-item-row--subtask")) {
      const isBeingChecked = !row.classList.contains("task-item-row--checked")
      row.classList.toggle("task-item-row--checked")
      if (isBeingChecked) this.#spawnConfetti(row)
      return
    }

    const subtasks = this.#subtasksFor(row)
    if (subtasks.length > 0) {
      const allSubtasksFilledAndChecked = subtasks.every((subtask) => {
        const text = subtask.querySelector("[data-role='task-text']")?.textContent.trim() || ""
        return text.length > 0 && subtask.classList.contains("task-item-row--checked")
      })

      if (!allSubtasksFilledAndChecked) return
      row.classList.add("task-item-row--checked")
      row.dataset.mainChecked = "true"
      this.#spawnConfetti(row)
      return
    }

    const isBeingChecked = row.dataset.mainChecked !== "true"
    row.dataset.mainChecked = row.dataset.mainChecked === "true" ? "false" : "true"
    
    if (isBeingChecked) {
      this.#spawnConfetti(row)
    }
  }

  #toggleCollapsed(row) {
    if (!row.matches(".task-item-row--main")) return

    const isCollapsed = row.dataset.collapsed === "true"
    row.dataset.collapsed = isCollapsed ? "false" : "true"
  }

  #subtasksFor(mainRow) {
    const subtasks = []
    let cursor = mainRow.nextElementSibling

    while (cursor && !cursor.matches(".task-item-row--main")) {
      if (cursor.matches(".task-item-row--subtask")) {
        subtasks.push(cursor)
      }
      cursor = cursor.nextElementSibling
    }

    return subtasks
  }

  #lastSubtaskFor(mainRow) {
    const subtasks = this.#subtasksFor(mainRow)
    return subtasks[subtasks.length - 1]
  }

  #findMainRowForSubtask(subtaskRow) {
    let cursor = subtaskRow.previousElementSibling
    while (cursor) {
      if (cursor.matches(".task-item-row--main")) {
        return cursor
      }
      cursor = cursor.previousElementSibling
    }
    return null
  }

  #buildMainTaskRow(text, checked, subtasks) {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--main organizer-row nexus-standard-row"
    row.draggable = true
    row.dataset.mainChecked = checked ? "true" : "false"
    row.dataset.hasSubtasks = subtasks.length > 0 ? "true" : "false"

    row.innerHTML =
      `<div class="organizer-row-left nexus-standard-row__main ${NEXUS_CLICKABLE_ROW_MAIN_CLASS}">` +
        '<span class="nexus-standard-row__leading">' +
          `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle task completion">${taskToggleMarkup(checked)}</span>` +
        "</span>" +
        `<span class="task-item-text" data-role="task-text">${this.#escapeHtml(text)}</span>` +
      "</div>" +
      '<div class="organizer-row-right">' +
        '<span class="task-progress-bar" aria-hidden="true"><span class="task-progress-bar-fill"></span></span>' +
        '<span class="task-progress-label"></span>' +
        `<span class="row-plus" title="Add subtask">${materialSymbolSvg("add", "xs")}</span>` +
        `<span class="item-action-btn" title="Rename">${materialSymbolSvg("edit", "xs")}</span>` +
        `<span class="item-action-btn item-action-delete" title="Delete">${materialSymbolSvg("delete", "xs")}</span>` +
      "</div>"

    const subtaskRows = subtasks.map((subtask) => this.#buildSubtaskRow(subtask.text, subtask.checked))
    if (subtaskRows.length > 0) row.classList.add("task-item-group--head")
    this.#insertRowsAfter(row, subtaskRows)

    return row
  }

  #insertRowsAfter(row, rows) {
    if (!rows.length) return

    if (!row.parentElement) {
      const pending = Array.isArray(row.__nexusPendingSubtaskRows) ? row.__nexusPendingSubtaskRows : []
      row.__nexusPendingSubtaskRows = [...pending, ...rows]
      return
    }

    let cursor = row
    rows.forEach((subtaskRow) => {
      cursor.insertAdjacentElement("afterend", subtaskRow)
      cursor = subtaskRow
    })
  }

  #materializePendingSubtasks(mainRow) {
    const pending = Array.isArray(mainRow.__nexusPendingSubtaskRows) ? mainRow.__nexusPendingSubtaskRows : []
    if (!pending.length) return

    let cursor = mainRow
    pending.forEach((subtaskRow) => {
      cursor.insertAdjacentElement("afterend", subtaskRow)
      cursor = subtaskRow
    })

    mainRow.__nexusPendingSubtaskRows = []
  }

  #buildSubtaskRow(text, checked) {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--subtask organizer-row nexus-standard-row task-item-group--child"
    row.draggable = true
    if (checked) row.classList.add("task-item-row--checked")

    row.innerHTML =
      `<div class="organizer-row-left nexus-standard-row__main ${NEXUS_CLICKABLE_ROW_MAIN_CLASS}">` +
        '<span class="nexus-standard-row__leading">' +
          `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle subtask completion">${taskToggleMarkup(checked)}</span>` +
        "</span>" +
        `<span class="task-item-text task-item-text--subtask" data-role="task-text">${this.#escapeHtml(text)}</span>` +
      "</div>" +
      '<div class="organizer-row-right">' +
        `<span class="item-action-btn" title="Rename">${materialSymbolSvg("edit", "xs")}</span>` +
        `<span class="item-action-btn item-action-delete" title="Delete">${materialSymbolSvg("delete", "xs")}</span>` +
      "</div>"

    return row
  }

  #refreshAll() {
    this.#clearHover()
    this.#ensureRowUids()
    const mainRows = Array.from(this.listTarget.querySelectorAll(".task-item-row--main"))

    mainRows.forEach((mainRow) => {
      this.#materializePendingSubtasks(mainRow)
      const subtasks = this.#subtasksFor(mainRow)
      const subtaskCount = subtasks.length
      const checkedSubtasks = subtasks.filter((row) => row.classList.contains("task-item-row--checked")).length
      if (subtaskCount === 0) mainRow.dataset.collapsed = "false"
      const isCollapsed = mainRow.dataset.collapsed === "true"
      mainRow.dataset.hasSubtasks = subtaskCount > 0 ? "true" : "false"

      if (subtaskCount > 0) {
        const completion = checkedSubtasks / subtaskCount
        mainRow.style.setProperty("--completion", completion.toString())

        const allFilledAndChecked = subtasks.every((subtask) => {
          const text = subtask.querySelector("[data-role='task-text']")?.textContent.trim() || ""
          return text.length > 0 && subtask.classList.contains("task-item-row--checked")
        })

        mainRow.classList.toggle("task-item-row--checked", allFilledAndChecked)
        mainRow.dataset.mainChecked = allFilledAndChecked ? "true" : "false"
      } else {
        const mainChecked = mainRow.dataset.mainChecked === "true"
        mainRow.style.setProperty("--completion", mainChecked ? "1" : "0")
        mainRow.classList.toggle("task-item-row--checked", mainChecked)
      }

      const mainChecked = mainRow.dataset.mainChecked === "true"
      const mainToggle = mainRow.querySelector(".task-toggle")
      if (mainToggle) mainToggle.innerHTML = taskToggleMarkup(mainChecked)

      const fill = mainRow.querySelector(".task-progress-bar-fill")
      const label = mainRow.querySelector(".task-progress-label")
      if (fill) fill.style.removeProperty("width")

      if (label) {
        label.textContent = subtaskCount > 0 ? `${checkedSubtasks}/${subtaskCount}` : ""
      }

      mainRow.classList.toggle("task-item-group--head", subtaskCount > 0 && !isCollapsed)
      mainRow.classList.toggle("task-item-group--tail", subtaskCount === 0 || isCollapsed)
      subtasks.forEach((subtask, index) => {
        subtask.classList.toggle("is-collapsed", isCollapsed)
        subtask.setAttribute("aria-hidden", isCollapsed ? "true" : "false")
        subtask.classList.add("task-item-group--child")
        subtask.classList.toggle("task-item-group--tail", index === subtaskCount - 1)

        const subToggle = subtask.querySelector(".task-toggle")
        if (subToggle) subToggle.innerHTML = taskToggleMarkup(subtask.classList.contains("task-item-row--checked"))
      })
    })

    this.#syncPayload()
    this.#normalizeEmptyMarker()
  }

  #ensureRowUids() {
    let next = 1
    this.listTarget.querySelectorAll(".task-item-row").forEach((row) => {
      if (!row.dataset.rowUid) {
        row.dataset.rowUid = `task-row-${Date.now().toString(36)}-${next}`
        next += 1
      }
    })
  }

  #mainGroupRows(mainRow) {
    return [mainRow, ...this.#subtasksFor(mainRow)]
  }

  #mainGroupTail(mainRow) {
    return this.#lastSubtaskFor(mainRow) || mainRow
  }

  #rowTextForSync(row) {
    const input = row.querySelector(".task-edit-input")
    if (input) return input.value.trim()
    return row.querySelector("[data-role='task-text']")?.textContent.trim() || ""
  }

  #syncPayload() {
    if (!this.hasPayloadTarget) return

    const tasks = []
    const rows = Array.from(this.listTarget.querySelectorAll(".task-item-row"))

    rows.forEach((row) => {
      if (!row.matches(".task-item-row--main")) return

      const text = this.#rowTextForSync(row)
      const subtasks = this.#subtasksFor(row).map((subtask) => ({
        text: this.#rowTextForSync(subtask),
        checked: subtask.classList.contains("task-item-row--checked")
      })).filter((subtask) => subtask.text.length > 0)

      if (!text && subtasks.length === 0) return

      const checked = subtasks.length > 0
        ? subtasks.every((subtask) => subtask.checked)
        : row.dataset.mainChecked === "true"

      tasks.push({ text, checked, subtasks })
    })

    this.payloadTarget.value = JSON.stringify(tasks)
  }

  #applyRemoteTasks(tasks) {
    if (!this.hasListTarget) return

    while (this.listTarget.firstChild) this.listTarget.removeChild(this.listTarget.firstChild)

    tasks.forEach((task) => {
      const text = String(task?.text || "")
      const checked = Boolean(task?.checked)
      const subtasks = (Array.isArray(task?.subtasks) ? task.subtasks : []).map((subtask) => ({
        text: String(subtask?.text || ""),
        checked: Boolean(subtask?.checked)
      }))

      const row = this.#buildMainTaskRow(text, checked, subtasks)
      this.listTarget.appendChild(row)
    })

    this.#refreshAll()
  }

  #triggerAutosave(delay = 80) {
    const form = this.element.querySelector("form") || this.listTarget.closest("form")
    if (!form) return

    if (this.autosaveTimer) window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = window.setTimeout(() => {
      form.dispatchEvent(new Event("autosave:trigger", { bubbles: true }))
      this.autosaveTimer = null
    }, delay)
  }

  #escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  }

  #spawnConfetti(row) {
    const toggle = row.querySelector(".task-toggle")
    if (!toggle) {
      console.warn("No toggle found on row", row)
      return
    }

    const colors = ["#ef4444", "#22c55e", "#3b82f6", "#facc15", "#f97316", "#a855f7", "#06b6d4", "#ec4899"]
    const duration = 375
    const particleCount = 8
    const startDist = 1
    const endDist = 5

    const icon = toggle.querySelector("svg, .material-icon") || toggle
    const iconRect = icon.getBoundingClientRect()
    const iconCenterX = iconRect.left + iconRect.width / 2
    const iconCenterY = iconRect.top + iconRect.height / 2

    colors.forEach((color, i) => {
      const particle = document.createElement("div")
      particle.className = "task-confetti-particle"

      const angle = (i / particleCount) * 360
      const angleRad = (angle * Math.PI) / 180

      const startX = Math.cos(angleRad) * startDist
      const startY = Math.sin(angleRad) * startDist
      const endX = Math.cos(angleRad) * endDist
      const endY = Math.sin(angleRad) * endDist

      particle.style.setProperty("--start-x", `${startX}px`)
      particle.style.setProperty("--start-y", `${startY}px`)
      particle.style.setProperty("--end-x", `${endX}px`)
      particle.style.setProperty("--end-y", `${endY}px`)
      particle.style.setProperty("--angle", `${angle}deg`)
      particle.style.setProperty("--dur", `${duration}ms`)
      particle.style.setProperty("--delay", `${Math.random() * 30}ms`)
      particle.style.setProperty("--color", color)

      particle.style.position = "fixed"
      particle.style.left = iconCenterX + "px"
      particle.style.top = iconCenterY + "px"

      document.body.appendChild(particle)

      setTimeout(() => {
        particle.remove()
      }, duration + 50)
    })
  }
}
