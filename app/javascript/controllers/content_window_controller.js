import { Controller } from "@hotwired/stimulus"
import { getDesktopSidePanelBlockEndPx, getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"
import { createOsWindowSizer } from "lib/os_window_sizing"
import { syncOrganizerAboveVisibleContentWindows } from "lib/nexus_desktop_layers"
import { clearSingularPickerDraft, SINGULAR_BEFORE_SAVE_PICKER } from "lib/singular_finder_picker_draft"

/** Kept in sync with inline boot script in `shared/_content_windows_boot.html.erb`. */
const DESKTOP_WINDOW_LAYERS_KEY = "nexus.desktop.windowLayers"
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
    "savePickerLayer",
    "savePickerIframe"
  ]
  static values = {
    appKey: String,
    appUrl: String,
    storageKey: String,
    frameId: String,
    hasSingularSavePicker: { type: Boolean, default: false }
  }

  connect() {
    this.currentUrl = this.buildAppUrl({ blank: false })
    this.restoreLinkedSingularUrlAndBadge()
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
    const loopsMin = { width: 320, height: 154 }
    const minByAppKey = {
      /* Same minimum as Finder (`finder` uses `taskListMin`). */
      "singular-task-list": taskListMin,
      finder: taskListMin,
      loops: loopsMin,
      "settings": finderLikeMin,
      user: { width: 320, height: 220 },
    }
    const appMinimum = minByAppKey[this.appKeyValue] || taskListMin
    this.minWindowWidth = appMinimum.width
    this.minWindowHeight = appMinimum.height

    const rect = this.element.getBoundingClientRect()
    if (this.appKeyValue === "finder" || this.appKeyValue === "loops") {
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
    this._lastSidePanelBlockEnd = getDesktopSidePanelBlockEndPx()

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundResizeMove = this.handleResizeMove.bind(this)
    this.boundResizeEnd = this.stopResize.bind(this)
    this.boundLostPointerCaptureResize = this.handleLostPointerCaptureResize.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)

    window.addEventListener("app-window:toggle", this.boundToggleRequest)
    this.boundOpenRequest = this.handleOpenRequest.bind(this)
    window.addEventListener("app-window:open", this.boundOpenRequest)
    this.boundCloseRequest = this.handleCloseRequest.bind(this)
    window.addEventListener("app-window:close", this.boundCloseRequest)
    this.boundSingularSaved = this.onSingularDiskSaved.bind(this)
    window.addEventListener("nexus:singular-disk-saved", this.boundSingularSaved)
    this.boundViewportResize = () => {
      this.syncViewportShellMargins()
      this.syncDesktopCanvasDimensions()
      this.reconcileWindowOnViewportResize({ viewportResize: true })
    }
    window.addEventListener("resize", this.boundViewportResize)
    this.boundSidePanelLayoutChange = this.handleSidePanelLayoutChange.bind(this)
    window.addEventListener("nexus:side-panel-layout-change", this.boundSidePanelLayoutChange)

    if (this.hasSingularSavePickerValue) {
      this.boundSingularPickerClose = this.handleSingularSavePickerClose.bind(this)
      window.addEventListener("nexus:singular-save-picker-close", this.boundSingularPickerClose)
      this.boundEmbeddedSingularOpen = this.handleEmbeddedSingularOpen.bind(this)
      window.addEventListener("nexus:singular-open-from-embedded-finder", this.boundEmbeddedSingularOpen)
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
    this.restoreOpenState()
  }

  disconnect() {
    this.stopDrag()
    this.stopResize()
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    if (this.windowSizer) this.windowSizer.disconnect()
    window.removeEventListener("app-window:toggle", this.boundToggleRequest)
    window.removeEventListener("app-window:open", this.boundOpenRequest)
    window.removeEventListener("app-window:close", this.boundCloseRequest)
    window.removeEventListener("nexus:singular-disk-saved", this.boundSingularSaved)
    window.removeEventListener("resize", this.boundViewportResize)
    window.removeEventListener("nexus:side-panel-layout-change", this.boundSidePanelLayoutChange)
    if (this.boundSingularPickerClose) {
      window.removeEventListener("nexus:singular-save-picker-close", this.boundSingularPickerClose)
    }
    if (this.boundEmbeddedSingularOpen) {
      window.removeEventListener("nexus:singular-open-from-embedded-finder", this.boundEmbeddedSingularOpen)
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

  /** Open linked doc from Finder save-picker tree (same window, exit picker chrome). */
  handleEmbeddedSingularOpen(event) {
    const { frameId, appKey, documentId, documentTitle } = event.detail || {}
    if (!this.hasSingularSavePickerValue || !this.hasFrameIdValue) return
    if (frameId !== this.frameIdValue || appKey !== this.appKeyValue) return

    this.clearSingularPickerDraftSnapshot()

    this.element.classList.remove("content-window--singular-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true
    this.#dismissSingularSavePickerLayer()

    const url = new URL(this.appUrlValue, window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("document_id", String(documentId))
    url.searchParams.delete("blank")
    this.currentUrl = `${url.pathname}${url.search}`

    try {
      window.sessionStorage.setItem(`nexus.singularLinkedDocument.${this.frameIdValue}`, String(documentId))
    } catch (_err) {
      /* ignore */
    }

    const t = (documentTitle || "").trim()
    if (t) {
      this.syncOpenFileBadge(t)
      this.persistSingularOpenTitle(t)
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
    const { appKey, documentId, documentTitle } = event.detail || {}
    if (appKey !== this.appKeyValue) return

    if (documentId) {
      const url = new URL(this.appUrlValue, window.location.origin)
      url.searchParams.set("frame_id", this.frameIdValue)
      url.searchParams.set("document_id", String(documentId))
      url.searchParams.delete("blank")
      this.currentUrl = `${url.pathname}${url.search}`
      this.syncOpenFileBadge(documentTitle)
      const titled = (documentTitle || "").trim()
      if (titled) this.persistSingularOpenTitle(titled)
      else this.clearSingularOpenTitleStorage()
    } else {
      this.currentUrl = this.buildAppUrl({ blank: this.isSingularApp() })
      this.clearOpenFileBadge()
    }

    if (this.hasFrameTarget) {
      const mustHardReload =
        Boolean(documentId) ||
        (this.isSingularApp() && this.currentUrl.includes("blank=1"))
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

  syncOpenFileBadge(title) {
    const sep = this.element.querySelector("[data-nexus-open-file-separator]")
    const nameEl = this.element.querySelector("[data-nexus-open-file-name]")
    if (!sep || !nameEl) return
    const t = (title || "").trim()
    if (!t) {
      sep.hidden = true
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
      return
    }
    sep.hidden = false
    nameEl.hidden = false
    nameEl.textContent = t
    nameEl.setAttribute("title", t)
  }

  clearOpenFileBadge() {
    this.syncOpenFileBadge("")
    if (this.isLinkedDocumentApp() && this.hasFrameIdValue) this.clearSingularOpenTitleStorage()
  }

  singularLinkedDocumentStorageKey() {
    return this.hasFrameIdValue ? `nexus.singularLinkedDocument.${this.frameIdValue}` : null
  }

  singularOpenTitleStorageKey() {
    return this.hasFrameIdValue ? `nexus.singularOpenTitle.${this.frameIdValue}` : null
  }

  clearSingularPickerDraftSnapshot() {
    if (!this.hasFrameIdValue) return
    clearSingularPickerDraft(this.frameIdValue)
  }

  persistSingularOpenTitle(title) {
    const key = this.singularOpenTitleStorageKey()
    if (!key) return
    const t = (title || "").trim()
    if (!t) return
    try {
      window.sessionStorage.setItem(key, t)
    } catch (_error) {
      // non-blocking
    }
  }

  clearSingularOpenTitleStorage() {
    const key = this.singularOpenTitleStorageKey()
    if (!key) return
    try {
      window.sessionStorage.removeItem(key)
    } catch (_error) {
      // non-blocking
    }
  }

  /** After reload, reattach document_id to the iframe URL and title chrome from sessionStorage. */
  restoreLinkedSingularUrlAndBadge() {
    if (!this.isLinkedDocumentApp() || !this.hasFrameIdValue) return
    const docKey = this.singularLinkedDocumentStorageKey()
    if (!docKey) return
    let linkedId = null
    try {
      linkedId = window.sessionStorage.getItem(docKey)
    } catch (_error) {
      return
    }
    if (!linkedId) return

    const url = new URL(this.appUrlValue, window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("document_id", String(linkedId))
    url.searchParams.delete("blank")
    this.currentUrl = `${url.pathname}${url.search}`

    const titleKey = this.singularOpenTitleStorageKey()
    let openTitle = ""
    if (titleKey) {
      try {
        openTitle = window.sessionStorage.getItem(titleKey) || ""
      } catch (_error) {
        // ignore
      }
    }
    const t = openTitle.trim()
    if (t) this.syncOpenFileBadge(t)
  }

  onSingularDiskSaved(event) {
    const { frameId, title } = event.detail || {}
    if (frameId !== this.frameIdValue) return
    const t = (title || "").trim()
    if (!t) return
    this.persistSingularOpenTitle(t)
    this.syncOpenFileBadge(t)
  }

  /** Legacy: modal save (unused when singular_save_flow uses in-window Finder). */
  openSaveDialog(event) {
    if (event) event.preventDefault()
  }

  openSingularSavePicker(event) {
    if (event) event.preventDefault()
    if (!this.hasSingularSavePickerValue || !this.hasFrameTarget) return

    this.element.classList.add("content-window--singular-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = true
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = false

    const url = new URL("/apps/finder", window.location.origin)
    url.searchParams.set("frame_id", this.frameIdValue)
    url.searchParams.set("mode", "save_as")

    if (this.hasSavePickerLayerTarget && this.hasSavePickerIframeTarget) {
      url.searchParams.set("embed", "iframe")
      this.#showSingularSavePickerLayer(`${url.pathname}${url.search}`)
      return
    }

    window.dispatchEvent(
      new CustomEvent(SINGULAR_BEFORE_SAVE_PICKER, { detail: { frameId: this.frameIdValue } })
    )
    this.frameTarget.src = `${url.pathname}${url.search}`
  }

  closeSingularSavePicker(event) {
    if (event) event.preventDefault()
    if (!this.hasSingularSavePickerValue || !this.hasFrameTarget) return

    this.element.classList.remove("content-window--singular-save-picker")
    if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
    if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true

    if (this.hasSavePickerLayerTarget && this.hasSavePickerIframeTarget) {
      this.#dismissSingularSavePickerLayer()
      return
    }

    this.frameTarget.src = this.currentUrl
  }

  #showSingularSavePickerLayer(src) {
    if (!this.hasSavePickerLayerTarget || !this.hasSavePickerIframeTarget) return
    this.savePickerIframeTarget.src = src
    this.savePickerLayerTarget.hidden = false
    this.savePickerLayerTarget.setAttribute("aria-hidden", "false")
  }

  #dismissSingularSavePickerLayer() {
    if (!this.hasSavePickerLayerTarget || !this.hasSavePickerIframeTarget) return
    this.savePickerLayerTarget.hidden = true
    this.savePickerLayerTarget.setAttribute("aria-hidden", "true")
    this.savePickerIframeTarget.removeAttribute("src")
  }

  handleSingularSavePickerClose(event) {
    const { frameId, saved, documentId } = event.detail || {}
    if (frameId !== this.frameIdValue) return

    if (saved) this.clearSingularPickerDraftSnapshot()

    if (saved && documentId != null) {
      const u = new URL(this.buildAppUrl({ blank: false }), window.location.origin)
      u.searchParams.set("document_id", String(documentId))
      this.currentUrl = `${u.pathname}${u.search}`
    }

    this.closeSingularSavePicker()
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
      this.currentUrl = this.buildAppUrl({ blank: this.isSingularApp() })
      try {
        if (this.isSingularApp() && this.hasFrameIdValue) {
          window.sessionStorage.removeItem(`nexus.singularLinkedDocument.${this.frameIdValue}`)
        }
      } catch (_) {}
      this.clearOpenFileBadge()
      if (this.isSingularApp() && this.hasFrameTarget) {
        this.frameTarget.removeAttribute("src")
        void this.frameTarget.offsetWidth
      }
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
    this.element.classList.remove("content-window--focus-pulse", "content-window--focus-pulse-static")
    void this.element.offsetWidth
    this.element.classList.add("content-window--focus-pulse-static")
    if (this.attentionTimer) clearTimeout(this.attentionTimer)
    this.attentionTimer = window.setTimeout(() => {
      this.element.classList.remove("content-window--focus-pulse", "content-window--focus-pulse-static")
    }, 200)
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
    if (this.hasSingularSavePickerValue && this.element.classList.contains("content-window--singular-save-picker")) {
      this.element.classList.remove("content-window--singular-save-picker")
      if (this.hasChromeAppToolsTarget) this.chromeAppToolsTarget.hidden = false
      if (this.hasChromePickerToolsTarget) this.chromePickerToolsTarget.hidden = true
      this.#dismissSingularSavePickerLayer()
    }
    this.saveOpenState(false)
    this.element.classList.add("is-hidden")
    this.emitWindowState(false)
  }

  ensureFrameLoaded() {
    if (!this.hasFrameTarget) return
    if (this.frameTarget.getAttribute("src") === this.currentUrl) return
    this.frameTarget.src = this.currentUrl
  }

  isSingularApp() {
    return this.appKeyValue === "singular-task-list"
  }

  /** Finder-linked document windows (Tasks, Audio) share sessionStorage restore + title badge. */
  isLinkedDocumentApp() {
    return this.appKeyValue === "singular-task-list" || this.appKeyValue === "loops"
  }

  buildAppUrl(options = {}) {
    const url = new URL(this.appUrlValue, window.location.origin)
    if (this.hasFrameIdValue) url.searchParams.set("frame_id", this.frameIdValue)
    if (this.isSingularApp() && options.blank === true) {
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

  /** Minimum viewport `left` (shell inset + open side panel block). */
  effectiveLeftBoundary() {
    const panelBlockEnd = getDesktopSidePanelBlockEndPx()
    return panelBlockEnd > this.dockLeftBoundary ? panelBlockEnd : this.dockLeftBoundary
  }

  panelIsOpen() {
    return getDesktopSidePanelBlockEndPx() > this.dockLeftBoundary
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
    if (this.element.classList.contains("is-hidden")) return
    if (this.activeDrag || this.activeResize) return

    const detail = event?.detail || {}
    const nextBlockEnd = Number.isFinite(detail.blockEnd) ? detail.blockEnd : this.effectiveLeftBoundary()
    const prevBlockEnd = Number.isFinite(this._lastSidePanelBlockEnd) ? this._lastSidePanelBlockEnd : nextBlockEnd
    this._lastSidePanelBlockEnd = nextBlockEnd

    const current = this.currentLocalBounds()
    let left = Math.max(this.dockLeftBoundary, current.left)
    let top = Math.max(this.viewportMargin, current.top)

    if (detail.open) {
      if (left < nextBlockEnd) left = nextBlockEnd
    } else {
      const visible = this.visibleShellBounds()
      const targetLeftToFitInView = Math.max(
        this.dockLeftBoundary,
        visible.right - this.viewportMargin - current.width
      )
      
      // Check if window currently fits in visible area
      const windowRight = left + current.width + this.viewportMargin
      const fitsInView = windowRight <= visible.right
      
      if (!fitsInView) {
        // Window is scrolled off-screen; aggressively pull it left to fit
        left = targetLeftToFitInView
      } else {
        // Window already fits; shift left by reclaimed space if available
        const reclaimed = Math.max(0, prevBlockEnd - nextBlockEnd)
        if (reclaimed > 0) {
          left = Math.max(this.dockLeftBoundary, left - reclaimed)
        }
      }
    }

    this.element.style.left = `${Math.round(left)}px`
    this.element.style.top = `${Math.round(top)}px`
    this.ensureDesktopCanvasContainsBounds({ left, top, width: current.width, height: current.height })
    this.syncDesktopCanvasDimensions()
    this.saveWindowBounds()
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
    if (this.appKeyValue === "loops") {
      event.preventDefault()
      return
    }
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
    const panelBlockEnd = this.effectiveLeftBoundary()
    if (this.panelIsOpen() && left < panelBlockEnd) left = panelBlockEnd

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

  emitTaskListAddTask(event) {
    if (event) event.preventDefault()
    if (this.appKeyValue !== "singular-task-list") return
    window.dispatchEvent(
      new CustomEvent("nexus:task-list-add-task", {
        detail: { frameId: this.hasFrameIdValue ? this.frameIdValue : "singular-task-list-pane" }
      })
    )
  }

  emitWindowState(isOpen) {
    const rect = this.element.getBoundingClientRect()
    const z = Number.parseInt(this.element.style.zIndex || window.getComputedStyle(this.element).zIndex, 10)
    window.dispatchEvent(new CustomEvent("app-window:state", {
      detail: {
        appKey: this.appKeyValue,
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
