import { Controller } from "@hotwired/stimulus"
const SEARCH_DEBOUNCE_MS = 140

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
      // Invalidate any in-flight response so stale callbacks cannot override reset state.
      this.requestToken += 1
      this.clearTimersAndRequests()
      this.resetDefaultPanelView()
      return
    }

    this.debounceTimer = window.setTimeout(() => {
      this.fetchAndFilter(query)
    }, SEARCH_DEBOUNCE_MS)
  }

  async fetchAndFilter(query) {
    if (!this.hasSearchUrlValue || !this.hasAppsTarget) return

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
        this.applyMatchedDocumentIds(new Set())
        return
      }

      const matchedDocumentIds = new Set()
      const addMatch = (item) => {
        const id = String(item?.document_id || "").trim()
        if (id) matchedDocumentIds.add(id)
      }

      const nameMatches = Array.isArray(payload.name_matches) ? payload.name_matches : []
      const contentMatches = Array.isArray(payload.content_matches) ? payload.content_matches : []
      nameMatches.forEach(addMatch)
      contentMatches.forEach(addMatch)

      this.applyMatchedDocumentIds(matchedDocumentIds)
    } catch (_error) {
      if (requestToken !== this.requestToken) return
      this.applyMatchedDocumentIds(new Set())
    }
  }

  applyMatchedDocumentIds(matchedDocumentIds) {
    const allRows = this.hasAppsTarget ? Array.from(this.appsTarget.querySelectorAll("li.finder-tree__node")) : []

    let visibleCount = 0
    allRows.forEach((row) => {
      const rowId = String(row.dataset.finderTreeNodeId || "").trim()
      const visible = rowId && matchedDocumentIds.has(rowId)
      row.style.display = visible ? "" : "none"
      if (visible) visibleCount++
    })

    if (this.hasAppsTarget) this.appsTarget.hidden = visibleCount === 0
    if (this.hasResultsTarget) this.resultsTarget.hidden = true
    if (this.hasEmptyStateTarget) this.emptyStateTarget.hidden = visibleCount > 0
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

  resetDefaultPanelView() {
    if (this.hasAppsTarget) {
      const allRows = this.appsTarget.querySelectorAll("li.finder-tree__node")
      allRows.forEach((row) => {
        row.style.display = ""
      })
    }

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
