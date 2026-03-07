import { Controller } from "@hotwired/stimulus"

const PLACEHOLDER = "__INDEX__"

export default class extends Controller {
  static targets = ["tbody", "templateRow", "addBtn", "statusCount", "statusMessage", "titleInput"]

  // Lifecycle: wire up DOM and global listeners for editing, status, and row operations.
  connect() {
    this.clipboard = []
    this.anchorRow = null
    this.boundKeydown = this.handleKeydown.bind(this)
    this.boundKeyup = this.handleKeyup.bind(this)
    this.boundFormChange = this.markUnsaved.bind(this)
    this.boundBeforeUnload = () => { this._isUnloading = true }
    this._isUnloading = false
    this.element.addEventListener("keydown", this.boundKeydown, true)
    this.element.addEventListener("keyup", this.boundKeyup, true)
    window.addEventListener("beforeunload", this.boundBeforeUnload)
    if (this.hasAddBtnTarget) this.addBtnTarget.addEventListener("click", this.addRow.bind(this))
    if (this.hasTbodyTarget) {
      this._hoverRow = null
      this.boundTbodyClick = this.handleTbodyClick.bind(this)
      this.boundTbodyMouseMove = this.handleTbodyMouseMove.bind(this)
      this.boundTbodyMouseLeave = this.handleTbodyMouseLeave.bind(this)
      this.tbodyTarget.addEventListener("click", this.boundTbodyClick, true)
      this.tbodyTarget.addEventListener("mousemove", this.boundTbodyMouseMove)
      this.tbodyTarget.addEventListener("mouseleave", this.boundTbodyMouseLeave)
      this.tbodyTarget.addEventListener("dragstart", this.handleDragStart.bind(this))
      this.tbodyTarget.addEventListener("dragover", this.handleDragOver.bind(this))
      this.tbodyTarget.addEventListener("drop", this.handleDrop.bind(this))
      this.tbodyTarget.addEventListener("dragend", this.handleDragEnd.bind(this))
    }
    this.boundGlobalKeydown = this.handleGlobalKeydown.bind(this)
    document.addEventListener("keydown", this.boundGlobalKeydown, true)
    if (this.hasStatusMessageTarget) {
      this._statusHighlightedRows = null
      this._statusDetailedMode = false
      this.boundStatusClick = this.handleStatusClick.bind(this)
      this.statusMessageTarget.addEventListener("click", this.boundStatusClick)
      const initial = (this.statusMessageTarget.textContent || "").trim()
      this._lastStatus = initial ? { simple: initial, detailed: initial } : null
      this.renderStatusMessage()
    }
    this.element.addEventListener("input", this.boundFormChange)
    this.element.addEventListener("change", this.boundFormChange)
    this.boundValidateTable = this.validateTable.bind(this)
    this.element.addEventListener("input", this.boundValidateTable)
    this.element.addEventListener("change", this.boundValidateTable)
    this.boundCellChanged = (e) => {
      if ((e.detail?.status || e.detail?.message) && e.detail?.row) this.setStatus(e.detail?.status || e.detail.message, [e.detail.row])
      this.validateTable()
      this.saveForm({ delta: e.detail?.delta || null, clearSortIndicator: true })
    }
    this.element.addEventListener("tag-table:cell-changed", this.boundCellChanged)
    this.boundFocusIn = this.handleCellFocusIn.bind(this)
    this.boundFocusOut = this.handleCellFocusOut.bind(this)
    this.boundCellSelectChange = this.handleCellSelectChange.bind(this)
    this.element.addEventListener("focusin", this.boundFocusIn, true)
    this.element.addEventListener("focusout", this.boundFocusOut, true)
    this.element.addEventListener("change", this.boundCellSelectChange, true)
    this.boundResizeInputs = this.resizeHeaderInputs.bind(this)
    this.element.querySelectorAll(".workspace-title-input, input.connection-inline").forEach(el => {
      el.addEventListener("input", this.boundResizeInputs)
      el.addEventListener("change", this.boundResizeInputs)
    })
    this.resizeHeaderInputs()
    this.validateTable()
  }

  disconnect() {
    this.element.removeEventListener("keydown", this.boundKeydown, true)
    this.element.removeEventListener("keyup", this.boundKeyup, true)
    window.removeEventListener("beforeunload", this.boundBeforeUnload)
    if (this.hasAddBtnTarget) this.addBtnTarget.removeEventListener("click", this.addRow.bind(this))
    if (this.hasTbodyTarget) {
      this.tbodyTarget.removeEventListener("click", this.boundTbodyClick, true)
      this.tbodyTarget.removeEventListener("mousemove", this.boundTbodyMouseMove)
      this.tbodyTarget.removeEventListener("mouseleave", this.boundTbodyMouseLeave)
      this.tbodyTarget.removeEventListener("dragstart", this.handleDragStart.bind(this))
      this.tbodyTarget.removeEventListener("dragover", this.handleDragOver.bind(this))
      this.tbodyTarget.removeEventListener("drop", this.handleDrop.bind(this))
      this.tbodyTarget.removeEventListener("dragend", this.handleDragEnd.bind(this))
    }
    document.removeEventListener("keydown", this.boundGlobalKeydown, true)
    if (this.hasStatusMessageTarget) {
      this.statusMessageTarget.removeEventListener("click", this.boundStatusClick)
    }
    this.element.removeEventListener("input", this.boundFormChange)
    this.element.removeEventListener("change", this.boundFormChange)
    this.element.removeEventListener("input", this.boundValidateTable)
    this.element.removeEventListener("change", this.boundValidateTable)
    this.element.removeEventListener("tag-table:cell-changed", this.boundCellChanged)
    this.element.removeEventListener("focusin", this.boundFocusIn, true)
    this.element.removeEventListener("focusout", this.boundFocusOut, true)
    this.element.removeEventListener("change", this.boundCellSelectChange, true)
    this.element.querySelectorAll(".workspace-title-input, input.connection-inline").forEach(el => {
      el.removeEventListener("input", this.boundResizeInputs)
      el.removeEventListener("change", this.boundResizeInputs)
    })
  }

  resizeHeaderInputs() {
    this.element.querySelectorAll(".workspace-title-input, input.connection-inline").forEach(el => {
      const minLen = el.classList.contains("workspace-title-input") ? 8 : 10
      const len = Math.max(el.value.length, (el.placeholder || "").length, minLen)
      const extra = el.classList.contains("workspace-title-input") ? 0.5 : 1
      el.style.width = `${len + extra}ch`
    })
  }

  // Validation: field-level format checks and duplicate address detection by register kind.
  validateTable() {
    if (!this.hasTbodyTarget) return
    const rows = this.dataRows
    const numericOnly = /^\d*$/
    rows.forEach(tr => {
      const cells = tr.querySelectorAll("td input.cell, td select.cell")
      cells.forEach(el => {
        el.classList.remove("cell-invalid", "cell-duplicate")
        const name = el.getAttribute("name") || ""
        const val = (el.value || "").trim()
        if (name.includes("[Address Start]")) {
          if (!numericOnly.test(val)) el.classList.add("cell-invalid")
        } else if (name.includes("[Data Length]")) {
          if (!numericOnly.test(val)) el.classList.add("cell-invalid")
        } else if (name.includes("[Scaling]")) {
          if (val !== "" && !/^-?\d+(\.\d+)?$/.test(val)) el.classList.add("cell-invalid")
        }
      })
    })

    const keyCount = new Map()
    rows.forEach(tr => {
      const dataTypeEl = tr.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
      const addrEl = tr.querySelector("input[name*='[Address Start]']")
      if (!dataTypeEl || !addrEl) return
      const kind = (dataTypeEl.value || "").trim() === "BOOL" ? "coil" : "holding"
      const addr = (addrEl.value || "").trim()
      const key = `${kind}:${addr}`
      keyCount.set(key, (keyCount.get(key) || 0) + 1)
    })
    rows.forEach(tr => {
      const dataTypeEl = tr.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
      const addrEl = tr.querySelector("input[name*='[Address Start]']")
      if (!dataTypeEl || !addrEl) return
      const kind = (dataTypeEl.value || "").trim() === "BOOL" ? "coil" : "holding"
      const addr = (addrEl.value || "").trim()
      const key = `${kind}:${addr}`
      if (addr !== "" && (keyCount.get(key) || 0) > 1) addrEl.classList.add("cell-duplicate")
    })

    const tagNameCount = new Map()
    rows.forEach(tr => {
      const tagNameEl = tr.querySelector("input[name*='[Tag Name]']")
      if (!tagNameEl) return
      const tagName = (tagNameEl.value || "").trim()
      if (tagName === "") return
      tagNameCount.set(tagName, (tagNameCount.get(tagName) || 0) + 1)
    })
    rows.forEach(tr => {
      const tagNameEl = tr.querySelector("input[name*='[Tag Name]']")
      if (!tagNameEl) return
      const tagName = (tagNameEl.value || "").trim()
      if (tagName !== "" && (tagNameCount.get(tagName) || 0) > 1) tagNameEl.classList.add("cell-duplicate")
    })

    const ipEl = this.element.querySelector("input.connection-inline[name='metadata_ip']")
    if (ipEl) {
      ipEl.classList.remove("cell-invalid")
      const ipValue = (ipEl.value || "").trim()
      if (ipValue !== "" && !this.isValidIpv4(ipValue)) ipEl.classList.add("cell-invalid")
    }
  }

