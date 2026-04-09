import { Controller } from "@hotwired/stimulus"
import { observeContent } from "lib/os_window_sizing"

/** New sticky: 9 spectrum hues × 3 soft saturations × 3 light brightness tiers (pastel-friendly). */
const STICKY_SPAWN_HUES = [0, 40, 80, 120, 160, 200, 240, 280, 320]
const STICKY_SPAWN_SATURATIONS = [34, 44, 54]
const STICKY_SPAWN_BRIGHTNESSES = [72, 77, 83]

/** Excel-style fixed palette for sticky fill (HSL). */
const STICKY_FILL_PRESETS = [
  { h: 48, s: 96, b: 76 },
  { h: 352, s: 70, b: 78 },
  { h: 268, s: 55, b: 76 },
  { h: 200, s: 72, b: 78 },
  { h: 160, s: 52, b: 72 },
  { h: 120, s: 45, b: 70 },
  { h: 28, s: 92, b: 72 },
  { h: 0, s: 65, b: 76 },
  { h: 88, s: 50, b: 74 },
  { h: 308, s: 55, b: 78 }
]

/** Theme-style text colors (Excel-like standard colors). */
const STICKY_TEXT_PRESETS = [
  "#FFFFFF",
  "#000000",
  "#C00000",
  "#FFC000",
  "#FFFF00",
  "#00B050",
  "#0070C0",
  "#002060",
  "#7030A0",
  "#7F7F7F"
]

const DEFAULT_STICKY_TEXT_COLOR = "#FFFFFF"

