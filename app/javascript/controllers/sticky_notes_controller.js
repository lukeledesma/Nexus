import { Controller } from "@hotwired/stimulus"
import { observeContent } from "lib/os_window_sizing"
import { materialSymbolSvg } from "lib/material_symbols"

/** New sticky: 9 spectrum hues × 3 soft saturations × 3 light brightness tiers (pastel-friendly). */
const STICKY_SPAWN_HUES = [0, 40, 80, 120, 160, 200, 240, 280, 320]
const STICKY_SPAWN_SATURATIONS = [34, 44, 54]
const STICKY_SPAWN_BRIGHTNESSES = [72, 77, 83]

export default class extends Controller {
  static targets = ["contentShell", "canvas", "grid", "gridToggle", "gridIconOn", "gridIconOff", "stickyColorAnchor", "stickySelection", "colorPopover", "colorSlider", "saturationSlider", "brightnessSlider", "minimap", "minimapViewport"]

  static values = {
    columns: { type: Number, default: 75 },
    rows: { type: Number, default: 75 },
    stickies: { type: Array, default: [] },
    saveUrl: { type: String, default: "" }
  }

  connect() {
    this.syncQueued = false
    this.syncFrame = null
    this.saveTimer = null
    this.stickyZCounter = 0
    this.activeStickyDrag = null
    this.activeStickyResize = null
    this.selectedSticky = null
    this.colorPopoverOpen = false
    this.pendingStickyColorSave = false
    this.zoomValue = 1
    this.panX = 0
    this.panY = 0
    this.activeCanvasPan = null
    this._minimapHideTimer = null
    this.boundCanvasPanMove = (e) => this.handleCanvasPanMove(e)
    this.boundCanvasPanEnd = () => this.stopCanvasPan()
    this.boundWindowResize = this.queueSync.bind(this)
    this.boundContentShellMouseDown = (event) => this.handleContentShellPointerDown(event)
    this.boundContentShellTouchStart = (event) => this.handleContentShellPointerDown(event)
    this.boundDocumentPointerDown = (event) => this.handleDocumentPointerDown(event)
    this.boundRequestSave = (event) => this.handleRequestSave(event)
    document.addEventListener("nexus:request-save", this.boundRequestSave)

    this.gridObserver = observeContent("singular-sticky-notes", this.contentShellTarget, () => {
      console.log("[sticky-notes] content shell resized via observer")
      this.queueSync()
    })

    window.addEventListener("resize", this.boundWindowResize)
    this.contentShellTarget.addEventListener("mousedown", this.boundContentShellMouseDown)
    this.contentShellTarget.addEventListener("touchstart", this.boundContentShellTouchStart, { passive: false })
    document.addEventListener("mousedown", this.boundDocumentPointerDown)
    document.addEventListener("touchstart", this.boundDocumentPointerDown, { passive: true })

    // Load grid visibility state from localStorage, default to visible.
    const gridVisible = this.loadGridState() !== false
    if (gridVisible) {
      this.gridTarget.classList.remove("sticky-notes-grid--hidden")
    } else {
      this.gridTarget.classList.add("sticky-notes-grid--hidden")
    }
    this.syncGridToggleUi()

    this.renderGrid()
    this.syncStickySelectionButton()
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
    document.removeEventListener("mousedown", this.boundDocumentPointerDown)
    document.removeEventListener("touchstart", this.boundDocumentPointerDown)
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

  // ── Sticky notes ─────────────────────────────────────────────────────────────

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

  renderSticky({ col, row, cols, rows, text, hue, saturation, brightness }) {
    const el = document.createElement("div")
    el.classList.add("sticky-notes-sticky")
    el.dataset.stickyCol = String(col)
    el.dataset.stickyRow = String(row)
    el.dataset.stickyCols = String(cols)
    el.dataset.stickyRows = String(rows)
    el.dataset.stickyHue = String(Number.isFinite(parseInt(hue, 10)) ? parseInt(hue, 10) : 45)
    el.dataset.stickySaturation = String(Number.isFinite(parseInt(saturation, 10)) ? parseInt(saturation, 10) : 92)
    el.dataset.stickyBrightness = String(Number.isFinite(parseInt(brightness, 10)) ? parseInt(brightness, 10) : 68)
    this.applyStickyPosition(el)

    const deleteBtn = document.createElement("button")
    deleteBtn.classList.add("sticky-notes-sticky-delete-btn")
    deleteBtn.setAttribute("type", "button")
    deleteBtn.setAttribute("aria-label", "Delete sticky note")
    deleteBtn.innerHTML = materialSymbolSvg("close", "xs")
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.deleteSticky(el)
    })
    el.appendChild(deleteBtn)

