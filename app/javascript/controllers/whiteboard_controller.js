import { Controller } from "@hotwired/stimulus"
import { observeContent } from "lib/os_window_sizing"

export default class extends Controller {
  static targets = ["contentShell", "grid", "gridToggle", "stickySelection", "colorPopover", "colorSlider"]

  static values = {
    columns: { type: Number, default: 75 },
    rows: { type: Number, default: 75 },
    stickies: { type: Array, default: [] },
    saveUrl: { type: String, default: "" }
  }

  connect() {
    this.syncQueued = false
    this.syncFrame = null
    this.saveTimer = null
    this.stickyZCounter = 0
    this.activeStickyDrag = null
    this.activeStickyResize = null
    this.selectedSticky = null
    this.colorPopoverOpen = false
    this.pendingStickyColorSave = false
    this.boundWindowResize = this.queueSync.bind(this)
    this.boundContentShellMouseDown = (event) => this.handleContentShellPointerDown(event)
    this.boundContentShellTouchStart = (event) => this.handleContentShellPointerDown(event)
    this.boundDocumentPointerDown = (event) => this.handleDocumentPointerDown(event)

    this.gridObserver = observeContent("singular-whiteboard", this.contentShellTarget, () => {
      console.log("[whiteboard] content shell resized via observer")
      this.queueSync()
    })

    window.addEventListener("resize", this.boundWindowResize)
    this.contentShellTarget.addEventListener("mousedown", this.boundContentShellMouseDown)
    this.contentShellTarget.addEventListener("touchstart", this.boundContentShellTouchStart, { passive: true })
    document.addEventListener("mousedown", this.boundDocumentPointerDown)
    document.addEventListener("touchstart", this.boundDocumentPointerDown, { passive: true })

    // Load grid visibility state from localStorage, default to visible.
    const gridVisible = this.loadGridState() !== false
    if (gridVisible) {
      this.gridTarget.classList.remove("whiteboard-grid--hidden")
    } else {
      this.gridTarget.classList.add("whiteboard-grid--hidden")
    }
    if (this.hasGridToggleTarget) {
      this.gridToggleTarget.setAttribute("aria-pressed", String(gridVisible))
    }

    this.renderGrid()
    this.syncStickySelectionButton()
    this.queueSync()

    // Render any previously saved stickies after the first grid metrics sync
    window.requestAnimationFrame(() => {
      this.stickiesValue.forEach(data => this.renderSticky(data))
    })
  }

  disconnect() {
    if (this.gridObserver) this.gridObserver.disconnect()
    if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    window.removeEventListener("resize", this.boundWindowResize)
    this.contentShellTarget.removeEventListener("mousedown", this.boundContentShellMouseDown)
    this.contentShellTarget.removeEventListener("touchstart", this.boundContentShellTouchStart)
    document.removeEventListener("mousedown", this.boundDocumentPointerDown)
    document.removeEventListener("touchstart", this.boundDocumentPointerDown)
  }

  // ── Grid toggle ─────────────────────────────────────────────────────────────

  toggleGrid() {
    const isVisible = !this.gridTarget.classList.contains("whiteboard-grid--hidden")
    this.gridTarget.classList.toggle("whiteboard-grid--hidden", isVisible)
    if (this.hasGridToggleTarget) {
      this.gridToggleTarget.setAttribute("aria-pressed", String(!isVisible))
    }
    this.saveGridState(!isVisible)
  }

  loadGridState() {
    try {
      const stored = localStorage.getItem("whiteboard-grid-visible")
      return stored === null ? true : JSON.parse(stored)
    } catch (e) {
      return true
    }
  }

  saveGridState(isVisible) {
    try {
      localStorage.setItem("whiteboard-grid-visible", JSON.stringify(isVisible))
    } catch (e) {
      // Silently fail if localStorage is unavailable
    }
  }

  // ── Sticky notes ─────────────────────────────────────────────────────────────

  addSticky() {
    const defaultCols = 10
    const defaultRows = 10
    const col = Math.max(0, Math.floor((this.columnsValue - defaultCols) / 2))
    const row = Math.max(0, Math.floor((this.rowsValue - defaultRows) / 2))

    this.renderSticky({ col, row, cols: defaultCols, rows: defaultRows, text: "" })
    this.scheduleSave()
  }

