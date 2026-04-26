import { Controller } from "@hotwired/stimulus"

/** App launcher rows (side panel): toggle windows + reflect `app-window:state`. */
export default class extends Controller {
  connect() {
    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundAppWindowState)
    this.clearRowActiveState()
  }

  disconnect() {
    window.removeEventListener("app-window:state", this.boundAppWindowState)
  }

  async launchApp(event) {
    if (event.target instanceof Element && event.target.closest(".desktop-side-panel-app-action")) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const appKey = event.currentTarget.dataset.windowKey
    if (!appKey) {
      return
    }

    await this.launchAppKey(appKey)
  }

  async launchAppKey(appKey) {
    if (!appKey) return

    const draftOnFirstOpenKeys = new Set([
      "tasks",
      "notes",
      "time-card"
    ])

    const blankOnFirstOpenKeys = new Set([
      "images",
      "audio"
    ])

    if (!draftOnFirstOpenKeys.has(appKey) && !blankOnFirstOpenKeys.has(appKey)) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      return
    }

    const visibleInstance = this.findVisibleInstanceForAppRow(appKey)
    if (visibleInstance) {
      const targetAppKey = visibleInstance.dataset.contentWindowAppKeyValue || appKey
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: targetAppKey } }))
      return
    }

    if (draftOnFirstOpenKeys.has(appKey)) {
      await this.openEmbeddedDraft(appKey)
      return
    }

    // No instance is open: launch an empty/blank instance for the row app.
    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: { appKey, forceBlank: true }
    }))
  }

  findVisibleInstanceForAppRow(appKey) {
    const selectorByApp = {
      "tasks": 'section.content-window[data-content-window-app-key-value="tasks"], section.content-window[data-content-window-app-key-value^="task-spawn-"]',
      "notes": 'section.content-window[data-content-window-app-key-value="notes"], section.content-window[data-content-window-app-key-value^="note-spawn-"]',
      "time-card": 'section.content-window[data-content-window-app-key-value="time-card"], section.content-window[data-content-window-app-key-value^="time-card-spawn-"]',
      "images": 'section.content-window[data-content-window-app-key-value="images"], section.content-window[data-content-window-app-key-value^="image-spawn-"]',
      "audio": 'section.content-window[data-content-window-app-key-value="audio"]'
    }

    const selector = selectorByApp[appKey]
    if (!selector) return null

    const nodes = Array.from(document.querySelectorAll(selector)).filter((el) => !el.classList.contains("is-hidden"))

    if (!nodes.length) return null

    // Prefer top-most visible window for this app group.
    nodes.sort((a, b) => {
      const za = Number.parseInt(a.style.zIndex || window.getComputedStyle(a).zIndex || "0", 10)
      const zb = Number.parseInt(b.style.zIndex || window.getComputedStyle(b).zIndex || "0", 10)
      return (Number.isFinite(zb) ? zb : 0) - (Number.isFinite(za) ? za : 0)
    })

    return nodes[0] || null
  }
  noopAppAction(event) {
    event.preventDefault()
    event.stopPropagation()
  }

  async addTaskFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("tasks")
  }

  async addNoteFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("notes")
  }

  async addTimeCardFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()
    await this.openEmbeddedDraft("time-card")
  }

  async openEmbeddedDraft(appKey) {
    const draft = await this.fetchDraftFile(appKey)
    if (!draft?.document_id) return

    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: {
        appKey,
        documentId: String(draft.document_id),
        documentTitle: draft.display_title || draft.title || "Draft",
        isDraft: true
      }
    }))
  }

  async fetchDraftFile(appKey) {
    try {
      const url = `/apps/tasks/draft_file?app_key=${encodeURIComponent(appKey)}`
      const response = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" })
      if (!response.ok) return null
      const payload = await response.json().catch(() => null)
      return payload && payload.ok ? payload : null
    } catch (_error) {
      return null
    }
  }

  handleAppWindowState(event) {
    const appKey = event.detail?.appKey
    if (appKey === "tasks") {
      this.updateRowState("tasks", this.anyTaskWindowOpen())
      return
    }
    if (appKey === "notes") {
      this.updateRowState("notes", this.anyNoteWindowOpen())
      return
    }
    if (appKey === "time-card") {
      this.updateRowState("time-card", this.anyTimeCardWindowOpen())
      return
    }
    this.updateRowState(appKey, Boolean(event.detail?.open))
  }

  anyTaskWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="tasks"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  anyNoteWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="note-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="notes"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  anyTimeCardWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="time-card-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="time-card"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  updateRowState(appKey, isOpen) {
    if (!appKey) return
    const button = this.element.querySelector(`[data-window-key="${appKey}"]`)
    if (!button) return
    button.classList.toggle("is-active", isOpen)
    button.setAttribute("aria-pressed", isOpen ? "true" : "false")
  }

  clearRowActiveState() {
    this.element.querySelectorAll("[data-window-key]").forEach((button) => {
      button.classList.remove("is-active")
      button.setAttribute("aria-pressed", "false")
    })
  }
}