    const content = document.createElement("div")
    content.classList.add("sticky-notes-sticky-content")
    content.setAttribute("contenteditable", "false")
    content.setAttribute("spellcheck", "false")
    if (text) content.textContent = text
    el.appendChild(content)

    const host = this.hasCanvasTarget ? this.canvasTarget : this.contentShellTarget
    host.appendChild(el)
    this.bringToFront(el)

    el.addEventListener("mousedown", (e) => {
      this.selectSticky(el)
      if (el.classList.contains("is-editing")) return
      const edgeInfo = this.getResizeEdgeInfo(el, e)
      if (edgeInfo.hasEdge) {
        this.startStickyResize(e, el, edgeInfo)
      } else {
        this.startStickyDrag(e, el)
      }
    })
    el.addEventListener("touchstart", (e) => {
      this.selectSticky(el)
      if (el.classList.contains("is-editing")) return
      const edgeInfo = this.getResizeEdgeInfo(el, e)
      if (edgeInfo.hasEdge) {
        this.startStickyResize(e, el, edgeInfo)
      } else {
        this.startStickyDrag(e, el)
      }
    }, { passive: false })

    el.addEventListener("dblclick", () => {
      this.selectSticky(el)
      this.startEditSticky(el)
    })

    return el
  }

  handleContentShellPointerDown(event) {
    if (event.target.closest(".sticky-notes-sticky")) return
    this.clearStickySelection(true)
    if (event.button !== undefined && event.button !== 0) return
    this.startCanvasPan(event)
  }

  handleDocumentPointerDown(event) {
    if (!this.colorPopoverOpen) return

    const target = event.target
    if (this.hasStickyColorAnchorTarget && this.stickyColorAnchorTarget.contains(target)) return
    if (this.hasColorPopoverTarget && this.colorPopoverTarget.contains(target)) return

    this.closeStickyColorPopover(true)
  }

  selectSticky(el) {
    if (this.selectedSticky === el) return

    if (this.selectedSticky) {
      this.selectedSticky.classList.remove("is-selected")
    }

    this.selectedSticky = el
    if (this.selectedSticky) {
      this.selectedSticky.classList.add("is-selected")
    }

    this.syncStickySelectionButton()
  }

  clearStickySelection(commitColor = false) {
    if (!this.selectedSticky) return

    this.selectedSticky.classList.remove("is-selected")
    this.selectedSticky = null
    this.closeStickyColorPopover(commitColor)
    this.syncStickySelectionButton()
  }

  syncStickySelectionButton() {
    const hasSelection = Boolean(this.selectedSticky)

    if (this.hasStickyColorAnchorTarget) {
      this.stickyColorAnchorTarget.classList.toggle("sticky-notes-action-btn--hidden", !hasSelection)
    }
    if (this.hasStickySelectionTarget) {
      this.stickySelectionTarget.setAttribute("aria-hidden", String(!hasSelection))
      this.stickySelectionTarget.tabIndex = hasSelection ? 0 : -1
    }

    if (!hasSelection) {
      this.stickySelectionTarget.style.removeProperty("--sticky-hue")
      this.stickySelectionTarget.style.removeProperty("--sticky-saturation")
      this.stickySelectionTarget.style.removeProperty("--sticky-brightness")
      this.stickySelectionTarget.style.removeProperty("--window-ui-hue")
      this.stickySelectionTarget.style.removeProperty("--window-ui-saturation")
      this.stickySelectionTarget.style.removeProperty("--window-ui-brightness")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--sticky-hue")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--sticky-saturation")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--sticky-brightness")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--window-ui-hue")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--window-ui-saturation")
      if (this.hasColorPopoverTarget) this.colorPopoverTarget.style.removeProperty("--window-ui-brightness")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--sticky-hue")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--sticky-saturation")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--sticky-brightness")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--window-ui-hue")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--window-ui-saturation")
      if (this.hasColorSliderTarget) this.colorSliderTarget.style.removeProperty("--window-ui-brightness")
      if (this.hasSaturationSliderTarget) {
        this.saturationSliderTarget.style.removeProperty("--sticky-hue")
        this.saturationSliderTarget.style.removeProperty("--sticky-saturation")
        this.saturationSliderTarget.style.removeProperty("--sticky-brightness")
        this.saturationSliderTarget.style.removeProperty("--window-ui-hue")
        this.saturationSliderTarget.style.removeProperty("--window-ui-saturation")
        this.saturationSliderTarget.style.removeProperty("--window-ui-brightness")
      }
      if (this.hasBrightnessSliderTarget) {
        this.brightnessSliderTarget.style.removeProperty("--sticky-hue")
        this.brightnessSliderTarget.style.removeProperty("--sticky-saturation")
        this.brightnessSliderTarget.style.removeProperty("--sticky-brightness")
        this.brightnessSliderTarget.style.removeProperty("--window-ui-hue")
        this.brightnessSliderTarget.style.removeProperty("--window-ui-saturation")
        this.brightnessSliderTarget.style.removeProperty("--window-ui-brightness")
      }
      return
    }

    const rawHue = parseInt(this.selectedSticky.dataset.stickyHue, 10)
    const hue = Number.isFinite(rawHue) ? rawHue : 45
    const rawSaturation = parseInt(this.selectedSticky.dataset.stickySaturation, 10)
    const saturation = Number.isFinite(rawSaturation) ? rawSaturation : 92
    const rawBrightness = parseInt(this.selectedSticky.dataset.stickyBrightness, 10)
    const brightness = Number.isFinite(rawBrightness) ? rawBrightness : 68

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
    if (this.hasColorSliderTarget) syncColorVars(this.colorSliderTarget)
    if (this.hasSaturationSliderTarget) syncColorVars(this.saturationSliderTarget)
    if (this.hasBrightnessSliderTarget) syncColorVars(this.brightnessSliderTarget)
    if (this.hasColorSliderTarget) {
      this.colorSliderTarget.value = String(hue)
    }
    if (this.hasSaturationSliderTarget) {
      this.saturationSliderTarget.value = String(saturation)
    }
    if (this.hasBrightnessSliderTarget) {
      this.brightnessSliderTarget.value = String(brightness)
    }
  }

  toggleStickyColorPopover(event) {
    event.preventDefault()
    event.stopPropagation()
    if (!this.selectedSticky) return

    if (this.colorPopoverOpen) {
      this.closeStickyColorPopover(true)
      return
    }

    const hue = parseInt(this.selectedSticky.dataset.stickyHue, 10) || 45
    const saturation = parseInt(this.selectedSticky.dataset.stickySaturation, 10) || 92
    const brightness = parseInt(this.selectedSticky.dataset.stickyBrightness, 10) || 68
    if (this.hasColorSliderTarget) {
      this.colorSliderTarget.value = String(hue)
    }
    if (this.hasSaturationSliderTarget) {
      this.saturationSliderTarget.value = String(saturation)
    }
    if (this.hasBrightnessSliderTarget) {
      this.brightnessSliderTarget.value = String(brightness)
    }
    this.colorPopoverOpen = true
    this.colorPopoverTarget.classList.remove("sticky-notes-action-btn--hidden")
    this.colorPopoverTarget.setAttribute("aria-hidden", "false")
  }

  updateStickyColor(event) {
    if (!this.selectedSticky) return

    const raw = parseInt(event.target.value, 10)
    const hue = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 360)) : 45
    this.selectedSticky.dataset.stickyHue = String(hue)
    this.applyStickyPosition(this.selectedSticky)
    this.syncStickySelectionButton()
    this.pendingStickyColorSave = true
  }

  updateStickySaturation(event) {
    if (!this.selectedSticky) return

    const raw = parseInt(event.target.value, 10)
    const saturation = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 100)) : 92
    this.selectedSticky.dataset.stickySaturation = String(saturation)
    this.applyStickyPosition(this.selectedSticky)
    this.syncStickySelectionButton()
    this.pendingStickyColorSave = true
  }

  updateStickyBrightness(event) {
    if (!this.selectedSticky) return

    const raw = parseInt(event.target.value, 10)
    const brightness = Number.isFinite(raw) ? Math.max(0, Math.min(raw, 100)) : 68
    this.selectedSticky.dataset.stickyBrightness = String(brightness)
    this.applyStickyPosition(this.selectedSticky)
    this.syncStickySelectionButton()
    this.pendingStickyColorSave = true
  }

  closeStickyColorPopover(commitColor = false) {
    if (!this.colorPopoverOpen) return

    this.colorPopoverOpen = false
    if (this.hasColorPopoverTarget) {
      this.colorPopoverTarget.classList.add("sticky-notes-action-btn--hidden")
      this.colorPopoverTarget.setAttribute("aria-hidden", "true")
    }

    if (commitColor && this.pendingStickyColorSave) {
      this.scheduleSave()
    }
    this.pendingStickyColorSave = false
  }

  deleteSticky(el) {
    el.remove()
    if (this.selectedSticky === el) {
      this.clearStickySelection(false)
    }
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

  startStickyDrag(event, el) {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    this.stopCanvasPan()
    this.bringToFront(el)

    const coords = this.getEventCoords(event)

    this.activeStickyDrag = {
      el,
      startMouseX: coords.x,
      startMouseY: coords.y,
      startCol: parseInt(el.dataset.stickyCol, 10) || 0,
      startRow: parseInt(el.dataset.stickyRow, 10) || 0,
      cols: parseInt(el.dataset.stickyCols, 10) || 10,
      rows: parseInt(el.dataset.stickyRows, 10) || 10,
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

    const { el, startMouseX, startMouseY, startCol, startRow, cols, rows } = this.activeStickyDrag
    const coords = this.getEventCoords(event)
    const dx = coords.x - startMouseX
    const dy = coords.y - startMouseY

    if (!this.activeStickyDrag.dragStarted) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      this.activeStickyDrag.dragStarted = true
      el.classList.add("is-dragging")
    }

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const z = this.zoomValue
    const cellW = (shellRect.width / this.columnsValue) * z
    const cellH = (shellRect.height / this.rowsValue) * z
    const rawCol = startCol + dx / cellW
    const rawRow = startRow + dy / cellH
    const newCol = this.snapStickyGridDual(rawCol)
    const newRow = this.snapStickyGridDual(rawRow)

    el.dataset.stickyCol = String(Math.max(0, Math.min(newCol, this.columnsValue - cols)))
    el.dataset.stickyRow = String(Math.max(0, Math.min(newRow, this.rowsValue - rows)))
    this.applyStickyPosition(el)
  }

  stopStickyDrag() {
    if (!this.activeStickyDrag) return
    if (this.activeStickyDrag.dragStarted) {
      this.activeStickyDrag.el.classList.remove("is-dragging")
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
      text: el.querySelector(".sticky-notes-sticky-content")?.innerText || ""
    }))

    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    return fetch(this.saveUrlValue, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ stickies: JSON.stringify(stickies) })
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
      })
      .catch(() => {})
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

  /** Snap sticky origin to 2×2 cell grid (even col/row indices). */
  snapStickyGridDual(value) {
    return Math.round(value / 2) * 2
  }

  // ── Viewport zoom / pan ─────────────────────────────────────────────────────

  zoomIn() {
    this.zoomValue = Math.min(2.5, Math.round((this.zoomValue + 0.25) * 100) / 100)
    this.clampPan()
    this.applyViewportTransform()
    this.queueSync()
    this.showMinimap()
    this.scheduleMinimapHide(1100)
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
    if (this.hasCanvasTarget) {
      this.canvasTarget.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomValue})`
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
    if (panMoved) this.scheduleMinimapHide(750)
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

    console.log("[sticky-notes] queueSync called")
    this.syncQueued = true
    this.syncFrame = window.requestAnimationFrame(() => {
      this.syncQueued = false
      this.syncGridMetrics()
    })
  }

  syncGridMetrics() {
    if (!this.hasContentShellTarget || !this.hasGridTarget) return

    const shellRect = this.contentShellTarget.getBoundingClientRect()
    const width = Math.max(shellRect.width, 0)
    const height = Math.max(shellRect.height, 0)
    const columns = Math.max(this.columnsValue, 1)
    const rows = Math.max(this.rowsValue, 1)
    const cellWidth = width > 0 ? width / columns : 0
    const cellHeight = height > 0 ? height / rows : 0
    const columnPercent = 100 / columns
    const rowPercent = 100 / rows

    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const noteBodyMinPx = rootPx * 0.92
    const scaled = cellHeight * 0.72
    const maxFit = cellHeight * 0.88
    let fontSize = Math.min(Math.max(scaled, noteBodyMinPx), maxFit)
    if (!Number.isFinite(fontSize) || fontSize <= 0) fontSize = noteBodyMinPx
    fontSize *= 1.22

    // Published on contentShellTarget so stickies (siblings of .sticky-notes-grid) inherit them.
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-cell-width", `${cellWidth}px`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-cell-height", `${cellHeight}px`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-columns", String(columns))
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-rows", String(rows))
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-col-percent", `${columnPercent}%`)
    this.contentShellTarget.style.setProperty("--sticky-notes-grid-row-percent", `${rowPercent}%`)
    this.contentShellTarget.style.setProperty("--sticky-notes-sticky-font-size", `${fontSize}px`)

    // Also directly apply font size to all existing sticky content elements
    const stickyContents = this.contentShellTarget.querySelectorAll(".sticky-notes-sticky-content")
    stickyContents.forEach(el => {
      el.style.fontSize = `${fontSize}px`
    })

    this.gridTarget.style.setProperty("--sticky-notes-grid-columns", String(columns))
    this.gridTarget.style.setProperty("--sticky-notes-grid-rows", String(rows))
    this.gridTarget.style.setProperty("--sticky-notes-grid-col-percent", `${columnPercent}%`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-row-percent", `${rowPercent}%`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-cell-width", `${cellWidth}px`)
    this.gridTarget.style.setProperty("--sticky-notes-grid-cell-height", `${cellHeight}px`)

    this.updateMinimap()
  }
}