function normalizeStickyTextColor(raw) {
  if (raw == null || raw === "") return DEFAULT_STICKY_TEXT_COLOR
  let s = String(raw).trim()
  if (!s.startsWith("#")) s = `#${s}`
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    const r = s[1]
    const g = s[2]
    const b = s[3]
    s = `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toUpperCase()
  return DEFAULT_STICKY_TEXT_COLOR
}

export default class extends Controller {
  static targets = [
    "contentShell",
    "canvas",
    "grid",
    "gridToggle",
    "gridIconOn",
    "gridIconOff",
    "stickyColorAnchor",
    "stickySelection",
    "colorPopover",
    "fillSwatchGrid",
    "textColorAnchor",
    "textColorSelection",
    "textColorPopover",
    "textSwatchGrid",
    "deleteAnchor",
    "minimap",
    "minimapBitmap",
    "minimapViewport",
    "interactionToggle",
    "interactionIconPan",
    "interactionIconSelect"
  ]

  static values = {
    columns: { type: Number, default: 75 },
    rows: { type: Number, default: 75 },
    stickies: { type: Array, default: [] },
    saveUrl: { type: String, default: "" },
    /** When true, empty-canvas drag draws a selection marquee; when false (default), it pans. */
    selectMode: { type: Boolean, default: false },
    /** Saved zoom / pan from server: { zoom?, panX?, panY? } */
    viewport: { type: Object, default: {} }
  }

  connect() {
    this.syncQueued = false
    this.syncFrame = null
    this.saveTimer = null
    this.stickyZCounter = 0
    this.activeStickyDrag = null
    this.activeStickyResize = null
    this.selection = new Set()
    this.pendingStickyPointer = null
    this.activeMarquee = null
    this.marqueeEl = null
    this.boundMarqueeMove = null
    this.boundMarqueeEnd = null
    this.fillColorPopoverOpen = false
    this.textColorPopoverOpen = false
    this.pendingStickyAppearanceSave = false
    this.zoomValue = 1
    this.panX = 0
    this.panY = 0
    this.applySavedViewportFromValue()
    this.activeCanvasPan = null
    this._minimapHideTimer = null
    this.boundCanvasPanMove = (e) => this.handleCanvasPanMove(e)
    this.boundCanvasPanEnd = () => this.stopCanvasPan()
    this.boundWindowResize = this.queueSync.bind(this)
    this.boundContentShellMouseDown = (event) => this.handleContentShellPointerDown(event)
    this.boundContentShellTouchStart = (event) => this.handleContentShellPointerDown(event)
    this.boundDocumentPointerDown = (event) => this.handleDocumentPointerDown(event)
    this.boundDocumentPointerDownClearSelection = (event) =>
      this.handleDocumentPointerDownClearSelection(event)
    this.boundContentShellWheel = (event) => this.handleContentShellWheel(event)
    this.boundRequestSave = (event) => this.handleRequestSave(event)
    document.addEventListener("nexus:request-save", this.boundRequestSave)

    this.gridObserver = observeContent("singular-sticky-notes", this.contentShellTarget, () => {
      this.queueSync()
    })

    window.addEventListener("resize", this.boundWindowResize)
    this.contentShellTarget.addEventListener("mousedown", this.boundContentShellMouseDown)
    this.contentShellTarget.addEventListener("touchstart", this.boundContentShellTouchStart, { passive: false })
    this.contentShellTarget.addEventListener("wheel", this.boundContentShellWheel, { passive: false })
    document.addEventListener("mousedown", this.boundDocumentPointerDown)
    document.addEventListener("touchstart", this.boundDocumentPointerDown, { passive: true })
    document.addEventListener("mousedown", this.boundDocumentPointerDownClearSelection, true)
    document.addEventListener("touchstart", this.boundDocumentPointerDownClearSelection, { passive: true, capture: true })
    this.boundStickyNotesAddFromChrome = (e) => this.handleStickyNotesAddFromChrome(e)
    window.addEventListener("nexus:sticky-notes-add-sticky", this.boundStickyNotesAddFromChrome)

    // Load grid visibility state from localStorage, default to visible.
    const gridVisible = this.loadGridState() !== false
    if (gridVisible) {
      this.gridTarget.classList.remove("sticky-notes-grid--hidden")
    } else {
      this.gridTarget.classList.add("sticky-notes-grid--hidden")
    }
    this.syncGridToggleUi()
    this.loadSelectModePreference()
    this.syncInteractionToggleUi()

    this.renderGrid()
    this.buildFillSwatches()
    this.buildTextSwatches()
    this.syncStickySelectionButton()
    this.clampPan()
    this.applyViewportTransform()
    this.queueSync()

    // Render any previously saved stickies after the first grid metrics sync
    window.requestAnimationFrame(() => {
      this.stickiesValue.forEach(data => this.renderSticky(data))
    })
  }

  disconnect() {
    document.removeEventListener("nexus:request-save", this.boundRequestSave)
    if (this.gridObserver) this.gridObserver.disconnect()
    if (this.syncFrame) window.cancelAnimationFrame(this.syncFrame)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.stopCanvasPan()
    if (this._minimapHideTimer) {
      clearTimeout(this._minimapHideTimer)
      this._minimapHideTimer = null
    }
    this.hideMinimap({ immediate: true })
    window.removeEventListener("resize", this.boundWindowResize)
    this.contentShellTarget.removeEventListener("mousedown", this.boundContentShellMouseDown)
    this.contentShellTarget.removeEventListener("touchstart", this.boundContentShellTouchStart)
    this.contentShellTarget.removeEventListener("wheel", this.boundContentShellWheel)
    document.removeEventListener("mousedown", this.boundDocumentPointerDown)
    document.removeEventListener("touchstart", this.boundDocumentPointerDown)
    document.removeEventListener("mousedown", this.boundDocumentPointerDownClearSelection, true)
    document.removeEventListener("touchstart", this.boundDocumentPointerDownClearSelection, { capture: true })
    window.removeEventListener("nexus:sticky-notes-add-sticky", this.boundStickyNotesAddFromChrome)
    this.stopMarquee(null, true)
    this.stopPendingStickyPointer()
  }

  handleRequestSave(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id) return
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.saveToServer()
  }

  // ── Grid toggle ─────────────────────────────────────────────────────────────

  toggleGrid() {
    const isVisible = !this.gridTarget.classList.contains("sticky-notes-grid--hidden")
    this.gridTarget.classList.toggle("sticky-notes-grid--hidden", isVisible)
    this.syncGridToggleUi()
    this.saveGridState(!isVisible)
  }

  syncGridToggleUi() {
    const gridVisible = !this.gridTarget.classList.contains("sticky-notes-grid--hidden")
    if (this.hasGridIconOnTarget && this.hasGridIconOffTarget) {
      // Full grid icon when grid is off (prompts "Show Grid"); slashed when on ("Hide Grid").
      this.gridIconOnTarget.hidden = gridVisible
      this.gridIconOffTarget.hidden = !gridVisible
    }
    if (this.hasGridToggleTarget) {
      const label = gridVisible ? "Hide Grid" : "Show Grid"
      this.gridToggleTarget.setAttribute("aria-label", label)
      this.gridToggleTarget.setAttribute("title", label)
    }
  }

  loadGridState() {
    try {
      const stored = localStorage.getItem("sticky-notes-grid-visible")
      return stored === null ? true : JSON.parse(stored)
    } catch (e) {
      return true
    }
  }

  saveGridState(isVisible) {
    try {
      localStorage.setItem("sticky-notes-grid-visible", JSON.stringify(isVisible))
    } catch (e) {
      // Silently fail if localStorage is unavailable
    }
  }

  // ── Pan vs selection (empty canvas drag) ───────────────────────────────────

  loadSelectModePreference() {
    try {
      const stored = localStorage.getItem("sticky-notes-select-mode")
      if (stored === "true") this.selectModeValue = true
      else if (stored === "false") this.selectModeValue = false
    } catch (e) {
      /* ignore */
    }
  }

  saveSelectModePreference() {
    try {
      localStorage.setItem("sticky-notes-select-mode", this.selectModeValue ? "true" : "false")
    } catch (e) {
      /* ignore */
    }
  }

  toggleSelectMode() {
    this.selectModeValue = !this.selectModeValue
    this.saveSelectModePreference()
    this.syncInteractionToggleUi()
  }

  syncInteractionToggleUi() {
    const selectMode = this.selectModeValue
    if (this.hasInteractionIconSelectTarget && this.hasInteractionIconPanTarget) {
      // Pan mode: show “select” icon (click to switch); select mode: show “pan” icon.
      this.interactionIconSelectTarget.hidden = selectMode
      this.interactionIconPanTarget.hidden = !selectMode
    }
    if (this.hasInteractionToggleTarget) {
      const label = selectMode ? "Switch to pan mode" : "Switch to selection mode"
      this.interactionToggleTarget.setAttribute("aria-label", label)
      this.interactionToggleTarget.setAttribute("title", label)
    }
  }

  handleContentShellWheel(event) {
    if (event.target.closest(".sticky-notes-sticky.is-editing .sticky-notes-sticky-content")) return
    const dy = event.deltaY
    if (dy === 0) return
    event.preventDefault()
    if (dy < 0) this.zoomIn()
    else this.zoomOut()
  }

  // ── Sticky notes ─────────────────────────────────────────────────────────────

  handleStickyNotesAddFromChrome(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id) return
    this.addSticky()
  }

  addSticky() {
    const maxW = Math.min(20, Math.max(1, this.columnsValue))
    const maxH = Math.min(20, Math.max(1, this.rowsValue))
    const minW = Math.min(6, maxW)
    const minH = Math.min(6, maxH)

    const maxSide = Math.min(20, maxW, maxH)
    const minSide = Math.min(6, maxSide)
    const side = this.randomInt(minSide, maxSide)
    let cols = Math.min(maxW, Math.max(minW, side))
    let rows = Math.min(maxH, Math.max(minH, side + this.randomInt(-1, 1)))
    if (Math.abs(cols - rows) > 2) {
      const m = Math.round((cols + rows) / 2)
      cols = Math.min(maxW, Math.max(minW, m))
      rows = Math.min(maxH, Math.max(minH, m))
    }

    const maxCol = Math.max(0, this.columnsValue - cols)
    const maxRow = Math.max(0, this.rowsValue - rows)
    const col = this.pickRandomEvenCentered(maxCol)
    const row = this.pickRandomEvenCentered(maxRow)

    const hue = STICKY_SPAWN_HUES[this.randomInt(0, STICKY_SPAWN_HUES.length - 1)]
    const saturation = STICKY_SPAWN_SATURATIONS[this.randomInt(0, STICKY_SPAWN_SATURATIONS.length - 1)]
    const brightness = STICKY_SPAWN_BRIGHTNESSES[this.randomInt(0, STICKY_SPAWN_BRIGHTNESSES.length - 1)]

    const el = this.renderSticky({ col, row, cols, rows, text: "", hue, saturation, brightness })
    this.selectSticky(el)
    this.scheduleSave()
  }

  randomInt(min, max) {
    const lo = Math.min(min, max)
    const hi = Math.max(min, max)
    return lo + Math.floor(Math.random() * (hi - lo + 1))
  }

  /** Random even index in [0, maxInclusive] for 2-cell grid alignment. */
  pickRandomEven(maxInclusive) {
    if (maxInclusive <= 0) return 0
    const evens = []
    for (let i = 0; i <= maxInclusive; i += 2) evens.push(i)
    return evens[this.randomInt(0, evens.length - 1)]
  }

  /** Random even col/row biased toward the center (not edge-to-edge — ~±18% of span from center). */
  pickRandomEvenCentered(maxInclusive) {
    if (maxInclusive <= 0) return 0
    let min = 0
    let max = maxInclusive
    if (maxInclusive > 4) {
      const c = maxInclusive / 2
      const span = maxInclusive * 0.18
      min = Math.max(0, Math.floor(c - span))
      max = Math.min(maxInclusive, Math.ceil(c + span))
      if (min > max) {
        min = 0
        max = maxInclusive
      }
    }
    return this.pickRandomEvenInRange(min, max)
  }

  pickRandomEvenInRange(minIn, maxIn) {
    const min = Math.min(minIn, maxIn)
    const max = Math.max(minIn, maxIn)
    const evens = []
    for (let i = min; i <= max; i += 1) {
      if (i % 2 === 0) evens.push(i)
    }
    if (evens.length === 0) return this.pickRandomEven(max)
    return evens[this.randomInt(0, evens.length - 1)]
  }

  renderSticky({ col, row, cols, rows, text, hue, saturation, brightness, text_color }) {
    const el = document.createElement("div")
    el.classList.add("sticky-notes-sticky")
    el.dataset.stickyCol = String(col)
    el.dataset.stickyRow = String(row)
    el.dataset.stickyCols = String(cols)
    el.dataset.stickyRows = String(rows)
    el.dataset.stickyHue = String(Number.isFinite(parseInt(hue, 10)) ? parseInt(hue, 10) : 45)
    el.dataset.stickySaturation = String(Number.isFinite(parseInt(saturation, 10)) ? parseInt(saturation, 10) : 92)
    el.dataset.stickyBrightness = String(Number.isFinite(parseInt(brightness, 10)) ? parseInt(brightness, 10) : 68)
    el.dataset.stickyTextColor = normalizeStickyTextColor(text_color)
    this.applyStickyPosition(el)

    const content = document.createElement("div")
    content.classList.add("sticky-notes-sticky-content")
    content.setAttribute("contenteditable", "false")
    content.setAttribute("spellcheck", "false")
    if (text) content.textContent = text
    el.appendChild(content)
    this.applyStickyTextColor(el)

    const host = this.hasCanvasTarget ? this.canvasTarget : this.contentShellTarget
    host.appendChild(el)
    this.bringToFront(el)

    el.addEventListener("mousedown", (e) => this.handleStickyNotePointerDown(e, el))
    el.addEventListener("touchstart", (e) => this.handleStickyNotePointerDown(e, el), { passive: false })

    el.addEventListener("dblclick", () => {
      this.selection.clear()
      this.selection.add(el)
      this.syncSelectionClasses()
      this.syncStickySelectionButton()
      this.startEditSticky(el)
    })

    return el
  }

  handleContentShellPointerDown(event) {
    if (event.target.closest(".sticky-notes-sticky")) return
    if (event.target.closest(".sticky-notes-action-shell")) return

    const panGesture = event.button === 1 || event.altKey
    if (panGesture) {
      this.clearStickySelection(true)
      this.startCanvasPan(event)
      return
    }
    if (event.button !== undefined && event.button !== 0) return

    this.clearStickySelection(true)
    if (this.selectModeValue) {
      this.startMarquee(event)
    } else {
      this.startCanvasPan(event)
    }
  }

  handleStickyNotePointerDown(event, el) {
    if (el.classList.contains("is-editing")) return

    this.stopStickyEditing()

    const edgeInfo = this.getResizeEdgeInfo(el, event)
    if (edgeInfo.hasEdge) {
      this.setSelectionSingle(el)
      this.startStickyResize(event, el, edgeInfo)
      return
    }

    event.stopPropagation()
    if (event.button !== undefined && event.button !== 0) return

    const additive = event.shiftKey
    if (additive) {
      this.toggleStickyInSelection(el)
    } else if (!this.selection.has(el)) {
      this.selection.clear()
      this.selection.add(el)
    }
    this.syncSelectionClasses()
    this.syncStickySelectionButton()
    this.selection.forEach((node) => this.bringToFront(node))

    const coords = this.getEventCoords(event)
    this.pendingStickyPointer = {
      startX: coords.x,
      startY: coords.y,
      stickies: Array.from(this.selection),
      pointerId: event.pointerId
    }

    this.boundPendingStickyMove = (e) => this.handlePendingStickyPointerMove(e)
    this.boundPendingStickyUp = (e) => this.handlePendingStickyPointerUp(e)
    document.addEventListener("mousemove", this.boundPendingStickyMove)
    document.addEventListener("mouseup", this.boundPendingStickyUp)
    document.addEventListener("touchmove", this.boundPendingStickyMove, { passive: false })
    document.addEventListener("touchend", this.boundPendingStickyUp)
    if (event.cancelable) event.preventDefault()
  }

  handlePendingStickyPointerMove(event) {
    if (!this.pendingStickyPointer) return
    if (event.touches) event.preventDefault()
    const coords = this.getEventCoords(event)
    const dx = coords.x - this.pendingStickyPointer.startX
    const dy = coords.y - this.pendingStickyPointer.startY
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
    const stickies = this.pendingStickyPointer.stickies
    this.stopPendingStickyPointer()
    this.startGroupDrag(event, stickies)
  }

  handlePendingStickyPointerUp() {
    this.stopPendingStickyPointer()
  }

  stopPendingStickyPointer() {
    if (this.boundPendingStickyMove) {
      document.removeEventListener("mousemove", this.boundPendingStickyMove)
      document.removeEventListener("mouseup", this.boundPendingStickyUp)
      document.removeEventListener("touchmove", this.boundPendingStickyMove)
      document.removeEventListener("touchend", this.boundPendingStickyUp)
      this.boundPendingStickyMove = null
      this.boundPendingStickyUp = null
    }
    this.pendingStickyPointer = null
  }

  setSelectionSingle(el) {
    this.selection.clear()
    this.selection.add(el)
    this.syncSelectionClasses()
    this.syncStickySelectionButton()
  }

  toggleStickyInSelection(el) {
    if (this.selection.has(el)) this.selection.delete(el)
    else this.selection.add(el)
    this.syncSelectionClasses()
    this.syncStickySelectionButton()
  }

  syncSelectionClasses() {
    if (!this.hasCanvasTarget) return
    this.canvasTarget.querySelectorAll(".sticky-notes-sticky").forEach((node) => {
      node.classList.toggle("is-selected", this.selection.has(node))
    })
  }

  startMarquee(event) {
    const shell = this.contentShellTarget.getBoundingClientRect()
    const coords = this.getEventCoords(event)
    const x0 = coords.x - shell.left
    const y0 = coords.y - shell.top

    this.activeMarquee = { x0, y0, x1: x0, y1: y0 }

    if (!this.marqueeEl) {
      this.marqueeEl = document.createElement("div")
      this.marqueeEl.className = "sticky-notes-marquee"
      this.marqueeEl.setAttribute("aria-hidden", "true")
      this.contentShellTarget.appendChild(this.marqueeEl)
    }
    this.marqueeEl.hidden = false
    this.updateMarqueeElement()

    this.boundMarqueeMove = (e) => this.handleMarqueeMove(e)
    this.boundMarqueeEnd = (e) => this.stopMarquee(e)
    document.addEventListener("mousemove", this.boundMarqueeMove)
    document.addEventListener("mouseup", this.boundMarqueeEnd)
    document.addEventListener("touchmove", this.boundMarqueeMove, { passive: false })
    document.addEventListener("touchend", this.boundMarqueeEnd)
    if (event.cancelable) event.preventDefault()
  }

  handleMarqueeMove(event) {
    if (!this.activeMarquee) return
    if (event.touches) event.preventDefault()
    const shell = this.contentShellTarget.getBoundingClientRect()
    const coords = this.getEventCoords(event)
    this.activeMarquee.x1 = coords.x - shell.left
    this.activeMarquee.y1 = coords.y - shell.top
    this.updateMarqueeElement()
  }

  updateMarqueeElement() {
    if (!this.marqueeEl || !this.activeMarquee) return
    const { x0, y0, x1, y1 } = this.activeMarquee
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    const width = Math.abs(x1 - x0)
    const height = Math.abs(y1 - y0)
    this.marqueeEl.style.left = `${left}px`
    this.marqueeEl.style.top = `${top}px`
    this.marqueeEl.style.width = `${width}px`
    this.marqueeEl.style.height = `${height}px`
  }

  stopMarquee(event, cancelled = false) {
    if (this.boundMarqueeMove) {
      document.removeEventListener("mousemove", this.boundMarqueeMove)
      document.removeEventListener("mouseup", this.boundMarqueeEnd)
      document.removeEventListener("touchmove", this.boundMarqueeMove)
      document.removeEventListener("touchend", this.boundMarqueeEnd)
    }
    this.boundMarqueeMove = null
    this.boundMarqueeEnd = null

    if (this.marqueeEl) this.marqueeEl.hidden = true

    if (!cancelled && this.activeMarquee && this.marqueeEl && this.hasCanvasTarget) {
      const shell = this.contentShellTarget.getBoundingClientRect()
      const { x0, y0, x1, y1 } = this.activeMarquee
      const mw = Math.abs(x1 - x0)
      const mh = Math.abs(y1 - y0)
      if (mw >= 3 || mh >= 3) {
      const left = Math.min(x0, x1)
      const top = Math.min(y0, y1)
      const right = Math.max(x0, x1)
      const bottom = Math.max(y0, y1)
      const marqueeRect = {
        left: shell.left + left,
        top: shell.top + top,
        right: shell.left + right,
        bottom: shell.top + bottom
      }

      const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)

      if (!event?.shiftKey) this.selection.clear()

      this.canvasTarget.querySelectorAll(".sticky-notes-sticky").forEach((el) => {
        const r = el.getBoundingClientRect()
        const stickyRect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        if (intersects(stickyRect, marqueeRect)) this.selection.add(el)
      })
      this.syncSelectionClasses()
      this.syncStickySelectionButton()
      }
    }

    this.activeMarquee = null
  }

  /** Click/touch outside this app (dock, other windows) clears selection and ends edit. */
  handleDocumentPointerDownClearSelection(event) {
    if (this.element.contains(event.target)) return
    this.clearStickySelection(true)
  }

  handleDocumentPointerDown(event) {
    if (!this.fillColorPopoverOpen && !this.textColorPopoverOpen) return

    const target = event.target
    if (this.hasStickyColorAnchorTarget && this.stickyColorAnchorTarget.contains(target)) return
    if (this.hasColorPopoverTarget && this.colorPopoverTarget.contains(target)) return
    if (this.hasTextColorAnchorTarget && this.textColorAnchorTarget.contains(target)) return
    if (this.hasTextColorPopoverTarget && this.textColorPopoverTarget.contains(target)) return
    if (this.fillColorPopoverOpen) this.closeStickyColorPopover(true)
    if (this.textColorPopoverOpen) this.closeTextColorPopover(true)
  }

  getPrimarySelected() {
    return this.selection.size > 0 ? this.selection.values().next().value : null
  }

  selectSticky(el) {
    this.setSelectionSingle(el)
  }

  /** End contenteditable on any note; blur fires save handler on the sticky. */
  stopStickyEditing() {
    if (!this.hasCanvasTarget) return
    this.canvasTarget.querySelectorAll(".sticky-notes-sticky.is-editing").forEach((el) => {
      const content = el.querySelector(".sticky-notes-sticky-content")
      if (content) content.blur()
    })
  }

  clearStickySelection(commitAppearance = false) {
    this.stopStickyEditing()
    if (this.selection.size === 0) {
      this.closeStickyColorPopover(commitAppearance)
      this.closeTextColorPopover(commitAppearance)
      this.syncStickySelectionButton()
      return
    }
    this.selection.clear()
    this.syncSelectionClasses()
    this.closeStickyColorPopover(commitAppearance)
    this.closeTextColorPopover(commitAppearance)
    this.syncStickySelectionButton()
  }

  syncStickySelectionButton() {
    const primary = this.getPrimarySelected()
    const hasSelection = Boolean(primary)

    if (this.hasStickyColorAnchorTarget) {
      this.stickyColorAnchorTarget.classList.toggle("sticky-notes-action-btn--hidden", !hasSelection)
    }
    if (this.hasTextColorAnchorTarget) {
      this.textColorAnchorTarget.classList.toggle("sticky-notes-action-btn--hidden", !hasSelection)
    }
    if (this.hasDeleteAnchorTarget) {
      this.deleteAnchorTarget.classList.toggle("sticky-notes-action-btn--hidden", !hasSelection)
    }
    if (this.hasStickySelectionTarget) {
      this.stickySelectionTarget.setAttribute("aria-hidden", String(!hasSelection))
      this.stickySelectionTarget.tabIndex = hasSelection ? 0 : -1
    }
    if (this.hasTextColorSelectionTarget) {
      this.textColorSelectionTarget.setAttribute("aria-hidden", String(!hasSelection))
      this.textColorSelectionTarget.tabIndex = hasSelection ? 0 : -1
    }

    if (!hasSelection) {
      this.stickySelectionTarget.style.removeProperty("--sticky-hue")
      this.stickySelectionTarget.style.removeProperty("--sticky-saturation")
      this.stickySelectionTarget.style.removeProperty("--sticky-brightness")
      this.stickySelectionTarget.style.removeProperty("--window-ui-hue")
      this.stickySelectionTarget.style.removeProperty("--window-ui-saturation")
      this.stickySelectionTarget.style.removeProperty("--window-ui-brightness")
      if (this.hasTextColorSelectionTarget) {
        this.textColorSelectionTarget.style.removeProperty("color")
      }
      if (this.hasColorPopoverTarget) {
        this.colorPopoverTarget.style.removeProperty("--sticky-hue")
        this.colorPopoverTarget.style.removeProperty("--sticky-saturation")
        this.colorPopoverTarget.style.removeProperty("--sticky-brightness")
        this.colorPopoverTarget.style.removeProperty("--window-ui-hue")
        this.colorPopoverTarget.style.removeProperty("--window-ui-saturation")
        this.colorPopoverTarget.style.removeProperty("--window-ui-brightness")
      }
      this.syncFillSwatchSelection(null)
      this.syncTextSwatchSelection(null)
      return
    }

    const rawHue = parseInt(primary.dataset.stickyHue, 10)
    const hue = Number.isFinite(rawHue) ? rawHue : 45
    const rawSaturation = parseInt(primary.dataset.stickySaturation, 10)
    const saturation = Number.isFinite(rawSaturation) ? rawSaturation : 92
    const rawBrightness = parseInt(primary.dataset.stickyBrightness, 10)
    const brightness = Number.isFinite(rawBrightness) ? rawBrightness : 68
    const textHex = normalizeStickyTextColor(primary.dataset.stickyTextColor)

    const syncColorVars = (el) => {
      if (!el) return
      el.style.setProperty("--sticky-hue", String(hue))
      el.style.setProperty("--sticky-saturation", String(saturation))
      el.style.setProperty("--sticky-brightness", String(brightness))
      el.style.setProperty("--window-ui-hue", String(hue))
      el.style.setProperty("--window-ui-saturation", `${saturation}%`)
      el.style.setProperty("--window-ui-brightness", `${brightness}%`)
    }

    syncColorVars(this.stickySelectionTarget)
    if (this.hasColorPopoverTarget) syncColorVars(this.colorPopoverTarget)
    if (this.hasTextColorSelectionTarget) {
      this.textColorSelectionTarget.style.setProperty("color", textHex)
    }
    this.syncFillSwatchSelection({ h: hue, s: saturation, b: brightness })
    this.syncTextSwatchSelection(textHex)
  }

  buildFillSwatches() {
    if (!this.hasFillSwatchGridTarget) return
    this.fillSwatchGridTarget.replaceChildren()
    STICKY_FILL_PRESETS.forEach((p) => {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "sticky-notes-color-swatch"
      btn.style.background = `hsl(${p.h}, ${p.s}%, ${p.b}%)`
      btn.dataset.stickyFillH = String(p.h)
      btn.dataset.stickyFillS = String(p.s)
      btn.dataset.stickyFillB = String(p.b)
      btn.setAttribute("aria-label", "Sticky fill color")
      btn.addEventListener("click", (e) => this.pickFillPreset(e))
      this.fillSwatchGridTarget.appendChild(btn)
    })
  }

  buildTextSwatches() {
    if (!this.hasTextSwatchGridTarget) return
    this.textSwatchGridTarget.replaceChildren()
    STICKY_TEXT_PRESETS.forEach((hex) => {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "sticky-notes-color-swatch"
      btn.style.background = hex
      btn.dataset.stickyTextHex = hex
      btn.setAttribute("aria-label", "Text color")
      btn.addEventListener("click", (e) => this.pickTextPreset(e))
      this.textSwatchGridTarget.appendChild(btn)
    })
  }

  syncFillSwatchSelection(preset) {
    if (!this.hasFillSwatchGridTarget) return
    this.fillSwatchGridTarget.querySelectorAll("button").forEach((btn) => {
      const match =
        preset != null &&
        parseInt(btn.dataset.stickyFillH, 10) === preset.h &&
        parseInt(btn.dataset.stickyFillS, 10) === preset.s &&
        parseInt(btn.dataset.stickyFillB, 10) === preset.b
      btn.classList.toggle("sticky-notes-color-swatch--selected", Boolean(match))
    })
  }

  syncTextSwatchSelection(hex) {
    if (!this.hasTextSwatchGridTarget) return
    const normalized = hex == null ? null : normalizeStickyTextColor(hex)
    this.textSwatchGridTarget.querySelectorAll("button").forEach((btn) => {
      const match = normalized != null && normalizeStickyTextColor(btn.dataset.stickyTextHex) === normalized
      btn.classList.toggle("sticky-notes-color-swatch--selected", Boolean(match))
    })
  }

  pickFillPreset(event) {
    event.preventDefault()
    event.stopPropagation()
    if (this.selection.size === 0) return

    const btn = event.currentTarget
    const h = parseInt(btn.dataset.stickyFillH, 10)
    const s = parseInt(btn.dataset.stickyFillS, 10)
    const b = parseInt(btn.dataset.stickyFillB, 10)
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(b)) return

    this.selection.forEach((el) => {
      el.dataset.stickyHue = String(h)
      el.dataset.stickySaturation = String(s)
      el.dataset.stickyBrightness = String(b)
      this.applyStickyPosition(el)
    })
    this.syncStickySelectionButton()
    this.pendingStickyAppearanceSave = true
  }

  pickTextPreset(event) {
    event.preventDefault()
    event.stopPropagation()
    if (this.selection.size === 0) return

    const hex = normalizeStickyTextColor(event.currentTarget.dataset.stickyTextHex)
    this.selection.forEach((el) => {
      el.dataset.stickyTextColor = hex
      this.applyStickyTextColor(el)
    })
    this.syncStickySelectionButton()
    this.pendingStickyAppearanceSave = true
  }

  applyStickyTextColor(el) {
    const content = el.querySelector(".sticky-notes-sticky-content")
    if (!content) return
    const hex = normalizeStickyTextColor(el.dataset.stickyTextColor)
    el.dataset.stickyTextColor = hex
    content.style.color = hex
  }

  toggleStickyColorPopover(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!this.getPrimarySelected()) return

    if (this.fillColorPopoverOpen) {
      this.closeStickyColorPopover(true)
      return
    }

    if (this.textColorPopoverOpen) this.closeTextColorPopover(false)

    const primary = this.getPrimarySelected()
    const hue = parseInt(primary.dataset.stickyHue, 10) || 45
    const saturation = parseInt(primary.dataset.stickySaturation, 10) || 92
    const brightness = parseInt(primary.dataset.stickyBrightness, 10) || 68
    this.syncFillSwatchSelection({ h: hue, s: saturation, b: brightness })
    this.fillColorPopoverOpen = true
    this.colorPopoverTarget.classList.remove("sticky-notes-action-btn--hidden")
    this.colorPopoverTarget.setAttribute("aria-hidden", "false")
  }

  toggleTextColorPopover(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!this.getPrimarySelected()) return

    if (this.textColorPopoverOpen) {
      this.closeTextColorPopover(true)
      return
    }

    if (this.fillColorPopoverOpen) this.closeStickyColorPopover(false)

    const textHex = normalizeStickyTextColor(this.getPrimarySelected().dataset.stickyTextColor)
    this.syncTextSwatchSelection(textHex)
    this.textColorPopoverOpen = true
    this.textColorPopoverTarget.classList.remove("sticky-notes-action-btn--hidden")
    this.textColorPopoverTarget.setAttribute("aria-hidden", "false")
  }

  closeStickyColorPopover(commitAppearance = false) {
    if (!this.fillColorPopoverOpen) return

    this.fillColorPopoverOpen = false
    if (this.hasColorPopoverTarget) {
      this.colorPopoverTarget.classList.add("sticky-notes-action-btn--hidden")
      this.colorPopoverTarget.setAttribute("aria-hidden", "true")
    }

    if (commitAppearance) {
      if (this.pendingStickyAppearanceSave) this.scheduleSave()
      this.pendingStickyAppearanceSave = false
    }
  }

  closeTextColorPopover(commitAppearance = false) {
    if (!this.textColorPopoverOpen) return

    this.textColorPopoverOpen = false
    if (this.hasTextColorPopoverTarget) {
      this.textColorPopoverTarget.classList.add("sticky-notes-action-btn--hidden")
      this.textColorPopoverTarget.setAttribute("aria-hidden", "true")
    }

    if (commitAppearance) {
      if (this.pendingStickyAppearanceSave) this.scheduleSave()
      this.pendingStickyAppearanceSave = false
    }
  }

  deleteSelectedStickies(event) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    if (this.selection.size === 0) return
    const count = this.selection.size
    const message =
      count === 1
        ? "Are you sure you want to delete this sticky note?"
        : `Are you sure you want to delete ${count} sticky notes?`
    if (!window.confirm(message)) return
    this.selection.forEach((el) => el.remove())
    this.selection.clear()
    this.syncSelectionClasses()
    this.syncStickySelectionButton()
    this.scheduleSave()
  }

  startEditSticky(el) {
    const content = el.querySelector(".sticky-notes-sticky-content")
    if (!content) return

    el.classList.add("is-editing")
    content.setAttribute("contenteditable", "true")
    content.focus()

    const selection = window.getSelection()
    if (selection) {
      const range = document.createRange()
      range.selectNodeContents(content)
      range.collapse(false)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    content.addEventListener("blur", () => {
      content.setAttribute("contenteditable", "false")
      el.classList.remove("is-editing")
      this.scheduleSave()
    }, { once: true })

    content.addEventListener("keydown", (e) => {
      if (e.key === "Escape") content.blur()
    }, { once: true })
  }

  applyStickyPosition(el) {
    el.style.setProperty("--sticky-col", el.dataset.stickyCol)
    el.style.setProperty("--sticky-row", el.dataset.stickyRow)
    el.style.setProperty("--sticky-cols", el.dataset.stickyCols)
    el.style.setProperty("--sticky-rows", el.dataset.stickyRows)
    el.style.setProperty("--sticky-hue", el.dataset.stickyHue || "45")
    el.style.setProperty("--sticky-saturation", el.dataset.stickySaturation || "92")
    el.style.setProperty("--sticky-brightness", el.dataset.stickyBrightness || "68")
  }

  startGroupDrag(event, stickies) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.stopCanvasPan()
    stickies.forEach((el) => this.bringToFront(el))

    const coords = this.getEventCoords(event)

    this.activeStickyDrag = {
      items: stickies.map((el) => ({
        el,
        startCol: parseInt(el.dataset.stickyCol, 10) || 0,
        startRow: parseInt(el.dataset.stickyRow, 10) || 0,
        cols: parseInt(el.dataset.stickyCols, 10) || 10,
        rows: parseInt(el.dataset.stickyRows, 10) || 10
      })),
      startMouseX: coords.x,
      startMouseY: coords.y,
      dragStarted: false
    }

    this.boundStickyDragMove = (e) => this.handleStickyDragMove(e)
    this.boundStickyDragEnd = () => this.stopStickyDrag()
    document.addEventListener("mousemove", this.boundStickyDragMove)
    document.addEventListener("mouseup", this.boundStickyDragEnd)
    document.addEventListener("touchmove", this.boundStickyDragMove, { passive: false })
    document.addEventListener("touchend", this.boundStickyDragEnd)
  }

  handleStickyDragMove(event) {
    if (!this.activeStickyDrag) return
    if (event.touches) event.preventDefault()

    const { items, startMouseX, startMouseY } = this.activeStickyDrag
    const coords = this.getEventCoords(event)
    const dx = coords.x - startMouseX
    const dy = coords.y - startMouseY

    if (!this.activeStickyDrag.dragStarted) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      this.activeStickyDrag.dragStarted = true
      items.forEach(({ el }) => el.classList.add("is-dragging"))
    }

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const z = this.zoomValue
    const cellW = (shellRect.width / this.columnsValue) * z
    const cellH = (shellRect.height / this.rowsValue) * z

    let deltaCol = Math.round(dx / cellW)
    let deltaRow = Math.round(dy / cellH)

    // Clamp one shared delta so the whole selection stays in-bounds without squashing spacing.
    let colMin = -Infinity
    let colMax = Infinity
    let rowMin = -Infinity
    let rowMax = Infinity
    for (const { startCol, startRow, cols, rows: rowSpan } of items) {
      colMin = Math.max(colMin, -startCol)
      colMax = Math.min(colMax, this.columnsValue - cols - startCol)
      rowMin = Math.max(rowMin, -startRow)
      rowMax = Math.min(rowMax, this.rowsValue - rowSpan - startRow)
    }
    deltaCol = Math.max(colMin, Math.min(colMax, deltaCol))
    deltaRow = Math.max(rowMin, Math.min(rowMax, deltaRow))

    items.forEach(({ el, startCol, startRow, cols, rows }) => {
      const newCol = startCol + deltaCol
      const newRow = startRow + deltaRow
      el.dataset.stickyCol = String(newCol)
      el.dataset.stickyRow = String(newRow)
      this.applyStickyPosition(el)
    })
  }

  stopStickyDrag() {
    if (!this.activeStickyDrag) return
    if (this.activeStickyDrag.dragStarted) {
      this.activeStickyDrag.items.forEach(({ el }) => el.classList.remove("is-dragging"))
      this.scheduleSave()
    }
    this.activeStickyDrag = null
    document.removeEventListener("mousemove", this.boundStickyDragMove)
    document.removeEventListener("mouseup", this.boundStickyDragEnd)
    document.removeEventListener("touchmove", this.boundStickyDragMove)
    document.removeEventListener("touchend", this.boundStickyDragEnd)
  }

  getResizeEdgeInfo(el, event) {
    const EDGE_MARGIN = 12
    const rect = el.getBoundingClientRect()
    const coords = this.getEventCoords(event)
    const dx = coords.x - rect.left
    const dy = coords.y - rect.top

    const isLeft = dx < EDGE_MARGIN
    const isRight = dx > rect.width - EDGE_MARGIN
    const isTop = dy < EDGE_MARGIN
    const isBottom = dy > rect.height - EDGE_MARGIN

    return {
      hasEdge: isLeft || isRight || isTop || isBottom,
      isLeft,
      isRight,
      isTop,
      isBottom
    }
  }

  startStickyResize(event, el, edgeInfo) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.stopCanvasPan()
    this.bringToFront(el)

    const coords = this.getEventCoords(event)

    this.activeStickyResize = {
      el,
      startMouseX: coords.x,
      startMouseY: coords.y,
      startCols: parseInt(el.dataset.stickyCols, 10) || 10,
      startRows: parseInt(el.dataset.stickyRows, 10) || 10,
      startCol: parseInt(el.dataset.stickyCol, 10) || 0,
      startRow: parseInt(el.dataset.stickyRow, 10) || 0,
      isLeft: edgeInfo.isLeft,
      isRight: edgeInfo.isRight,
      isTop: edgeInfo.isTop,
      isBottom: edgeInfo.isBottom
    }

    el.classList.add("is-resizing")

    this.boundStickyResizeMove = (e) => this.handleStickyResizeMove(e)
    this.boundStickyResizeEnd = () => this.stopStickyResize()
    document.addEventListener("mousemove", this.boundStickyResizeMove)
    document.addEventListener("mouseup", this.boundStickyResizeEnd)
    document.addEventListener("touchmove", this.boundStickyResizeMove, { passive: false })
    document.addEventListener("touchend", this.boundStickyResizeEnd)
  }

  handleStickyResizeMove(event) {
    if (!this.activeStickyResize) return
    if (event.touches) event.preventDefault()

    const { el, startMouseX, startMouseY, startCols, startRows, startCol, startRow, isLeft, isRight, isTop, isBottom } = this.activeStickyResize
    const coords = this.getEventCoords(event)
    const dx = coords.x - startMouseX
    const dy = coords.y - startMouseY

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const z = this.zoomValue
    const cellW = (shellRect.width / this.columnsValue) * z
    const cellH = (shellRect.height / this.rowsValue) * z

    let newCol = startCol
    let newRow = startRow
    let newCols = startCols
    let newRows = startRows

    if (isLeft) {
      const deltaCol = Math.round(dx / cellW)
      newCol = Math.max(0, startCol + deltaCol)
      newCols = Math.max(2, startCols - deltaCol)
    }
    if (isRight) {
      const deltaCol = Math.round(dx / cellW)
      newCols = Math.max(2, startCols + deltaCol)
    }
    if (isTop) {
      const deltaRow = Math.round(dy / cellH)
      newRow = Math.max(0, startRow + deltaRow)
      newRows = Math.max(2, startRows - deltaRow)
    }
    if (isBottom) {
      const deltaRow = Math.round(dy / cellH)
      newRows = Math.max(2, startRows + deltaRow)
    }

    newCol = Math.max(0, Math.min(newCol, this.columnsValue - newCols))
    newRow = Math.max(0, Math.min(newRow, this.rowsValue - newRows))

    el.dataset.stickyCol = String(newCol)
    el.dataset.stickyRow = String(newRow)
    el.dataset.stickyCols = String(newCols)
    el.dataset.stickyRows = String(newRows)
    this.applyStickyPosition(el)
  }

  stopStickyResize() {
    if (!this.activeStickyResize) return
    this.activeStickyResize.el.classList.remove("is-resizing")
    this.scheduleSave()
    this.activeStickyResize = null
    document.removeEventListener("mousemove", this.boundStickyResizeMove)
    document.removeEventListener("mouseup", this.boundStickyResizeEnd)
    document.removeEventListener("touchmove", this.boundStickyResizeMove)
    document.removeEventListener("touchend", this.boundStickyResizeEnd)
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveToServer(), 600)
  }

  saveToServer() {
    if (!this.hasSaveUrlValue || !this.saveUrlValue) return Promise.resolve()

    const frame = this.element.closest("turbo-frame")
    const frameId = frame?.id

    const stickies = Array.from(
      this.contentShellTarget.querySelectorAll(".sticky-notes-sticky")
    ).map(el => ({
      col: parseInt(el.dataset.stickyCol, 10) || 0,
      row: parseInt(el.dataset.stickyRow, 10) || 0,
      cols: parseInt(el.dataset.stickyCols, 10) || 10,
      rows: parseInt(el.dataset.stickyRows, 10) || 10,
      hue: parseInt(el.dataset.stickyHue, 10) || 45,
      saturation: parseInt(el.dataset.stickySaturation, 10) || 92,
      brightness: parseInt(el.dataset.stickyBrightness, 10) || 68,
      text_color: normalizeStickyTextColor(el.dataset.stickyTextColor),
      text: el.querySelector(".sticky-notes-sticky-content")?.innerText || ""
    }))

    const payload = {
      stickies,
      zoom: this.zoomValue,
      panX: this.panX,
      panY: this.panY
    }

    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    return fetch(this.saveUrlValue, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ stickies: JSON.stringify(payload) })
    })
      .then(async (res) => {
        if (!res.ok) return
        const json = await res.json().catch(() => ({}))
        const ts = (json.updated_at || "").toString().trim() || new Date().toISOString()
        window.dispatchEvent(
          new CustomEvent("nexus:item-saved", {
            detail: { itemType: json.item_type || "stickynotes", timestamp: ts }
          })
        )
        document.dispatchEvent(
          new CustomEvent("nexus:sticky-save-complete", { bubbles: true, detail: { frameId } })
        )
        this.requestWorkspaceDiskFlush()
      })
      .catch(() => {})
  }

  requestWorkspaceDiskFlush() {
    const token = document.querySelector("meta[name='csrf-token']")?.content || ""
    if (!token) return
    void fetch("/apps/workspace/flush_disk", {
      method: "POST",
      headers: {
        "X-CSRF-Token": token,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin"
    }).catch(() => {})
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  bringToFront(el) {
    this.stickyZCounter += 1
    el.style.zIndex = String(this.stickyZCounter)
  }

  getEventCoords(event) {
    if (event.touches && event.touches.length > 0) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }
    return { x: event.clientX, y: event.clientY }
  }

  // ── Viewport zoom / pan ─────────────────────────────────────────────────────

  applySavedViewportFromValue() {
    const v = this.viewportValue
    if (!v || typeof v !== "object") return
    if (typeof v.zoom === "number" && Number.isFinite(v.zoom)) {
      const z = Math.min(2.5, Math.max(1, v.zoom))
      this.zoomValue = Math.round(z * 100) / 100
    }
    if (typeof v.panX === "number" && Number.isFinite(v.panX)) this.panX = v.panX
    if (typeof v.panY === "number" && Number.isFinite(v.panY)) this.panY = v.panY
  }

  zoomIn() {
    this.zoomValue = Math.min(2.5, Math.round((this.zoomValue + 0.25) * 100) / 100)
    this.clampPan()
    this.applyViewportTransform()
    this.queueSync()
    this.showMinimap()
    this.scheduleMinimapHide(1100)
    this.scheduleSave()
  }

  zoomOut() {
    const next = Math.max(1, Math.round((this.zoomValue - 0.25) * 100) / 100)
    if (next === this.zoomValue) return
    this.zoomValue = next
    this.clampPan()
    this.applyViewportTransform()
    this.queueSync()
    this.showMinimap()
    this.scheduleMinimapHide(1100)
    this.scheduleSave()
  }

  clampPan() {
    const shell = this.contentShellTarget.getBoundingClientRect()
    const z = Math.max(this.zoomValue, 0.01)
    const W = shell.width
    const H = shell.height
    const scaledW = W * z
    const scaledH = H * z
    const maxPanX = Math.min(0, W - scaledW)
    const maxPanY = Math.min(0, H - scaledH)
    this.panX = Math.max(maxPanX, Math.min(0, this.panX))
    this.panY = Math.max(maxPanY, Math.min(0, this.panY))
  }

  applyViewportTransform() {
    if (this.hasCanvasTarget && this.hasContentShellTarget) {
      const shell = this.contentShellTarget.getBoundingClientRect()
      const z = Math.max(this.zoomValue, 0.01)
      const w = Math.max(0, shell.width)
      const h = Math.max(0, shell.height)
      this.canvasTarget.style.width = `${w * z}px`
      this.canvasTarget.style.height = `${h * z}px`
      this.canvasTarget.style.transform = `translate(${this.panX}px, ${this.panY}px)`
      this.canvasTarget.style.transformOrigin = "0 0"
    }
    this.updateMinimap()
  }

  showMinimap() {
    if (this._minimapHideTimer) {
      clearTimeout(this._minimapHideTimer)
      this._minimapHideTimer = null
    }
    if (this.hasMinimapTarget) {
      this.minimapTarget.classList.add("sticky-notes-minimap--visible")
      this.minimapTarget.setAttribute("aria-hidden", "false")
    }
  }

  scheduleMinimapHide(delayMs = 850) {
    if (this._minimapHideTimer) clearTimeout(this._minimapHideTimer)
    this._minimapHideTimer = setTimeout(() => {
      this._minimapHideTimer = null
      this.hideMinimap()
    }, delayMs)
  }

  hideMinimap({ immediate = false } = {}) {
    if (!this.hasMinimapTarget) return
    if (immediate) this.minimapTarget.classList.add("sticky-notes-minimap--no-transition")
    this.minimapTarget.classList.remove("sticky-notes-minimap--visible")
    this.minimapTarget.setAttribute("aria-hidden", "true")
    if (immediate) {
      requestAnimationFrame(() => this.minimapTarget.classList.remove("sticky-notes-minimap--no-transition"))
    }
  }

  updateMinimap() {
    if (!this.hasMinimapViewportTarget || !this.hasContentShellTarget) return
    const shell = this.contentShellTarget.getBoundingClientRect()
    const W = shell.width
    const H = shell.height
    if (W <= 0 || H <= 0) return
    const z = Math.max(this.zoomValue, 0.01)
    const vw = Math.min(1, 1 / z)
    const vh = Math.min(1, 1 / z)
    let left = (-this.panX / z) / W
    let top = (-this.panY / z) / H
    left = Math.max(0, Math.min(1 - vw, left))
    top = Math.max(0, Math.min(1 - vh, top))
    const vp = this.minimapViewportTarget
    vp.style.left = `${left * 100}%`
    vp.style.top = `${top * 100}%`
    vp.style.width = `${Math.min(1 - left, vw) * 100}%`
    vp.style.height = `${Math.min(1 - top, vh) * 100}%`
    this.drawMinimapBitmapPreview()
  }

  /** Low-res overview of grid + note colors (matches logical layout, not zoom). */
  drawMinimapBitmapPreview() {
    if (!this.hasMinimapBitmapTarget || !this.hasCanvasTarget) return
    const inner = this.minimapBitmapTarget.parentElement
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    const dpr = window.devicePixelRatio || 1
    const canvas = this.minimapBitmapTarget
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = "rgb(36, 38, 44)"
    ctx.fillRect(0, 0, w, h)

    const cols = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const step = Math.max(1, Math.floor(cols / 14))
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)"
    ctx.lineWidth = 1
    for (let i = 0; i <= cols; i += step) {
      const x = (i / cols) * w
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, h)
      ctx.stroke()
    }
    for (let j = 0; j <= rows; j += step) {
      const y = (j / rows) * h
      ctx.beginPath()
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(w, y + 0.5)
      ctx.stroke()
    }

    this.canvasTarget.querySelectorAll(".sticky-notes-sticky").forEach((el) => {
      const col = parseInt(el.dataset.stickyCol, 10) || 0
      const row = parseInt(el.dataset.stickyRow, 10) || 0
      const cw = parseInt(el.dataset.stickyCols, 10) || 2
      const rh = parseInt(el.dataset.stickyRows, 10) || 2
      const hue = parseInt(el.dataset.stickyHue, 10) || 45
      const sat = parseInt(el.dataset.stickySaturation, 10) || 92
      const bri = parseInt(el.dataset.stickyBrightness, 10) || 68
      const x = (col / cols) * w
      const y = (row / rows) * h
      const ww = (cw / cols) * w
      const hh = (rh / rows) * h
      const rad = Math.min(8, ww * 0.14, hh * 0.14)
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${bri}%)`
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath()
        ctx.roundRect(x, y, Math.max(1, ww), Math.max(1, hh), rad)
        ctx.fill()
      } else {
        ctx.fillRect(x, y, Math.max(1, ww), Math.max(1, hh))
      }
    })
  }

  startCanvasPan(event) {
    if (this.activeCanvasPan) return
    const coords = this.getEventCoords(event)
    this.activeCanvasPan = {
      startX: coords.x,
      startY: coords.y,
      startPanX: this.panX,
      startPanY: this.panY,
      moved: false
    }
    document.addEventListener("mousemove", this.boundCanvasPanMove)
    document.addEventListener("mouseup", this.boundCanvasPanEnd)
    document.addEventListener("touchmove", this.boundCanvasPanMove, { passive: false })
    document.addEventListener("touchend", this.boundCanvasPanEnd)
    if (event.cancelable) event.preventDefault()
    this.contentShellTarget.classList.add("sticky-notes-content-shell--pan-armed")
  }

  handleCanvasPanMove(event) {
    if (!this.activeCanvasPan) return
    if (event.touches) event.preventDefault()
    const coords = this.getEventCoords(event)
    const dx = coords.x - this.activeCanvasPan.startX
    const dy = coords.y - this.activeCanvasPan.startY
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      if (!this.activeCanvasPan.moved) this.showMinimap()
      this.activeCanvasPan.moved = true
      this.contentShellTarget.classList.add("sticky-notes-content-shell--is-panning")
    }
    this.panX = this.activeCanvasPan.startPanX + dx
    this.panY = this.activeCanvasPan.startPanY + dy
    this.clampPan()
    this.applyViewportTransform()
  }

  stopCanvasPan() {
    if (!this.activeCanvasPan) return
    const panMoved = this.activeCanvasPan.moved
    this.activeCanvasPan = null
    document.removeEventListener("mousemove", this.boundCanvasPanMove)
    document.removeEventListener("mouseup", this.boundCanvasPanEnd)
    document.removeEventListener("touchmove", this.boundCanvasPanMove)
    document.removeEventListener("touchend", this.boundCanvasPanEnd)
    this.contentShellTarget.classList.remove("sticky-notes-content-shell--pan-armed", "sticky-notes-content-shell--is-panning")
    if (panMoved) {
      this.scheduleMinimapHide(750)
      this.scheduleSave()
    }
  }

  renderGrid() {
    if (!this.hasGridTarget) return

    const columns = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const vertical = []
    const horizontal = []

    for (let i = 0; i <= columns; i += 1) {
      vertical.push(`<line x1="${i}" y1="0" x2="${i}" y2="${rows}" />`)
    }
    for (let i = 0; i <= rows; i += 1) {
      horizontal.push(`<line x1="0" y1="${i}" x2="${columns}" y2="${i}" />`)
    }

    this.gridTarget.innerHTML = `
      <svg class="sticky-notes-grid-svg" viewBox="0 0 ${columns} ${rows}" preserveAspectRatio="none" aria-hidden="true">
        <g class="sticky-notes-grid-lines">
          ${vertical.join("")}
          ${horizontal.join("")}
        </g>
      </svg>
    `
  }

  // ── Grid sizing ──────────────────────────────────────────────────────────────

  queueSync() {
    if (this.syncQueued) return

    this.syncQueued = true
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncQueued = false
      this.syncGridMetrics()
    })
  }

  syncGridMetrics() {
    if (!this.hasContentShellTarget || !this.hasGridTarget) return

    this.applyViewportTransform()

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const sw = Math.max(shellRect.width, 0)
    const sh = Math.max(shellRect.height, 0)
    if (this.hasMinimapTarget && sw > 0 && sh > 0) {
      this.minimapTarget.style.setProperty("--sticky-notes-shell-aspect", String(sw / sh))
    }
    const z = Math.max(this.zoomValue, 0.01)
    const width = sw * z
    const height = sh * z
    const columns = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const cellWidth = width > 0 ? width / columns : 0
    const cellHeight = height > 0 ? height / rows : 0
    const columnPercent = 100 / columns
    const rowPercent = 100 / rows

    // Published on contentShellTarget so stickies (siblings of .sticky-notes-grid) inherit them.
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-cell-width", `${cellWidth}px`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-cell-height", `${cellHeight}px`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-columns", String(columns))
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-rows", String(rows))
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-col-percent", `${columnPercent}%`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-row-percent", `${rowPercent}%`)

    this.gridTarget.style.setProperty("--sticky-notes-grid-columns", String(columns))
    this.gridTarget.style.setProperty("--sticky-notes-grid-rows", String(rows))
    this.gridTarget.style.setProperty("--sticky-notes-grid-col-percent", `${columnPercent}%`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-row-percent", `${rowPercent}%`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-cell-width", `${cellWidth}px`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-cell-height", `${cellHeight}px`)

    this.updateMinimap()
  }
}
