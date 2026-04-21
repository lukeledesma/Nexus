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

  launchApp(event) {
    if (event.target instanceof Element && event.target.closest(".desktop-side-panel-app-action")) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    const appKey = event.currentTarget.dataset.windowKey
    if (!appKey) {
      return
    }
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
  }

  noopAppAction(event) {
    event.preventDefault()
    event.stopPropagation()
  }

  addTaskFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()

    // Step 1: If an unsaved task window is already open, highlight/focus it.
    const blankWindow = this.findBlankOpenTaskWindow()
    if (blankWindow) {
      const appKey = blankWindow.dataset.contentWindowAppKeyValue
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      return
    }

    // Step 2: If the primary Tasks window is closed, open it (blank instance).
    const primaryEl = document.querySelector('[data-content-window-app-key-value="singular-task-list"]')
    if (!primaryEl || primaryEl.classList.contains("is-hidden")) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "singular-task-list" } }))
      return
    }

    // Step 3: No unsaved instance is open and primary is in-use with a linked file.
    // Spawn a fresh unsaved task window instance.
    window.dispatchEvent(new CustomEvent("nexus:task-list-spawn-blank-window"))
  }

  addNoteFromPanel(event) {
    event.preventDefault()
    event.stopPropagation()

    // Step 1: If an unsaved note window is already open, highlight/focus it.
    const blankWindow = this.findBlankOpenNoteWindow()
    if (blankWindow) {
      const appKey = blankWindow.dataset.contentWindowAppKeyValue
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey } }))
      return
    }

    // Step 2: If the primary Notes window is closed, open it (blank instance).
    const primaryEl = document.querySelector('[data-content-window-app-key-value="notes"]')
    if (!primaryEl || primaryEl.classList.contains("is-hidden")) {
      window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "notes" } }))
      return
    }

    // Step 3: No unsaved instance is open and primary is in-use with a linked file.
    // Spawn a fresh unsaved note window instance.
    window.dispatchEvent(new CustomEvent("nexus:notes-spawn-blank-window"))
  }

  /** Returns the first visible task window that has no linked document, or null. */
  findBlankOpenTaskWindow() {
    const primaryFrameId = this.primaryTaskFrameId()
    const primaryEl = document.querySelector('[data-content-window-app-key-value="singular-task-list"]')
    if (primaryEl && !primaryEl.classList.contains("is-hidden")) {
      const hasLinkedDoc = Boolean(
        window.sessionStorage?.getItem(`nexus.singularLinkedDocument.${primaryFrameId}`) ||
        window.localStorage?.getItem(`nexus.singularLinkedDocument.${primaryFrameId}`)
      )
      if (!hasLinkedDoc) return primaryEl
    }

    const spawnedWindows = document.querySelectorAll('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)')
    for (const w of spawnedWindows) {
      const frameId = w.dataset.contentWindowFrameIdValue
      const hasLinkedDoc = Boolean(
        window.sessionStorage?.getItem(`nexus.singularLinkedDocument.${frameId}`) ||
        window.localStorage?.getItem(`nexus.singularLinkedDocument.${frameId}`)
      )
      if (!hasLinkedDoc) return w
    }

    return null
  }

  primaryTaskFrameId() {
    const taskWindow = document.querySelector('[data-content-window-app-key-value="singular-task-list"]')
    return taskWindow?.dataset?.contentWindowFrameIdValue || "singular-task-list-pane"
  }

  /** Returns the first visible notes window that has no linked document, or null. */
  findBlankOpenNoteWindow() {
    const primaryFrameId = this.primaryNotesFrameId()
    const primaryEl = document.querySelector('[data-content-window-app-key-value="notes"]')
    if (primaryEl && !primaryEl.classList.contains("is-hidden")) {
      const hasLinkedDoc = Boolean(
        window.sessionStorage?.getItem(`nexus.singularLinkedDocument.${primaryFrameId}`) ||
        window.localStorage?.getItem(`nexus.singularLinkedDocument.${primaryFrameId}`)
      )
      if (!hasLinkedDoc) return primaryEl
    }

    const spawnedWindows = document.querySelectorAll('[data-content-window-app-key-value^="note-spawn-"]:not(.is-hidden)')
    for (const w of spawnedWindows) {
      const frameId = w.dataset.contentWindowFrameIdValue
      const hasLinkedDoc = Boolean(
        window.sessionStorage?.getItem(`nexus.singularLinkedDocument.${frameId}`) ||
        window.localStorage?.getItem(`nexus.singularLinkedDocument.${frameId}`)
      )
      if (!hasLinkedDoc) return w
    }

    return null
  }

  primaryNotesFrameId() {
    const notesWindow = document.querySelector('[data-content-window-app-key-value="notes"]')
    return notesWindow?.dataset?.contentWindowFrameIdValue || "notes-pane"
  }
  handleAppWindowState(event) {
    const appKey = event.detail?.appKey
    if (appKey === "singular-task-list") {
      this.updateRowState("singular-task-list", this.anyTaskWindowOpen())
      return
    }
    if (appKey === "notes") {
      this.updateRowState("notes", this.anyNoteWindowOpen())
      return
    }
    this.updateRowState(appKey, Boolean(event.detail?.open))
  }

  anyTaskWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="singular-task-list"]:not(.is-hidden)')
    return Boolean(spawnedOpen || primaryOpen)
  }

  anyNoteWindowOpen() {
    const spawnedOpen = document.querySelector('[data-content-window-app-key-value^="note-spawn-"]:not(.is-hidden)')
    const primaryOpen = document.querySelector('[data-content-window-app-key-value="notes"]:not(.is-hidden)')
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
