import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["table", "tbody", "tableWrap"]

  connect() {
    this.anchorRow = null
    this.lastInteractionAt = 0
    this.activeTooltipCell = null
    this.pendingTooltipCell = null
    this.pendingTooltipPoint = null
    this.tooltipDelayMs = 520
    this.tooltipTimer = null
    this.tooltipEl = this.buildTooltipElement()
    this.boundHandleGlobalKeydown = this.handleGlobalKeydown.bind(this)
    document.addEventListener("keydown", this.boundHandleGlobalKeydown)
    this.syncHeaderScrollState()
    this.emitSelectionChanged()
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundHandleGlobalKeydown)
    this.clearTooltipTimer()
    this.hideTooltip()
    if (this.tooltipEl && this.tooltipEl.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl)
    }
    this.tooltipEl = null
  }

  handleTooltipOver(e) {
    const cell = e.target.closest("td[data-hover-tip]")
    if (!cell || !this.tbodyTarget.contains(cell)) {
      this.clearTooltipTimer()
      this.pendingTooltipCell = null
      this.hideTooltip()
      return
    }

    if (this.activeTooltipCell === cell) return

    this.pendingTooltipCell = cell
    this.pendingTooltipPoint = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) }
    this.clearTooltipTimer()
    this.hideTooltip()
    this.tooltipTimer = window.setTimeout(() => {
      if (!this.pendingTooltipCell || this.pendingTooltipCell !== cell) return
      const point = this.pendingTooltipPoint || { x: 0, y: 0 }
      this.showTooltip(cell, point)
    }, this.tooltipDelayMs)
  }

  handleTooltipMove(e) {
    const point = { x: Number(e.clientX || 0), y: Number(e.clientY || 0) }
    this.pendingTooltipPoint = point
    if (!this.activeTooltipCell || !this.tooltipEl) return
    this.positionTooltip(point)
  }

  handleTooltipOut(e) {
    this.clearTooltipTimer()
    this.pendingTooltipCell = null
    const related = e.relatedTarget
    if (related && this.activeTooltipCell && this.activeTooltipCell.contains(related)) return
    const nextCell = related?.closest ? related.closest("td[data-hover-tip]") : null
    if (nextCell && this.tbodyTarget.contains(nextCell)) return
    this.hideTooltip()
  }

  handleTbodyClick(e) {
    const row = e.target.closest("tr")
    if (!row || !this.tbodyTarget.contains(row)) return

    e.preventDefault()
    e.stopPropagation()
    this.lastInteractionAt = Date.now()

    const dataRows = this.dataRows
    const rowIndex = dataRows.indexOf(row)
    if (rowIndex < 0) return

    if (e.metaKey || e.ctrlKey) {
      row.classList.toggle("row-selected")
      this.anchorRow = row
      this.emitSelectionChanged(this.anchorRow)
      return
    }

    if (e.shiftKey) {
      if (!this.anchorRow || !dataRows.includes(this.anchorRow)) {
        this.clearSelection()
        row.classList.add("row-selected")
        this.anchorRow = row
        this.emitSelectionChanged(this.anchorRow)
        return
      }

      const anchorIndex = dataRows.indexOf(this.anchorRow)
      const lo = Math.min(anchorIndex, rowIndex)
      const hi = Math.max(anchorIndex, rowIndex)
      dataRows.forEach((r, i) => r.classList.toggle("row-selected", i >= lo && i <= hi))
      this.emitSelectionChanged(row)
      return
    }

    const selected = this.getSelectedRows()
    if (selected.length === 1 && selected[0] === row) {
      row.classList.remove("row-selected")
      this.anchorRow = null
      this.emitSelectionChanged(null)
      return
    }

    this.clearSelection()
    row.classList.add("row-selected")
    this.anchorRow = row
    this.emitSelectionChanged(this.anchorRow)
  }

  handleTableScroll() {
    this.syncHeaderScrollState()
  }

  handleGlobalKeydown(e) {
    const activeEl = document.activeElement
    const inRawPane = activeEl instanceof Element && !!activeEl.closest(".alchemy-app__raw-view")
    if (inRawPane) return

    const inTable = this.element.contains(document.activeElement)
    const recentlyUsed = Date.now() - this.lastInteractionAt < 20000
    const hasSelection = this.getSelectedRows().length > 0
    if (!inTable && !recentlyUsed && !hasSelection) return

    const isMod = e.metaKey || e.ctrlKey
    const key = String(e.key || "").toLowerCase()

    if (isMod && key === "a") {
      e.preventDefault()
      e.stopPropagation()
      this.dataRows.forEach((row) => row.classList.add("row-selected"))
      this.anchorRow = this.dataRows[this.dataRows.length - 1] || null
      this.emitSelectionChanged(this.anchorRow)
      return
    }

    if (isMod && key === "c") {
      const selected = this.getSelectedRows()
      if (selected.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      this.copySelectedRows(selected)
      return
    }

    if (key === "escape") {
      this.clearSelection()
      this.anchorRow = null
      this.emitSelectionChanged(null)
    }
  }

  copySelectedRows(selectedRows) {
    const rows = selectedRows.map((tr) => {
      const dataset = tr.dataset || {}
      return [
        String(dataset.tagGroup || "").trim(),
        String(dataset.tagName || "").trim(),
        "",
        String(dataset.dataType || "").trim(),
        "",
        String(dataset.modbusRegister || "").trim(),
        String(dataset.scaling || "").trim(),
        String(dataset.readWrite || "").trim()
      ]
    })

    const tsv = rows.map((cols) => cols.join("\t")).join("\n")

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).catch(() => this.fallbackCopyToClipboard(tsv))
    } else {
      this.fallbackCopyToClipboard(tsv)
    }
  }

  fallbackCopyToClipboard(text) {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.left = "-9999px"
    textarea.setAttribute("readonly", "")
    document.body.appendChild(textarea)
    textarea.select()

    try {
      document.execCommand("copy")
    } catch (_err) {
      // no-op
    }

    document.body.removeChild(textarea)
  }

  get dataRows() {
    if (!this.hasTbodyTarget) return []
    return Array.from(this.tbodyTarget.querySelectorAll("tr"))
  }

  getSelectedRows() {
    return this.dataRows.filter((row) => row.classList.contains("row-selected"))
  }

  clearSelection() {
    this.dataRows.forEach((row) => row.classList.remove("row-selected"))
  }

  emitSelectionChanged(activeRow = null) {
    const selectedRows = this.getSelectedRows()
    const active = activeRow && selectedRows.includes(activeRow)
      ? activeRow
      : selectedRows[selectedRows.length - 1] || null

    this.element.dispatchEvent(new CustomEvent("alchemy:selection-changed", {
      bubbles: true,
      detail: {
        selectedRows: selectedRows.map((row) => ({
          tagName: String(row.dataset.tagName || ""),
          rawTagName: String(row.dataset.rawTagName || row.dataset.tagName || ""),
          conflict: row.classList.contains("row-address-conflict"),
          pair: row.classList.contains("row-address-paired"),
          unique: !!row.querySelector("td.alchemy-app__cell-unique")
        })),
        activeTagName: String(active?.dataset?.tagName || ""),
        activeRawTagName: String(active?.dataset?.rawTagName || active?.dataset?.tagName || "")
      }
    }))
  }

  buildTooltipElement() {
    const el = document.createElement("div")
    el.className = "alchemy-app__hover-tip"
    el.setAttribute("aria-hidden", "true")
    document.body.appendChild(el)
    return el
  }

  showTooltip(cell, event) {
    if (!this.tooltipEl) return
    const text = String(cell.dataset.hoverTip || "").trim()
    if (!text) {
      this.hideTooltip()
      return
    }

    this.activeTooltipCell = cell
    this.tooltipEl.textContent = text
    this.tooltipEl.classList.add("is-visible")
    this.clearTooltipTimer()
    this.pendingTooltipCell = null
    this.positionTooltip(event)
  }

  hideTooltip() {
    this.activeTooltipCell = null
    if (!this.tooltipEl) return
    this.tooltipEl.classList.remove("is-visible")
    this.tooltipEl.textContent = ""
  }

  positionTooltip(event) {
    if (!this.tooltipEl || !event) return
    const x = Number(event.clientX ?? event.x ?? 0) + 12
    const y = Number(event.clientY ?? event.y ?? 0) + 14
    this.tooltipEl.style.left = `${x}px`
    this.tooltipEl.style.top = `${y}px`
  }

  clearTooltipTimer() {
    if (!this.tooltipTimer) return
    window.clearTimeout(this.tooltipTimer)
    this.tooltipTimer = null
  }

  syncHeaderScrollState() {
    if (!this.hasTableWrapTarget) return
    const isScrolled = this.tableWrapTarget.scrollTop > 0
    this.tableWrapTarget.classList.toggle("is-scrolled", isScrolled)
  }
}
