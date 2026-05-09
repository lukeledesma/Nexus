import { Controller } from "@hotwired/stimulus"
import { getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"
import { createOsWindowSizer } from "lib/os_window_sizing"
import { syncOrganizerAboveVisibleContentWindows } from "lib/nexus_desktop_layers"
import { clearLinkedAppPickerDraft, LINKED_APP_BEFORE_SAVE_PICKER } from "lib/linked_app_picker_draft"
import { syncNexusDesktopWallpaper } from "lib/nexus_workspace_chrome"
import { NexusUserState } from "lib/nexus_user_state"

/** Kept in sync with inline boot script in `shared/_content_windows_boot.html.erb`. */
const DESKTOP_WINDOW_LAYERS_KEY = "nexus.desktop.windowLayers"
/** Server-synced registries of spawned per-document windows (open across devices). */
const TASK_WINDOW_REGISTRY_KEY = "windows.tasks"
const NOTE_WINDOW_REGISTRY_KEY = "windows.notes"
const TIMECARD_WINDOW_REGISTRY_KEY = "windows.timeCard"
/** Legacy device-local localStorage keys; consulted once at first read for migration. */
const LEGACY_TASK_REGISTRY_KEY = "nexus.taskWindowRegistry"
const LEGACY_NOTE_REGISTRY_KEY = "nexus.noteWindowRegistry"
const LEGACY_TIMECARD_REGISTRY_KEY = "nexus.timeCardWindowRegistry"

function readRegistry(key, legacyKey) {
  const synced = NexusUserState.get(key)
  if (Array.isArray(synced)) return synced
  if (NexusUserState.has(key)) return []
  try {
    const raw = window.localStorage.getItem(legacyKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      NexusUserState.set(key, parsed)
      return parsed
    }
  } catch (_e) { /* ignore */ }
  return []
}

function writeRegistry(key, entries) {
  NexusUserState.set(key, entries)
}
/** Treat as “at least operational min” within this many px (subpixel + border rounding). */
const MIN_SIZE_SLACK_PX = 2
/** Desktop canvas minimum app area (px): when viewport is smaller, shell scrolls instead of shrinking windows further. */
const SHELL_CANVAS_MIN_W = 760
const SHELL_CANVAS_MIN_H = 460

export default class extends Controller {
  static targets = [
    "frame",
    "chromeAppTools",
    "chromePickerTools",
    "chromeTimeCardClear",
    "savePickerLayer",
    "savePickerIframe"
  ]
  static values = {
    appKey: String,
    appUrl: String,
    storageKey: String,
    frameId: String,
    hasLinkedAppSavePicker: { type: Boolean, default: false }
  }

  connect() {
    if (!window.__nexusSpawnedTasksByDocumentId) window.__nexusSpawnedTasksByDocumentId = {}
    if (!window.__nexusSpawnedImagesByDocumentId) window.__nexusSpawnedImagesByDocumentId = {}
    if (!window.__nexusSpawnedNotesByDocumentId) window.__nexusSpawnedNotesByDocumentId = {}
    if (!window.__nexusSpawnedTimeCardsByDocumentId) window.__nexusSpawnedTimeCardsByDocumentId = {}
    this.currentUrl = this.buildAppUrl({ blank: this.shouldStartBlank() })
    this.restoreLinkedAppUrlAndBadge()
    this.isAutoSizedWindow = false
    this.desktopMinAppWidth = SHELL_CANVAS_MIN_W
    this.desktopMinAppHeight = SHELL_CANVAS_MIN_H
    this.syncViewportShellMargins()
    this.syncDesktopCanvasDimensions()
    this._viewportResizeW = window.innerWidth
    this._viewportResizeH = window.innerHeight
    /* Finder shell + Settings (two-pane layouts) share a minimum so rows don’t collapse. */
    const finderLikeMin = { width: 760, height: 460 }
    const taskListMin = { width: 320, height: 320 }
    const audioMin = { width: 320, height: 320 }
      const imagesMin = { width: 320, height: 320 }
      const notesMin = { width: 320, height: 320 }
      const timeCardMin = { width: 320, height: 320 }
    const minByAppKey = {
      tasks: taskListMin,
      finder: finderLikeMin,
      calendar: finderLikeMin,
      audio: audioMin,
      images: imagesMin,
      notes: notesMin,
      "time-card": timeCardMin,
      user: { width: 320, height: 220 },
    }
    const appMinimum = minByAppKey[this.appKeyValue] || taskListMin
    this.minWindowWidth = appMinimum.width
    this.minWindowHeight = appMinimum.height

    const rect = this.element.getBoundingClientRect()
    if (this.appKeyValue === "finder" || this.appKeyValue === "calendar") {
      /* Default / first paint: use minimum allowed size (not generic 550×480 .content-window CSS). */
      this.windowWidth = this.minWindowWidth
      this.windowHeight = this.minWindowHeight
    } else {
      this.windowWidth = Math.round(rect.width || 550)
      this.windowHeight = Math.round(rect.height || 480)
    }
    this.preferredWindowWidth = this.minWindowWidth
    this.preferredWindowHeight = this.minWindowHeight
    this.activeDrag = null
    this.activeResize = null
    this._boundsPinX = "none"
    this._boundsPinY = "none"

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundResizeMove = this.handleResizeMove.bind(this)
    this.boundResizeEnd = this.stopResize.bind(this)
    this.boundLostPointerCaptureResize = this.handleLostPointerCaptureResize.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)

    window.addEventListener("app-window:toggle", this.boundToggleRequest)
    this.boundOpenRequest = this.handleOpenRequest.bind(this)
    window.addEventListener("app-window:open", this.boundOpenRequest)
    this.boundFrameLoad = this.handleFrameLoad.bind(this)
    if (this.hasFrameTarget) this.frameTarget.addEventListener("turbo:frame-load", this.boundFrameLoad)
    this.boundSpawnBlankTaskWindow = this.handleSpawnBlankTaskWindow.bind(this)
    window.addEventListener("nexus:task-list-spawn-blank-window", this.boundSpawnBlankTaskWindow)
    this.boundSpawnBlankNoteWindow = this.handleSpawnBlankNoteWindow.bind(this)
    window.addEventListener("nexus:notes-spawn-blank-window", this.boundSpawnBlankNoteWindow)
    this.boundSpawnBlankTimeCardWindow = this.handleSpawnBlankTimeCardWindow.bind(this)
    window.addEventListener("nexus:time-card-spawn-blank-window", this.boundSpawnBlankTimeCardWindow)
    this.boundCloseRequest = this.handleCloseRequest.bind(this)
    window.addEventListener("app-window:close", this.boundCloseRequest)
    this.boundLinkedAppSaved = this.onLinkedAppDocumentSaved.bind(this)
    window.addEventListener("nexus:linked-app-document-saved", this.boundLinkedAppSaved)
    this.boundFinderItemRenamed = this.onFinderItemRenamed.bind(this)
    window.addEventListener("nexus:finder-item-renamed", this.boundFinderItemRenamed)
    this.boundTimeCardClearState = this.handleTimeCardClearState.bind(this)
    window.addEventListener("nexus:time-card-clear-state", this.boundTimeCardClearState)
    this.boundTimeCardChromeHours = this.handleTimeCardChromeHours.bind(this)
    window.addEventListener("nexus:time-card-chrome-hours", this.boundTimeCardChromeHours)
    this.boundItemDirtyState = this.handleItemDirtyState.bind(this)
    window.addEventListener("nexus:item-dirty", this.boundItemDirtyState)
    this.boundItemSavingState = this.handleItemSavingState.bind(this)
    window.addEventListener("nexus:item-saving", this.boundItemSavingState)
    this.boundItemSavedState = this.handleItemSavedState.bind(this)
    window.addEventListener("nexus:item-saved", this.boundItemSavedState)
    this.boundUserStateLoaded = this.handleUserStateLoaded.bind(this)
    window.addEventListener("nexus:user-state-loaded", this.boundUserStateLoaded)
    this.boundViewportResize = () => {
      this.syncViewportShellMargins()
      this.syncDesktopCanvasDimensions()
      this.reconcileWindowOnViewportResize({ viewportResize: true })
    }
    window.addEventListener("resize", this.boundViewportResize)

    if (this.hasLinkedAppSavePickerValue) {
      this.boundLinkedAppPickerClose = this.handleLinkedAppSavePickerClose.bind(this)
      window.addEventListener("nexus:linked-app-save-picker-close", this.boundLinkedAppPickerClose)
      this.boundEmbeddedLinkedAppOpen = this.handleEmbeddedLinkedAppOpen.bind(this)
      window.addEventListener("nexus:linked-app-open-from-embedded-finder", this.boundEmbeddedLinkedAppOpen)
    }
    this.boundTitleShellPointerDown = this.onTitleShellPointerDown.bind(this)
    this.element.addEventListener("mousedown", this.boundTitleShellPointerDown)
    this.element.addEventListener("touchstart", this.boundTitleShellPointerDown, { passive: false })
    this.element.addEventListener("mousedown", () => this.bringToFront())

    if (this.isAutoSizedWindow) {
      this.windowSizer = createOsWindowSizer({
        windowId: this.appKeyValue,
        windowElement: this.element,
        contentElement: this.element.querySelector(".window-content"),
        viewportMargin: () => getNexusDesktopShellInsetPx(),
        isWindowOpen: () => !this.element.classList.contains("is-hidden")
      })
      this.windowSizer.observeContent()
    }

    this.restoreWindowZIndex()
    this.syncDesktopZIndexFloor()
    syncOrganizerAboveVisibleContentWindows()
    this.restoreWindowBounds()
    this.restorePersistedSpawnedTaskWindows()
    this.restorePersistedSpawnedNoteWindows()
    this.restorePersistedSpawnedTimeCardWindows()
    this.restoreOpenState()

    // Frames restored by boot scripts may already be loaded before connect(),
    // so run one immediate stale-link repair pass in addition to turbo:frame-load.
    queueMicrotask(() => this.repairTaskDraftLinkIfStale())

    if (this.element.dataset.openOnConnect === "true") {
      delete this.element.dataset.openOnConnect
      this.open()
    }
  }

  shouldStartBlank() {
    if (!this.isLinkedApp()) return false
    return !this.readLinkedDocumentIdForCurrentFrame()
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    if (this.windowSizer) this.windowSizer.disconnect()
    window.removeEventListener("app-window:toggle", this.boundToggleRequest)
    window.removeEventListener("app-window:open", this.boundOpenRequest)
    if (this.boundFrameLoad && this.hasFrameTarget) this.frameTarget.removeEventListener("turbo:frame-load", this.boundFrameLoad)
    window.removeEventListener("app-window:close", this.boundCloseRequest)
    window.removeEventListener("nexus:task-list-spawn-blank-window", this.boundSpawnBlankTaskWindow)
    window.removeEventListener("nexus:notes-spawn-blank-window", this.boundSpawnBlankNoteWindow)
    window.removeEventListener("nexus:time-card-spawn-blank-window", this.boundSpawnBlankTimeCardWindow)
    window.removeEventListener("nexus:linked-app-document-saved", this.boundLinkedAppSaved)
    window.removeEventListener("nexus:finder-item-renamed", this.boundFinderItemRenamed)
    window.removeEventListener("nexus:time-card-clear-state", this.boundTimeCardClearState)
    window.removeEventListener("nexus:time-card-chrome-hours", this.boundTimeCardChromeHours)
    window.removeEventListener("nexus:item-dirty", this.boundItemDirtyState)
    window.removeEventListener("nexus:item-saving", this.boundItemSavingState)
    window.removeEventListener("nexus:item-saved", this.boundItemSavedState)
    window.removeEventListener("nexus:user-state-loaded", this.boundUserStateLoaded)
    window.removeEventListener("resize", this.boundViewportResize)
    if (this.boundLinkedAppPickerClose) {
      window.removeEventListener("nexus:linked-app-save-picker-close", this.boundLinkedAppPickerClose)
    }
    if (this.boundEmbeddedLinkedAppOpen) {
      window.removeEventListener("nexus:linked-app-open-from-embedded-finder", this.boundEmbeddedLinkedAppOpen)
    }
    this.element.removeEventListener("mousedown", this.boundTitleShellPointerDown)
    this.element.removeEventListener("touchstart", this.boundTitleShellPointerDown)
  }

  onTitleShellPointerDown(event) {
    if (!(event.target instanceof Element)) return
    const target = event.target
    if (this.activeResize) return
    if (target.closest(".pane-resize-handle")) return
    if (target.closest(".content-window-close, button, a, input, textarea, select, [role='button']")) return
    if (!target.closest(".content-window-chrome")) return
    this.startDrag(event)
  }

  handleToggleRequest(event) {
    if (event.detail?.appKey !== this.appKeyValue) return
    this.toggle()
  }

  handleCloseRequest(event) {
    if (event.detail?.appKey !== this.appKeyValue) return
    if (this.element.classList.contains("is-hidden")) return
    this.close()
  }

  handleTimeCardClearState(event) {
    if (this.appKeyValue !== "time-card") return
    if (!this.hasChromeTimeCardClearTarget) return
    const { frameId, show } = event.detail || {}
    if (frameId !== this.frameIdValue) return
    this.chromeTimeCardClearTarget.hidden = !Boolean(show)
  }

  handleTimeCardChromeHours(event) {
    const isTimeCardWindow =
      this.appKeyValue === "time-card" || this.appKeyValue.startsWith("time-card-spawn-")
    if (!isTimeCardWindow) return

    const { frameId, label, isOpen } = event.detail || {}
    if (String(frameId || "") !== String(this.frameIdValue || "")) return

    this.syncTimeCardHoursBadge(label, { isOpen: Boolean(isOpen) })
  }

  handleItemDirtyState(event) {
    const frameId = String(event?.detail?.frameId || "")
    if (!frameId || frameId !== this.frameIdValue) return
    this.syncOpenFileNameState("dirty")
  }

  handleItemSavingState(event) {
    const frameId = String(event?.detail?.frameId || "")
    if (!frameId || frameId !== this.frameIdValue) return
    this.syncOpenFileNameState("dirty")
  }

  handleItemSavedState(event) {
    const frameId = String(event?.detail?.frameId || "")
    if (!frameId || frameId !== this.frameIdValue) return
    this.syncOpenFileNameState("saved")
  }

  /** Open linked doc from Finder save-picker tree (same window, exit picker chrome). */
  handleEmbeddedLinkedAppOpen(event) {
    const { frameId, appKey, documentId, documentTitle } = event.detail || {}
    if (!this.hasLinkedAppSavePickerValue || !this.hasFrameIdValue) return
    const canHandleEmbeddedTaskOpen =
      this.appKeyValue === "tasks" || this.appKeyValue.startsWith("task-spawn-")
    const canHandleEmbeddedNotesOpen =
      this.appKeyValue === "notes" || this.appKeyValue.startsWith("note-spawn-")
    const canHandleEmbeddedTimeCardOpen =
      this.appKeyValue === "time-card" || this.appKeyValue.startsWith("time-card-spawn-")
    const appKeyMatches =
      appKey === this.appKeyValue ||
      (canHandleEmbeddedTaskOpen && appKey === "tasks") ||
      (canHandleEmbeddedNotesOpen && appKey === "notes") ||
      (canHandleEmbeddedTimeCardOpen && appKey === "time-card")
    if (frameId !== this.frameIdValue || !appKeyMatches) return

    // Enforce one-open-instance for saved task documents when opened from the embedded picker.
    if (documentId && this.isLinkedApp()) {
      const docId = String(documentId)
      const existingWindow = this.findVisibleTaskWindowByDocumentId(docId)
      if (existingWindow) {
        this.focusAndFlashWindow(existingWindow)
        return
      }
    }
    if (documentId && (this.appKeyValue === "notes" || this.appKeyValue.startsWith("note-spawn-"))) {
      const docId = String(documentId)
      const existingWindow = this.findVisibleNoteWindowByDocumentId(docId)
      if (existingWindow) {
        this.focusAndFlashWindow(existingWindow)
        return
      }
    }
    if (documentId && (this.appKeyValue === "time-card" || this.appKeyValue.startsWith("time-card-spawn-"))) {
      const docId = String(documentId)
      const existingWindow = this.findVisibleTimeCardWindowByDocumentId(docId)
      if (existingWindow) {
        this.focusAndFlashWindow(existingWindow)
        return
      }
    }

    this.clearLinkedAppPickerDraftSnapshot()

    this.element.classList.remove("content-window--linked-app-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true
    this.#dismissLinkedAppSavePickerLayer()

    const url = new URL(this.appUrlValue, window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("document_id", String(documentId))
    url.searchParams.delete("blank")
    this.currentUrl = `${url.pathname}${url.search}`

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(documentId))
    } catch (_err) {
      /* ignore */
    }
      try {
        window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(documentId))
      } catch (_) {}
    this.syncSpawnedLinkedDocumentRegistration(String(documentId))

    const t = (documentTitle || "").trim()
    if (t) {
      this.syncOpenFileBadge(t)
      this.persistLinkedAppOpenTitle(t)
    } else {
      this.clearOpenFileBadge()
    }

    if (this.element.classList.contains("is-hidden")) {
      this.open()
    } else {
      this.bringToFront()
    }

    if (this.hasFrameTarget) {
      this.frameTarget.removeAttribute("src")
      void this.frameTarget.offsetWidth
      this.frameTarget.src = this.currentUrl
    }
  }

  /** Open (or focus) this window and optionally load a Finder document into the frame. */
  handleOpenRequest(event) {
    const { appKey, documentId, documentTitle, forceBlank, isDraft } = event.detail || {}
    if (appKey !== this.appKeyValue) return

    // When a specific document is requested for the linked-app task list window,
    // check if it's already open (spawned window). If so, focus and flash it.
    if (documentId && this.isLinkedApp()) {
      const docId = String(documentId)
      const existingWindow = this.findTaskWindowByDocumentId(docId, { includeHidden: true })
      if (existingWindow) {
        this.focusOrOpenWindow(existingWindow)
        return
      }
      // Only spawn if primary window is visible (already in use).
      // If it's hidden, load the document there instead.
      const isPrimaryWindowVisible = !this.element.classList.contains("is-hidden")
      if (isPrimaryWindowVisible && (!isDraft || this.shouldSpawnDraftWindow(String(documentId)))) {
        this.spawnTaskWindow(documentId, documentTitle)
        return
      }
    }

    if (documentId && this.appKeyValue === "images") {
      const docId = String(documentId)
      const existingWindow = this.findImageWindowByDocumentId(docId, { includeHidden: true })
      if (existingWindow) {
        this.focusOrOpenWindow(existingWindow)
        return
      }
      const isPrimaryWindowVisible = !this.element.classList.contains("is-hidden")
      if (isPrimaryWindowVisible) {
        this.spawnImageWindow(documentId, documentTitle)
        return
      }
    }

    if (documentId && this.appKeyValue === "notes") {
      const docId = String(documentId)
      const existingWindow = this.findNoteWindowByDocumentId(docId, { includeHidden: true })
      if (existingWindow) {
        this.focusOrOpenWindow(existingWindow)
        return
      }
      const isPrimaryWindowVisible = !this.element.classList.contains("is-hidden")
      if (isPrimaryWindowVisible && (!isDraft || this.shouldSpawnDraftWindow(String(documentId)))) {
        this.spawnNoteWindow(documentId, documentTitle)
        return
      }
    }

    if (documentId && this.appKeyValue === "time-card") {
      const docId = String(documentId)
      const existingWindow = this.findTimeCardWindowByDocumentId(docId, { includeHidden: true })
      if (existingWindow) {
        this.focusOrOpenWindow(existingWindow)
        return
      }
      const isPrimaryWindowVisible = !this.element.classList.contains("is-hidden")
      if (isPrimaryWindowVisible && (!isDraft || this.shouldSpawnDraftWindow(String(documentId)))) {
        this.spawnTimeCardWindow(documentId, documentTitle)
        return
      }
    }

      // Blank open request while window is already visible — just bring to front
      // without reloading, regardless of whether a file is loaded or not.
      if (!documentId && this.isLinkedApp() && !this.element.classList.contains("is-hidden")) {
        this.bringToFront()
        return
      }

    if (documentId) {
      const url = new URL(this.appUrlValue, window.location.origin)
      url.searchParams.set("frame_id", this.frameIdValue)
      url.searchParams.set("document_id", String(documentId))
      url.searchParams.delete("blank")
      this.currentUrl = `${url.pathname}${url.search}`
      this.syncOpenFileBadge(documentTitle)
      const titled = (documentTitle || "").trim()
      if (titled) this.persistLinkedAppOpenTitle(titled)
      else this.clearLinkedAppOpenTitleStorage()
        // Persist linked doc to both storages so it survives logout/login
        try {
          window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(documentId))
          window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, String(documentId))
        } catch (_) {}
      this.syncSpawnedLinkedDocumentRegistration(String(documentId))
    } else {
      if (forceBlank && this.hasFrameIdValue) {
        try {
          window.sessionStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
          window.localStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
        } catch (_) {}
      }
      this.currentUrl = this.buildAppUrl({ blank: this.isLinkedApp() })
      this.clearOpenFileBadge()
    }

    if (this.appKeyValue === "time-card" || this.appKeyValue.startsWith("time-card-spawn-")) {
      this.clearTimeCardHoursBadge()
    }

    if (this.hasFrameTarget) {
      const mustHardReload =
        Boolean(documentId) ||
        (this.isLinkedApp() && this.currentUrl.includes("blank=1"))
      if (mustHardReload) {
        this.frameTarget.removeAttribute("src")
        void this.frameTarget.offsetWidth
      }
      this.frameTarget.src = this.currentUrl
    }

    if (this.element.classList.contains("is-hidden")) {
      this.open()
    } else {
      this.bringToFront()
    }
  }

  focusAndFlashWindow(windowEl) {
    if (!windowEl) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    windowEl.style.zIndex = String(next)
    this.applyFocusExpandCue(windowEl)
    windowEl.classList.remove("content-window--focus-pulse", "content-window--focus-pulse-static", "content-window--focus-flash")
    if (windowEl.__nexusFocusPulseTimer) {
      window.clearTimeout(windowEl.__nexusFocusPulseTimer)
      windowEl.__nexusFocusPulseTimer = null
    }
  }

  focusOrOpenWindow(windowEl) {
    if (!windowEl) return
    if (windowEl.classList.contains("is-hidden")) {
      const existingKey = windowEl.dataset.contentWindowAppKeyValue
      if (existingKey) {
        window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: existingKey } }))
      }
      return
    }
    this.focusAndFlashWindow(windowEl)
  }

  shouldSpawnDraftWindow(requestedDocumentId) {
    const requested = String(requestedDocumentId || "")
    if (!requested) return false
    const current = String(this.readLinkedDocumentIdForCurrentFrame() || "")
    if (!current) return false
    return current !== requested
  }

  readLinkedDocumentIdForCurrentFrame() {
    if (!this.hasFrameIdValue) return null
    return this.readLinkedDocumentIdForFrame(this.frameIdValue)
  }

  readLinkedDocumentIdForFrame(frameId) {
    if (!frameId) return null
    try {
      const v = window.sessionStorage.getItem(`nexus.linkedAppDocument.${frameId}`)
        if (v) return String(v)
        const lv = window.localStorage.getItem(`nexus.linkedAppDocument.${frameId}`)
        return lv ? String(lv) : null
    } catch (_error) {
      return null
    }
  }

  windowMatchesLinkedDocumentId(windowEl, docId) {
    const targetId = String(docId || "")
    if (!windowEl || !targetId) return false

    const spawnedDocId = (windowEl.dataset.spawnedFromDocumentId || "").toString()
    if (spawnedDocId && spawnedDocId === targetId) return true

    const frameId =
      windowEl.dataset.contentWindowFrameIdValue ||
      windowEl.querySelector("turbo-frame[data-content-window-target='frame']")?.id ||
      null
    const linkedDocId = this.readLinkedDocumentIdForFrame(frameId)
    if (linkedDocId && linkedDocId === targetId) return true

    const frameEl = windowEl.querySelector("turbo-frame[data-content-window-target='frame']")
    const src = (frameEl?.getAttribute("src") || "").toString()
    if (src.includes(`document_id=${encodeURIComponent(targetId)}`) || src.includes(`document_id=${targetId}`)) return true

    return false
  }

  findTaskWindowByDocumentId(documentId, options = {}) {
    const includeHidden = Boolean(options.includeHidden)
    const docId = String(documentId || "")
    if (!docId) return null
    const taskWindows = document.querySelectorAll(
      'section.content-window[data-content-window-app-key-value="tasks"], section.content-window[data-content-window-app-key-value^="task-spawn-"]'
    )
    for (const windowEl of taskWindows) {
      if (!includeHidden && windowEl.classList.contains("is-hidden")) continue
      if (this.windowMatchesLinkedDocumentId(windowEl, docId)) return windowEl
    }
    return null
  }

  findVisibleTaskWindowByDocumentId(documentId) {
    return this.findTaskWindowByDocumentId(documentId, { includeHidden: false })
  }

  findImageWindowByDocumentId(documentId, options = {}) {
    const includeHidden = Boolean(options.includeHidden)
    const docId = String(documentId || "")
    if (!docId) return null
    const imageWindows = document.querySelectorAll(
      'section.content-window[data-content-window-app-key-value="images"], section.content-window[data-content-window-app-key-value^="image-spawn-"]'
    )
    for (const windowEl of imageWindows) {
      if (!includeHidden && windowEl.classList.contains("is-hidden")) continue
      if (this.windowMatchesLinkedDocumentId(windowEl, docId)) return windowEl
    }
    return null
  }

  findVisibleImageWindowByDocumentId(documentId) {
    return this.findImageWindowByDocumentId(documentId, { includeHidden: false })
  }

  findNoteWindowByDocumentId(documentId, options = {}) {
    const includeHidden = Boolean(options.includeHidden)
    const docId = String(documentId || "")
    if (!docId) return null
    const noteWindows = document.querySelectorAll(
      'section.content-window[data-content-window-app-key-value="notes"], section.content-window[data-content-window-app-key-value^="note-spawn-"]'
    )
    for (const windowEl of noteWindows) {
      if (!includeHidden && windowEl.classList.contains("is-hidden")) continue
      if (this.windowMatchesLinkedDocumentId(windowEl, docId)) return windowEl
    }
    return null
  }

  findVisibleNoteWindowByDocumentId(documentId) {
    return this.findNoteWindowByDocumentId(documentId, { includeHidden: false })
  }

  findTimeCardWindowByDocumentId(documentId, options = {}) {
    const includeHidden = Boolean(options.includeHidden)
    const docId = String(documentId || "")
    if (!docId) return null
    const windows = document.querySelectorAll(
      'section.content-window[data-content-window-app-key-value="time-card"], section.content-window[data-content-window-app-key-value^="time-card-spawn-"]'
    )
    for (const windowEl of windows) {
      if (!includeHidden && windowEl.classList.contains("is-hidden")) continue
      if (this.windowMatchesLinkedDocumentId(windowEl, docId)) return windowEl
    }
    return null
  }

  findVisibleTimeCardWindowByDocumentId(documentId) {
    return this.findTimeCardWindowByDocumentId(documentId, { includeHidden: false })
  }

  /** Clone the Tasks window shell to display a document in a new, independent window. */
  spawnTaskWindow(documentId, documentTitle) {
    const existingWindow = this.findTaskWindowByDocumentId(documentId, { includeHidden: true })
    if (existingWindow) {
      this.focusOrOpenWindow(existingWindow)
      return
    }

    const uid = `task-spawn-${Date.now()}`
    const title = (documentTitle || "").trim()

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}
      try {
        window.localStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
        if (title) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
      } catch (_) {}

    // Register documentId → spawned appKey so we can detect duplicates
    window.__nexusSpawnedTasksByDocumentId[String(documentId)] = uid

    const clone = this.element.cloneNode(true)

    // Give the clone a unique identity so it doesn't respond to toggle/open events
    // meant for the primary Tasks window.
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    // Signal connect() to open the window immediately.
    clone.dataset.openOnConnect = "true"
    // Mark as spawned so it emits Tasks state
    clone.dataset.isSpawnedTaskWindow = "true"
    // Store documentId for cleanup
    clone.dataset.spawnedFromDocumentId = String(documentId)

    // Give the turbo-frame a unique id so Turbo doesn't confuse it with the original.
    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) frame.id = uid

    // Offset position so the new window doesn't land exactly on top of the original.
    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.syncOpenFileBadgeFor(clone, title)

    this.persistSpawnedTaskWindow({
      appKey: uid,
      frameId: uid,
      storageKey: uid,
      documentId: String(documentId),
      documentTitle: title
    })

    this.element.parentElement.appendChild(clone)
  }

  spawnImageWindow(documentId, documentTitle) {
    const uid = `image-spawn-${Date.now()}`
    const title = (documentTitle || "").trim()

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}
    try {
      window.localStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}

    window.__nexusSpawnedImagesByDocumentId[String(documentId)] = uid

    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedImageWindow = "true"
    clone.dataset.spawnedFromDocumentId = String(documentId)

    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) frame.id = uid

    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.syncOpenFileBadgeFor(clone, title)

    this.element.parentElement.appendChild(clone)
  }

  spawnNoteWindow(documentId, documentTitle) {
    const existingWindow = this.findNoteWindowByDocumentId(documentId, { includeHidden: true })
    if (existingWindow) {
      this.focusOrOpenWindow(existingWindow)
      return
    }

    const uid = `note-spawn-${Date.now()}`
    const title = (documentTitle || "").trim()

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}
    try {
      window.localStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}

    window.__nexusSpawnedNotesByDocumentId[String(documentId)] = uid

    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedNoteWindow = "true"
    clone.dataset.spawnedFromDocumentId = String(documentId)

    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) frame.id = uid

    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.syncOpenFileBadgeFor(clone, title)

    this.persistSpawnedNoteWindow({
      appKey: uid,
      frameId: uid,
      storageKey: uid,
      documentId: String(documentId),
      documentTitle: title
    })

    this.element.parentElement.appendChild(clone)
  }

  spawnTimeCardWindow(documentId, documentTitle) {
    const existingWindow = this.findTimeCardWindowByDocumentId(documentId, { includeHidden: true })
    if (existingWindow) {
      this.focusOrOpenWindow(existingWindow)
      return
    }

    const uid = `time-card-spawn-${Date.now()}`
    const title = (documentTitle || "").trim()

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}
    try {
      window.localStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}

    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedTimeCardWindow = "true"
    clone.dataset.spawnedFromDocumentId = String(documentId)

    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) frame.id = uid

    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.syncOpenFileBadgeFor(clone, title)
    this.syncTimeCardHoursBadgeFor(clone, "", { isOpen: false })

    this.persistSpawnedTimeCardWindow({
      appKey: uid,
      frameId: uid,
      storageKey: uid,
      documentId: String(documentId),
      documentTitle: title
    })

    this.element.parentElement.appendChild(clone)
  }

  handleUserStateLoaded(event) {
    const changed = new Set(event.detail?.changedKeys || [])
    if (this.appKeyValue === "tasks" && changed.has(TASK_WINDOW_REGISTRY_KEY)) {
      window.__nexusTaskWindowsRestored = false
      this.restorePersistedSpawnedTaskWindows()
    }
    if (this.appKeyValue === "notes" && changed.has(NOTE_WINDOW_REGISTRY_KEY)) {
      window.__nexusNoteWindowsRestored = false
      this.restorePersistedSpawnedNoteWindows()
    }
    if (this.appKeyValue === "time-card" && changed.has(TIMECARD_WINDOW_REGISTRY_KEY)) {
      window.__nexusTimeCardWindowsRestored = false
      this.restorePersistedSpawnedTimeCardWindows()
    }
  }

  restorePersistedSpawnedTaskWindows() {
    if (this.appKeyValue !== "tasks") return
    if (window.__nexusTaskWindowsRestored) return
    window.__nexusTaskWindowsRestored = true

    const primaryLinkedDocId = this.readLinkedDocumentIdForCurrentFrame()
    const entries = this.readPersistedSpawnedTaskWindows()
    const seenTaskDocIds = new Set()
    entries.forEach((entry) => {
      if (!entry?.appKey || !entry?.documentId) return
      const entryDocId = String(entry.documentId)
      if (seenTaskDocIds.has(entryDocId)) {
        this.removePersistedSpawnedTaskWindow(String(entry.appKey))
        return
      }
      seenTaskDocIds.add(entryDocId)
      if (primaryLinkedDocId && String(entry.documentId) === String(primaryLinkedDocId)) {
        this.removePersistedSpawnedTaskWindow(String(entry.appKey))
        return
      }
      const restoredFrameId = String(entry.frameId || entry.appKey)
      const restoredTitle = (entry.documentTitle || "").trim()
      // Always restore sessionStorage from registry so restoreLinkedAppUrlAndBadge
      // works even after a logout where sessionStorage is cleared.
      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}
      try {
        window.localStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}

      if (document.querySelector(`[data-content-window-app-key-value="${entry.appKey}"]`)) {
        window.__nexusSpawnedTasksByDocumentId[String(entry.documentId)] = entry.appKey
        return
      }

      const clone = this.element.cloneNode(true)
      clone.dataset.contentWindowAppKeyValue = String(entry.appKey)
      clone.dataset.contentWindowFrameIdValue = String(entry.frameId || entry.appKey)
      clone.dataset.contentWindowStorageKeyValue = String(entry.storageKey || entry.appKey)
      clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
      clone.dataset.isSpawnedTaskWindow = "true"
      clone.dataset.spawnedFromDocumentId = String(entry.documentId)

      const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
      if (frame) frame.id = String(entry.frameId || entry.appKey)
      this.syncOpenFileBadgeFor(clone, restoredTitle)

      window.__nexusSpawnedTasksByDocumentId[String(entry.documentId)] = String(entry.appKey)
      this.element.parentElement.appendChild(clone)
    })
  }

  readPersistedSpawnedTaskWindows() {
    return readRegistry(TASK_WINDOW_REGISTRY_KEY, LEGACY_TASK_REGISTRY_KEY)
  }

  writePersistedSpawnedTaskWindows(entries) {
    writeRegistry(TASK_WINDOW_REGISTRY_KEY, entries)
  }

  persistSpawnedTaskWindow(entry) {
    const entryDocId = String(entry?.documentId || "")
    const entries = this.readPersistedSpawnedTaskWindows().filter((item) => {
      if (item?.appKey === entry.appKey) return false
      if (!entryDocId) return true
      return String(item?.documentId || "") !== entryDocId
    })
    entries.push(entry)
    this.writePersistedSpawnedTaskWindows(entries)
  }

  removePersistedSpawnedTaskWindow(appKey) {
    const entries = this.readPersistedSpawnedTaskWindows().filter((item) => item?.appKey !== appKey)
    this.writePersistedSpawnedTaskWindows(entries)
  }

  restorePersistedSpawnedNoteWindows() {
    if (this.appKeyValue !== "notes") return
    if (window.__nexusNoteWindowsRestored) return
    window.__nexusNoteWindowsRestored = true

    const primaryLinkedDocId = this.readLinkedDocumentIdForCurrentFrame()
    const entries = this.readPersistedSpawnedNoteWindows()
    const seenNoteDocIds = new Set()
    entries.forEach((entry) => {
      if (!entry?.appKey || !entry?.documentId) return
      const entryDocId = String(entry.documentId)
      if (seenNoteDocIds.has(entryDocId)) {
        this.removePersistedSpawnedNoteWindow(String(entry.appKey))
        return
      }
      seenNoteDocIds.add(entryDocId)
      if (primaryLinkedDocId && String(entry.documentId) === String(primaryLinkedDocId)) {
        this.removePersistedSpawnedNoteWindow(String(entry.appKey))
        return
      }
      const restoredFrameId = String(entry.frameId || entry.appKey)
      const restoredTitle = (entry.documentTitle || "").trim()

      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}
      try {
        window.localStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}

      if (document.querySelector(`[data-content-window-app-key-value="${entry.appKey}"]`)) return

      const clone = this.element.cloneNode(true)
      clone.dataset.contentWindowAppKeyValue = String(entry.appKey)
      clone.dataset.contentWindowFrameIdValue = String(entry.frameId || entry.appKey)
      clone.dataset.contentWindowStorageKeyValue = String(entry.storageKey || entry.appKey)
      clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
      clone.dataset.isSpawnedNoteWindow = "true"
      clone.dataset.spawnedFromDocumentId = String(entry.documentId)

      const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
      if (frame) frame.id = String(entry.frameId || entry.appKey)
      this.syncOpenFileBadgeFor(clone, restoredTitle)

      this.element.parentElement.appendChild(clone)
    })
  }

  readPersistedSpawnedNoteWindows() {
    return readRegistry(NOTE_WINDOW_REGISTRY_KEY, LEGACY_NOTE_REGISTRY_KEY)
  }

  writePersistedSpawnedNoteWindows(entries) {
    writeRegistry(NOTE_WINDOW_REGISTRY_KEY, entries)
  }

  persistSpawnedNoteWindow(entry) {
    const entryDocId = String(entry?.documentId || "")
    const entries = this.readPersistedSpawnedNoteWindows().filter((item) => {
      if (item?.appKey === entry.appKey) return false
      if (!entryDocId) return true
      return String(item?.documentId || "") !== entryDocId
    })
    entries.push(entry)
    this.writePersistedSpawnedNoteWindows(entries)
  }

  removePersistedSpawnedNoteWindow(appKey) {
    const entries = this.readPersistedSpawnedNoteWindows().filter((item) => item?.appKey !== appKey)
    this.writePersistedSpawnedNoteWindows(entries)
  }

  restorePersistedSpawnedTimeCardWindows() {
    if (this.appKeyValue !== "time-card") return
    if (window.__nexusTimeCardWindowsRestored) return
    window.__nexusTimeCardWindowsRestored = true

    const primaryLinkedDocId = this.readLinkedDocumentIdForCurrentFrame()
    const entries = this.readPersistedSpawnedTimeCardWindows()
    const seenTimeCardDocIds = new Set()
    entries.forEach((entry) => {
      if (!entry?.appKey || !entry?.documentId) return
      const entryDocId = String(entry.documentId)
      if (seenTimeCardDocIds.has(entryDocId)) {
        this.removePersistedSpawnedTimeCardWindow(String(entry.appKey))
        return
      }
      seenTimeCardDocIds.add(entryDocId)
      if (primaryLinkedDocId && String(entry.documentId) === String(primaryLinkedDocId)) {
        this.removePersistedSpawnedTimeCardWindow(String(entry.appKey))
        return
      }
      const restoredFrameId = String(entry.frameId || entry.appKey)
      const restoredTitle = (entry.documentTitle || "").trim()

      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}
      try {
        window.localStorage.setItem(`nexus.linkedAppDocument.${restoredFrameId}`, String(entry.documentId))
        if (restoredTitle) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${restoredFrameId}`, restoredTitle)
      } catch (_) {}

      if (document.querySelector(`[data-content-window-app-key-value="${entry.appKey}"]`)) {
        window.__nexusSpawnedTimeCardsByDocumentId[String(entry.documentId)] = String(entry.appKey)
        return
      }

      const clone = this.element.cloneNode(true)
      clone.dataset.contentWindowAppKeyValue = String(entry.appKey)
      clone.dataset.contentWindowFrameIdValue = String(entry.frameId || entry.appKey)
      clone.dataset.contentWindowStorageKeyValue = String(entry.storageKey || entry.appKey)
      clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
      clone.dataset.isSpawnedTimeCardWindow = "true"
      clone.dataset.spawnedFromDocumentId = String(entry.documentId)

      const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
      if (frame) frame.id = String(entry.frameId || entry.appKey)
      this.syncOpenFileBadgeFor(clone, restoredTitle)
      this.syncTimeCardHoursBadgeFor(clone, "", { isOpen: false })

      window.__nexusSpawnedTimeCardsByDocumentId[String(entry.documentId)] = String(entry.appKey)
      this.element.parentElement.appendChild(clone)
    })
  }

  readPersistedSpawnedTimeCardWindows() {
    return readRegistry(TIMECARD_WINDOW_REGISTRY_KEY, LEGACY_TIMECARD_REGISTRY_KEY)
  }

  writePersistedSpawnedTimeCardWindows(entries) {
    writeRegistry(TIMECARD_WINDOW_REGISTRY_KEY, entries)
  }

  persistSpawnedTimeCardWindow(entry) {
    const entryDocId = String(entry?.documentId || "")
    const entries = this.readPersistedSpawnedTimeCardWindows().filter((item) => {
      if (item?.appKey === entry.appKey) return false
      if (!entryDocId) return true
      return String(item?.documentId || "") !== entryDocId
    })
    entries.push(entry)
    this.writePersistedSpawnedTimeCardWindows(entries)
  }

  removePersistedSpawnedTimeCardWindow(appKey) {
    const entries = this.readPersistedSpawnedTimeCardWindows().filter((item) => item?.appKey !== appKey)
    this.writePersistedSpawnedTimeCardWindows(entries)
  }

  syncOpenFileBadge(title) {
    this.syncOpenFileBadgeFor(this.element, title)
  }

  syncOpenFileBadgeFor(windowEl, title) {
    if (!windowEl) return
    const sep = windowEl.querySelector("[data-nexus-open-file-separator]")
    const nameEl = windowEl.querySelector("[data-nexus-open-file-name]")
    if (!sep || !nameEl) return
    const t = (title || "").trim()
    if (!t) {
      sep.hidden = true
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
      this.syncOpenFileNameStateFor(windowEl, "neutral")
      return
    }
    sep.hidden = false
    nameEl.hidden = false
    nameEl.textContent = t
    nameEl.setAttribute("title", t)
    this.syncOpenFileNameStateFor(windowEl, "saved")
  }

  syncTimeCardHoursBadge(label, { isOpen = false } = {}) {
    this.syncTimeCardHoursBadgeFor(this.element, label, { isOpen })
  }

  syncTimeCardHoursBadgeFor(windowEl, label, { isOpen = false } = {}) {
    if (!windowEl) return
    const sep = windowEl.querySelector("[data-nexus-time-card-hours-separator]")
    const hoursEl = windowEl.querySelector("[data-nexus-time-card-hours]")
    if (!sep || !hoursEl) return

    const text = String(label || "").trim()

    if (!text) {
      sep.hidden = true
      hoursEl.hidden = true
      hoursEl.textContent = ""
      hoursEl.removeAttribute("title")
      return
    }

    sep.hidden = false
    hoursEl.hidden = false
    hoursEl.textContent = text
    hoursEl.setAttribute("title", `Worked ${text}`)
  }

  clearTimeCardHoursBadge() {
    this.syncTimeCardHoursBadge("", { isOpen: false })
  }

  isDraftOpenFileTitle(title) {
    return /\bdraft\b/i.test(String(title || "").trim())
  }

  syncOpenFileNameState(state) {
    this.syncOpenFileNameStateFor(this.element, state)
  }

  syncOpenFileNameStateFor(windowEl, state) {
    if (!windowEl) return
    const nameEl = windowEl.querySelector("[data-nexus-open-file-name]")
    if (!nameEl) return

    nameEl.classList.remove(
      "content-window-open-file-name--dirty",
      "content-window-open-file-name--saved",
      "content-window-open-file-name--draft"
    )

    if (nameEl.hidden) return

    const title = String(nameEl.textContent || "").trim()
    if (!title) return

    if (this.isDraftOpenFileTitle(title)) {
      nameEl.classList.add("content-window-open-file-name--draft")
      return
    }

    if (state === "dirty") {
      nameEl.classList.add("content-window-open-file-name--dirty")
      return
    }

    if (state === "saved") {
      nameEl.classList.add("content-window-open-file-name--saved")
    }
  }

  readOpenTitleForFrame(frameId) {
    if (!frameId) return ""
    const key = `nexus.linkedAppOpenTitle.${frameId}`
    let title = ""
    try {
      title = window.sessionStorage.getItem(key) || ""
    } catch (_error) {
      // non-blocking
    }
    if (title.trim().length > 0) return title.trim()
    try {
      title = window.localStorage.getItem(key) || ""
    } catch (_error) {
      // non-blocking
    }
    return (title || "").trim()
  }

  syncOpenTitleStorageForFrame(frameId, title) {
    if (!frameId) return
    const key = `nexus.linkedAppOpenTitle.${frameId}`
    const t = (title || "").trim()
    if (!t) return
    try {
      window.sessionStorage.setItem(key, t)
    } catch (_error) {
      // non-blocking
    }
    try {
      window.localStorage.setItem(key, t)
    } catch (_error) {
      // non-blocking
    }
  }

  syncPersistedSpawnedTaskTitle(documentTitle) {
    if (!this.appKeyValue.startsWith("task-spawn-")) return
    const entries = this.readPersistedSpawnedTaskWindows()
    const next = entries.map((item) => {
      if (item?.appKey !== this.appKeyValue) return item
      return { ...item, documentTitle: (documentTitle || "").trim() }
    })
    this.writePersistedSpawnedTaskWindows(next)
  }

  syncPersistedSpawnedNoteTitle(documentTitle) {
    if (!this.appKeyValue.startsWith("note-spawn-")) return
    const entries = this.readPersistedSpawnedNoteWindows()
    const next = entries.map((item) => {
      if (item?.appKey !== this.appKeyValue) return item
      return { ...item, documentTitle: (documentTitle || "").trim() }
    })
    this.writePersistedSpawnedNoteWindows(next)
  }

  syncPersistedSpawnedTimeCardTitle(documentTitle) {
    if (!this.appKeyValue.startsWith("time-card-spawn-")) return
    const entries = this.readPersistedSpawnedTimeCardWindows()
    const next = entries.map((item) => {
      if (item?.appKey !== this.appKeyValue) return item
      return { ...item, documentTitle: (documentTitle || "").trim() }
    })
    this.writePersistedSpawnedTimeCardWindows(next)
  }

  syncSpawnedTaskDocumentRegistration(documentId) {
    if (!this.appKeyValue.startsWith("task-spawn-")) return
    if (!window.__nexusSpawnedTasksByDocumentId) window.__nexusSpawnedTasksByDocumentId = {}

    const map = window.__nexusSpawnedTasksByDocumentId
    const nextDocId = String(documentId || "")

    Object.keys(map).forEach((docId) => {
      if (map[docId] === this.appKeyValue && docId !== nextDocId) delete map[docId]
    })

    if (!nextDocId) {
      delete this.element.dataset.spawnedFromDocumentId
      return
    }

    map[nextDocId] = this.appKeyValue
    this.element.dataset.spawnedFromDocumentId = nextDocId
    this.persistSpawnedTaskWindow({
      appKey: this.appKeyValue,
      frameId: this.frameIdValue,
      storageKey: this.storageKeyValue,
      documentId: nextDocId,
      documentTitle: this.readOpenTitleForFrame(this.frameIdValue)
    })
  }

  syncSpawnedNoteDocumentRegistration(documentId) {
    if (!this.appKeyValue.startsWith("note-spawn-")) return
    if (!window.__nexusSpawnedNotesByDocumentId) window.__nexusSpawnedNotesByDocumentId = {}

    const map = window.__nexusSpawnedNotesByDocumentId
    const nextDocId = String(documentId || "")

    Object.keys(map).forEach((docId) => {
      if (map[docId] === this.appKeyValue && docId !== nextDocId) delete map[docId]
    })

    if (!nextDocId) {
      delete this.element.dataset.spawnedFromDocumentId
      return
    }

    map[nextDocId] = this.appKeyValue
    this.element.dataset.spawnedFromDocumentId = nextDocId
    this.persistSpawnedNoteWindow({
      appKey: this.appKeyValue,
      frameId: this.frameIdValue,
      storageKey: this.storageKeyValue,
      documentId: nextDocId,
      documentTitle: this.readOpenTitleForFrame(this.frameIdValue)
    })
  }

  syncSpawnedTimeCardDocumentRegistration(documentId) {
    if (!this.appKeyValue.startsWith("time-card-spawn-")) return
    if (!window.__nexusSpawnedTimeCardsByDocumentId) window.__nexusSpawnedTimeCardsByDocumentId = {}

    const map = window.__nexusSpawnedTimeCardsByDocumentId

    const nextDocId = String(documentId || "")
    Object.keys(map).forEach((docId) => {
      if (map[docId] === this.appKeyValue && docId !== nextDocId) delete map[docId]
    })

    if (!nextDocId) {
      Object.keys(map).forEach((docId) => {
        if (map[docId] === this.appKeyValue) delete map[docId]
      })
      delete this.element.dataset.spawnedFromDocumentId
      return
    }

    map[nextDocId] = this.appKeyValue
    this.element.dataset.spawnedFromDocumentId = nextDocId
    this.persistSpawnedTimeCardWindow({
      appKey: this.appKeyValue,
      frameId: this.frameIdValue,
      storageKey: this.storageKeyValue,
      documentId: nextDocId,
      documentTitle: this.readOpenTitleForFrame(this.frameIdValue)
    })
  }

  syncSpawnedLinkedDocumentRegistration(documentId) {
    this.syncSpawnedTaskDocumentRegistration(documentId)
    this.syncSpawnedNoteDocumentRegistration(documentId)
    this.syncSpawnedTimeCardDocumentRegistration(documentId)
  }

  clearOpenFileBadge() {
    this.syncOpenFileBadge("")
    this.clearTimeCardHoursBadge()
    if (this.isLinkedDocumentApp() && this.hasFrameIdValue) this.clearLinkedAppOpenTitleStorage()
  }

  linkedAppDocumentStorageKey() {
    return this.hasFrameIdValue ? `nexus.linkedAppDocument.${this.frameIdValue}` : null
  }

  linkedAppOpenTitleStorageKey() {
    return this.hasFrameIdValue ? `nexus.linkedAppOpenTitle.${this.frameIdValue}` : null
  }

  clearLinkedAppPickerDraftSnapshot() {
    if (!this.hasFrameIdValue) return
    clearLinkedAppPickerDraft(this.frameIdValue)
  }

  persistLinkedAppOpenTitle(title) {
    const key = this.linkedAppOpenTitleStorageKey()
    if (!key) return
    const t = (title || "").trim()
    if (!t) return
    try {
      window.sessionStorage.setItem(key, t)
    } catch (_error) {
      // non-blocking
    }
    try {
      window.localStorage.setItem(key, t)
    } catch (_error) {
      // non-blocking
    }
    this.syncPersistedSpawnedTaskTitle(t)
    this.syncPersistedSpawnedNoteTitle(t)
    this.syncPersistedSpawnedTimeCardTitle(t)
  }

  clearLinkedAppOpenTitleStorage() {
    const key = this.linkedAppOpenTitleStorageKey()
    if (!key) return
    try {
      window.sessionStorage.removeItem(key)
    } catch (_error) {
      // non-blocking
    }
    try {
      window.localStorage.removeItem(key)
    } catch (_error) {
      // non-blocking
    }
    this.syncPersistedSpawnedTaskTitle("")
    this.syncPersistedSpawnedNoteTitle("")
    this.syncPersistedSpawnedTimeCardTitle("")
  }

  /** After reload, reattach document_id to the iframe URL and title chrome from sessionStorage. */
  restoreLinkedAppUrlAndBadge() {
    if (!this.isLinkedDocumentApp() && !this.appKeyValue.startsWith("task-spawn-")) return
    if (!this.hasFrameIdValue) return
    const docKey = this.linkedAppDocumentStorageKey()
    if (!docKey) return
    let linkedId = null
    try {
      linkedId = window.sessionStorage.getItem(docKey)
    } catch (_error) {
      return
    }
      // Fall back to localStorage so state survives logout/login
      if (!linkedId) {
        try {
          linkedId = window.localStorage.getItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
        } catch (_) {}
      }
      if (!linkedId) return

    const url = new URL(this.appUrlValue, window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("document_id", String(linkedId))
    url.searchParams.delete("blank")
    this.currentUrl = `${url.pathname}${url.search}`

    const titleKey = this.linkedAppOpenTitleStorageKey()
    let openTitle = ""
    if (titleKey) {
      try {
        openTitle = window.sessionStorage.getItem(titleKey) || ""
      } catch (_error) {
        // ignore
      }
      if (!openTitle) {
        try {
          openTitle = window.localStorage.getItem(titleKey) || ""
        } catch (_error) {
          // ignore
        }
      }
    }
    const t = openTitle.trim()
    if (t) this.syncOpenFileBadge(t)
    else this.syncOpenFileBadge("")
  }

  onLinkedAppDocumentSaved(event) {
    const { frameId, title } = event.detail || {}
    if (frameId !== this.frameIdValue) return
    const t = (title || "").trim()
    if (!t) return
    this.persistLinkedAppOpenTitle(t)
    this.syncOpenFileBadge(t)
  }

  onFinderItemRenamed(event) {
    const { itemId, newName, isFolder } = event.detail || {}
    if (isFolder || !itemId || !newName) return
    
    const linkedDocId = this.readLinkedDocumentIdForCurrentFrame()
    if (!linkedDocId || String(linkedDocId) !== String(itemId)) return
    
    const newTitle = (newName || "").trim()
    if (!newTitle) return
    
    this.persistLinkedAppOpenTitle(newTitle)
    this.syncOpenFileBadge(newTitle)
  }

  handleFrameLoad(event) {
    if (!this.hasFrameTarget || event?.target !== this.frameTarget) return
    this.repairTaskDraftLinkIfStale()
  }

  async repairTaskDraftLinkIfStale() {
    const isTaskWindow = this.appKeyValue === "tasks" || this.appKeyValue.startsWith("task-spawn-")
    if (!isTaskWindow) return
    if (this._taskDraftRepairInFlight) return

    const root = this.frameTarget.querySelector("[data-task-list-linked-mode][data-task-list-linked-document-id]")
    if (!root) return

    const linkedMode = String(root.getAttribute("data-task-list-linked-mode") || "") === "true"
    const linkedDocumentId = String(root.getAttribute("data-task-list-linked-document-id") || "")
    const linkedDocumentTitle = String(root.getAttribute("data-task-list-linked-document-title") || "").trim()

    // If the server rendered linked mode, synchronize local identity and stop.
    if (linkedMode && linkedDocumentId) {
      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, linkedDocumentId)
        window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, linkedDocumentId)
      } catch (_) {}
      if (linkedDocumentTitle) {
        this.syncOpenFileBadge(linkedDocumentTitle)
        this.persistLinkedAppOpenTitle(linkedDocumentTitle)
      }
      this.syncSpawnedLinkedDocumentRegistration(linkedDocumentId)
      return
    }

    // No linked document came back while a document_id URL was requested.
    // Recover by rebinding this window to the canonical embedded Task Draft.
    const requestedId = this.readDocumentIdFromFrameSrc()
    if (!requestedId) return

    this._taskDraftRepairInFlight = true
    try {
      const response = await fetch("/apps/tasks/draft_file?app_key=tasks", {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      })
      if (!response.ok) return
      const payload = await response.json().catch(() => null)
      const canonicalId = String(payload?.document_id || "")
      const canonicalTitle = String(payload?.display_title || payload?.title || "").trim()
      if (!canonicalId) return

      const existing = this.findTaskWindowByDocumentId(canonicalId, { includeHidden: true })
      if (existing && existing !== this.element && this.appKeyValue.startsWith("task-spawn-")) {
        this.focusOrOpenWindow(existing)
        this.close()
        return
      }

      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, canonicalId)
        window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, canonicalId)
      } catch (_) {}
      if (canonicalTitle) {
        this.syncOpenFileBadge(canonicalTitle)
        this.persistLinkedAppOpenTitle(canonicalTitle)
      }
      this.syncSpawnedLinkedDocumentRegistration(canonicalId)

      const url = new URL(this.appUrlValue, window.location.origin)
      url.searchParams.set("frame_id", this.frameIdValue)
      url.searchParams.set("document_id", canonicalId)
      url.searchParams.delete("blank")
      this.currentUrl = `${url.pathname}${url.search}`

      if (this.hasFrameTarget && this.frameTarget.getAttribute("src") !== this.currentUrl) {
        this.frameTarget.removeAttribute("src")
        void this.frameTarget.offsetWidth
        this.frameTarget.src = this.currentUrl
      }
    } finally {
      this._taskDraftRepairInFlight = false
    }
  }

  readDocumentIdFromFrameSrc() {
    const src = (this.frameTarget?.getAttribute("src") || "").toString()
    if (!src) return ""
    try {
      const url = new URL(src, window.location.origin)
      return String(url.searchParams.get("document_id") || "")
    } catch (_error) {
      const m = src.match(/[?&]document_id=([^&]+)/)
      return m ? decodeURIComponent(m[1]) : ""
    }
  }

  /** Legacy: modal save (unused when linked_app_save_flow uses in-window Finder). */
  openSaveDialog(event) {
    if (event) event.preventDefault()
  }

  openLinkedAppSavePicker(event) {
    if (event) event.preventDefault()
    if (!this.hasLinkedAppSavePickerValue || !this.hasFrameTarget) return

    window.dispatchEvent(
      new CustomEvent(LINKED_APP_BEFORE_SAVE_PICKER, { detail: { frameId: this.frameIdValue } })
    )

    this.element.classList.add("content-window--linked-app-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = true
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = false

    const url = new URL("/apps/finder", window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("mode", "save_as")

    if (this.hasSavePickerLayerTarget && this.hasSavePickerIframeTarget) {
      url.searchParams.set("embed", "iframe")
      this.#showLinkedAppSavePickerLayer(`${url.pathname}${url.search}`)
      return
    }

    this.frameTarget.src = `${url.pathname}${url.search}`
  }

  closeLinkedAppSavePicker(event) {
    if (event) event.preventDefault()
    if (!this.hasLinkedAppSavePickerValue || !this.hasFrameTarget) return

    this.element.classList.remove("content-window--linked-app-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true

    if (this.hasSavePickerLayerTarget && this.hasSavePickerIframeTarget) {
      this.#dismissLinkedAppSavePickerLayer()
      return
    }

    this.frameTarget.src = this.currentUrl
  }

  #showLinkedAppSavePickerLayer(src) {
    if (!this.hasSavePickerLayerTarget || !this.hasSavePickerIframeTarget) return
    this.savePickerIframeTarget.src = src
    this.savePickerLayerTarget.hidden = false
    this.savePickerLayerTarget.setAttribute("aria-hidden", "false")
  }

  #dismissLinkedAppSavePickerLayer() {
    if (!this.hasSavePickerLayerTarget || !this.hasSavePickerIframeTarget) return
    this.savePickerLayerTarget.hidden = true
    this.savePickerLayerTarget.setAttribute("aria-hidden", "true")
    this.savePickerIframeTarget.removeAttribute("src")
  }

  handleLinkedAppSavePickerClose(event) {
    const { frameId, saved, documentId, clearedEmbeddedDraft } = event.detail || {}
    if (frameId !== this.frameIdValue) return

    if (saved) this.clearLinkedAppPickerDraftSnapshot()

    if (saved && documentId != null) {
      const u = new URL(this.buildAppUrl({ blank: false }), window.location.origin)
      u.searchParams.set("document_id", String(documentId))
      this.currentUrl = `${u.pathname}${u.search}`

      // Ensure the current window immediately becomes the saved file view.
      if (this.hasFrameTarget) {
        this.frameTarget.removeAttribute("src")
        void this.frameTarget.offsetWidth
        this.frameTarget.src = this.currentUrl
      }
    }

    this.closeLinkedAppSavePicker()

    // Only persist the linked document if this wasn't an embedded draft save.
    // Embedded draft saves should not become the "linked document" for the next session.
    if (saved && documentId != null) {
      const docIdStr = String(documentId)
      // Persist linked doc to both storages so it survives logout/login
      try {
        window.sessionStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, docIdStr)
        window.localStorage.setItem(`nexus.linkedAppDocument.${this.frameIdValue}`, docIdStr)
      } catch (_) {}
      this.syncSpawnedLinkedDocumentRegistration(docIdStr)
    }

  }

  readStoredLayers() {
    try {
      const raw = window.localStorage.getItem(DESKTOP_WINDOW_LAYERS_KEY)
      if (!raw) return null
      const o = JSON.parse(raw)
      return typeof o === "object" && o !== null ? o : null
    } catch (_error) {
      return null
    }
  }

  restoreWindowZIndex() {
    const layers = this.readStoredLayers()
    const z = layers?.[this.appKeyValue]
    if (Number.isFinite(z) && z > 0) {
      this.element.style.zIndex = String(Math.round(z))
    }
  }

  persistWindowLayer(z) {
    try {
      const layers = this.readStoredLayers() || {}
      layers[this.appKeyValue] = z
      window.localStorage.setItem(DESKTOP_WINDOW_LAYERS_KEY, JSON.stringify(layers))
    } catch (_error) {
      // non-blocking
    }
  }

  syncDesktopZIndexFloor() {
    const zRaw = this.element.style.zIndex || window.getComputedStyle(this.element).zIndex
    const n = Number.parseInt(zRaw, 10)
    if (Number.isFinite(n)) {
      window.__nexusDesktopZIndex = Math.max(window.__nexusDesktopZIndex || 1500, n)
    }
  }

  toggle() {
    if (this.element.classList.contains("is-hidden")) {
      // Reopening a hidden window should preserve linked document context.
      // Explicit blank resets are handled via app-window:open + forceBlank.
      this.open()
      return
    }

    if (this.isForegroundContentWindow()) {
      this.flashAttentionRing()
      return
    }

    this.bringToFront()
  }

  /** True when this window has the highest z-index among visible app windows (dock: second click closes). */
  isForegroundContentWindow() {
    if (this.element.classList.contains("is-hidden")) return false
    let maxZ = -Infinity
    let topEl = null
    document.querySelectorAll("section.content-window.os-window:not(.is-hidden)").forEach((el) => {
      const zRaw = el.style.zIndex || window.getComputedStyle(el).zIndex
      const z = Number.parseInt(zRaw, 10)
      const zc = Number.isFinite(z) ? z : 0
      if (zc >= maxZ) {
        maxZ = zc
        topEl = el
      }
    })
    return topEl === this.element
  }

  flashAttentionRing() {
    this.applyFocusExpandCue(this.element)
    this.element.classList.remove("content-window--focus-pulse", "content-window--focus-pulse-static")
    if (this.attentionTimer) {
      clearTimeout(this.attentionTimer)
      this.attentionTimer = null
    }
  }

  applyFocusExpandCue(windowEl) {
    if (!windowEl) return
    windowEl.classList.remove("content-window--focus-expand")
    void windowEl.offsetWidth
    windowEl.classList.add("content-window--focus-expand")
    if (windowEl.__nexusFocusExpandTimer) window.clearTimeout(windowEl.__nexusFocusExpandTimer)
    windowEl.__nexusFocusExpandTimer = window.setTimeout(() => {
      windowEl.classList.remove("content-window--focus-expand")
      windowEl.__nexusFocusExpandTimer = null
    }, 230)
  }

  open(options = {}) {
    const fromRestore = Boolean(options.fromRestore)
    this.ensureFrameLoaded()
    this.element.classList.remove("is-hidden")
    if (this.isAutoSizedWindow) this.element.style.height = ""
    if (this.windowSizer) this.windowSizer.syncOnOpen()
    if (!fromRestore) {
      this.bringToFront()
    }
    this.saveOpenState(true)
    this.emitWindowState(true)
    requestAnimationFrame(() => {
      this.reconcileWindowOnViewportResize()
    })
  }

  close() {
    if (this.hasLinkedAppSavePickerValue && this.element.classList.contains("content-window--linked-app-save-picker")) {
      this.element.classList.remove("content-window--linked-app-save-picker")
      if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
      if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true
      this.#dismissLinkedAppSavePickerLayer()
    }
    if (this.shouldResetLinkedDocumentOnClose()) {
      this.resetLinkedDocumentSessionState()
    }
    this.saveOpenState(false)
    this.element.classList.add("is-hidden")

    // Spawned linked-doc windows are transient — remove them from DOM when closed.
    if (
      this.appKeyValue.startsWith("task-spawn-") ||
      this.appKeyValue.startsWith("image-spawn-") ||
      this.appKeyValue.startsWith("note-spawn-") ||
      this.appKeyValue.startsWith("time-card-spawn-")
    ) {
      // Clean up the global registry
      const docId = this.element.dataset.spawnedFromDocumentId
      if (docId) {
        if (this.appKeyValue.startsWith("task-spawn-")) delete window.__nexusSpawnedTasksByDocumentId[docId]
        if (this.appKeyValue.startsWith("image-spawn-")) delete window.__nexusSpawnedImagesByDocumentId[docId]
        if (this.appKeyValue.startsWith("note-spawn-")) delete window.__nexusSpawnedNotesByDocumentId[docId]
        if (this.appKeyValue.startsWith("time-card-spawn-")) delete window.__nexusSpawnedTimeCardsByDocumentId[docId]
      }
      if (this.appKeyValue.startsWith("task-spawn-")) this.removePersistedSpawnedTaskWindow(this.appKeyValue)
      if (this.appKeyValue.startsWith("note-spawn-")) this.removePersistedSpawnedNoteWindow(this.appKeyValue)
      if (this.appKeyValue.startsWith("time-card-spawn-")) this.removePersistedSpawnedTimeCardWindow(this.appKeyValue)
      try {
        window.localStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
        window.sessionStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
      } catch (_) {}
      this.element.remove()
      const hasOtherSpawned = this.appKeyValue.startsWith("task-spawn-")
        ? document.querySelectorAll('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)').length > 0
        : this.appKeyValue.startsWith("image-spawn-")
          ? document.querySelectorAll('[data-content-window-app-key-value^="image-spawn-"]:not(.is-hidden)').length > 0
          : this.appKeyValue.startsWith("note-spawn-")
            ? document.querySelectorAll('[data-content-window-app-key-value^="note-spawn-"]:not(.is-hidden)').length > 0
            : document.querySelectorAll('[data-content-window-app-key-value^="time-card-spawn-"]:not(.is-hidden)').length > 0
      const hasPrimaryOpen = this.appKeyValue.startsWith("task-spawn-")
        ? Boolean(document.querySelector('[data-content-window-app-key-value="tasks"]:not(.is-hidden)'))
        : this.appKeyValue.startsWith("image-spawn-")
          ? Boolean(document.querySelector('[data-content-window-app-key-value="images"]:not(.is-hidden)'))
          : this.appKeyValue.startsWith("note-spawn-")
            ? Boolean(document.querySelector('[data-content-window-app-key-value="notes"]:not(.is-hidden)'))
            : Boolean(document.querySelector('[data-content-window-app-key-value="time-card"]:not(.is-hidden)'))
      if (!hasOtherSpawned && !hasPrimaryOpen) {
        this.emitWindowState(false)
      }
    } else {
      this.emitWindowState(false)
    }
  }

  ensureFrameLoaded() {
    if (!this.hasFrameTarget) return
    if (this.frameTarget.getAttribute("src") === this.currentUrl) return
    this.frameTarget.src = this.currentUrl
  }

  shouldResetLinkedDocumentOnClose() {
    return this.appKeyValue === "audio" || this.appKeyValue === "images"
  }

  resetLinkedDocumentSessionState() {
    if (this.hasFrameIdValue) {
      try {
        window.sessionStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
        window.localStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
      } catch (_) {}
    }
    this.currentUrl = this.buildAppUrl({ blank: false })
    this.clearOpenFileBadge()
    if (this.hasFrameTarget) {
      this.frameTarget.removeAttribute("src")
      void this.frameTarget.offsetWidth
    }
  }

  isLinkedApp() {
    return this.appKeyValue === "tasks" || this.appKeyValue.startsWith("task-spawn-")
  }

  /** Finder-linked document windows (Tasks, Audio) share sessionStorage restore + title badge. */
  isLinkedDocumentApp() {
    return this.appKeyValue === "tasks" ||
      this.appKeyValue.startsWith("task-spawn-") ||
      this.appKeyValue === "audio" ||
      this.appKeyValue === "images" ||
      this.appKeyValue.startsWith("image-spawn-") ||
      this.appKeyValue === "notes" ||
      this.appKeyValue.startsWith("note-spawn-") ||
      this.appKeyValue === "time-card" ||
      this.appKeyValue.startsWith("time-card-spawn-")
  }

  buildAppUrl(options = {}) {
    const url = new URL(this.appUrlValue, window.location.origin)
    if (this.hasFrameIdValue) url.searchParams.set("frame_id", this.frameIdValue)
    if (this.isLinkedApp() && options.blank === true) {
      url.searchParams.set("blank", "1")
      url.searchParams.delete("document_id")
    } else {
      url.searchParams.delete("blank")
    }
    return `${url.pathname}${url.search}`
  }

  syncViewportShellMargins() {
    const m = getNexusDesktopShellInsetPx()
    this.viewportMargin = m
    this.dockLeftBoundary = m
    this.bottomDockBoundary = m
  }

  /** Minimum viewport `left` (shell inset only, panel does not constrain windows). */
  effectiveLeftBoundary() {
    return this.dockLeftBoundary
  }

  desktopShellElement() {
    return document.getElementById("desktop-shell")
  }

  currentLocalBounds() {
    const rect = this.element.getBoundingClientRect()
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    return {
      left: rect.left - shellRect.left + scrollLeft,
      top: rect.top - shellRect.top + scrollTop,
      width: rect.width,
      height: rect.height
    }
  }

  visibleShellBounds() {
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const clientWidth = shell ? shell.clientWidth : window.innerWidth
    const clientHeight = shell ? shell.clientHeight : window.innerHeight
    return {
      left: scrollLeft,
      top: scrollTop,
      right: scrollLeft + clientWidth,
      bottom: scrollTop + clientHeight
    }
  }

  ensureDesktopCanvasContainsBounds(bounds) {
    const shell = this.desktopShellElement()
    const canvas = document.getElementById("desktop-shell-canvas")
    if (!shell || !canvas) return
    const nextWidth = Math.max(
      this.desktopMinAppWidth,
      shell.clientWidth,
      Math.ceil(bounds.left + bounds.width + this.viewportMargin)
    )
    const nextHeight = Math.max(
      this.desktopMinAppHeight,
      shell.clientHeight,
      Math.ceil(bounds.top + bounds.height + this.bottomDockBoundary)
    )
    canvas.style.width = `${nextWidth}px`
    canvas.style.height = `${nextHeight}px`
  }

  syncDesktopCanvasDimensions() {
    const shell = this.desktopShellElement()
    const canvas = document.getElementById("desktop-shell-canvas")
    if (!shell || !canvas) return
    let maxRight = this.desktopMinAppWidth
    let maxBottom = this.desktopMinAppHeight
    document.querySelectorAll("section.content-window.os-window:not(.is-hidden)").forEach((el) => {
      const rect = el.getBoundingClientRect()
      const shellRect = shell.getBoundingClientRect()
      const left = rect.left - shellRect.left + shell.scrollLeft
      const top = rect.top - shellRect.top + shell.scrollTop
      maxRight = Math.max(maxRight, Math.ceil(left + rect.width + this.viewportMargin))
      maxBottom = Math.max(maxBottom, Math.ceil(top + rect.height + this.bottomDockBoundary))
    })
    canvas.style.width = `${Math.max(this.desktopMinAppWidth, shell.clientWidth, maxRight)}px`
    canvas.style.height = `${Math.max(this.desktopMinAppHeight, shell.clientHeight, maxBottom)}px`
  }

  handleSidePanelLayoutChange(event) {
    /* Feature disabled: windows no longer auto-reposition when side panel opens/closes */
  }

  startDrag(event) {
    if (this.activeResize) return
    if (event.button !== undefined && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='button']")) return

    event.preventDefault()
    this.bringToFront()

    this._boundsPinX = "none"
    this._boundsPinY = "none"

    const rect = this.element.getBoundingClientRect()
    const coords = this.getCoords(event)
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    const rectLeft = rect.left - shellRect.left + scrollLeft
    const rectTop = rect.top - shellRect.top + scrollTop

    this.activeDrag = { offsetX: coords.x - rectLeft, offsetY: coords.y - rectTop }
    this.element.classList.add("content-window--suppress-position-transition")

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getCoords(event)
    const margin = this.viewportMargin
    const w = this.element.offsetWidth
    const h = this.element.offsetHeight
    const dock = this.effectiveLeftBoundary()
    const left = Math.max(coords.x - this.activeDrag.offsetX, dock)
    const top  = Math.max(coords.y - this.activeDrag.offsetY, margin)

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.ensureDesktopCanvasContainsBounds({ left, top, width: w, height: h })
  }

  stopDrag() {
    const hadDrag = Boolean(this.activeDrag)
    this.activeDrag = null
    this.element.classList.remove("content-window--suppress-position-transition")
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
    /* reconcile bails out while activeDrag is set — clear first so snap + saveWindowBounds run. */
    if (hadDrag) {
      this.reconcileWindowOnViewportResize()
      this.emitWindowState(!this.element.classList.contains("is-hidden"))
    }
  }

  startResize(event) {
    if (this.isAutoSizedWindow) return
    if (this.activeResize) {
      event.preventDefault()
      return
    }
    const btn = event.button
    if (btn != null && btn !== 0) return
    event.preventDefault()
    this.bringToFront()

    this._boundsPinX = "none"
    this._boundsPinY = "none"

    const handle = event.currentTarget
    const rect = this.element.getBoundingClientRect()
    const coords = this.getCoords(event)
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    const rectLeft = rect.left - shellRect.left + scrollLeft
    const rectTop = rect.top - shellRect.top + scrollTop

    this.activeResize = {
      edge: this.getEdgeFromHandle(handle),
      startX: coords.x,
      startY: coords.y,
      startLeft: rectLeft,
      startTop: rectTop,
      startWidth: rect.width,
      startHeight: rect.height,
      anchorLeft: rectLeft,
      anchorTop: rectTop,
      anchorRight: rectLeft + rect.width,
      anchorBottom: rectTop + rect.height
    }
    this.element.classList.add("content-window--suppress-position-transition")

    this._resizeUsesPointer = false
    this._resizePointerId = null
    this._resizeCaptureEl = null

    if (typeof event.pointerId === "number") {
      try {
        handle.setPointerCapture(event.pointerId)
        this._resizePointerId = event.pointerId
        this._resizeCaptureEl = handle
        this._resizeUsesPointer = true
        handle.addEventListener("lostpointercapture", this.boundLostPointerCaptureResize)
        document.addEventListener("pointermove", this.boundResizeMove)
        document.addEventListener("pointerup", this.boundResizeEnd)
        document.addEventListener("pointercancel", this.boundResizeEnd)
      } catch (_e) {
        this._resizeUsesPointer = false
        this._resizePointerId = null
        this._resizeCaptureEl = null
      }
    }

    if (!this._resizeUsesPointer) {
      document.addEventListener("mousemove", this.boundResizeMove)
      document.addEventListener("mouseup", this.boundResizeEnd)
      document.addEventListener("touchmove", this.boundResizeMove, { passive: false })
      document.addEventListener("touchend", this.boundResizeEnd)
    }
  }

  handleLostPointerCaptureResize(event) {
    if (!this.activeResize) return
    if (this._resizeCaptureEl != null && event.target !== this._resizeCaptureEl) return
    if (typeof event.pointerId === "number" && this._resizePointerId != null && event.pointerId !== this._resizePointerId) {
      return
    }
    this.stopResize()
  }

  handleResizeMove(event) {
    if (!this.activeResize) return
    if (event.cancelable && (event.touches || typeof event.pointerId === "number")) event.preventDefault()

    const coords = this.getCoords(event)
    const deltaX = coords.x - this.activeResize.startX
    const deltaY = coords.y - this.activeResize.startY
    const edge = this.activeResize.edge
    const margin = this.viewportMargin

    let left = this.activeResize.startLeft
    let top = this.activeResize.startTop
    let width = this.activeResize.startWidth
    let height = this.activeResize.startHeight

    if (edge.includes("left")) {
      left += deltaX
      width -= deltaX
    }
    if (edge.includes("right")) width += deltaX
    if (edge.includes("top")) {
      top += deltaY
      height -= deltaY
    }
    if (edge.includes("bottom")) height += deltaY

    const dockBound = this.effectiveLeftBoundary()
    const minW = this.minWindowWidth
    const minH = this.minWindowHeight

    left = Math.max(dockBound, left)
    top = Math.max(margin, top)
    const ar = this.activeResize
    if (width < minW) {
      if (edge.includes("left")) left = ar.anchorRight - minW
      else if (edge.includes("right")) left = ar.anchorLeft
      width = minW
    }
    if (height < minH) {
      if (edge.includes("top")) top = ar.anchorBottom - minH
      else if (edge.includes("bottom")) top = ar.anchorTop
      height = minH
    }
    left = Math.max(dockBound, left)
    top = Math.max(margin, top)

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
    this.ensureDesktopCanvasContainsBounds({ left, top, width, height })
  }

  stopResize() {
    const hadResize = Boolean(this.activeResize)

    if (this._resizeCaptureEl) {
      this._resizeCaptureEl.removeEventListener("lostpointercapture", this.boundLostPointerCaptureResize)
    }

    if (this._resizeUsesPointer) {
      document.removeEventListener("pointermove", this.boundResizeMove)
      document.removeEventListener("pointerup", this.boundResizeEnd)
      document.removeEventListener("pointercancel", this.boundResizeEnd)
    } else {
      document.removeEventListener("mousemove", this.boundResizeMove)
      document.removeEventListener("mouseup", this.boundResizeEnd)
      document.removeEventListener("touchmove", this.boundResizeMove)
      document.removeEventListener("touchend", this.boundResizeEnd)
    }

    if (this._resizeCaptureEl != null && this._resizePointerId != null) {
      try {
        if (this._resizeCaptureEl.hasPointerCapture?.(this._resizePointerId)) {
          this._resizeCaptureEl.releasePointerCapture(this._resizePointerId)
        }
      } catch (_e) {
        // already released
      }
    }
    this._resizeUsesPointer = false
    this._resizePointerId = null
    this._resizeCaptureEl = null

    this.activeResize = null
    this.element.classList.remove("content-window--suppress-position-transition")
    if (hadResize) {
      const r = this.element.getBoundingClientRect()
      const slack = MIN_SIZE_SLACK_PX
      const minW = this.minWindowWidth
      const minH = this.minWindowHeight
      if (r.width + slack >= minW && r.height + slack >= minH) {
        this.preferredWindowWidth = Math.round(r.width)
        this.preferredWindowHeight = Math.round(r.height)
      }
      this.reconcileWindowOnViewportResize()
      this.emitWindowState(!this.element.classList.contains("is-hidden"))
    }
  }

  reconcileWindowOnViewportResize(options = {}) {
    const viewportResize = options.viewportResize === true
    if (this.element.classList.contains("is-hidden")) return
    if (this.activeDrag || this.activeResize) return

    const iwViewport = window.innerWidth
    const ihViewport = window.innerHeight
    const prevW = this._viewportResizeW ?? iwViewport
    const prevH = this._viewportResizeH ?? ihViewport
    const grewX = iwViewport > prevW + 2
    const grewY = ihViewport > prevH + 2
    this._viewportResizeW = iwViewport
    this._viewportResizeH = ihViewport

    const bounds = this.currentLocalBounds()
    let left = Math.max(this.dockLeftBoundary, bounds.left)
    let top = Math.max(this.viewportMargin, bounds.top)

    const visible = this.visibleShellBounds()
    if (viewportResize && grewX) {
      const maxVisibleLeft = visible.right - this.viewportMargin - bounds.width
      if (maxVisibleLeft >= this.dockLeftBoundary && left > maxVisibleLeft) {
        left = maxVisibleLeft
      }
    }
    if (viewportResize && grewY) {
      const maxVisibleTop = visible.bottom - this.bottomDockBoundary - bounds.height
      if (maxVisibleTop >= this.viewportMargin && top > maxVisibleTop) {
        top = maxVisibleTop
      }
    }

    this.element.style.left = `${Math.round(left)}px`
    this.element.style.top = `${Math.round(top)}px`
    this.ensureDesktopCanvasContainsBounds({ left, top, width: bounds.width, height: bounds.height })
    this.syncDesktopCanvasDimensions()
    this.saveWindowBounds()
  }

  positionWindow() {
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const clientWidth = shell ? shell.clientWidth : window.innerWidth
    const clientHeight = shell ? shell.clientHeight : window.innerHeight
    const width = Math.max(this.minWindowWidth, this.windowWidth)
    const height = Math.max(this.minWindowHeight, this.windowHeight)
    let centeredLeft = Math.round(scrollLeft + ((shell ? shell.clientWidth : window.innerWidth) - width) / 2)
    let centeredTop = Math.round(scrollTop + ((shell ? shell.clientHeight : window.innerHeight) - height) / 2)
    const dock = this.effectiveLeftBoundary()
    const maxVisibleLeft = scrollLeft + clientWidth - this.viewportMargin - width
    const maxVisibleTop = scrollTop + clientHeight - this.bottomDockBoundary - height
    let left = Math.max(centeredLeft, dock)
    let top = Math.max(centeredTop, this.viewportMargin)
    if (maxVisibleLeft >= dock) left = Math.min(left, maxVisibleLeft)
    if (maxVisibleTop >= this.viewportMargin) top = Math.min(top, maxVisibleTop)

    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.ensureDesktopCanvasContainsBounds({ left, top, width, height })
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds()
    if (!bounds) {
      this._boundsPinX = "none"
      this._boundsPinY = "none"
      this.positionWindow()
      this.saveWindowBounds()
      return
    }

    this.hydratePreferredFromStoredBounds(bounds)

    this._boundsPinX = bounds.pinX === "left" || bounds.pinX === "right" ? bounds.pinX : "none"
    this._boundsPinY = bounds.pinY === "top" || bounds.pinY === "bottom" ? bounds.pinY : "none"
    this.applyBounds(this.clampBounds(bounds))
    this.reconcileWindowOnViewportResize()
  }

  hydratePreferredFromStoredBounds(bounds) {
    const minW = this.minWindowWidth
    const minH = this.minWindowHeight
    const slack = MIN_SIZE_SLACK_PX
    if (Number.isFinite(bounds.prefW) && Number.isFinite(bounds.prefH)) {
      this.preferredWindowWidth = Math.max(Math.round(bounds.prefW), minW)
      this.preferredWindowHeight = Math.max(Math.round(bounds.prefH), minH)
    } else if (bounds.width + slack >= minW && bounds.height + slack >= minH) {
      this.preferredWindowWidth = Math.round(bounds.width)
      this.preferredWindowHeight = Math.round(bounds.height)
    }
  }

  readStoredBounds() {
    try {
      const raw = window.localStorage.getItem(this.storageKeyValue)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (![parsed?.left, parsed?.top, parsed?.width, parsed?.height].every(Number.isFinite)) return null
      return parsed
    } catch (_error) {
      return null
    }
  }

  saveWindowBounds() {
    const rect = this.element.getBoundingClientRect()
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    const bounds = this.clampBounds({
      left: rect.left - shellRect.left + scrollLeft,
      top: rect.top - shellRect.top + scrollTop,
      width: rect.width,
      height: rect.height
    })
    const slack = MIN_SIZE_SLACK_PX
    const minW = this.minWindowWidth
    const minH = this.minWindowHeight
    if (bounds.width + slack >= minW && bounds.height + slack >= minH) {
      this.preferredWindowWidth = Math.round(bounds.width)
      this.preferredWindowHeight = Math.round(bounds.height)
    }
    const payload = {
      ...bounds,
      pinX: this._boundsPinX,
      pinY: this._boundsPinY,
      prefW: this.preferredWindowWidth,
      prefH: this.preferredWindowHeight
    }

    try {
      window.localStorage.setItem(this.storageKeyValue, JSON.stringify(payload))
    } catch (_error) {
      // non-blocking
    }
  }

  openStateStorageKey() {
    return `${this.storageKeyValue}.open`
  }

  readStoredOpenState() {
    try {
      const raw = window.localStorage.getItem(this.openStateStorageKey())
      if (raw === "1") return true
      if (raw === "0") return false
      return null
    } catch (_error) {
      return null
    }
  }

  saveOpenState(isOpen) {
    try {
      window.localStorage.setItem(this.openStateStorageKey(), isOpen ? "1" : "0")
    } catch (_error) {
      // non-blocking
    }
  }

  restoreOpenState() {
    const shouldOpen = this.readStoredOpenState()
    if (shouldOpen !== true) return
    this.open({ fromRestore: true })
  }

  clampBounds(bounds) {
    const left = Math.max(bounds.left, this.dockLeftBoundary)
    const top = Math.max(bounds.top, this.viewportMargin)
    const width = Math.max(bounds.width, this.minWindowWidth)
    const height = Math.max(bounds.height, this.minWindowHeight)
    return { left, top, width, height }
  }

  applyBounds(bounds) {
    this.element.style.left = `${bounds.left}px`
    this.element.style.top = `${bounds.top}px`
    this.element.style.width = `${bounds.width}px`
    if (!this.isAutoSizedWindow) {
      this.element.style.height = `${bounds.height}px`
    } else {
      this.element.style.height = ""
    }
  }

  getEdgeFromHandle(handle) {
    if (handle.classList.contains("pane-resize-handle--top-left")) return "top-left"
    if (handle.classList.contains("pane-resize-handle--top-right")) return "top-right"
    if (handle.classList.contains("pane-resize-handle--bottom-left")) return "bottom-left"
    if (handle.classList.contains("pane-resize-handle--bottom-right")) return "bottom-right"
    if (handle.classList.contains("pane-resize-handle--top")) return "top"
    if (handle.classList.contains("pane-resize-handle--right")) return "right"
    if (handle.classList.contains("pane-resize-handle--bottom")) return "bottom"
    if (handle.classList.contains("pane-resize-handle--left")) return "left"
    return "right"
  }

  bringToFront() {
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.element.style.zIndex = String(next)
    this.persistWindowLayer(next)
    syncOrganizerAboveVisibleContentWindows()
    this.emitWindowState(!this.element.classList.contains("is-hidden"))
  }

  getCoords(event) {
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    if (event.touches) {
      return {
        x: event.touches[0].clientX - shellRect.left + scrollLeft,
        y: event.touches[0].clientY - shellRect.top + scrollTop
      }
    }
    return {
      x: event.clientX - shellRect.left + scrollLeft,
      y: event.clientY - shellRect.top + scrollTop
    }
  }

  /** Spawns a new blank task window instance (unsaved). */
  handleSpawnBlankTaskWindow() {
    if (this.appKeyValue !== "tasks") return
    this.spawnBlankTaskWindow()
  }

  /** Spawns a new blank notes window instance (unsaved). */
  handleSpawnBlankNoteWindow() {
    if (this.appKeyValue !== "notes") return
    this.spawnBlankNoteWindow()
  }

  /** Spawns a new blank time card window instance (unsaved). */
  handleSpawnBlankTimeCardWindow() {
    if (this.appKeyValue !== "time-card") return
    this.spawnBlankTimeCardWindow()
  }

  /** Clone the primary window shell into a new blank (unsaved) task window and open it. */
  spawnBlankTaskWindow() {
    const uid = `task-spawn-${Date.now()}`
    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedTaskWindow = "true"
    // No spawnedFromDocumentId — blank window hasn't been saved yet
    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) {
      frame.id = uid
      frame.removeAttribute("src")
    }

    const sep = clone.querySelector("[data-nexus-open-file-separator]")
    const nameEl = clone.querySelector("[data-nexus-open-file-name]")
    if (sep) sep.hidden = true
    if (nameEl) {
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
    }
    this.syncTimeCardHoursBadgeFor(clone, "", { isOpen: false })
    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top  = `${Math.round(rect.top)  + 24}px`
    clone.style.width  = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.element.parentElement.appendChild(clone)
    return uid
  }

  /** Clone the primary notes window shell into a new blank (unsaved) notes window and open it. */
  spawnBlankNoteWindow() {
    const uid = `note-spawn-${Date.now()}`
    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedNoteWindow = "true"
    // No spawnedFromDocumentId — blank window hasn't been saved yet
    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) {
      frame.id = uid
      frame.removeAttribute("src")
    }

    const sep = clone.querySelector("[data-nexus-open-file-separator]")
    const nameEl = clone.querySelector("[data-nexus-open-file-name]")
    if (sep) sep.hidden = true
    if (nameEl) {
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
    }
    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top  = `${Math.round(rect.top)  + 24}px`
    clone.style.width  = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.element.parentElement.appendChild(clone)
    return uid
  }

  /** Clone the primary time card window shell into a new blank (unsaved) time card window and open it. */
  spawnBlankTimeCardWindow() {
    const uid = `time-card-spawn-${Date.now()}`
    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedTimeCardWindow = "true"
    // No spawnedFromDocumentId — blank window hasn't been saved yet
    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (frame) {
      frame.id = uid
      frame.removeAttribute("src")
    }

    const sep = clone.querySelector("[data-nexus-open-file-separator]")
    const nameEl = clone.querySelector("[data-nexus-open-file-name]")
    if (sep) sep.hidden = true
    if (nameEl) {
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
    }
    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top  = `${Math.round(rect.top)  + 24}px`
    clone.style.width  = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`
    this.element.parentElement.appendChild(clone)
    return uid
  }

  emitTaskListAddTask(event) {
    if (event) event.preventDefault()
    // Allow task add in both the primary Tasks window and spawned task windows
    const isTaskWindow = this.appKeyValue === "tasks" || this.appKeyValue.startsWith("task-spawn-")
    if (!isTaskWindow) return
    window.dispatchEvent(
      new CustomEvent("nexus:task-list-add-task", {
        detail: { frameId: this.hasFrameIdValue ? this.frameIdValue : "tasks-pane" }
      })
    )
  }

  emitCalendarNewEvent(event) {
    if (event) event.preventDefault()
    if (this.appKeyValue !== "calendar") return
    window.dispatchEvent(
      new CustomEvent("nexus:calendar-new-event", {
        detail: { frameId: this.hasFrameIdValue ? this.frameIdValue : "calendar-pane" }
      })
    )
  }

  emitTimeCardClearRequest(event) {
    if (event) event.preventDefault()
    if (this.appKeyValue !== "time-card") return
    if (!window.confirm("Clear all time card data? This cannot be undone.")) return
    window.dispatchEvent(new CustomEvent("nexus:time-card-clear-request", {
      detail: { frameId: this.frameIdValue }
    }))
  }

  async setLinkedImageAsWallpaper(event) {
    if (event) event.preventDefault()
    const isImagesWindow = this.appKeyValue === "images" || this.appKeyValue.startsWith("image-spawn-")
    if (!isImagesWindow) return

    const documentId = this.readLinkedDocumentIdForCurrentFrame()
    if (!documentId) return

    const csrf = document.querySelector('meta[name="csrf-token"]')?.content || ""
    const response = await fetch("/workspace_preferences", {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf
      },
      body: JSON.stringify({ apply_wallpaper_image: { document_id: Number(documentId) } })
    })

    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(payload.error || "Could not set wallpaper.")
      return
    }

    syncNexusDesktopWallpaper(payload || {})
  }

  emitWindowState(isOpen) {
    const rect = this.element.getBoundingClientRect()
    const z = Number.parseInt(this.element.style.zIndex || window.getComputedStyle(this.element).zIndex, 10)
    // Spawned task windows report as "tasks" so the Tasks row highlights,
    // but keep the internal appKey for proper controller identity.
    const reportedAppKey =
      this.element.dataset.isSpawnedTaskWindow === "true"
        ? "tasks"
        : this.element.dataset.isSpawnedImageWindow === "true"
          ? "images"
          : this.element.dataset.isSpawnedNoteWindow === "true"
            ? "notes"
            : this.element.dataset.isSpawnedTimeCardWindow === "true"
              ? "time-card"
              : this.appKeyValue
    window.dispatchEvent(new CustomEvent("app-window:state", {
      detail: {
        appKey: reportedAppKey,
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        z: Number.isFinite(z) ? z : 1500,
        url: isOpen ? this.currentUrl : null
      }
    }))
  }
}
