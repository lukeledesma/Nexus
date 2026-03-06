import { Controller } from "@hotwired/stimulus"

const PLACEHOLDER = "__INDEX__"

export default class extends Controller {
  static targets = ["tbody", "templateRow", "addBtn", "statusCount", "statusMessage", "titleInput"]

  connect() {
    this.clipboard = []
    this.anchorRow = null
    this.boundKeydown = this.handleKeydown.bind(this)
    this.boundFormChange = this.markUnsaved.bind(this)
    this.element.addEventListener("keydown", this.boundKeydown, true)
    if (this.hasAddBtnTarget) this.addBtnTarget.addEventListener("click", this.addRow.bind(this))
    if (this.hasTbodyTarget) {
      this.boundTbodyClick = this.handleTbodyClick.bind(this)
      this.tbodyTarget.addEventListener("click", this.boundTbodyClick, true)
      this.tbodyTarget.addEventListener("dragstart", this.handleDragStart.bind(this))
      this.tbodyTarget.addEventListener("dragover", this.handleDragOver.bind(this))
      this.tbodyTarget.addEventListener("drop", this.handleDrop.bind(this))
      this.tbodyTarget.addEventListener("dragend", this.handleDragEnd.bind(this))
    }
    this.boundGlobalKeydown = this.handleGlobalKeydown.bind(this)
    document.addEventListener("keydown", this.boundGlobalKeydown, true)
    this.element.addEventListener("input", this.boundFormChange)
    this.element.addEventListener("change", this.boundFormChange)
    this.boundValidateTable = this.validateTable.bind(this)
    this.element.addEventListener("input", this.boundValidateTable)
    this.element.addEventListener("change", this.boundValidateTable)
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
    if (this.hasAddBtnTarget) this.addBtnTarget.removeEventListener("click", this.addRow.bind(this))
    if (this.hasTbodyTarget) {
      this.tbodyTarget.removeEventListener("click", this.boundTbodyClick, true)
      this.tbodyTarget.removeEventListener("dragstart", this.handleDragStart.bind(this))
      this.tbodyTarget.removeEventListener("dragover", this.handleDragOver.bind(this))
      this.tbodyTarget.removeEventListener("drop", this.handleDrop.bind(this))
      this.tbodyTarget.removeEventListener("dragend", this.handleDragEnd.bind(this))
    }
    document.removeEventListener("keydown", this.boundGlobalKeydown, true)
    this.element.removeEventListener("input", this.boundFormChange)
    this.element.removeEventListener("change", this.boundFormChange)
    this.element.removeEventListener("input", this.boundValidateTable)
    this.element.removeEventListener("change", this.boundValidateTable)
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
      const dataTypeEl = tr.querySelector("select[name*='[Data Type]']")
      const addrEl = tr.querySelector("input[name*='[Address Start]']")
      if (!dataTypeEl || !addrEl) return
      const kind = (dataTypeEl.value || "").trim() === "BOOL" ? "coil" : "holding"
      const addr = (addrEl.value || "").trim()
      const key = `${kind}:${addr}`
      keyCount.set(key, (keyCount.get(key) || 0) + 1)
    })
    rows.forEach(tr => {
      const dataTypeEl = tr.querySelector("select[name*='[Data Type]']")
      const addrEl = tr.querySelector("input[name*='[Address Start]']")
      if (!dataTypeEl || !addrEl) return
      const kind = (dataTypeEl.value || "").trim() === "BOOL" ? "coil" : "holding"
      const addr = (addrEl.value || "").trim()
      const key = `${kind}:${addr}`
      if (addr !== "" && (keyCount.get(key) || 0) > 1) addrEl.classList.add("cell-duplicate")
    })
  }

  markUnsaved(e) {
    if (!e.target) return
    if (e.target.classList.contains("cell") || e.target.classList.contains("workspace-title-input") || e.target.classList.contains("connection-inline")) {
      if (e.target.classList.contains("cell") && e.target.name) {
        const m = e.target.name.match(/records\[\d+\]\[([^\]]+)\]/)
        if (m) this.setStatus(m[1] + " updated")
      } else if (e.target.classList.contains("workspace-title-input")) {
        e.target.classList.remove("cell-invalid")
        this.setStatus("Document name updated")
      } else if (e.target.classList.contains("connection-inline")) {
        this.setStatus("Connection updated")
      }
    }
  }

  setStatus(message) {
    if (!this.hasStatusMessageTarget) return
    this.statusMessageTarget.textContent = message
  }

  requireTitleBeforeHome(e) {
    if (!this.hasTitleInputTarget) return
    const title = (this.titleInputTarget.value || "").trim()
    if (title === "") {
      e.preventDefault()
      this.titleInputTarget.classList.add("cell-invalid")
      this.setStatus("Enter a title")
      this.titleInputTarget.focus()
      return
    }
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

  handleKeydown(e) {
    if (e.key !== "Enter") return
    const el = e.target
    if (!el || !this.element.contains(el)) return
    if ((el.tagName === "INPUT" || el.tagName === "SELECT") && !el.matches('button, [type="submit"]')) {
      e.preventDefault()
      el.blur()
      this.saveForm()
    }
  }

  // Save document via PATCH without leaving the page. Returns fetch promise.
  saveForm() {
    const form = this.element
    if (!form || !form.action || form.tagName !== "FORM") return Promise.resolve()
    const method = (form.getAttribute("method") || "get").toUpperCase()
    const action = form.action
    // Disabled fields are omitted from FormData — temporarily enable all table cells so every row is sent
    const cells = form.querySelectorAll("input.cell, select.cell")
    const wasDisabled = []
    cells.forEach((el, i) => {
      wasDisabled[i] = el.disabled
      el.disabled = false
    })
    const body = new FormData(form)
    cells.forEach((el, i) => {
      if (wasDisabled[i]) el.disabled = true
    })
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

  handleGlobalKeydown(e) {
    const inWorkspace = this.element.contains(document.activeElement) || this.element.classList.contains("workspace-select-mode")
    if (!inWorkspace) return
    const isSelectMode = this.element.classList.contains("workspace-select-mode")
    const isMod = e.metaKey || e.ctrlKey
    if (isMod && e.key === "c") {
      if (isSelectMode) {
        const selected = this.getSelectedRows()
        if (selected.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          this.copySelected()
        }
      }
    } else if (isMod && e.key === "x") {
      if (isSelectMode) {
        const selected = this.getSelectedRows()
        if (selected.length > 0) {
          e.preventDefault()
          e.stopPropagation()
          this.cutSelected()
        }
      }
    } else if (isMod && e.key === "v") {
      if (isSelectMode && this.clipboard && this.clipboard.length > 0) {
        e.preventDefault()
        e.stopPropagation()
        this.paste()
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

  removeSelected(e) {
    if (e) e.preventDefault()
    if (this.element.classList.contains("workspace-locked")) return
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    selected.forEach(tr => tr.remove())
    this.reindexRows()
    this.setStatus(selected.length === 1 ? "1 row deleted" : `${selected.length} rows deleted`)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm()
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
    newRows.forEach(tr => tr.classList.add("row-selected"))
    if (newRows.length) newRows[0].scrollIntoView({ block: "nearest", behavior: "smooth" })
    this.setStatus(newRows.length === 1 ? "1 row duplicated" : `${newRows.length} rows duplicated`)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm()
  }

  copySelected() {
    const selected = this.getSelectedRows()
    if (selected.length === 0) return
    this.clipboard = selected.map(tr => this.getRowValues(tr))
    this.setStatus(selected.length === 1 ? "1 row copied" : `${selected.length} rows copied`)
  }

  paste(e) {
    if (e) e.preventDefault()
    if (this.element.classList.contains("workspace-locked")) return
    if (!this.clipboard || this.clipboard.length === 0) return
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
    this.clipboard.forEach(values => {
      const newRow = this.addRowWithValues(values, insertBeforeRow)
      if (newRow) newRows.push(newRow)
    })
    this.reindexRows()
    newRows.forEach(tr => tr.classList.add("row-selected"))
    if (newRows.length) newRows[0].scrollIntoView({ block: "nearest", behavior: "smooth" })
    this.setStatus(newRows.length === 1 ? "1 row pasted" : `${newRows.length} rows pasted`)
    this.updateStatusCount()
    this.validateTable()
    this.saveForm()
  }

  getRowValues(tr) {
    const cells = tr.querySelectorAll("td input.cell, td select.cell")
    return Array.from(cells).map(el => el.tagName === "SELECT" ? el.value : el.value)
  }

  setRowValues(tr, values) {
    const cells = tr.querySelectorAll("td input.cell, td select.cell")
    cells.forEach((el, i) => {
      if (values[i] !== undefined) el.value = values[i]
    })
  }

  addRow(e) {
    if (e) e.preventDefault()
    if (!this.hasTemplateRowTarget) return
    this.addRowWithValues(null)
    this.setStatus("1 row added")
    this.updateStatusCount()
    this.validateTable()
    this.saveForm()
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
      tr.querySelectorAll("td input.cell, td select.cell").forEach(el => {
        if (el.name && el.name.startsWith("records[")) {
          el.name = el.name.replace(/^records\[\d+\]/, `records[${i}]`)
        }
      })
    })
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
    } else {
      this.movingRows = [row]
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
      // dropping on another row in the selection: treat as before/after the whole block
      const first = moving[0]
      const last = moving[moving.length - 1]
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
    const rect = dropTarget.getBoundingClientRect()
    const mid = rect.top + rect.height / 2
    const before = e.clientY < mid
    const tbody = this.tbodyTarget
    let ref
    if (moving.length && moving.includes(dropTarget)) {
      ref = before ? moving[0].previousElementSibling : moving[moving.length - 1].nextElementSibling
    } else {
      ref = before ? dropTarget : dropTarget.nextElementSibling
    }
    // ref must not be one of the rows we're removing (would be detached and break insertBefore)
    while (ref && moving.includes(ref)) ref = ref.nextElementSibling
    moving.forEach(r => r.remove())
    moving.forEach(r => tbody.insertBefore(r, ref))
    this.reindexRows()
    this.dataRows.forEach(r => r.classList.remove("drop-before", "drop-after"))
    this.setStatus(moving.length === 1 ? "1 row moved" : `${moving.length} rows moved`)
    this.clearSortIndicator()
    this.validateTable()
    this.saveForm()
  }

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

  handleDragEnd(e) {
    this.dataRows.forEach(r => r.classList.remove("drag-source", "drop-before", "drop-after"))
    this.draggedRow = null
    this.movingRows = null
  }
}