  renderSticky({ col, row, cols, rows, text, hue }) {
    const el = document.createElement("div")
    el.classList.add("whiteboard-sticky")
    el.dataset.stickyCol = String(col)
    el.dataset.stickyRow = String(row)
    el.dataset.stickyCols = String(cols)
    el.dataset.stickyRows = String(rows)
    el.dataset.stickyHue = String(Number.isFinite(parseInt(hue, 10)) ? parseInt(hue, 10) : 45)
    this.applyStickyPosition(el)

    const deleteBtn = document.createElement("button")
    deleteBtn.classList.add("whiteboard-sticky-delete-btn")
    deleteBtn.setAttribute("type", "button")
    deleteBtn.setAttribute("aria-label", "Delete sticky note")
    deleteBtn.textContent = "✕"
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.deleteSticky(el)
    })
    el.appendChild(deleteBtn)

    const content = document.createElement("div")
    content.classList.add("whiteboard-sticky-content")
    content.setAttribute("contenteditable", "false")
    content.setAttribute("spellcheck", "false")
    if (text) content.textContent = text
    el.appendChild(content)

    this.contentShellTarget.appendChild(el)
    this.bringToFront(el)

    el.addEventListener("mousedown", (e) => {
      this.selectSticky(el)
      if (el.classList.contains("is-editing")) return
      const edgeInfo = this.getResizeEdgeInfo(el, e)
      if (edgeInfo.hasEdge) {
        this.startStickyResize(e, el, edgeInfo)
      } else {
        this.startStickyDrag(e, el)
      }
    })
    el.addEventListener("touchstart", (e) => {
      this.selectSticky(el)
      if (el.classList.contains("is-editing")) return
      const edgeInfo = this.getResizeEdgeInfo(el, e)
      if (edgeInfo.hasEdge) {
        this.startStickyResize(e, el, edgeInfo)
      } else {
        this.startStickyDrag(e, el)
      }
    }, { passive: false })

    el.addEventListener("dblclick", () => {
      this.selectSticky(el)
      this.startEditSticky(el)
    })
  }

  handleContentShellPointerDown(event) {
    if (event.target.closest(".whiteboard-sticky")) return
    this.clearStickySelection(true)
  }

  handleDocumentPointerDown(event) {
    if (!this.colorPopoverOpen) return

    const target = event.target
    if (this.hasStickySelectionTarget && this.stickySelectionTarget.contains(target)) return
    if (this.hasColorPopoverTarget && this.colorPopoverTarget.contains(target)) return

    this.closeStickyColorPopover(true)
  }

  selectSticky(el) {
    if (this.selectedSticky === el) return

    if (this.selectedSticky) {
      this.selectedSticky.classList.remove("is-selected")
    }

    this.selectedSticky = el
    if (this.selectedSticky) {
      this.selectedSticky.classList.add("is-selected")
    }

    this.syncStickySelectionButton()
  }

  clearStickySelection(commitColor = false) {
    if (!this.selectedSticky) return

    this.selectedSticky.classList.remove("is-selected")
    this.selectedSticky = null
    this.closeStickyColorPopover(commitColor)
    this.syncStickySelectionButton()
  }

  syncStickySelectionButton() {
    if (!this.hasStickySelectionTarget) return

    const hasSelection = Boolean(this.selectedSticky)
    this.stickySelectionTarget.classList.toggle("whiteboard-action-btn--hidden", !hasSelection)
    this.stickySelectionTarget.setAttribute("aria-hidden", String(!hasSelection))
    this.stickySelectionTarget.tabIndex = hasSelection ? 0 : -1

    if (!hasSelection) {
      this.stickySelectionTarget.style.removeProperty("--sticky-hue")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--sticky-hue")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--sticky-hue")
      return
    }

    const raw = parseInt(this.selectedSticky.dataset.stickyHue, 10)
    const hue = Number.isFinite(raw) ? raw : 45
    this.stickySelectionTarget.style.setProperty("--sticky-hue", String(hue))
    if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.setProperty("--sticky-hue", String(hue))
    if (this.hasColorSliderTarget) this.colorSliderTarget.style.setProperty("--sticky-hue", String(hue))
    if (this.hasColorSliderTarget) {
      this.colorSliderTarget.value = String(hue)
    }
  }

  toggleStickyColorPopover(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!this.selectedSticky) return

    if (this.colorPopoverOpen) {
      this.closeStickyColorPopover(true)
      return
    }

    const hue = parseInt(this.selectedSticky.dataset.stickyHue, 10) || 45
    if (this.hasColorSliderTarget) {
      this.colorSliderTarget.value = String(hue)
    }
    this.colorPopoverOpen = true
    this.colorPopoverTarget.classList.remove("whiteboard-action-btn--hidden")
    this.colorPopoverTarget.setAttribute("aria-hidden", "false")
  }

  updateStickyColor(event) {
    if (!this.selectedSticky) return

    const raw = parseInt(event.target.value, 10)
    const hue = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 360)) : 45
    this.selectedSticky.dataset.stickyHue = String(hue)
    this.applyStickyPosition(this.selectedSticky)
    this.syncStickySelectionButton()
    this.pendingStickyColorSave = true
  }

  closeStickyColorPopover(commitColor = false) {
    if (!this.colorPopoverOpen) return

    this.colorPopoverOpen = false
    if (this.hasColorPopoverTarget) {
      this.colorPopoverTarget.classList.add("whiteboard-action-btn--hidden")
      this.colorPopoverTarget.setAttribute("aria-hidden", "true")
    }

    if (commitColor && this.pendingStickyColorSave) {
      this.scheduleSave()
    }
    this.pendingStickyColorSave = false
  }

  deleteSticky(el) {
    el.remove()
    if (this.selectedSticky === el) {
      this.clearStickySelection(false)
    }
    this.scheduleSave()
  }

  startEditSticky(el) {
    const content = el.querySelector(".whiteboard-sticky-content")
    if (!content) return

    el.classList.add("is-editing")
    content.setAttribute("contenteditable", "true")
    content.focus()

    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(content)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    content.addEventListener("blur", () => {
      content.setAttribute("contenteditable", "false")
      el.classList.remove("is-editing")
      this.scheduleSave()
    }, { once: true })

    content.addEventListener("keydown", (e) => {
      if (e.key === "Escape") content.blur()
    }, { once: true })
  }

  applyStickyPosition(el) {
    el.style.setProperty("--sticky-col", el.dataset.stickyCol)
    el.style.setProperty("--sticky-row", el.dataset.stickyRow)
    el.style.setProperty("--sticky-cols", el.dataset.stickyCols)
    el.style.setProperty("--sticky-rows", el.dataset.stickyRows)
    el.style.setProperty("--sticky-hue", el.dataset.stickyHue || "45")
  }

  startStickyDrag(event, el) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.bringToFront(el)

    const coords = this.getEventCoords(event)
    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const cellW = shellRect.width / this.columnsValue
    const cellH = shellRect.height / this.rowsValue

    this.activeStickyDrag = {
      el,
      startMouseX: coords.x,
      startMouseY: coords.y,
      startCol: parseInt(el.dataset.stickyCol, 10) || 0,
      startRow: parseInt(el.dataset.stickyRow, 10) || 0,
      cols: parseInt(el.dataset.stickyCols, 10) || 10,
      rows: parseInt(el.dataset.stickyRows, 10) || 10,
      cellW,
      cellH,
      dragStarted: false
    }

    this.boundStickyDragMove = (e) => this.handleStickyDragMove(e)
    this.boundStickyDragEnd = () => this.stopStickyDrag()
    document.addEventListener("mousemove", this.boundStickyDragMove)
    document.addEventListener("mouseup", this.boundStickyDragEnd)
    document.addEventListener("touchmove", this.boundStickyDragMove, { passive: false })
    document.addEventListener("touchend", this.boundStickyDragEnd)
  }

  handleStickyDragMove(event) {
    if (!this.activeStickyDrag) return
    if (event.touches) event.preventDefault()

    const { el, startMouseX, startMouseY, startCol, startRow, cols, rows, cellW, cellH } = this.activeStickyDrag
    const coords = this.getEventCoords(event)
    const dx = coords.x - startMouseX
    const dy = coords.y - startMouseY

    if (!this.activeStickyDrag.dragStarted) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      this.activeStickyDrag.dragStarted = true
      el.classList.add("is-dragging")
    }

    const newCol = Math.round(startCol + dx / cellW)
    const newRow = Math.round(startRow + dy / cellH)

    el.dataset.stickyCol = String(Math.max(0, Math.min(newCol, this.columnsValue - cols)))
    el.dataset.stickyRow = String(Math.max(0, Math.min(newRow, this.rowsValue - rows)))
    this.applyStickyPosition(el)
  }

  stopStickyDrag() {
    if (!this.activeStickyDrag) return
    if (this.activeStickyDrag.dragStarted) {
      this.activeStickyDrag.el.classList.remove("is-dragging")
      this.scheduleSave()
    }
    this.activeStickyDrag = null
    document.removeEventListener("mousemove", this.boundStickyDragMove)
    document.removeEventListener("mouseup", this.boundStickyDragEnd)
    document.removeEventListener("touchmove", this.boundStickyDragMove)
    document.removeEventListener("touchend", this.boundStickyDragEnd)
  }

  getResizeEdgeInfo(el, event) {
    const EDGE_MARGIN = 12
    const rect = el.getBoundingClientRect()
    const coords = this.getEventCoords(event)
    const dx = coords.x - rect.left
    const dy = coords.y - rect.top

    const isLeft = dx < EDGE_MARGIN
    const isRight = dx > rect.width - EDGE_MARGIN
    const isTop = dy < EDGE_MARGIN
    const isBottom = dy > rect.height - EDGE_MARGIN

    return {
      hasEdge: isLeft || isRight || isTop || isBottom,
      isLeft,
      isRight,
      isTop,
      isBottom
    }
  }

  startStickyResize(event, el, edgeInfo) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.bringToFront(el)

    const coords = this.getEventCoords(event)
    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const cellW = shellRect.width / this.columnsValue
    const cellH = shellRect.height / this.rowsValue

    this.activeStickyResize = {
      el,
      startMouseX: coords.x,
      startMouseY: coords.y,
      startCols: parseInt(el.dataset.stickyCols, 10) || 10,
      startRows: parseInt(el.dataset.stickyRows, 10) || 10,
      startCol: parseInt(el.dataset.stickyCol, 10) || 0,
      startRow: parseInt(el.dataset.stickyRow, 10) || 0,
      cellW,
      cellH,
      isLeft: edgeInfo.isLeft,
      isRight: edgeInfo.isRight,
      isTop: edgeInfo.isTop,
      isBottom: edgeInfo.isBottom
    }

    el.classList.add("is-resizing")

    this.boundStickyResizeMove = (e) => this.handleStickyResizeMove(e)
    this.boundStickyResizeEnd = () => this.stopStickyResize()
    document.addEventListener("mousemove", this.boundStickyResizeMove)
    document.addEventListener("mouseup", this.boundStickyResizeEnd)
    document.addEventListener("touchmove", this.boundStickyResizeMove, { passive: false })
    document.addEventListener("touchend", this.boundStickyResizeEnd)
  }

  handleStickyResizeMove(event) {
    if (!this.activeStickyResize) return
    if (event.touches) event.preventDefault()

    const { el, startMouseX, startMouseY, startCols, startRows, startCol, startRow, cellW, cellH, isLeft, isRight, isTop, isBottom } = this.activeStickyResize
    const coords = this.getEventCoords(event)
    const dx = coords.x - startMouseX
    const dy = coords.y - startMouseY

    let newCol = startCol
    let newRow = startRow
    let newCols = startCols
    let newRows = startRows

    if (isLeft) {
      const deltaCol = Math.round(dx / cellW)
      newCol = Math.max(0, startCol + deltaCol)
      newCols = Math.max(2, startCols - deltaCol)
    }
    if (isRight) {
      const deltaCol = Math.round(dx / cellW)
      newCols = Math.max(2, startCols + deltaCol)
    }
    if (isTop) {
      const deltaRow = Math.round(dy / cellH)
      newRow = Math.max(0, startRow + deltaRow)
      newRows = Math.max(2, startRows - deltaRow)
    }
    if (isBottom) {
      const deltaRow = Math.round(dy / cellH)
      newRows = Math.max(2, startRows + deltaRow)
    }

    newCol = Math.max(0, Math.min(newCol, this.columnsValue - newCols))
    newRow = Math.max(0, Math.min(newRow, this.rowsValue - newRows))

    el.dataset.stickyCol = String(newCol)
    el.dataset.stickyRow = String(newRow)
    el.dataset.stickyCols = String(newCols)
    el.dataset.stickyRows = String(newRows)
    this.applyStickyPosition(el)
  }

  stopStickyResize() {
    if (!this.activeStickyResize) return
    this.activeStickyResize.el.classList.remove("is-resizing")
    this.scheduleSave()
    this.activeStickyResize = null
    document.removeEventListener("mousemove", this.boundStickyResizeMove)
    document.removeEventListener("mouseup", this.boundStickyResizeEnd)
    document.removeEventListener("touchmove", this.boundStickyResizeMove)
    document.removeEventListener("touchend", this.boundStickyResizeEnd)
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveToServer(), 600)
  }

  saveToServer() {
    if (!this.hasSaveUrlValue || !this.saveUrlValue) return

    const stickies = Array.from(
      this.contentShellTarget.querySelectorAll(".whiteboard-sticky")
    ).map(el => ({
      col: parseInt(el.dataset.stickyCol, 10) || 0,
      row: parseInt(el.dataset.stickyRow, 10) || 0,
      cols: parseInt(el.dataset.stickyCols, 10) || 10,
      rows: parseInt(el.dataset.stickyRows, 10) || 10,
      hue: parseInt(el.dataset.stickyHue, 10) || 45,
      text: el.querySelector(".whiteboard-sticky-content")?.innerText || ""
    }))

    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    fetch(this.saveUrlValue, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ stickies: JSON.stringify(stickies) })
    }).catch(() => {})
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  bringToFront(el) {
    this.stickyZCounter += 1
    el.style.zIndex = String(this.stickyZCounter)
  }

  getEventCoords(event) {
    if (event.touches && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }
    return { x: event.clientX, y: event.clientY }
  }

  renderGrid() {
    if (!this.hasGridTarget) return

    const columns = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const vertical = []
    const horizontal = []

    for (let i = 0; i <= columns; i += 1) {
      vertical.push(`<line x1="${i}" y1="0" x2="${i}" y2="${rows}" />`)
    }
    for (let i = 0; i <= rows; i += 1) {
      horizontal.push(`<line x1="0" y1="${i}" x2="${columns}" y2="${i}" />`)
    }

    this.gridTarget.innerHTML = `
      <svg class="whiteboard-grid-svg" viewBox="0 0 ${columns} ${rows}" preserveAspectRatio="none" aria-hidden="true">
        <g class="whiteboard-grid-lines">
          ${vertical.join("")}
          ${horizontal.join("")}
        </g>
      </svg>
    `
  }

  // ── Grid sizing ──────────────────────────────────────────────────────────────

  queueSync() {
    if (this.syncQueued) return

    console.log("[whiteboard] queueSync called")
    this.syncQueued = true
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncQueued = false
      this.syncGridMetrics()
    })
  }

  syncGridMetrics() {
    if (!this.hasContentShellTarget || !this.hasGridTarget) return

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const width = Math.max(shellRect.width, 0)
    const height = Math.max(shellRect.height, 0)
    const columns = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const cellWidth = width > 0 ? width / columns : 0
    const cellHeight = height > 0 ? height / rows : 0
    const columnPercent = 100 / columns
    const rowPercent = 100 / rows
    const fontSize = Math.max(cellHeight * 0.65, 10)

    console.log("[whiteboard] syncGridMetrics: width=%d, height=%d, cellHeight=%d, fontSize=%d", width, height, cellHeight, fontSize)

    // Published on contentShellTarget so stickies (siblings of .whiteboard-grid) inherit them.
    this.contentShellTarget.style.setProperty("--whiteboard-grid-cell-width", `${cellWidth}px`)
    this.contentShellTarget.style.setProperty("--whiteboard-grid-cell-height", `${cellHeight}px`)
    this.contentShellTarget.style.setProperty("--whiteboard-grid-columns", String(columns))
    this.contentShellTarget.style.setProperty("--whiteboard-grid-rows", String(rows))
    this.contentShellTarget.style.setProperty("--whiteboard-grid-col-percent", `${columnPercent}%`)
    this.contentShellTarget.style.setProperty("--whiteboard-grid-row-percent", `${rowPercent}%`)
    this.contentShellTarget.style.setProperty("--whiteboard-sticky-font-size", `${fontSize}px`)

    // Also directly apply font size to all existing sticky content elements
    const stickyContents = this.contentShellTarget.querySelectorAll(".whiteboard-sticky-content")
    console.log("[whiteboard] updating %d sticky content elements with fontSize=%dpx", stickyContents.length, fontSize)
    stickyContents.forEach(el => {
      el.style.fontSize = `${fontSize}px`
    })

    this.gridTarget.style.setProperty("--whiteboard-grid-columns", String(columns))
    this.gridTarget.style.setProperty("--whiteboard-grid-rows", String(rows))
    this.gridTarget.style.setProperty("--whiteboard-grid-col-percent", `${columnPercent}%`)
    this.gridTarget.style.setProperty("--whiteboard-grid-row-percent", `${rowPercent}%`)
    this.gridTarget.style.setProperty("--whiteboard-grid-cell-width", `${cellWidth}px`)
    this.gridTarget.style.setProperty("--whiteboard-grid-cell-height", `${cellHeight}px`)
  }
}
