import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"

const SEARCH_DEBOUNCE_MS = 140

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export default class extends Controller {
  static targets = ["input", "apps", "userSection", "results", "emptyState"]
  static values = { searchUrl: String }

  connect() {
    this.abortController = null
    this.debounceTimer = null
    this.requestToken = 0
    this.lastQuery = ""
  }

  disconnect() {
    this.clearTimersAndRequests()
  }

  handleInput(event) {
    const value = event?.target?.value || ""
    this.queueSearch(value)
  }

  handleInputKeydown(event) {
    if (event.key !== "Escape") return
    if (!this.hasInputTarget) return

    this.inputTarget.value = ""
    this.queueSearch("")
  }

  queueSearch(rawQuery) {
    const query = String(rawQuery || "").trim()
    this.lastQuery = query

    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (!query) {
      this.clearTimersAndRequests()
      this.resetDefaultPanelView()
      return
    }

    this.debounceTimer = window.setTimeout(() => {
      this.fetchAndRender(query)
    }, SEARCH_DEBOUNCE_MS)
  }

  async fetchAndRender(query) {
    if (!this.hasSearchUrlValue || !this.hasResultsTarget) return

    if (this.abortController) this.abortController.abort()
    this.abortController = new AbortController()

    const requestToken = ++this.requestToken

    try {
      const url = `${this.searchUrlValue}?q=${encodeURIComponent(query)}`
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: this.abortController.signal
      })

      if (!response.ok) throw new Error("Search failed")
      const payload = await response.json().catch(() => null)

      if (requestToken !== this.requestToken) return
      if (!payload || payload.ok !== true) {
        this.renderResults([], [])
        return
      }

      const nameMatches = Array.isArray(payload.name_matches) ? payload.name_matches : []
      const contentMatches = Array.isArray(payload.content_matches) ? payload.content_matches : []
      this.renderResults(nameMatches, contentMatches)
    } catch (_error) {
      if (requestToken !== this.requestToken) return
      this.renderResults([], [])
    }
  }

  renderResults(nameMatches, contentMatches) {
    const rows = []

    nameMatches.forEach((item) => rows.push(this.renderRow(item)))
    contentMatches.forEach((item) => rows.push(this.renderRow(item)))

    this.showSearchMode(rows.length === 0)
    this.resultsTarget.innerHTML = rows.join("")
  }

  renderRow(item) {
    const appKey = escapeHtml(item?.app_key || "")
    const documentId = escapeHtml(item?.document_id || "")
    const title = escapeHtml(item?.document_title || "Untitled")
    const icon = this.iconName(item?.icon)

    return `
      <button
        type="button"
        class="desktop-side-panel-app-row"
        data-action="click->side-panel-search#openResult"
        data-app-key="${appKey}"
        data-document-id="${documentId}"
        data-document-title="${title}"
      >
        <span class="desktop-side-panel-app-icon" aria-hidden="true">${materialSymbolSvg(icon, "sm")}</span>
        <span class="desktop-side-panel-app-label">${title}</span>
      </button>
    `
  }

  iconName(value) {
    const key = String(value || "").trim().toLowerCase()
    const known = new Set(["edit_note", "task_checklist", "overview", "wallpaper", "graphic_eq", "file_document"])
    return known.has(key) ? key : "file_document"
  }

  openResult(event) {
    event.preventDefault()
    const button = event.currentTarget
    const appKey = button?.dataset?.appKey
    const documentId = button?.dataset?.documentId
    const documentTitle = button?.dataset?.documentTitle
    if (!appKey || !documentId) return

    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: {
        appKey,
        documentId,
        documentTitle: String(documentTitle || "").trim()
      }
    }))
  }

  showSearchMode(isEmpty) {
    if (this.hasAppsTarget) this.appsTarget.hidden = true
    if (this.hasResultsTarget) this.resultsTarget.hidden = false
    if (this.hasEmptyStateTarget) this.emptyStateTarget.hidden = !isEmpty
  }

  resetDefaultPanelView() {
    if (this.hasAppsTarget) this.appsTarget.hidden = false
    if (this.hasResultsTarget) {
      this.resultsTarget.hidden = true
      this.resultsTarget.innerHTML = ""
    }
    if (this.hasEmptyStateTarget) this.emptyStateTarget.hidden = true
  }

  clearTimersAndRequests() {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }
}
