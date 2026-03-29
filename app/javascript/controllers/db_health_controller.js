import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "window",
    "panel",
    "title",
    "stamp",
    "grid",
    "metricCard",
    "detailWrap",
    "detailTitle",
    "detailList",
    "backButton",
    "itemsCount",
    "foldersCount",
    "maxItemId",
    "workspaceSize",
    "usersCount",
    "dbSize"
  ]

  static values = {
    url: String
  }

  connect() {
    this.refreshTimer = null
    this.focusedMetricKey = null
    this.latestPayload = null
    this.defaultTitle = "DB Health"
    this.windowWidth = 320
    this.minimumWindowHeight = 180
    this.windowHeight = this.calculateCardGridWindowHeight(
      this.calculateGridRows(this.metricCardTargets.length, 2)
    )
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.activeDrag = null
    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
      this.boundWindowInteraction = this.handleWindowInteraction.bind(this)

    this.restoreWindowBounds()
    window.addEventListener("db-health:toggle", this.boundToggleRequest)
      this.windowTarget.addEventListener("mousedown", this.boundWindowInteraction)
  }

  disconnect() {
    this.stopAutoRefresh()
    this.stopDrag()
    window.removeEventListener("db-health:toggle", this.boundToggleRequest)
      this.windowTarget.removeEventListener("mousedown", this.boundWindowInteraction)
  }

    handleWindowInteraction() {
      this.bringToFront()
    }

  handleToggleRequest() {
    this.toggle()
  }

  async toggle() {
    const shouldOpen = this.windowTarget.classList.contains("is-hidden")

    if (shouldOpen) {
      this.open()
      this.clearFocus()
      await this.fetchAndRender()
      this.startAutoRefresh()
    } else {
      this.close()
    }
  }

  open() {
    this.windowTarget.classList.remove("is-hidden")
    this.bringToFront()
    this.emitWindowState(true)
  }

  close() {
    this.emitWindowState(false)
    this.windowTarget.classList.add("is-hidden")
    this.stopAutoRefresh()
  }

  emitWindowState(isOpen) {
    const rect = this.windowTarget.getBoundingClientRect()
    const z = Number.parseInt(this.windowTarget.style.zIndex || window.getComputedStyle(this.windowTarget).zIndex, 10)
    window.dispatchEvent(new CustomEvent("db-health:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        z: Number.isFinite(z) ? z : 1500
      }
    }))
  }

  startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest(".db-health-controls")) return

    this.beginDrag(event)
  }

  startResize(event) {
    if (event.button !== undefined && event.button !== 0) return
    this.beginDrag(event)
  }

  beginDrag(event) {
    if (this.windowTarget.classList.contains("is-hidden")) return

    event.preventDefault()
    this.bringToFront()

    const rect = this.windowTarget.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)

    this.activeDrag = {
      offsetX: coords.x - rect.left,
      offsetY: coords.y - rect.top
    }

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getEventCoordinates(event)
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMargin
    const width = this.windowTarget.offsetWidth
    const height = this.windowTarget.offsetHeight

    let left = coords.x - this.activeDrag.offsetX
    let top = coords.y - this.activeDrag.offsetY

    left = Math.max(this.dockLeftBoundary, Math.min(left, vw - margin - width))
    top = Math.max(margin, Math.min(top, vh - margin - height))

    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  stopDrag() {
    if (this.activeDrag) {
      this.saveWindowBounds()
      this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
    }
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.dbHealth.bounds")
    if (!bounds) { this.positionWindow(); return }
    this.windowTarget.style.left = `${bounds.left}px`
    this.windowTarget.style.top  = `${bounds.top}px`
    // Preserve default width/height; only position is stored for fixed-size windows.
    this.windowTarget.style.width  = `${this.windowWidth}px`
    this.windowTarget.style.height = `${this.windowHeight}px`
  }

  saveWindowBounds() {
    const rect = this.windowTarget.getBoundingClientRect()
    const bounds = { left: Math.round(rect.left), top: Math.round(rect.top) }
    try { localStorage.setItem("nexus.window.dbHealth.bounds", JSON.stringify(bounds)) } catch (_) {}
  }

  readStoredBounds(key) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.left !== "number" || typeof parsed?.top !== "number") return null
      return parsed
    } catch (_) { return null }
  }

  getEventCoordinates(event) {
    if (event.touches) {
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      }
    }

    return {
      x: event.clientX,
      y: event.clientY
    }
  }

  positionWindow() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const defaultTop = this.viewportMargin
    const leftColumnLeft = this.dockLeftBoundary
    const width = Math.min(this.windowWidth, Math.max(280, vw - 40))
    const height = Math.min(this.windowHeight, Math.max(this.minimumWindowHeight, vh - 40))
    const left = Math.max(leftColumnLeft, Math.min(leftColumnLeft, vw - this.viewportMargin - width))
    const top = Math.max(this.viewportMargin, Math.min(defaultTop, vh - this.viewportMargin - height))

    this.windowTarget.style.width = `${width}px`
    this.windowTarget.style.height = `${height}px`
    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  bringToFront() {
      if (window.__nexusRestoringLayout) return
      const next = Number(window.__nexusDesktopZIndex || 1500) + 1
      window.__nexusDesktopZIndex = next
    this.windowTarget.style.zIndex = String(next)
    this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
  }

  calculateGridRows(itemCount, columns = 2) {
    return Math.max(1, Math.ceil(itemCount / columns))
  }

  calculateCardGridWindowHeight(rows) {
    const baseChromeHeight = 75
    const cardHeight = 50
    const rowGap = 5
    return baseChromeHeight + (rows * cardHeight) + (Math.max(0, rows - 1) * rowGap)
  }

  focusMetric(event) {
    const metricCard = event.currentTarget
    const key = metricCard.dataset.dbHealthFocusKey
    if (!key) return

    this.focusedMetricKey = key
    this.applyFocusState()
    this.renderFocusedDetails()
  }

  clearFocus() {
    this.focusedMetricKey = null
    this.applyFocusState()
    this.detailListTarget.innerHTML = ""
    this.detailListTarget.style.maxHeight = ""
  }

  async refresh() {
    await this.fetchAndRender()
  }

  async fetchAndRender() {
    try {
      const response = await fetch(this.urlValue, {
        method: "GET",
        headers: { Accept: "application/json" }
      })

      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      this.latestPayload = payload

      this.renderMetrics(payload)
      if (this.focusedMetricKey) this.renderFocusedDetails()
    } catch (error) {
      this.stampTarget.textContent = `Health unavailable (${error.message})`
    }
  }

  renderMetrics(payload) {
    const records = payload.records || {}
    const workspace = payload.workspace || {}
    const database = payload.database || {}

    this.stampTarget.textContent = `Updated ${this.formatTimestamp(payload.generated_at)}`
    this.itemsCountTarget.textContent = this.formatNumber(records.items_count)
    this.foldersCountTarget.textContent = this.formatNumber(records.folders_count)
    this.maxItemIdTarget.textContent = this.formatNumber(records.item_id_total)
    this.workspaceSizeTarget.textContent = this.formatBytes(workspace.total_size_bytes)
    this.usersCountTarget.textContent = this.formatNumber(records.users_count)
    this.dbSizeTarget.textContent = this.formatBytes(database.database_size_bytes)
  }

  applyFocusState() {
    const focused = this.focusedMetricKey

    this.gridTarget.classList.toggle("hidden", Boolean(focused))
    this.detailWrapTarget.classList.toggle("hidden", !focused)
    this.backButtonTarget.classList.toggle("hidden", !focused)
    this.titleTarget.textContent = focused ? this.focusLabelForKey(focused) : this.defaultTitle

  }

  focusLabelForKey(key) {
    if (key === "folders") return "Folders"
    if (key === "items") return "Items"
    if (key === "item_id_total") return "Item IDs"
    if (key === "workspace") return "Workspace Size"
    if (key === "users") return "Users"
    if (key === "db_size") return "DB Size"
    return this.defaultTitle
  }

  renderFocusedDetails() {
    if (!this.focusedMetricKey || !this.latestPayload) return

    const details = this.latestPayload.details || {}
    const key = this.focusedMetricKey
    let title = "Details"
    let lines = []
    let rows = []

    if (key === "folders") {
      title = "Folders Included"
      lines = this.normalizeArray(details.folders).map((entry) => {
        const value = this.normalizeEntry(entry)
        return `#${value.id ?? "?"} ${value.name ?? "(unnamed)"}`
      })
    } else if (key === "items") {
      title = "Items Included"
      lines = this.normalizeArray(details.items).map((entry) => {
        const value = this.normalizeEntry(entry)
        return `#${value.id ?? "?"} ${value.item_type ?? "item"} - ${value.name ?? "(untitled)"}`
      })
    } else if (key === "item_id_total") {
      title = "Item IDs"
      lines = this.normalizeArray(details.items).map((entry) => {
        const value = this.normalizeEntry(entry)
        return `#${value.id ?? "?"} ${value.item_type ?? "item"} - ${value.name ?? "(untitled)"}`
      })
    } else if (key === "users") {
      title = "Users Included"
      lines = this.normalizeArray(details.users).map((entry) => {
        const value = this.normalizeEntry(entry)
        return `#${value.id ?? "?"} ${value.email ?? "(no email)"}`
      })
    } else if (key === "workspace") {
      title = "Workspace Files"
      rows = this.normalizeArray(details.workspace_files).map((entry) => {
        const value = this.normalizeEntry(entry)
        return {
          left: value.name ?? "(unnamed)",
          right: this.formatBytes(value.size_bytes)
        }
      })
    } else if (key === "db_size") {
      title = "DB Tables"
      rows = this.normalizeArray(details.db_tables).map((entry) => {
        const value = this.normalizeEntry(entry)
        return {
          left: value.name ?? "(table)",
          right: this.formatBytes(value.size_bytes)
        }
      })
    }

    if (rows.length === 0 && lines.length === 0) lines = ["Nothing to show yet"]

    this.detailTitleTarget.textContent = title
    this.detailListTarget.innerHTML = ""

    if (rows.length > 0) {
      rows.forEach((row) => {
        const item = document.createElement("li")
        item.classList.add("db-health-detail-row")

        const left = document.createElement("span")
        left.classList.add("db-health-detail-row-main")
        left.textContent = row.left

        const right = document.createElement("span")
        right.classList.add("db-health-detail-row-size")
        right.textContent = row.right

        item.append(left, right)
        this.detailListTarget.appendChild(item)
      })

      this.adjustDetailListMaxHeight()
      return
    }

    lines.forEach((line) => {
      const item = document.createElement("li")
      item.textContent = line
      this.detailListTarget.appendChild(item)
    })

    this.adjustDetailListMaxHeight()
  }

  adjustDetailListMaxHeight() {
    if (!this.focusedMetricKey) return
    if (this.windowTarget.classList.contains("is-hidden")) return

    const panelRect = this.panelTarget.getBoundingClientRect()
    const listRect = this.detailListTarget.getBoundingClientRect()
    const bottomInset = 12
    const available = Math.floor(panelRect.bottom - listRect.top - bottomInset)

    if (available > 0) {
      this.detailListTarget.style.maxHeight = `${available}px`
    } else {
      this.detailListTarget.style.maxHeight = ""
    }
  }

  startAutoRefresh() {
    this.stopAutoRefresh()
    this.refreshTimer = window.setInterval(() => {
      this.fetchAndRender()
    }, 30000)
  }

  stopAutoRefresh() {
    if (!this.refreshTimer) return
    window.clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  formatNumber(value) {
    return Number(value || 0).toLocaleString()
  }

  formatBytes(value) {
    const bytes = Number(value || 0)
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  formatTimestamp(value) {
    if (!value) return "just now"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "just now"
    return date.toLocaleString()
  }

  normalizeArray(value) {
    if (Array.isArray(value)) return value

    if (typeof value === "string") {
      const trimmed = value.trim()
      if (!trimmed) return []

      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed
      } catch (_error) {
        // Ignore parse failure and fall back to CSV split.
      }

      return trimmed.split(",").map((part) => part.trim()).filter(Boolean)
    }

    if (value && typeof value === "object") return Object.values(value)
    return []
  }

  normalizeEntry(entry) {
    if (entry && typeof entry === "object") return entry

    if (typeof entry === "string") {
      try {
        const parsed = JSON.parse(entry)
        if (parsed && typeof parsed === "object") return parsed
      } catch (_error) {
        // Fall back to raw string handling.
      }

      return { name: entry }
    }

    return { name: String(entry) }
  }
}
