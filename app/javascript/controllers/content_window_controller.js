import { Controller } from "@hotwired/stimulus"
import { getNexusDesktopShellInsetPx } from "lib/desktop_shell_metrics"
import { createOsWindowSizer } from "lib/os_window_sizing"
import { syncOrganizerAboveVisibleContentWindows } from "lib/nexus_desktop_layers"
import { clearSingularPickerDraft, SINGULAR_BEFORE_SAVE_PICKER } from "lib/singular_finder_picker_draft"

/** Kept in sync with inline boot script in `shared/_content_windows_boot.html.erb`. */
const DESKTOP_WINDOW_LAYERS_KEY = "nexus.desktop.windowLayers"
/** Match ollama crab DOCK_EDGE_HUG_PX: treat as “touching” within this many px of a viewport edge. */
const BOUNDS_EDGE_HUG_PX = 3
/** Smallest outer size while viewport is smaller than operational minimum (px). */
const VIEWPORT_MIN_WINDOW_PX = 44
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
    return this.dockLeftBoundary
  }

  desktopShellElement() {
    return document.getElementById("desktop-shell")
  }

  desktopWorkAreaSize() {
    const shell = this.desktopShellElement()
    const viewportW = shell ? shell.clientWidth : window.innerWidth
    const viewportH = shell ? shell.clientHeight : window.innerHeight
    const minW = this.effectiveLeftBoundary() + this.desktopMinAppWidth
    const minH = this.desktopMinAppHeight
    return {
      width: Math.max(minW, viewportW),
      height: Math.max(minH, viewportH)
    }
  }

  syncDesktopCanvasDimensions() {
    const shell = this.desktopShellElement()
    const canvas = document.getElementById("desktop-shell-canvas")
    if (!shell || !canvas) return
    const minW = this.desktopMinAppWidth
    const minH = this.desktopMinAppHeight
    canvas.style.minWidth = `${Math.round(minW)}px`
    canvas.style.minHeight = `${Math.round(minH)}px`
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
    const work = this.desktopWorkAreaSize()
    const vw = work.width
    const vh = work.height

    const dock = this.effectiveLeftBoundary()
    const left = Math.min(Math.max(coords.x - this.activeDrag.offsetX, dock), vw - margin - w)
    const top  = Math.min(Math.max(coords.y - this.activeDrag.offsetY, margin), vh - this.bottomDockBoundary - h)

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
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
    const work = this.desktopWorkAreaSize()
    const vw = work.width
    const vh = work.height
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
    const bot = this.bottomDockBoundary
    const minW = this.minWindowWidth
    const minH = this.minWindowHeight

    left = Math.max(dockBound, left)
    top = Math.max(margin, top)
    let maxFitW = vw - margin - left
    let maxFitH = vh - bot - top
    width = Math.min(width, maxFitW)
    height = Math.min(height, maxFitH)

    const viewportFitsMin = maxFitW >= minW && maxFitH >= minH

    if (viewportFitsMin) {
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
      width = Math.min(Math.max(width, minW), vw - margin - left)
      height = Math.min(Math.max(height, minH), vh - bot - top)
      if (left + width > vw - margin) left = vw - margin - width
      if (top + height > vh - bot) top = vh - bot - height
      left = Math.max(dockBound, left)
      top = Math.max(margin, top)
    } else {
      /* Viewport slot smaller than min: still never go below operational min while dragging (browser resize may compress later). */
      width = Math.max(minW, Math.min(width, maxFitW))
      height = Math.max(minH, Math.min(height, maxFitH))
    }

    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
  }

  /**
   * Fit width/height to the viewport from (left, top). Above operational min (and when the slot
   * fits minW×minH), clamp independently. Otherwise keep the **operational min aspect ratio**
   * (minW : minH) so compress/expand tracks the active resize edge instead of freezing one axis.
   *
   * @param {string | null} resizeEdge handle edge during live resize ("right", "bottom-right", …); omit for layout-only calls.
   */
  viewportFitContentDimensions(left, top, w, h, resizeEdge = null) {
    const work = this.desktopWorkAreaSize()
    const iw = work.width
    const ih = work.height
    const m = this.viewportMargin
    const bot = this.bottomDockBoundary
    const minW = this.minWindowWidth
    const minH = this.minWindowHeight
    const slack = MIN_SIZE_SLACK_PX

    /* Transient 0×0 or bad layout during first paint — keep previous size. */
    if (iw < 64 || ih < 64 || !Number.isFinite(left) || !Number.isFinite(top)) {
      return { width: w, height: h }
    }

    const maxFitW = Math.max(VIEWPORT_MIN_WINDOW_PX, iw - m - left)
    const maxFitH = Math.max(VIEWPORT_MIN_WINDOW_PX, ih - bot - top)

    const canSlotFitMin = maxFitW >= minW && maxFitH >= minH
    const userAtOrAboveMin = w + slack >= minW && h + slack >= minH

    if (canSlotFitMin && userAtOrAboveMin) {
      const width = Math.min(Math.max(w, minW), maxFitW)
      const height = Math.min(Math.max(h, minH), maxFitH)
      return { width, height }
    }

    const sMax = Math.min(maxFitW / minW, maxFitH / minH)
    const sMin = Math.max(VIEWPORT_MIN_WINDOW_PX / minW, VIEWPORT_MIN_WINDOW_PX / minH)
    const edge = typeof resizeEdge === "string" ? resizeEdge : ""
    const isCorner = edge.includes("-")
    let s
    if (isCorner) {
      s = Math.min(w / minW, h / minH)
    } else if (edge === "left" || edge === "right") {
      s = w / minW
    } else if (edge === "top" || edge === "bottom") {
      s = h / minH
    } else {
      s = Math.min(w / minW, h / minH)
    }
    if (!Number.isFinite(s) || s <= 0) s = sMin
    s = Math.min(Math.max(s, sMin), sMax)

    const width = minW * s
    const height = minH * s
    return { width, height }
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

  /** Shift top-left so a minW×minH rectangle can fit in the viewport when there is enough global room (drag/resize end — not browser viewport squeeze). */
  nudgePositionForOperationalSlot(left, top, minW, minH, iw, ih, m, dock, bot) {
    const maxLeft = iw - m - minW
    const maxTop = ih - bot - minH
    let l = left
    let t = top
    if (maxLeft >= dock) l = Math.min(Math.max(dock, l), maxLeft)
    else l = dock
    if (maxTop >= m) t = Math.min(Math.max(m, t), maxTop)
    else t = m
    return { left: l, top: t }
  }

  /**
   * Float at a fixed viewport position until an edge would clip the window; then stick to that edge
   * so further viewport resize moves the window with the border. Pins clear when drag/resize starts.
   *
   * @param {{ viewportResize?: boolean }} [options] — Pass `viewportResize: true` only from `window.resize` so compress can run. Drag/resize end uses layout-only reconciliation (min size + nudge).
   */
  reconcileWindowOnViewportResize(options = {}) {
    const viewportResize = options.viewportResize === true
    if (this.element.classList.contains("is-hidden")) return
    if (this.activeDrag || this.activeResize) return

    const iwViewport = window.innerWidth
    const ihViewport = window.innerHeight
    const work = this.desktopWorkAreaSize()
    const iw = work.width
    const ih = work.height
    const prevW = this._viewportResizeW ?? iw
    const prevH = this._viewportResizeH ?? ih
    /* Ignore 1px jitter (mobile URL bar, subpixel) so we don’t re-run pin logic and drift saves. */
    const shrinkX = iwViewport + 2 < prevW
    const shrinkY = ihViewport + 2 < prevH
    this._viewportResizeW = iwViewport
    this._viewportResizeH = ihViewport

    const dock = this.effectiveLeftBoundary()
    const m = this.viewportMargin
    const bot = this.bottomDockBoundary
    const hug = BOUNDS_EDGE_HUG_PX

    const r = this.element.getBoundingClientRect()
    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    const shellRect = shell ? shell.getBoundingClientRect() : { left: 0, top: 0 }
    let w = r.width
    let h = r.height
    let left = r.left - shellRect.left + scrollLeft
    let top = r.top - shellRect.top + scrollTop
    if (w < 1 || h < 1) return

    const minW = this.minWindowWidth
    const minH = this.minWindowHeight

    let pinX = this._boundsPinX
    let pinY = this._boundsPinY

    if (w + dock + m > iw) {
      left = dock
      pinX = "left"
    }
    if (h + m + bot > ih) {
      top = m
      pinY = "top"
    }

    if (shrinkX) {
      if (pinX === "right") {
        left = iw - w - m
      } else if (pinX === "left") {
        left = dock
      } else {
        const overflowRight = left + w > iw - m
        const overflowLeft = left < dock
        const hugLeft = left <= dock + hug
        const hugRight = left + w >= iw - m - hug

        if (overflowLeft && overflowRight) {
          const gapL = left - dock
          const gapR = iw - m - (left + w)
          if (gapL <= gapR) {
            left = dock
            pinX = "left"
          } else {
            left = iw - w - m
            pinX = "right"
          }
        } else if (overflowRight && hugLeft) {
          left = dock
          pinX = "left"
        } else if (overflowLeft && hugRight) {
          left = iw - w - m
          pinX = "right"
        } else if (overflowRight) {
          left = iw - w - m
          pinX = "right"
        } else if (overflowLeft) {
          left = dock
          pinX = "left"
        }
      }
    } else {
      if (left < dock) left = dock
      if (left + w > iw - m) left = iw - w - m
    }

    if (shrinkY) {
      if (pinY === "bottom") {
        top = ih - h - bot
      } else if (pinY === "top") {
        top = m
      } else {
        const overflowBottom = top + h > ih - bot
        const overflowTop = top < m
        const hugTop = top <= m + hug
        const hugBottom = top + h >= ih - bot - hug

        if (overflowTop && overflowBottom) {
          const gapT = top - m
          const gapB = ih - bot - (top + h)
          if (gapT <= gapB) {
            top = m
            pinY = "top"
          } else {
            top = ih - h - bot
            pinY = "bottom"
          }
        } else if (overflowBottom && hugTop) {
          top = m
          pinY = "top"
        } else if (overflowTop && hugBottom) {
          top = ih - h - bot
          pinY = "bottom"
        } else if (overflowBottom) {
          top = ih - h - bot
          pinY = "bottom"
        } else if (overflowTop) {
          top = m
          pinY = "top"
        }
      }
    } else {
      if (top < m) top = m
      if (top + h > ih - bot) top = ih - h - bot
    }

    const maxL = Math.max(dock, iw - w - m)
    const maxT = Math.max(m, ih - h - bot)
    left = Math.min(Math.max(dock, left), maxL)
    top = Math.min(Math.max(m, top), maxT)

    const prefW = Math.max(this.preferredWindowWidth, minW)
    const prefH = Math.max(this.preferredWindowHeight, minH)

    if (viewportResize) {
      const maxFitW = Math.max(VIEWPORT_MIN_WINDOW_PX, iw - m - left)
      const maxFitH = Math.max(VIEWPORT_MIN_WINDOW_PX, ih - bot - top)
      const wTry = Math.min(prefW, maxFitW)
      const hTry = Math.min(prefH, maxFitH)

      const fit = this.viewportFitContentDimensions(left, top, wTry, hTry, null)
      w = fit.width
      h = fit.height
    } else {
      const nudged = this.nudgePositionForOperationalSlot(left, top, minW, minH, iw, ih, m, dock, bot)
      left = nudged.left
      top = nudged.top

      let maxFw = iw - m - left
      let maxFh = ih - bot - top
      w = Math.max(minW, Math.min(prefW, maxFw))
      h = Math.max(minH, Math.min(prefH, maxFh))
      left = Math.min(Math.max(dock, left), iw - m - w)
      top = Math.min(Math.max(m, top), ih - bot - h)
      maxFw = iw - m - left
      maxFh = ih - bot - top
      w = Math.max(minW, Math.min(prefW, maxFw))
      h = Math.max(minH, Math.min(prefH, maxFh))
    }

    this._boundsPinX = pinX
    this._boundsPinY = pinY

    this.element.style.left = `${Math.round(left)}px`
    this.element.style.top = `${Math.round(top)}px`
    if (!this.isAutoSizedWindow) {
      this.element.style.width = `${Math.round(w)}px`
      this.element.style.height = `${Math.round(h)}px`
    }

    this.saveWindowBounds()
  }

  positionWindow() {
    const work = this.desktopWorkAreaSize()
    const vw = work.width
    const vh = work.height
    let width = Math.max(this.minWindowWidth, Math.min(this.windowWidth, vw - 40))
    let height = Math.max(this.minWindowHeight, Math.min(this.windowHeight, vh - 40))

    const shell = this.desktopShellElement()
    const scrollLeft = shell ? shell.scrollLeft : window.scrollX
    const scrollTop = shell ? shell.scrollTop : window.scrollY
    let centeredLeft = Math.round(scrollLeft + ((shell ? shell.clientWidth : window.innerWidth) - width) / 2)
    let centeredTop = Math.round(scrollTop + ((shell ? shell.clientHeight : window.innerHeight) - height) / 2)
    const dock = this.effectiveLeftBoundary()
    let maxLeft = Math.max(dock, vw - this.viewportMargin - width)
    let maxTop = Math.max(this.viewportMargin, vh - this.bottomDockBoundary - height)
    let left = Math.min(Math.max(centeredLeft, dock), maxLeft)
    let top = Math.min(Math.max(centeredTop, this.viewportMargin), maxTop)

    const fit = this.viewportFitContentDimensions(left, top, width, height, null)
    width = fit.width
    height = fit.height
    left = Math.min(Math.max(left, dock), vw - this.viewportMargin - width)
    top = Math.min(Math.max(top, this.viewportMargin), vh - this.bottomDockBoundary - height)
    const fit2 = this.viewportFitContentDimensions(left, top, width, height, null)
    width = fit2.width
    height = fit2.height

    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
    this.element.style.left = `${left}px`
    this.element.style.top = `${top}px`
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
    const work = this.desktopWorkAreaSize()
    const vw = work.width
    const vh = work.height
    const margin = this.viewportMargin
    const dock = this.effectiveLeftBoundary()
    const bot = this.bottomDockBoundary
    let width = bounds.width
    let height = bounds.height
    const maxLeft0 = Math.max(dock, vw - margin - width)
    const maxTop0 = Math.max(margin, vh - bot - height)
    let left = Math.min(Math.max(bounds.left, dock), maxLeft0)
    let top = Math.min(Math.max(bounds.top, margin), maxTop0)

    const fit = this.viewportFitContentDimensions(left, top, width, height, null)
    width = fit.width
    height = fit.height
    left = Math.min(Math.max(left, dock), vw - margin - width)
    top = Math.min(Math.max(top, margin), vh - bot - height)
    const fit2 = this.viewportFitContentDimensions(left, top, width, height, null)
    return { left, top, width: fit2.width, height: fit2.height }
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