  markUnsaved(e) {
    if (!e.target) return
    if (e.target.classList.contains("cell") || e.target.classList.contains("workspace-title-input") || e.target.classList.contains("connection-inline")) {
      if (e.target.classList.contains("cell") && e.target.name) {
        if (e.target.closest("tr.tag-data-row") && (e.type === "input" || e.type === "change")) {
          return
        }
        const m = e.target.name.match(/records\[\d+\]\[([^\]]+)\]/)
        if (m) {
          const row = e.target.closest("tr.tag-data-row")
          this.setStatus(m[1] + " updated", row && !row.classList.contains("tag-row-template") ? [row] : null)
        }
        if (e.type === "change") {
          if (e.target.tagName === "SELECT") e.target.blur()
        }
      } else if (e.target.classList.contains("workspace-title-input")) {
        e.target.classList.remove("cell-invalid")
      }
    }
  }

  // Status system: simple message by default; click status text to toggle detailed view.
  setStatus(status, rows = null) {
    if (!this.hasStatusMessageTarget) return
    this._lastStatus = this.normalizeStatus(status)
    this._statusDetailedMode = false
    this.clearStatusHighlight()
    this.clearHeaderStatusHighlight()
    this.clearDeletedGhostRows()
    this.clearMovedGhostRows()
    this.renderStatusMessage()
    this._lastStatusRows = rows && rows.length ? Array.from(rows) : null
    this.flashStatusTargets(this._lastStatus, this._lastStatusRows)
  }

  statusTone(status) {
    const kind = status?.meta?.kind
    const transition = status?.meta?.transition
    if (kind === "invalid-address" || kind === "invalid-ip" || kind === "duplicate-address" || kind === "duplicate-tag-name") {
      return "red"
    }
    if (kind === "data-type-unique-transition" && transition === "formatted-to-unique") return "yellow"
    return "green"
  }

  applyFlashClass(el, className) {
    if (!el || !className) return
    el.classList.remove(className)
    void el.offsetWidth
    el.classList.add(className)
    el.addEventListener("animationend", () => el.classList.remove(className), { once: true })
  }

  flashRows(rows, tone) {
    if (!Array.isArray(rows) || rows.length === 0) return
    const className = `row-change-flash-${tone}`
    rows.filter((r) => r && r.isConnected).forEach((r) => this.applyFlashClass(r, className))
  }

  flashField(el, tone) {
    if (!el) return
    this.applyFlashClass(el, `field-change-flash-${tone}`)
  }

  flashInvalidAddressFields(rows, tone) {
    if (!Array.isArray(rows) || rows.length === 0) return
    rows.forEach((row) => {
      const el = row?.querySelector("input[name*='[Address Start]']")
      if (el) this.flashField(el, tone)
    })
  }

  flashDuplicateAddressFields(meta, tone) {
    const address = String(meta?.address || "").trim()
    const registerKind = String(meta?.registerKind || "")
    if (!address || !registerKind) return
    this.dataRows.forEach((row) => {
      const dt = row.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
      const addrEl = row.querySelector("input[name*='[Address Start]']")
      if (!dt || !addrEl) return
      const rowKind = (dt.value || "").trim() === "BOOL" ? "coil" : "holding"
      if (rowKind !== registerKind) return
      if ((addrEl.value || "").trim() !== address) return
      this.flashField(addrEl, tone)
    })
  }

  flashDuplicateTagNameFields(meta, tone) {
    const tagName = String(meta?.tagName || "").trim()
    if (!tagName) return
    this.dataRows.forEach((row) => {
      const tagNameEl = row.querySelector("input[name*='[Tag Name]']")
      if (!tagNameEl) return
      if ((tagNameEl.value || "").trim() !== tagName) return
      this.flashField(tagNameEl, tone)
    })
  }

  flashHeaderFields(meta, tone) {
    const names = Array.isArray(meta?.headerFieldNames) ? meta.headerFieldNames : []
    names.forEach((fieldName) => {
      const el = this.element.querySelector(`[name='${fieldName}']`)
      if (el) this.flashField(el, tone)
    })
  }

  flashStatusTargets(status, rows) {
    const tone = this.statusTone(status)
    this.flashRows(rows, tone)
    const kind = status?.meta?.kind
    if (kind === "header-field-change") {
      this.flashHeaderFields(status.meta, tone)
      return
    }
    if (kind === "invalid-ip") {
      this.flashHeaderFields(status.meta, tone)
      return
    }
    if (kind === "invalid-address") {
      this.flashInvalidAddressFields(rows, tone)
      return
    }
    if (kind === "duplicate-address") {
      this.flashDuplicateAddressFields(status.meta, tone)
      return
    }
    if (kind === "duplicate-tag-name") {
      this.flashDuplicateTagNameFields(status.meta, tone)
    }
  }

  normalizeStatus(status) {
    if (status && typeof status === "object") {
      const simple = String(status.simple || status.message || "")
      const detailed = String(status.detailed || simple)
      const meta = status.meta || null
      return { simple, detailed, meta }
    }
    const text = String(status || "")
    return { simple: text, detailed: text, meta: null }
  }

  renderStatusMessage() {
    if (!this.hasStatusMessageTarget) return
    if (!this._lastStatus) {
      this.statusMessageTarget.textContent = ""
      this.statusMessageTarget.classList.remove("status-detailed")
      this.statusMessageTarget.classList.remove("status-detailed-deleted")
      this.statusMessageTarget.classList.remove("status-detailed-unique")
      return
    }
    const text = this._statusDetailedMode ? this._lastStatus.detailed : this._lastStatus.simple
    this.statusMessageTarget.textContent = text
    this.statusMessageTarget.classList.toggle("status-detailed", !!this._statusDetailedMode)
    const detailKind = this._lastStatus?.meta?.kind
    const isErrorDetail = !!(
      this._statusDetailedMode && (
        detailKind === "rows-deleted" ||
        detailKind === "invalid-address" ||
        detailKind === "invalid-ip" ||
        detailKind === "duplicate-address" ||
        detailKind === "duplicate-tag-name"
      )
    )
    const transition = this._lastStatus?.meta?.transition
    const isFormattedToUnique = transition === "formatted-to-unique"
    const isUniqueTransitionDetail = !!(this._statusDetailedMode && detailKind === "data-type-unique-transition" && isFormattedToUnique)
    this.statusMessageTarget.classList.toggle("status-detailed-deleted", isErrorDetail)
    this.statusMessageTarget.classList.toggle("status-detailed-unique", isUniqueTransitionDetail)
  }

  flashStatusRestored() {
    if (!this.hasStatusMessageTarget) return
    this.statusMessageTarget.classList.remove("status-restored-flash")
    // Restart animation if restore is triggered repeatedly.
    void this.statusMessageTarget.offsetWidth
    this.statusMessageTarget.classList.add("status-restored-flash")
    this.statusMessageTarget.addEventListener("animationend", () => {
      this.statusMessageTarget.classList.remove("status-restored-flash")
    }, { once: true })
  }

  statusValueText(value) {
    const text = String(value ?? "").trim()
    return text === "" ? "(blank)" : text
  }

  buildFieldChangeStatus(field, beforeValue, afterValue) {
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: `${field} updated`,
      detailed: `${field} ${beforeText} > ${field} ${afterText}`
    }
  }

  headerFieldLabel(fieldName) {
    if (fieldName === "metadata_filename") return "Document name"
    if (fieldName === "metadata_ip") return "IP"
    if (fieldName === "metadata_protocol") return "Protocol"
    return "Connection"
  }

  buildHeaderFieldChangeStatus(el, beforeValue, afterValue) {
    const fieldName = (el?.getAttribute("name") || "").trim()
    const label = this.headerFieldLabel(fieldName)
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: `${label} updated`,
      detailed: `${label} ${beforeText} > ${label} ${afterText}`,
      meta: { kind: "header-field-change", headerFieldNames: [fieldName] }
    }
  }

  buildInvalidIpStatus(beforeValue, afterValue) {
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: "An invalid IP was entered",
      detailed: `IP ${beforeText} > IP ${afterText} (invalid)`,
      meta: { kind: "invalid-ip", headerFieldNames: ["metadata_ip"] }
    }
  }

  isValidIpv4(value) {
    const text = String(value || "").trim()
    const octets = text.split(".")
    if (octets.length !== 4) return false
    return octets.every((octet) => {
      if (!/^\d+$/.test(octet)) return false
      const n = Number(octet)
      return n >= 0 && n <= 255
    })
  }

  buildInvalidAddressStatus(beforeValue, afterValue) {
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: "An invalid address was entered",
      detailed: `Address Start ${beforeText} > Address Start ${afterText} (invalid)`,
      meta: { kind: "invalid-address" }
    }
  }

  buildDuplicateAddressStatus(beforeValue, afterValue, registerKind) {
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: "A duplicate address was entered",
      detailed: `Address Start ${beforeText} > Address Start ${afterText} (duplicate)`,
      meta: { kind: "duplicate-address", address: String(afterValue || "").trim(), registerKind: String(registerKind || "") }
    }
  }

  buildDuplicateTagNameStatus(beforeValue, afterValue) {
    const beforeText = this.statusValueText(beforeValue)
    const afterText = this.statusValueText(afterValue)
    return {
      simple: "A duplicate tag name was entered",
      detailed: `Tag Name ${beforeText} > Tag Name ${afterText} (duplicate)`,
      meta: { kind: "duplicate-tag-name", tagName: String(afterValue || "").trim() }
    }
  }

  isDuplicateAddressValue(row, value) {
    const address = String(value || "").trim()
    if (address === "") return false
    const dataTypeEl = row?.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
    const kind = (dataTypeEl?.value || "").trim() === "BOOL" ? "coil" : "holding"
    let count = 0
    this.dataRows.forEach((tr) => {
      const dt = tr.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
      const addrEl = tr.querySelector("input[name*='[Address Start]']")
      if (!dt || !addrEl) return
      const trKind = (dt.value || "").trim() === "BOOL" ? "coil" : "holding"
      const trAddr = (addrEl.value || "").trim()
      if (trKind === kind && trAddr === address) count += 1
    })
    return count > 1
  }

  isDuplicateTagNameValue(value) {
    const tagName = String(value || "").trim()
    if (tagName === "") return false
    let count = 0
    this.dataRows.forEach((tr) => {
      const tagNameEl = tr.querySelector("input[name*='[Tag Name]']")
      if (!tagNameEl) return
      if ((tagNameEl.value || "").trim() === tagName) count += 1
    })
    return count > 1
  }

  buildRecordStatusForChange(fieldName, beforeValue, afterValue, row) {
    if (fieldName === "Address Start") {
      if (/[^0-9]/.test((afterValue || "").trim())) return this.buildInvalidAddressStatus(beforeValue, afterValue)
      if (row && this.isDuplicateAddressValue(row, afterValue)) {
        const dt = row.querySelector("input[name*='[Data Type]'], select[name*='[Data Type]']")
        const registerKind = (dt?.value || "").trim() === "BOOL" ? "coil" : "holding"
        return this.buildDuplicateAddressStatus(beforeValue, afterValue, registerKind)
      }
    }
    if (fieldName === "Tag Name" && this.isDuplicateTagNameValue(afterValue)) {
      return this.buildDuplicateTagNameStatus(beforeValue, afterValue)
    }
    return this.buildFieldChangeStatus(fieldName, beforeValue, afterValue)
  }

  statusHighlightClass() {
    const kind = this._lastStatus?.meta?.kind
    const transition = this._lastStatus?.meta?.transition
    if (kind === "data-type-unique-transition" && transition === "formatted-to-unique") {
      return "row-status-highlight-unique"
    }
    if (kind === "invalid-address" || kind === "duplicate-address" || kind === "duplicate-tag-name") {
      return "row-status-highlight-deleted"
    }
    return "row-status-highlight"
  }

  clearStatusHighlight() {
    if (!this._statusHighlightedRows) return
    this._statusHighlightedRows.forEach(r => {
      if (!r || !r.isConnected) return
      r.classList.remove("row-status-highlight", "row-status-highlight-deleted", "row-status-highlight-unique")
    })
    this._statusHighlightedRows = null
  }

  clearHeaderStatusHighlight() {
    this.element.querySelectorAll(".workspace-title-input, .connection-inline").forEach((el) => {
      el.classList.remove("header-status-highlight", "header-status-highlight-error")
    })
  }

  showHeaderStatusHighlight(fieldNames, className = "header-status-highlight") {
    this.clearHeaderStatusHighlight()
    if (!Array.isArray(fieldNames) || fieldNames.length === 0) return
    fieldNames.forEach((fieldName) => {
      if (!fieldName) return
      const el = this.element.querySelector(`[name='${fieldName}']`)
      if (el) el.classList.add(className)
    })
  }

  clearDeletedGhostRows() {
    this.element.querySelectorAll("tr.row-deleted-ghost").forEach((tr) => tr.remove())
  }

  clearMovedGhostRows() {
    this.element.querySelectorAll("tr.row-moved-ghost").forEach((tr) => tr.remove())
  }

  hasDeletedGhostPreviewActive() {
    return !!(this._statusDetailedMode && this._lastStatus?.meta?.kind === "rows-deleted")
  }

  hasMovedGhostPreviewActive() {
    return !!(this._statusDetailedMode && this._lastStatus?.meta?.kind === "rows-moved")
  }

  showDeletedGhostRows(entries) {
    if (!this.hasTbodyTarget || !Array.isArray(entries) || entries.length === 0) return
    this.clearDeletedGhostRows()
    const tbody = this.tbodyTarget
    const tableBodyRows = () => Array.from(tbody.querySelectorAll("tr:not(.tag-row-template):not(.row-deleted-ghost)"))
    const sorted = entries
      .map((entry) => ({ index: Number(entry.index), values: Array.isArray(entry.values) ? entry.values : [] }))
      .filter((entry) => Number.isInteger(entry.index) && entry.index >= 0)
      .sort((a, b) => a.index - b.index)
    if (sorted.length === 0) return
    const colCount = Math.max(1, this.element.querySelectorAll(".tag-table thead th").length)

    let inserted = 0
    sorted.forEach((entry) => {
      const rows = tableBodyRows()
      const targetIndex = entry.index - inserted
      const referenceRow = targetIndex >= rows.length ? this.templateRowTarget : rows[targetIndex]
      const ghost = document.createElement("tr")
      ghost.className = "row-deleted-ghost row-status-highlight-deleted"
      ghost.setAttribute("aria-hidden", "true")
      for (let i = 0; i < colCount; i += 1) {
        const cell = document.createElement("td")
        const value = entry.values[i]
        const shell = document.createElement("div")
        shell.className = "cell ghost-cell"
        if (value && typeof value === "object" && "label" in value) {
          shell.textContent = value.label || ""
        } else {
          shell.textContent = value == null ? "" : String(value)
        }
        cell.appendChild(shell)
        ghost.appendChild(cell)
      }
      tbody.insertBefore(ghost, referenceRow)
      inserted += 1
    })
  }

  showMovedGhostRows(entries) {
    if (!this.hasTbodyTarget || !Array.isArray(entries) || entries.length === 0) return
    this.clearMovedGhostRows()
    const tbody = this.tbodyTarget
    const tableBodyRows = () => Array.from(tbody.querySelectorAll("tr:not(.tag-row-template):not(.row-deleted-ghost):not(.row-moved-ghost)"))
    const sorted = entries
      .map((entry) => ({ fromIndex: Number(entry.fromIndex), values: Array.isArray(entry.values) ? entry.values : [] }))
      .filter((entry) => Number.isInteger(entry.fromIndex) && entry.fromIndex >= 0)
      .sort((a, b) => a.fromIndex - b.fromIndex)
    if (sorted.length === 0) return
    const colCount = Math.max(1, this.element.querySelectorAll(".tag-table thead th").length)

    let inserted = 0
    sorted.forEach((entry) => {
      const rows = tableBodyRows()
      const targetIndex = entry.fromIndex - inserted
      const referenceRow = targetIndex >= rows.length ? this.templateRowTarget : rows[targetIndex]
      const ghost = document.createElement("tr")
      ghost.className = "row-moved-ghost row-status-highlight-deleted"
      ghost.setAttribute("aria-hidden", "true")
      for (let i = 0; i < colCount; i += 1) {
        const cell = document.createElement("td")
        const value = entry.values[i]
        const shell = document.createElement("div")
        shell.className = "cell ghost-cell"
        if (value && typeof value === "object" && "label" in value) {
          shell.textContent = value.label || ""
        } else {
          shell.textContent = value == null ? "" : String(value)
        }
        cell.appendChild(shell)
        ghost.appendChild(cell)
      }
      tbody.insertBefore(ghost, referenceRow)
      inserted += 1
    })
  }

  buildDeletedRowsStatus(count, deletedEntries) {
    const noun = count === 1 ? "row" : "rows"
    return {
      simple: `${count} ${noun} deleted`,
      detailed: `${count} ${noun} deleted (original positions shown)`,
      meta: { kind: "rows-deleted", entries: deletedEntries }
    }
  }

  buildMovedRowsStatus(count, movedEntries) {
    const noun = count === 1 ? "row" : "rows"
    return {
      simple: `${count} ${noun} moved`,
      detailed: `${count} ${noun} moved (original positions shown)`,
      meta: { kind: "rows-moved", entries: movedEntries }
    }
  }

  buildMovedBackStatus(count, movedEntries) {
    const noun = count === 1 ? "row" : "rows"
    return {
      simple: `${count} ${noun} moved back`,
      detailed: `${count} ${noun} moved back (previous positions shown)`,
      meta: { kind: "rows-moved", entries: movedEntries }
    }
  }

  restoreDeletedRowsFromStatus() {
    const entries = this._lastStatus?.meta?.entries
    if (!Array.isArray(entries) || entries.length === 0) return false
    this.clearDeletedGhostRows()
    const sorted = entries
      .map((entry) => ({ index: Number(entry.index), values: Array.isArray(entry.values) ? entry.values : [] }))
      .filter((entry) => Number.isInteger(entry.index) && entry.index >= 0)
      .sort((a, b) => a.index - b.index)
    if (sorted.length === 0) return false

    const restoredRows = []
    sorted.forEach((entry) => {
      const rows = this.dataRows
      const ref = entry.index >= rows.length ? this.templateRowTarget : rows[entry.index]
      const restored = this.addRowWithValues(entry.values, ref)
      if (restored) restoredRows.push(restored)
    })
    this.reindexRows()
    this.clearHoverState()
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
    restoredRows.forEach((row) => {
      row.classList.add("row-restored-flash")
      row.addEventListener("animationend", () => row.classList.remove("row-restored-flash"), { once: true })
    })
    const restoredLabel = restoredRows.length === 1 ? "Row restored" : "Rows restored"
    this.setStatus({ simple: restoredLabel, detailed: restoredLabel, meta: { kind: "rows-restored" } }, restoredRows)
    return true
  }

  restoreMovedRowsFromStatus() {
    const entries = this._lastStatus?.meta?.entries
    if (!Array.isArray(entries) || entries.length === 0) return false
    this.clearMovedGhostRows()
    const sorted = entries
      .map((entry) => ({ row: entry.row, fromIndex: Number(entry.fromIndex) }))
      .filter((entry) => entry.row && entry.row.isConnected && Number.isInteger(entry.fromIndex) && entry.fromIndex >= 0)
      .sort((a, b) => a.fromIndex - b.fromIndex)
    if (sorted.length === 0) return false

    const preRestoreRows = this.dataRows
    const reverseEntries = sorted
      .map((entry) => ({ row: entry.row, fromIndex: preRestoreRows.indexOf(entry.row), values: this.getRowValues(entry.row) }))
      .filter((entry) => entry.fromIndex >= 0)
      .sort((a, b) => a.fromIndex - b.fromIndex)

    const tbody = this.tbodyTarget
    sorted.forEach((entry) => entry.row.remove())
    sorted.forEach((entry) => {
      const rows = this.dataRows
      const ref = entry.fromIndex >= rows.length ? this.templateRowTarget : rows[entry.fromIndex]
      tbody.insertBefore(entry.row, ref)
    })
    this.reindexRows()
    this.clearHoverState()
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
    const restoredRows = sorted.map((entry) => entry.row)
    restoredRows.forEach((row) => {
      row.classList.add("row-restored-flash")
      row.addEventListener("animationend", () => row.classList.remove("row-restored-flash"), { once: true })
    })
    this.setStatus(this.buildMovedBackStatus(restoredRows.length, reverseEntries), restoredRows)
    return true
  }

  handleStatusClick(e) {
    if (e.button !== 0) return
    if (!this._lastStatus) return
    if (!this._lastStatusRows?.length) {
      this._statusDetailedMode = !this._statusDetailedMode
      const deletedMeta = this._lastStatus.meta && this._lastStatus.meta.kind === "rows-deleted" ? this._lastStatus.meta : null
      const movedMeta = this._lastStatus.meta && this._lastStatus.meta.kind === "rows-moved" ? this._lastStatus.meta : null
      if (deletedMeta && this._statusDetailedMode) this.showDeletedGhostRows(deletedMeta.entries)
      else this.clearDeletedGhostRows()
      if (movedMeta && this._statusDetailedMode) this.showMovedGhostRows(movedMeta.entries)
      else this.clearMovedGhostRows()
      const headerMeta = this._lastStatus?.meta
      const headerNames = (headerMeta?.kind === "header-field-change" || headerMeta?.kind === "invalid-ip") ? headerMeta.headerFieldNames : null
      const headerClass = headerMeta?.kind === "invalid-ip" ? "header-status-highlight-error" : "header-status-highlight"
      if (this._statusDetailedMode) this.showHeaderStatusHighlight(headerNames, headerClass)
      else this.clearHeaderStatusHighlight()
      this.renderStatusMessage()
      return
    }
    const lastSet = new Set(this._lastStatusRows.filter(r => r && r.isConnected))
    const highlightedSet = this._statusHighlightedRows ? new Set(this._statusHighlightedRows) : new Set()
    const same = lastSet.size === highlightedSet.size && [...lastSet].every(r => highlightedSet.has(r))
    if (same) {
      this.clearStatusHighlight()
      this.clearHeaderStatusHighlight()
      this.clearDeletedGhostRows()
      this.clearMovedGhostRows()
      this._statusDetailedMode = false
      this.renderStatusMessage()
      return
    }
    this.clearStatusHighlight()
    this.clearHeaderStatusHighlight()
    this.clearDeletedGhostRows()
    this._statusHighlightedRows = this._lastStatusRows.filter(r => r && r.isConnected)
    const highlightClass = this.statusHighlightClass()
    this._statusHighlightedRows.forEach(r => r.classList.add(highlightClass))
    this._statusDetailedMode = true
    const movedMeta = this._lastStatus?.meta?.kind === "rows-moved" ? this._lastStatus.meta : null
    if (movedMeta) this.showMovedGhostRows(movedMeta.entries)
    else this.clearMovedGhostRows()
    this.renderStatusMessage()
  }

  requireTitleBeforeHome(e) {
    e.preventDefault()
    const homeUrl = e.currentTarget && e.currentTarget.href
    this.saveForm().then((res) => {
      if (homeUrl) window.location.href = homeUrl
    })
  }

  updateStatusCount() {
    if (!this.hasStatusCountTarget) return
    const n = this.dataRows.length
    this.statusCountTarget.textContent = n + " tag" + (n !== 1 ? "s" : "")
  }

  // Keyboard commit/cancel behavior for cells and header fields.
  handleKeydown(e) {
    const el = e.target
    if (!el || !this.element.contains(el)) return
    const isCell = (el.tagName === "INPUT" || el.tagName === "SELECT") && el.classList.contains("cell") && !el.matches('button, [type="submit"]')
    const isHeaderEditable = this.isHeaderEditable(el)
    if ((e.key === "Enter" || e.key === "Tab") && isCell) {
      const isEnter = e.key === "Enter"
      const isTab = e.key === "Tab"
      if (isEnter) e.preventDefault()
      const originalValue = this._editingCell === el ? this._editingCellOriginalValue : el.value
      const hasChanged = String(el.value ?? "") !== String(originalValue ?? "")
      this._committedOnEnter = true
      if (hasChanged) {
        const m = el.name && el.name.match(/records\[\d+\]\[([^\]]+)\]/)
        const row = el.closest("tr.tag-data-row")
        const validRow = row && !row.classList.contains("tag-row-template")
        if (m) {
          this.setStatus(this.buildRecordStatusForChange(m[1], originalValue, el.value, row), validRow ? [row] : null)
        }
        this.saveForm({ delta: this.buildRecordFieldDelta(el), clearSortIndicator: true })
      }
      if (isTab) {
        const nextTextCell = this.findNextTextCell(el, e.shiftKey)
        if (nextTextCell) {
          e.preventDefault()
          nextTextCell.focus()
          if (nextTextCell.tagName === "INPUT" || nextTextCell.tagName === "TEXTAREA") nextTextCell.select()
        }
      }
      if (isEnter) el.blur()
    } else if (e.key === "Enter" && isHeaderEditable) {
      e.preventDefault()
      const originalValue = this._editingHeaderField === el ? this._editingHeaderFieldOriginalValue : el.value
      const hasChanged = String(el.value ?? "") !== String(originalValue ?? "")
      this._headerFieldCommitted = true
      if (hasChanged) {
        const isIpField = (el.getAttribute("name") || "") === "metadata_ip"
        const isInvalidIp = isIpField && (el.value || "").trim() !== "" && !this.isValidIpv4(el.value)
        if (isInvalidIp) this.setStatus(this.buildInvalidIpStatus(originalValue, el.value))
        else this.setStatus(this.buildHeaderFieldChangeStatus(el, originalValue, el.value))
        this.saveForm({ delta: this.buildHeaderFieldDelta(el) })
      }
      this.validateTable()
      el.blur()
    } else if (e.key === "Escape" && isCell) {
      const isSelect = el.tagName === "SELECT"
      if (!isSelect) e.preventDefault()
      if (this._editingCell) {
        this._editingCellCanceled = true
        this._editingCell.value = this._editingCellOriginalValue
        this._editingCell = null
      }
      this.validateTable()
      if (isSelect) this.blurSelectAfterClose(el)
      else el.blur()
    } else if (e.key === "Escape" && isHeaderEditable) {
      const isSelect = el.tagName === "SELECT"
      if (!isSelect) e.preventDefault()
      if (this._editingHeaderField === el) {
        this._editingHeaderFieldCanceled = true
        this._editingHeaderField.value = this._editingHeaderFieldOriginalValue
        this._headerFieldCommitted = false
      }
      this.validateTable()
      if (isSelect) this.blurSelectAfterClose(el)
      else el.blur()
    }
  }

  handleKeyup(e) {
    if (e.key !== "Escape") return
    const el = e.target
    if (!el || !this.element.contains(el) || el.tagName !== "SELECT") return
    const isCellSelect = el.classList.contains("cell") && el.closest("tr.tag-data-row")
    if (!isCellSelect && !this.isHeaderEditable(el)) return
    this.blurSelectAfterClose(el)
  }

  blurSelectAfterClose(selectEl) {
    const ensureBlur = () => {
      if (document.activeElement !== selectEl) return
      selectEl.blur()
      if (document.activeElement === selectEl) {
        const fallback = this.element
        const hadTabindex = fallback.hasAttribute("tabindex")
        if (!hadTabindex) fallback.setAttribute("tabindex", "-1")
        fallback.focus({ preventScroll: true })
        if (!hadTabindex) fallback.removeAttribute("tabindex")
      }
    }
    requestAnimationFrame(ensureBlur)
    setTimeout(ensureBlur, 0)
    setTimeout(ensureBlur, 40)
  }

  findNextTextCell(currentEl, backwards = false) {
    const allCells = Array.from(this.element.querySelectorAll("input.cell:not([type='hidden']), textarea.cell, select.cell"))
      .filter((cell) => !cell.disabled)
      .filter((cell) => cell.offsetParent !== null)
    const textCells = allCells.filter((cell) => cell.tagName !== "SELECT")
    if (textCells.length === 0) return null
    const currentAllIndex = allCells.indexOf(currentEl)
    if (currentAllIndex === -1) return null
    if (backwards) {
      for (let i = currentAllIndex - 1; i >= 0; i -= 1) {
        if (allCells[i].tagName !== "SELECT") return allCells[i]
      }
      return null
    }
    for (let i = currentAllIndex + 1; i < allCells.length; i += 1) {
      if (allCells[i].tagName !== "SELECT") return allCells[i]
    }
    return null
  }

  handleCellFocusIn(e) {
    const el = e.target
    if (this.hasDeletedGhostPreviewActive() && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) {
      if (this.restoreDeletedRowsFromStatus()) {
        requestAnimationFrame(() => {
          if (el && el.isConnected) el.focus()
        })
      }
    } else if (this.hasMovedGhostPreviewActive() && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) {
      if (this.restoreMovedRowsFromStatus()) {
        requestAnimationFrame(() => {
          if (el && el.isConnected) el.focus()
        })
      }
    }
    if ((el.tagName === "INPUT" || el.tagName === "SELECT") && el.classList.contains("cell") && el.closest("tr.tag-data-row")) {
      this._editingCell = el
      this._editingCellOriginalValue = el.value
      this._committedOnEnter = false
      this._editingCellCanceled = false
      return
    }
    if (this.isHeaderEditable(el)) {
      this._editingHeaderField = el
      this._editingHeaderFieldOriginalValue = el.value
      this._headerFieldCommitted = false
      this._editingHeaderFieldCanceled = false
    }
  }

  handleCellFocusOut(e) {
    if (this._editingCell && e.target === this._editingCell) {
      const el = this._editingCell
      const originalValue = this._editingCellOriginalValue
      const committed = this._committedOnEnter
      const canceled = this._editingCellCanceled
      this._editingCell = null
      this._committedOnEnter = false
      this._editingCellCanceled = false
      if (canceled || this._isUnloading) return
      if (committed) return
      if (el.tagName === "SELECT") return
      const hasChanged = String(el.value ?? "") !== String(originalValue ?? "")
      if (hasChanged) {
        const m = el.name && el.name.match(/records\[\d+\]\[([^\]]+)\]/)
        const row = el.closest("tr.tag-data-row")
        const validRow = row && !row.classList.contains("tag-row-template")
        if (m) {
          this.setStatus(this.buildRecordStatusForChange(m[1], originalValue, el.value, row), validRow ? [row] : null)
          this.saveForm({ delta: this.buildRecordFieldDelta(el), clearSortIndicator: true })
        }
      }
      return
    }
    if (this._editingHeaderField && e.target === this._editingHeaderField) {
      const el = this._editingHeaderField
      const originalValue = this._editingHeaderFieldOriginalValue
      const committed = this._headerFieldCommitted
      const canceled = this._editingHeaderFieldCanceled
      this._editingHeaderField = null
      this._headerFieldCommitted = false
      this._editingHeaderFieldCanceled = false
      if (canceled || this._isUnloading) return
      if (committed) return
      if (el.tagName === "SELECT") return
      const hasChanged = String(el.value ?? "") !== String(originalValue ?? "")
      if (hasChanged) {
        const isIpField = (el.getAttribute("name") || "") === "metadata_ip"
        const isInvalidIp = isIpField && (el.value || "").trim() !== "" && !this.isValidIpv4(el.value)
        if (isInvalidIp) this.setStatus(this.buildInvalidIpStatus(originalValue, el.value))
        else this.setStatus(this.buildHeaderFieldChangeStatus(el, originalValue, el.value))
        this.saveForm({ delta: this.buildHeaderFieldDelta(el) })
      }
      this.validateTable()
    }
  }

  handleCellSelectChange(e) {
    const el = e.target
    if (el.tagName !== "SELECT") return
    if (this.isHeaderEditable(el)) {
      const originalValue = this._editingHeaderField === el ? this._editingHeaderFieldOriginalValue : el.value
      const hasChanged = String(el.value ?? "") !== String(originalValue ?? "")
      this._headerFieldCommitted = true
      if (hasChanged) {
        const isIpField = (el.getAttribute("name") || "") === "metadata_ip"
        const isInvalidIp = isIpField && (el.value || "").trim() !== "" && !this.isValidIpv4(el.value)
        if (isInvalidIp) this.setStatus(this.buildInvalidIpStatus(originalValue, el.value))
        else this.setStatus(this.buildHeaderFieldChangeStatus(el, originalValue, el.value))
        this.saveForm({ delta: this.buildHeaderFieldDelta(el) })
      }
      this.validateTable()
      el.blur()
      return
    }
    if (!el.classList.contains("cell") || !el.closest("tr.tag-data-row")) return
    const name = el.getAttribute("name") || ""
    if (!name.includes("[Data Length]") && !name.includes("[Scaling]") && !name.includes("[Read/Write]")) return
    this._committedOnEnter = true
    const originalValue = this._editingCell === el ? this._editingCellOriginalValue : el.value
    const m = name.match(/records\[\d+\]\[([^\]]+)\]/)
    if (m) {
      const row = el.closest("tr.tag-data-row")
      this.setStatus(this.buildFieldChangeStatus(m[1], originalValue, el.value), row ? [row] : null)
    }
    this.saveForm({ delta: this.buildRecordFieldDelta(el), clearSortIndicator: true })
    el.blur()
  }

  isHeaderEditable(el) {
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA")) return false
    return el.classList.contains("workspace-title-input") || el.classList.contains("connection-inline")
  }

  buildRecordFieldDelta(el) {
    const name = el?.getAttribute("name") || ""
    const m = name.match(/^records\[(\d+)\]\[([^\]]+)\]$/)
    if (!m) return null
    return {
      kind: "record_field",
      rowIndex: m[1],
      key: m[2],
      value: el.value
    }
  }

  buildHeaderFieldDelta(el) {
    const name = (el?.getAttribute("name") || "").trim()
    if (name === "metadata_filename") {
      return { kind: "metadata_field", key: "metadata_filename", value: el.value }
    }
    if (name === "metadata_ip") {
      return { kind: "metadata_field", key: "metadata_ip", value: el.value }
    }
    if (name === "metadata_protocol") {
      return { kind: "metadata_field", key: "metadata_protocol", value: el.value }
    }
    return null
  }

  appendDeltaToBody(body, delta) {
    if (!delta || typeof delta !== "object") return
    if (delta.kind) body.set("delta[kind]", String(delta.kind))
    if (delta.rowIndex != null) body.set("delta[row_index]", String(delta.rowIndex))
    if (delta.key != null) body.set("delta[key]", String(delta.key))
    if (delta.value != null) body.set("delta[value]", String(delta.value))
    if (delta.fields && typeof delta.fields === "object") {
      Object.entries(delta.fields).forEach(([k, v]) => {
        body.set(`delta[fields][${k}]`, v == null ? "" : String(v))
      })
    }
  }

  // Sorting UI state: once data is edited, current sort marker is no longer authoritative.
  clearSortIndicator() {
    const table = this.tbodyTarget && this.tbodyTarget.closest("table")
    if (!table) return
    table.querySelectorAll("th.sort-asc").forEach(th => th.classList.remove("sort-asc"))
    const url = new URL(window.location.href)
    if (url.searchParams.has("sort") || url.searchParams.has("direction")) {
      url.searchParams.delete("sort")
      url.searchParams.delete("direction")
      history.replaceState({}, "", url.toString())
    }
    const base = window.location.pathname
    table.querySelectorAll("thead th a[href]").forEach(a => {
      const col = a.textContent.trim()
      if (col) a.href = `${base}?sort=${encodeURIComponent(col)}&direction=asc`
    })
  }

  // Save document via PATCH without leaving the page. Returns fetch promise.
  // Save pipeline: delta payload for single-field edits, full form payload for bulk mutations.
  saveForm(options = {}) {
    const delta = options && options.delta ? options.delta : null
    const clearSortIndicator = !!(options && options.clearSortIndicator)
    const form = this.element
    if (!form || !form.action || form.tagName !== "FORM") return Promise.resolve()
    if (clearSortIndicator) this.clearSortIndicator()
    const method = (form.getAttribute("method") || "get").toUpperCase()
    const action = form.action
    const body = delta ? new FormData() : (() => {
      // Disabled fields are omitted from FormData — temporarily enable all table cells so every row is sent.
      const cells = form.querySelectorAll("input.cell, select.cell")
      const wasDisabled = []
      cells.forEach((el, i) => {
        wasDisabled[i] = el.disabled
        el.disabled = false
      })
      const fd = new FormData(form)
      cells.forEach((el, i) => {
        if (wasDisabled[i]) el.disabled = true
      })
      return fd
    })()
    if (delta) this.appendDeltaToBody(body, delta)
    if (!body.has("_method")) body.set("_method", "patch")
    const csrf = document.querySelector('meta[name="csrf-token"]')
    if (csrf && csrf.getAttribute("content") && !body.has("authenticity_token")) body.set("authenticity_token", csrf.getAttribute("content"))
    const headers = { "X-Requested-With": "XMLHttpRequest", "Accept": "text/html" }
    if (csrf && csrf.getAttribute("content")) headers["X-CSRF-Token"] = csrf.getAttribute("content")
    return fetch(action, { method: method === "GET" ? "GET" : "POST", body: body, headers }).catch(() => {})
  }

  saveThenExport(e) {
    e.preventDefault()
    const exportUrl = e.currentTarget.href
    this.saveForm().then((res) => {
      if (res && (res.status === 204 || res.ok)) window.location = exportUrl
      else window.location = exportUrl
    })
  }

  // Global shortcuts used while select mode is active.
  handleGlobalKeydown(e) {
    const inWorkspace = this.element.contains(document.activeElement) || this.element.classList.contains("workspace-select-mode")
    if (!inWorkspace) return
    const isSelectMode = this.element.classList.contains("workspace-select-mode")
    const isMod = e.metaKey || e.ctrlKey
    const key = (e.key || "").toLowerCase()
    if (isMod && key === "c") {
      if (isSelectMode) {
        const selected = this.getSelectedRows()
        if (selected.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          this.copySelected()
        }
      }
    } else if (isMod && key === "x") {
      if (isSelectMode) {
        const selected = this.getSelectedRows()
        if (selected.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          this.cutSelected()
        }
      }
    } else if (isMod && key === "v") {
      if (isSelectMode) {
        e.preventDefault()
        e.stopPropagation()
        if (this.clipboard && this.clipboard.length > 0) {
          this.paste()
        } else {
          this.pasteFromSystemClipboard()
        }
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const target = e.target
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return
      const selected = this.getSelectedRows()
      if (selected.length > 0 && this.element.classList.contains("workspace-select-mode")) {
        e.preventDefault()
        e.stopPropagation()
        this.removeSelected()
      }
    }
  }

  // Select mode: single click = one row; Cmd/Ctrl+click = toggle (multi); Shift+click = range from anchor.
  handleTbodyClick(e) {
    if (this.hasDeletedGhostPreviewActive()) {
      const ghostRow = e.target.closest("tr.row-deleted-ghost")
      if (ghostRow) {
        e.preventDefault()
        e.stopPropagation()
        this.restoreDeletedRowsFromStatus()
        return
      }
    }
    if (this.hasMovedGhostPreviewActive()) {
      const ghostRow = e.target.closest("tr.row-moved-ghost")
      if (ghostRow) {
        e.preventDefault()
        e.stopPropagation()
        this.restoreMovedRowsFromStatus()
        return
      }
    }
    if (!this.element.classList.contains("workspace-select-mode")) return
    const row = e.target.closest("tr.tag-data-row")
    if (!row || row.classList.contains("tag-row-template")) return
    e.preventDefault()
    e.stopPropagation()
    const dataRows = this.dataRows
    const rowIndex = dataRows.indexOf(row)
    if (e.metaKey || e.ctrlKey) {
      row.classList.toggle("row-selected")
      this.anchorRow = row
    } else if (e.shiftKey) {
      if (!this.anchorRow) {
        this.dataRows.forEach(r => r.classList.remove("row-selected"))
        row.classList.add("row-selected")
        this.anchorRow = row
      } else {
        const anchorIndex = dataRows.indexOf(this.anchorRow)
        const lo = Math.min(anchorIndex, rowIndex)
        const hi = Math.max(anchorIndex, rowIndex)
        this.dataRows.forEach((r, i) => r.classList.toggle("row-selected", i >= lo && i <= hi))
      }
    } else {
      const selected = this.getSelectedRows()
      if (selected.length === 1 && selected[0] === row) {
        row.classList.remove("row-selected")
        this.anchorRow = null
      } else {
        this.dataRows.forEach(r => r.classList.remove("row-selected"))
        row.classList.add("row-selected")
        this.anchorRow = row
      }
    }
  }

  get dataRows() {
    return Array.from(this.tbodyTarget.querySelectorAll("tr:not(.tag-row-template)"))
  }

  getSelectedRows() {
    return this.dataRows.filter(tr => tr.classList.contains("row-selected"))
  }

  clearHoverState() {
    this.dataRows.forEach((tr) => tr.classList.remove("row-hover"))
    this._hoverRow = null
  }

  // Clipboard and row mutation helpers.
  removeSelected(e) {
    if (e) e.preventDefault()
    if (this.element.classList.contains("workspace-locked")) return
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    const beforeRows = this.dataRows
    const deletedEntries = selected
      .map((tr) => ({ index: beforeRows.indexOf(tr), values: this.getRowValues(tr) }))
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index)
    selected.forEach(tr => tr.remove())
    this.reindexRows()
    this.clearHoverState()
    this.setStatus(this.buildDeletedRowsStatus(selected.length, deletedEntries))
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
  }

  cutSelected() {
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    this.copySelected()
    this.removeSelected()
    this.setStatus(selected.length === 1 ? "1 row cut" : `${selected.length} rows cut`)
    this.updateStatusCount()
  }

  duplicateSelected(e) {
    if (e) e.preventDefault()
    if (this.element.classList.contains("workspace-locked")) return
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    const dataRows = this.dataRows
    const lowestIndex = Math.max(...selected.map(tr => dataRows.indexOf(tr)))
    const insertBeforeRow = lowestIndex === dataRows.length - 1 ? this.templateRowTarget : dataRows[lowestIndex + 1]
    const valuesList = selected.map(tr => this.getRowValues(tr))
    selected.forEach(tr => tr.classList.remove("row-selected"))
    const newRows = []
    valuesList.forEach(values => {
      const newRow = this.addRowWithValues(values, insertBeforeRow)
      if (newRow) newRows.push(newRow)
    })
    this.reindexRows()
    this.clearHoverState()
    newRows.forEach(tr => tr.classList.add("row-selected"))
    if (newRows.length) newRows[0].scrollIntoView({ block: "nearest", behavior: "smooth" })
    this.setStatus(newRows.length === 1 ? "1 row duplicated" : `${newRows.length} rows duplicated`, newRows)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
  }

  copySelected() {
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    this.clipboard = selected.map(tr => this.getRowValues(tr))
    const headers = Array.from(this.element.querySelectorAll(".tag-table thead th")).map(th => th.textContent.replace(/\s*↑\s*$/, "").trim())
    const rows = this.clipboard
    const flatten = (v) => (typeof v === "object" && v && "label" in v ? v.label : v)
    const tsv = [headers.join("\t"), ...rows.map(vals => vals.map(flatten).join("\t"))].join("\n")
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(tsv).catch(() => this.fallbackCopyToClipboard(tsv))
    } else {
      this.fallbackCopyToClipboard(tsv)
    }
    this.setStatus(selected.length === 1 ? "1 row copied" : `${selected.length} rows copied`)
  }

  fallbackCopyToClipboard(text) {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.left = "-9999px"
    ta.setAttribute("readonly", "")
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand("copy")
    } catch (err) {}
    document.body.removeChild(ta)
  }

  paste(e) {
    if (e) e.preventDefault()
    if (this.clipboard && this.clipboard.length > 0) this.pasteWithValues(this.clipboard)
  }

  pasteFromSystemClipboard() {
    if (this.element.classList.contains("workspace-locked")) return
    if (!navigator.clipboard || !navigator.clipboard.readText) return
    navigator.clipboard.readText().then((text) => {
      const rows = this.parseTsvToRowValues(text)
      if (rows && rows.length > 0) this.pasteWithValues(rows)
    }).catch(() => {})
  }

  parseTsvToRowValues(text) {
    if (!text || typeof text !== "string") return null
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return null
    const rows = lines.slice(1).map((line) => line.split("\t"))
    const colCount = this.element.querySelectorAll(".tag-table thead th").length
    if (colCount === 0) return null
    return rows.filter((row) => row.length >= colCount).map((row) => row.slice(0, colCount))
  }

  pasteWithValues(values) {
    if (this.element.classList.contains("workspace-locked")) return
    if (!values || values.length === 0) return
    const selected = this.getSelectedRows()
    const dataRows = this.dataRows
    const insertBeforeRow = selected.length > 0
      ? (() => {
          const lowestIndex = Math.max(...selected.map(tr => dataRows.indexOf(tr)))
          return lowestIndex === dataRows.length - 1 ? this.templateRowTarget : dataRows[lowestIndex + 1]
        })()
      : null
    this.dataRows.forEach(r => r.classList.remove("row-selected"))
    const newRows = []
    values.forEach((rowValues) => {
      const newRow = this.addRowWithValues(rowValues, insertBeforeRow)
      if (newRow) newRows.push(newRow)
    })
    this.reindexRows()
    this.clearHoverState()
    newRows.forEach(tr => tr.classList.add("row-selected"))
    if (newRows.length) newRows[0].scrollIntoView({ block: "nearest", behavior: "smooth" })
    this.setStatus(newRows.length === 1 ? "1 row pasted" : `${newRows.length} rows pasted`, newRows)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
  }

  getRowValues(tr) {
    const cells = tr.querySelectorAll("td input.cell, td select.cell")
    const vals = Array.from(cells).map(el => (el.tagName === "SELECT" ? el.value : el.value))
    const dataTypeTd = tr.querySelector("td:nth-child(3)")
    if (dataTypeTd) {
      const rawDt = dataTypeTd.querySelector("input[name*='_raw_datatype']")?.value
      const rawEnc = dataTypeTd.querySelector("input[name*='_raw_encode']")?.value
      if (rawDt !== undefined || rawEnc !== undefined) {
        vals[2] = { label: vals[2], rawDt: rawDt ?? "0", rawEnc: rawEnc ?? "255" }
      }
    }
    return vals
  }

  setRowValues(tr, values) {
    const cells = tr.querySelectorAll("td input.cell, td select.cell")
    const dataTypeTd = tr.querySelector("td:nth-child(3)")
    cells.forEach((el, i) => {
      if (values[i] === undefined) return
      if (i === 2 && typeof values[i] === "object" && values[i] && "label" in values[i]) {
        const { label, rawDt, rawEnc } = values[i]
        el.value = label ?? ""
        if (dataTypeTd) {
          const rawDtInput = dataTypeTd.querySelector("input[name*='_raw_datatype']")
          const rawEncInput = dataTypeTd.querySelector("input[name*='_raw_encode']")
          const btn = dataTypeTd.querySelector(".data-type-trigger")
          if (rawDtInput) rawDtInput.value = rawDt ?? "0"
          if (rawEncInput) rawEncInput.value = rawEnc ?? "255"
          if (btn) {
            btn.textContent = label || "—"
            btn.dataset.value = label
            btn.dataset.rawDatatype = rawDt ?? "0"
            btn.dataset.rawEncode = rawEnc ?? "255"
            if (label === "Unique") btn.classList.add("data-type-unique")
            else btn.classList.remove("data-type-unique")
          }
        }
      } else {
        el.value = values[i]
      }
    })
    if (dataTypeTd && typeof values[2] === "string") {
      const btn = dataTypeTd.querySelector(".data-type-trigger")
      if (btn) {
        const label = values[2] || ""
        btn.textContent = label || "—"
        btn.dataset.value = label
        if (label === "Unique") btn.classList.add("data-type-unique")
        else btn.classList.remove("data-type-unique")
      }
    }
  }

  // Row mutation operations (add/delete/duplicate/paste/reorder) keep names/indexes consistent.
  addRow(e) {
    if (e) e.preventDefault()
    if (!this.hasTemplateRowTarget) return
    const newRow = this.addRowWithValues(null)
    this.clearHoverState()
    this.setStatus("1 row added", newRow ? [newRow] : null)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
  }

  addRowWithValues(values, insertBeforeRow) {
    if (!this.hasTemplateRowTarget) return null
    const ref = insertBeforeRow || this.templateRowTarget
    const currentRows = this.tbodyTarget.querySelectorAll("tr:not(.tag-row-template)")
    const nextIndex = currentRows.length
    const clone = this.templateRowTarget.cloneNode(true)
    clone.classList.remove("tag-row-template")
    clone.removeAttribute("id")
    clone.removeAttribute("aria-hidden")
    clone.removeAttribute("data-tag-table-target")
    clone.draggable = this.element.classList.contains("workspace-reorder-mode")
    clone.style.display = ""
    clone.querySelectorAll("[data-name-pattern]").forEach(el => {
      el.name = el.getAttribute("data-name-pattern").replace(new RegExp(PLACEHOLDER, "g"), nextIndex)
      el.removeAttribute("data-name-pattern")
    })
    clone.querySelectorAll("input, select").forEach(el => {
      el.disabled = this.element.classList.contains("workspace-locked") || this.element.classList.contains("workspace-reorder-mode") || this.element.classList.contains("workspace-select-mode")
    })
    if (values && values.length) this.setRowValues(clone, values)
    this.tbodyTarget.insertBefore(clone, ref)
    this.validateTable()
    return clone
  }

  reindexRows() {
    this.dataRows.forEach((tr, i) => {
      tr.querySelectorAll("[name^='records[']").forEach(el => {
        if (el.name && el.name.startsWith("records[")) {
          el.name = el.name.replace(/^records\[\d+\]/, `records[${i}]`)
        }
      })
    })
  }

  // Drag and drop row reordering.
  handleTbodyMouseMove(e) {
    const row = e.target.closest("tr.tag-data-row")
    const dataRow = row && !row.classList.contains("tag-row-template") ? row : null
    if (dataRow === this._hoverRow) return
    if (this._hoverRow) {
      this._hoverRow.classList.remove("row-hover")
      this._hoverRow = null
    }
    if (dataRow) {
      dataRow.classList.add("row-hover")
      this._hoverRow = dataRow
    }
  }

  handleTbodyMouseLeave() {
    if (this._hoverRow) {
      this._hoverRow.classList.remove("row-hover")
      this._hoverRow = null
    }
  }

  handleDragStart(e) {
    if (this.element.classList.contains("workspace-locked")) return
    if (!this.element.classList.contains("workspace-reorder-mode")) return
    const row = e.target.closest("tr.tag-data-row")
    if (!row || row.classList.contains("tag-row-template")) return
    this.draggedRow = row
    const selected = this.getSelectedRows()
    if (selected.length && selected.includes(row)) {
      this.movingRows = selected.slice() // order top to bottom
      this.draggedRowWasUnselected = false
    } else {
      this.movingRows = [row]
      this.draggedRowWasUnselected = true
    }
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", "")
    row.classList.add("drag-source")
  }

  handleDragOver(e) {
    e.preventDefault()
    const row = e.target.closest("tr.tag-data-row")
    if (!row || row.classList.contains("tag-row-template")) return
    const moving = this.movingRows || []
    if (row === this.draggedRow) return
    if (moving.length && moving.includes(row)) {
      // Dropping on a selected row should anchor around that local selected segment,
      // not the global first/last selected row.
      const rows = this.dataRows
      const index = rows.indexOf(row)
      let start = index
      while (start > 0 && moving.includes(rows[start - 1])) start -= 1
      let end = index
      while (end < rows.length - 1 && moving.includes(rows[end + 1])) end += 1
      const first = rows[start]
      const last = rows[end]
      const rect = row.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      const before = e.clientY < mid
      this.dataRows.forEach(r => r.classList.remove("drop-before", "drop-after"))
      if (before) first.classList.add("drop-before")
      else last.classList.add("drop-after")
    } else {
      this.dataRows.forEach(r => r.classList.remove("drop-before", "drop-after"))
      const rect = row.getBoundingClientRect()
      const mid = rect.top + rect.height / 2
      row.classList.add(e.clientY < mid ? "drop-before" : "drop-after")
    }
    e.dataTransfer.dropEffect = "move"
  }

  handleDrop(e) {
    e.preventDefault()
    const dropTarget = e.target.closest("tr.tag-data-row")
    if (!dropTarget || !this.draggedRow || dropTarget.classList.contains("tag-row-template")) return
    const moving = this.movingRows || [this.draggedRow]
    const preDropRows = this.dataRows
    const movedEntries = moving
      .map((r) => ({ row: r, fromIndex: preDropRows.indexOf(r), values: this.getRowValues(r) }))
      .filter((entry) => entry.fromIndex >= 0)
      .sort((a, b) => a.fromIndex - b.fromIndex)
    const rect = dropTarget.getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    const before = e.clientY < mid
    const tbody = this.tbodyTarget
    let ref
    if (moving.length && moving.includes(dropTarget)) {
      const rows = this.dataRows
      const index = rows.indexOf(dropTarget)
      let start = index
      while (start > 0 && moving.includes(rows[start - 1])) start -= 1
      let end = index
      while (end < rows.length - 1 && moving.includes(rows[end + 1])) end += 1
      // before => insert ahead of the local segment; after => insert after it.
      ref = before ? rows[start] : rows[end].nextElementSibling
    } else {
      ref = before ? dropTarget : dropTarget.nextElementSibling
    }
    // ref must not be one of the rows we're removing (would be detached and break insertBefore)
    while (ref && moving.includes(ref)) ref = ref.nextElementSibling

    const baseRows = preDropRows.filter((r) => !moving.includes(r))
    const insertAtRaw = ref ? baseRows.indexOf(ref) : baseRows.length
    const insertAt = insertAtRaw < 0 ? baseRows.length : insertAtRaw
    const nextOrder = [
      ...baseRows.slice(0, insertAt),
      ...moving,
      ...baseRows.slice(insertAt)
    ]
    const isNoOpDrop = nextOrder.length === preDropRows.length && nextOrder.every((r, i) => r === preDropRows[i])
    if (isNoOpDrop) {
      this.clearHoverState()
      this.dataRows.forEach(r => r.classList.remove("drop-before", "drop-after"))
      this.dataRows.forEach(r => r.classList.remove("row-selected"))
      this.anchorRow = null
      return
    }

    moving.forEach(r => r.remove())
    moving.forEach(r => tbody.insertBefore(r, ref))
    this.reindexRows()
    this.clearHoverState()
    this.dataRows.forEach(r => r.classList.remove("drop-before", "drop-after"))
    this.dataRows.forEach(r => r.classList.remove("row-selected"))
    this.anchorRow = null
    this.setStatus(this.buildMovedRowsStatus(moving.length, movedEntries), moving)
    this.validateTable()
    this.saveForm({ clearSortIndicator: true })
  }

  handleDragEnd(e) {
    this.dataRows.forEach(r => r.classList.remove("drag-source", "drop-before", "drop-after", "row-hover"))
    this.draggedRow = null
    this.movingRows = null
    this.draggedRowWasUnselected = null
    this._hoverRow = null
  }
}
