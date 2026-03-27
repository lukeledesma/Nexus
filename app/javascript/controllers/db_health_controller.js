import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "overlay",
    "panel",
    "toggleBtn",
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
    this.lockedPanelHeight = null
    this.defaultTitle = "DB Health"
  }

  disconnect() {
    this.stopAutoRefresh()
  }

  async toggle() {
    const shouldOpen = this.overlayTarget.classList.contains("hidden")
    this.overlayTarget.classList.toggle("hidden", !shouldOpen)
    this.toggleBtnTarget.classList.toggle("is-active", shouldOpen)

    if (shouldOpen) {
      this.clearFocus()
      await this.fetchAndRender()
      this.lockPanelHeightToOverviewContent()
      this.startAutoRefresh()
    } else {
      this.stopAutoRefresh()
    }
  }

  close() {
    this.overlayTarget.classList.add("hidden")
    this.toggleBtnTarget.classList.remove("is-active")
    this.stopAutoRefresh()
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
    this.lockPanelHeightToOverviewContent()
  }

  async refresh() {
    await this.fetchAndRender()
    if (!this.focusedMetricKey) this.lockPanelHeightToOverviewContent()
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

    if (this.lockedPanelHeight) {
      this.panelTarget.style.height = `${this.lockedPanelHeight}px`
    }
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

  lockPanelHeightToOverviewContent() {
    if (this.focusedMetricKey) return
    if (this.overlayTarget.classList.contains("hidden")) return

    this.panelTarget.style.height = "auto"
    const measuredHeight = Math.ceil(this.panelTarget.scrollHeight)

    if (measuredHeight > 0) {
      this.lockedPanelHeight = measuredHeight
      this.panelTarget.style.height = `${measuredHeight}px`
    }
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
    if (this.overlayTarget.classList.contains("hidden")) return

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
