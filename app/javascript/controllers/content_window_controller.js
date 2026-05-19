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
/** Legacy device-local localStorage keys; consulted once at first read for migration. */
const LEGACY_TASK_REGISTRY_KEY = "nexus.taskWindowRegistry"

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
const CONTENT_WINDOW_OPEN_ANIMATION_MS = 300
const CONTENT_WINDOW_CLOSE_ANIMATION_MS = 300

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
    hasLinkedAppSavePicker: { type: Boolean, default: false }
  }

  connect() {
    if (!window.__nexusSpawnedTasksByDocumentId) window.__nexusSpawnedTasksByDocumentId = {}
    if (!window.__nexusSpawnedImagesByDocumentId) window.__nexusSpawnedImagesByDocumentId = {}
    if (!window.__nexusSpawnedQuartzByDocumentId) window.__nexusSpawnedQuartzByDocumentId = {}
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
    const clockMin = taskListMin
    const minByAppKey = {
      tasks: taskListMin,
      finder: finderLikeMin,
      calendar: finderLikeMin,
      audio: audioMin,
      images: imagesMin,
      quartz: taskListMin,
      clock: clockMin,
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
    this.openAnimationFrame = null
    this.openAnimationTimer = null
    this.closeAnimationTimer = null
    this._boundsPinX = "none"
    this._boundsPinY = "none"

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundPointerDragMove = this.handleDragMove.bind(this)
    this.boundPointerDragEnd = this.stopDrag.bind(this)
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
    this.boundCloseRequest = this.handleCloseRequest.bind(this)
    window.addEventListener("app-window:close", this.boundCloseRequest)
    this.boundLinkedAppSaved = this.onLinkedAppDocumentSaved.bind(this)
    window.addEventListener("nexus:linked-app-document-saved", this.boundLinkedAppSaved)
    this.boundFinderItemRenamed = this.onFinderItemRenamed.bind(this)
    window.addEventListener("nexus:finder-item-renamed", this.boundFinderItemRenamed)
    this.boundLinkedDocumentUnavailable = this.onLinkedDocumentUnavailable.bind(this)
    window.addEventListener("nexus:linked-document-unavailable", this.boundLinkedDocumentUnavailable)
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
    this.boundEdgeDragPointerDown = this.handleEdgeDragPointerDown.bind(this)
    this.boundEdgeDragPointerMove = this.handleEdgeDragPointerMove.bind(this)
    this.boundEdgeDragPointerLeave = this.handleEdgeDragPointerLeave.bind(this)
    this.installEdgeDragRails()

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
    this.cancelVisibilityAnimation()
    if (this.windowSizer) this.windowSizer.disconnect()
    window.removeEventListener("app-window:toggle", this.boundToggleRequest)
    window.removeEventListener("app-window:open", this.boundOpenRequest)
    if (this.boundFrameLoad && this.hasFrameTarget) this.frameTarget.removeEventListener("turbo:frame-load", this.boundFrameLoad)
    window.removeEventListener("app-window:close", this.boundCloseRequest)
    window.removeEventListener("nexus:task-list-spawn-blank-window", this.boundSpawnBlankTaskWindow)
    window.removeEventListener("nexus:linked-app-document-saved", this.boundLinkedAppSaved)
    window.removeEventListener("nexus:finder-item-renamed", this.boundFinderItemRenamed)
    window.removeEventListener("nexus:linked-document-unavailable", this.boundLinkedDocumentUnavailable)
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
    this.removeEdgeDragRails()
  }

  onTitleShellPointerDown(event) {
    if (!(event.target instanceof Element)) return
    const target = event.target
    if (this.activeResize) return
    if (target.closest(".pane-resize-handle")) return
    if (target.closest(".content-window-close, button, a, input, textarea, select, [role='button']")) return
    if (!target.closest(".content-window-chrome, .content-window-bottom-shell")) return
    this.startDrag(event)
  }

  installEdgeDragRails() {
    if (this.edgeDragRailsElement?.isConnected) return
    const rails = document.createElement("div")
    rails.className = "content-window-drag-rails"
    rails.setAttribute("aria-hidden", "true")

    const ns = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(ns, "svg")
    svg.classList.add("content-window-drag-ghost")

    // High-resolution taper: many tiny path slices with gaussian alpha.
    const taperPaths = []
    const taperSegmentCount = 56
    for (let i = 0; i < taperSegmentCount; i += 1) {
      const taperPath = document.createElementNS(ns, "path")
      taperPath.classList.add("content-window-drag-ghost-taper-path")
      svg.appendChild(taperPath)
      taperPaths.push(taperPath)
    }
    rails.appendChild(svg)

    // 4 edge + 4 corner hit zones: pointerdown to start drag, pointermove to activate ghost
    // when cursor is outside the window's own layout bounds (hit zones extend beyond window)
    for (const zone of ["top", "right", "bottom", "left", "corner-tl", "corner-tr", "corner-br", "corner-bl"]) {
      const hit = document.createElement("div")
      hit.className = `content-window-drag-hit content-window-drag-hit--${zone}`
      hit.addEventListener("pointerdown", this.boundEdgeDragPointerDown)
      hit.addEventListener("pointermove", this.boundEdgeDragPointerMove)
      rails.appendChild(hit)
    }
    // pointermove/pointerleave on the window element avoids ghost flicker when
    // the cursor transitions between adjacent hit zones
    this.element.addEventListener("pointermove", this.boundEdgeDragPointerMove)
    this.element.addEventListener("pointerleave", this.boundEdgeDragPointerLeave)

    this.edgeDragRailsElement = rails
    this.edgeDragTaperPathElements = taperPaths
    this.edgeDragPathElement = taperPaths[0] || null
    this.element.appendChild(rails)
    this.updateEdgeDragPathGeometry()
  }

  removeEdgeDragRails() {
    if (!this.edgeDragRailsElement) return
    this.edgeDragRailsElement
      .querySelectorAll(".content-window-drag-hit")
      .forEach((hit) => {
        hit.removeEventListener("pointerdown", this.boundEdgeDragPointerDown)
        hit.removeEventListener("pointermove", this.boundEdgeDragPointerMove)
      })
    this.element.removeEventListener("pointermove", this.boundEdgeDragPointerMove)
    this.element.removeEventListener("pointerleave", this.boundEdgeDragPointerLeave)
    this.edgeDragRailsElement.remove()
    this.edgeDragRailsElement = null
    this.edgeDragTaperPathElements = null
    this.edgeDragPathElement = null
    this.edgeDragPathMetrics = null
  }

  handleEdgeDragPointerDown(event) {
    if (this.activeResize) return
    if (event.button !== undefined && event.button !== 0) return
    if (event.buttons !== undefined && event.buttons !== 1) return
    if (!this.updateEdgeDragGhost(event)) return
    this.startDrag(event)
  }

  handleEdgeDragPointerMove(event) {
    this.updateEdgeDragGhost(event)
  }

  handleEdgeDragPointerLeave(_event) {
    if (this.activeDrag) return
    this.clearAllEdgeGhosts()
  }

  updateEdgeDragGhost(event) {
    // While dragging, keep the ghost locked at full opacity regardless of cursor distance
    if (this.activeDrag) {
      if (this.edgeDragRailsElement) this.edgeDragRailsElement.classList.add("is-edge-drag-hot")
      return true
    }

    const hit = this.computeEdgePathHit(event)
    if (!hit) {
      this.clearAllEdgeGhosts()
      return false
    }

    if (!this.edgeDragPathElement) return false
    const { offset, strength, totalLength: total, segmentLength: segLen } = hit
    const intensity = strength

    const taperPaths = this.edgeDragTaperPathElements || []
    const visibleLength = Math.min(total - 1, segLen + 38)
    const n = Math.max(1, taperPaths.length)
    const baseSliceLength = visibleLength / n
    const sliceLength = Math.max(1.2, baseSliceLength * 1.55)
    const sigma = 0.27

    const applySlice = (pathElement, centerDistance, length, alpha) => {
      if (!pathElement) return
      const start = ((centerDistance - (length / 2)) % total + total) % total
      const end = start + length
      let dasharray
      let dashoffset
      if (end <= total) {
        dasharray = `${length} ${total - length}`
        dashoffset = String(-start)
      } else {
        const part1 = total - start
        const part2 = length - part1
        const gap = total - length
        dasharray = `${part2} ${gap} ${part1} 0`
        dashoffset = "0"
      }
      pathElement.style.opacity = String(alpha)
      pathElement.style.strokeDasharray = dasharray
      pathElement.style.strokeDashoffset = dashoffset
    }

    for (let i = 0; i < n; i += 1) {
      const pathElement = taperPaths[i]
      const t = n === 1 ? 0.5 : ((i + 0.5) / n)
      const signed = (2 * t) - 1
      const gaussian = Math.exp(-0.5 * Math.pow(signed / sigma, 2))
      const alpha = intensity * gaussian * 0.98
      const centerDistance = (offset - (visibleLength / 2)) + (t * visibleLength)
      applySlice(pathElement, centerDistance, sliceLength, alpha)
    }

    if (this.edgeDragRailsElement) this.edgeDragRailsElement.classList.add("is-edge-drag-hot")
    return true
  }

  computeEdgePathHit(event) {
    if (!this.edgeDragRailsElement || !this.edgeDragPathElement) return null
    const eventTarget = event.target
    if (eventTarget instanceof Element && eventTarget.closest(".pane-resize-handle")) return null
    if (!this.isPointerOutsideWindow(event)) return null

    this.updateEdgeDragPathGeometry()
    const metrics = this.edgeDragPathMetrics
    if (!metrics) return null

    const railsRect = this.edgeDragRailsElement.getBoundingClientRect()
    const localX = event.clientX - railsRect.left
    const localY = event.clientY - railsRect.top
    const nearest = this.nearestRoundedRectPathPoint(localX, localY, metrics)
    if (!nearest) return null

    const hoverBand = 25
    if (nearest.distance > hoverBand) return null
    return {
      offset: nearest.offset,
      distance: nearest.distance,
      strength: 1,
      totalLength: metrics.totalLength,
      segmentLength: 60
    }
  }

  isPointerOutsideWindow(event) {
    const rect = this.element.getBoundingClientRect()
    const x = event.clientX
    const y = event.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
  }

  updateEdgeDragPathGeometry() {
    if (!this.edgeDragRailsElement || !this.edgeDragPathElement) return
    const rect = this.edgeDragRailsElement.getBoundingClientRect()
    const width = Math.max(2, rect.width)
    const height = Math.max(2, rect.height)
    const inset = 9
    const pathWidth = Math.max(2, width - inset * 2)
    const pathHeight = Math.max(2, height - inset * 2)
    const radius = Math.max(1, Math.min(10, (Math.min(pathWidth, pathHeight) / 2) - 0.5))

    const x = inset
    const y = inset
    const d = [
      `M ${x + radius} ${y}`,
      `H ${x + pathWidth - radius}`,
      `A ${radius} ${radius} 0 0 1 ${x + pathWidth} ${y + radius}`,
      `V ${y + pathHeight - radius}`,
      `A ${radius} ${radius} 0 0 1 ${x + pathWidth - radius} ${y + pathHeight}`,
      `H ${x + radius}`,
      `A ${radius} ${radius} 0 0 1 ${x} ${y + pathHeight - radius}`,
      `V ${y + radius}`,
      `A ${radius} ${radius} 0 0 1 ${x + radius} ${y}`
    ].join(" ")

    const svg = this.edgeDragPathElement.ownerSVGElement
    if (svg) svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
    if (Array.isArray(this.edgeDragTaperPathElements)) {
      this.edgeDragTaperPathElements.forEach((taperPath) => taperPath.setAttribute("d", d))
    }
    this.edgeDragPathElement?.setAttribute("d", d)

    const straightH = Math.max(0, pathWidth - radius * 2)
    const straightV = Math.max(0, pathHeight - radius * 2)
    const totalLength = (2 * straightH) + (2 * straightV) + (2 * Math.PI * radius)
    this.edgeDragPathMetrics = {
      x,
      y,
      width: pathWidth,
      height: pathHeight,
      radius,
      totalLength
    }
  }

  nearestRoundedRectPathPoint(localX, localY, metrics) {
    const px = localX - metrics.x
    const py = localY - metrics.y
    const w = metrics.width
    const h = metrics.height
    const r = metrics.radius

    if (w <= 0 || h <= 0) return null

    const topLen = Math.max(0, w - (2 * r))
    const rightLen = Math.max(0, h - (2 * r))
    const quarter = (Math.PI * r) / 2
    const perimeter = metrics.totalLength

    const candidates = []
    const addCandidate = (qx, qy, offset) => {
      const dx = px - qx
      const dy = py - qy
      candidates.push({ distance: Math.hypot(dx, dy), offset })
    }

    // Top edge
    const topX = Math.max(r, Math.min(w - r, px))
    addCandidate(topX, 0, topX - r)

    // Top-right arc
    const tr = this.closestArcPoint(px, py, w - r, r, r, -Math.PI / 2, 0)
    addCandidate(tr.x, tr.y, topLen + ((tr.angle + (Math.PI / 2)) * r))

    // Right edge
    const rightY = Math.max(r, Math.min(h - r, py))
    addCandidate(w, rightY, topLen + quarter + (rightY - r))

    // Bottom-right arc
    const br = this.closestArcPoint(px, py, w - r, h - r, r, 0, Math.PI / 2)
    addCandidate(br.x, br.y, topLen + quarter + rightLen + ((br.angle - 0) * r))

    // Bottom edge (right -> left)
    const bottomX = Math.max(r, Math.min(w - r, px))
    addCandidate(bottomX, h, topLen + quarter + rightLen + quarter + ((w - r) - bottomX))

    // Bottom-left arc
    const bl = this.closestArcPoint(px, py, r, h - r, r, Math.PI / 2, Math.PI)
    addCandidate(bl.x, bl.y, topLen + quarter + rightLen + quarter + topLen + ((bl.angle - (Math.PI / 2)) * r))

    // Left edge (bottom -> top)
    const leftY = Math.max(r, Math.min(h - r, py))
    addCandidate(0, leftY, topLen + quarter + rightLen + quarter + topLen + quarter + ((h - r) - leftY))

    // Top-left arc
    const tl = this.closestArcPoint(px, py, r, r, r, Math.PI, (3 * Math.PI) / 2)
    addCandidate(tl.x, tl.y, topLen + quarter + rightLen + quarter + topLen + quarter + rightLen + ((tl.angle - Math.PI) * r))

    let best = candidates[0]
    for (let i = 1; i < candidates.length; i += 1) {
      if (candidates[i].distance < best.distance) best = candidates[i]
    }

    const wrappedOffset = ((best.offset % perimeter) + perimeter) % perimeter
    return { distance: best.distance, offset: wrappedOffset }
  }

  closestArcPoint(px, py, cx, cy, radius, startAngle, endAngle) {
    let angle = Math.atan2(py - cy, px - cx)
    // Normalize into [startAngle, endAngle] span to handle atan2 wrap-around at ±π
    while (angle < startAngle - 1e-9) angle += 2 * Math.PI
    while (angle > endAngle + 1e-9) angle -= 2 * Math.PI
    angle = Math.max(startAngle, Math.min(endAngle, angle))
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    return { x, y, angle }
  }

  clearAllEdgeGhosts() {
    if (!this.edgeDragPathElement) return
    if (Array.isArray(this.edgeDragTaperPathElements)) {
      this.edgeDragTaperPathElements.forEach((taperPath) => {
        taperPath.style.opacity = "0"
      })
    }
    if (this.edgeDragRailsElement) this.edgeDragRailsElement.classList.remove("is-edge-drag-hot")
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
    const canHandleEmbeddedQuartzOpen =
      this.appKeyValue === "quartz" || this.appKeyValue.startsWith("quartz-spawn-")
    const appKeyMatches =
      appKey === this.appKeyValue ||
      (canHandleEmbeddedTaskOpen && appKey === "tasks") ||
      (canHandleEmbeddedQuartzOpen && appKey === "quartz")
    if (frameId !== this.frameIdValue || !appKeyMatches) return

    // Enforce one-open-instance for saved linked documents when opened from embedded picker.
    if (documentId && canHandleEmbeddedTaskOpen) {
      const docId = String(documentId)
      const existingWindow = this.findVisibleTaskWindowByDocumentId(docId)
      if (existingWindow) {
        this.focusAndFlashWindow(existingWindow)
        return
      }
    }
    if (documentId && canHandleEmbeddedQuartzOpen) {
      const docId = String(documentId)
      const existingWindow = this.findQuartzWindowByDocumentId(docId, { includeHidden: false })
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
      this.hardReloadFrame(this.currentUrl)
    }
  }

  /** Open (or focus) this window and optionally load a Finder document into the frame. */
  handleOpenRequest(event) {
    const { appKey, documentId, documentTitle, forceBlank, isDraft } = event.detail || {}
    if (appKey !== this.appKeyValue) return

    // When a specific document is requested for the linked-app task list window,
    // check if it's already open (spawned window). If so, focus and flash it.
    const isTaskLinkedWindow =
      this.appKeyValue === "tasks" || this.appKeyValue.startsWith("task-spawn-")
    if (documentId && isTaskLinkedWindow) {
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

    if (documentId && this.appKeyValue === "quartz") {
      const docId = String(documentId)
      const existingWindow = this.findQuartzWindowByDocumentId(docId, { includeHidden: true })
      if (existingWindow) {
        this.focusOrOpenWindow(existingWindow)
        return
      }
      const isPrimaryWindowVisible = !this.element.classList.contains("is-hidden")
      if (isPrimaryWindowVisible && (!isDraft || this.shouldSpawnDraftWindow(String(documentId)))) {
        this.spawnQuartzWindow(documentId, documentTitle)
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


    if (this.hasFrameTarget) {
      const mustHardReload =
        Boolean(documentId) ||
        (this.isLinkedApp() && this.currentUrl.includes("blank=1"))
      if (mustHardReload) {
        this.clearFrameForNavigation()
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

  findQuartzWindowByDocumentId(documentId, { includeHidden = true } = {}) {
    const docId = String(documentId || "")
    if (!docId) return null
    const quartzWindows = document.querySelectorAll(
      'section.content-window[data-content-window-app-key-value="quartz"], section.content-window[data-content-window-app-key-value^="quartz-spawn-"]'
    )
    for (const windowEl of quartzWindows) {
      if (!includeHidden && windowEl.classList.contains("is-hidden")) continue
      if (this.windowMatchesLinkedDocumentId(windowEl, docId)) return windowEl
    }
    return null
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

    this.prepareClonedWindowShell(clone, { frameId: uid, title, openOnConnect: true })

    // Offset position so the new window doesn't land exactly on top of the original.
    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`

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

    this.prepareClonedWindowShell(clone, { frameId: uid, title, openOnConnect: true })

    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`

    this.element.parentElement.appendChild(clone)
  }

  spawnQuartzWindow(documentId, documentTitle) {
    const existingWindow = this.findQuartzWindowByDocumentId(documentId, { includeHidden: true })
    if (existingWindow) {
      this.focusOrOpenWindow(existingWindow)
      return
    }

    const uid = `quartz-spawn-${Date.now()}`
    const title = (documentTitle || "").trim()

    try {
      window.sessionStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.sessionStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}
    try {
      window.localStorage.setItem(`nexus.linkedAppDocument.${uid}`, String(documentId))
      if (title) window.localStorage.setItem(`nexus.linkedAppOpenTitle.${uid}`, title)
    } catch (_) {}

    window.__nexusSpawnedQuartzByDocumentId[String(documentId)] = uid

    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.openOnConnect = "true"
    clone.dataset.isSpawnedQuartzWindow = "true"
    clone.dataset.spawnedFromDocumentId = String(documentId)

    this.prepareClonedWindowShell(clone, { frameId: uid, title, openOnConnect: true })

    const rect = this.element.getBoundingClientRect()
    clone.style.left = `${Math.round(rect.left) + 24}px`
    clone.style.top = `${Math.round(rect.top) + 24}px`
    clone.style.width = `${Math.round(rect.width)}px`
    clone.style.height = `${Math.round(rect.height)}px`

    this.element.parentElement.appendChild(clone)
  }

  handleUserStateLoaded(event) {
    const changed = new Set(event.detail?.changedKeys || [])
    if (this.appKeyValue === "tasks" && changed.has(TASK_WINDOW_REGISTRY_KEY)) {
      window.__nexusTaskWindowsRestored = false
      this.restorePersistedSpawnedTaskWindows()
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

      this.prepareClonedWindowShell(clone, {
        frameId: String(entry.frameId || entry.appKey),
        title: restoredTitle,
        openOnConnect: false
      })

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

  syncOpenFileBadge(title) {
    this.syncOpenFileBadgeFor(this.element, title)
  }

  syncOpenFileBadgeFor(windowEl, title) {
    if (!windowEl) return
    const nameEl = windowEl.querySelector("[data-nexus-open-file-name]")
    if (!nameEl) return
    const t = (title || "").trim()
    if (!t) {
      nameEl.hidden = true
      nameEl.textContent = ""
      nameEl.removeAttribute("title")
      this.syncOpenFileNameStateFor(windowEl, "neutral")
      return
    }
    nameEl.hidden = false
    nameEl.textContent = t
    nameEl.setAttribute("title", t)
    this.syncOpenFileNameStateFor(windowEl, "saved")
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
    const editedEl = windowEl.querySelector("[data-nexus-open-file-edited]")
    if (!nameEl || !editedEl) return

    // Only show "- Edited" if we have a title and the state is dirty
    const title = String(nameEl.textContent || "").trim()
    if (title && state === "dirty") {
      editedEl.hidden = false
      return
    }

    editedEl.hidden = true
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

  syncSpawnedQuartzDocumentRegistration(documentId) {
    if (!this.appKeyValue.startsWith("quartz-spawn-")) return
    if (!window.__nexusSpawnedQuartzByDocumentId) window.__nexusSpawnedQuartzByDocumentId = {}

    const map = window.__nexusSpawnedQuartzByDocumentId
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
  }

  syncSpawnedLinkedDocumentRegistration(documentId) {
    this.syncSpawnedTaskDocumentRegistration(documentId)
    this.syncSpawnedQuartzDocumentRegistration(documentId)
  }

  clearOpenFileBadge() {
    this.syncOpenFileBadge("")
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

  onLinkedDocumentUnavailable(event) {
    const documentId = String(event?.detail?.documentId || "")
    if (!documentId) return
    if (!this.windowMatchesLinkedDocumentId(this.element, documentId)) return

    this.resetLinkedDocumentSessionState()
    if (this.element.classList.contains("is-hidden")) {
      if (this.isSpawnedWindow()) this.finalizeSpawnedWindowClose()
      return
    }

    this.close()
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
        this.hardReloadFrame(this.currentUrl)
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
        this.hardReloadFrame(this.currentUrl)
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
    if (this.element.classList.contains("is-hidden") || this.element.classList.contains("content-window--closing")) {
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
    this.cancelVisibilityAnimation()
    this.ensureFrameLoaded()
    this.element.classList.remove("is-hidden", "content-window--closing")
    this.playOpenAnimation()
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
    if (this.element.classList.contains("is-hidden") || this.element.classList.contains("content-window--closing")) return

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
    this.playCloseAnimation(() => {
      this.element.classList.add("is-hidden")
      this.element.classList.remove("content-window--closing")
      if (!this.isSpawnedWindow() && this.isLinkedDocumentApp() && !this.shouldResetLinkedDocumentOnClose()) {
        this.clearFrameForNavigation()
      }
      if (this.isSpawnedWindow()) {
        this.finalizeSpawnedWindowClose()
      } else {
        this.emitWindowState(false)
      }
    })
  }

  isSpawnedWindow() {
    return this.appKeyValue.startsWith("task-spawn-") ||
      this.appKeyValue.startsWith("image-spawn-") ||
      this.appKeyValue.startsWith("quartz-spawn-")
  }

  finalizeSpawnedWindowClose() {
    // Clean up the global registry
    const docId = this.element.dataset.spawnedFromDocumentId
    if (docId) {
      if (this.appKeyValue.startsWith("task-spawn-")) delete window.__nexusSpawnedTasksByDocumentId[docId]
      if (this.appKeyValue.startsWith("image-spawn-")) delete window.__nexusSpawnedImagesByDocumentId[docId]
      if (this.appKeyValue.startsWith("quartz-spawn-")) delete window.__nexusSpawnedQuartzByDocumentId[docId]
    }
    if (this.appKeyValue.startsWith("task-spawn-")) this.removePersistedSpawnedTaskWindow(this.appKeyValue)
    try {
      window.localStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
      window.sessionStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
    } catch (_) {}
    this.element.remove()

    const hasOtherSpawned = this.appKeyValue.startsWith("task-spawn-")
      ? document.querySelectorAll('[data-content-window-app-key-value^="task-spawn-"]:not(.is-hidden)').length > 0
      : this.appKeyValue.startsWith("image-spawn-")
        ? document.querySelectorAll('[data-content-window-app-key-value^="image-spawn-"]:not(.is-hidden)').length > 0
        : document.querySelectorAll('[data-content-window-app-key-value^="quartz-spawn-"]:not(.is-hidden)').length > 0
    const hasPrimaryOpen = this.appKeyValue.startsWith("task-spawn-")
      ? Boolean(document.querySelector('[data-content-window-app-key-value="tasks"]:not(.is-hidden)'))
      : this.appKeyValue.startsWith("image-spawn-")
        ? Boolean(document.querySelector('[data-content-window-app-key-value="images"]:not(.is-hidden)'))
        : Boolean(document.querySelector('[data-content-window-app-key-value="quartz"]:not(.is-hidden)'))
    if (!hasOtherSpawned && !hasPrimaryOpen) {
      this.emitWindowState(false)
    }
  }

  playOpenAnimation() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.element.classList.remove("content-window--opening", "content-window--opening-active")
      return
    }

    this.element.classList.remove("content-window--opening", "content-window--opening-active")
    this.element.classList.add("content-window--opening")
    this.openAnimationFrame = window.requestAnimationFrame(() => {
      this.openAnimationFrame = null
      this.element.classList.add("content-window--opening-active")
    })

    this.openAnimationTimer = window.setTimeout(() => {
      this.openAnimationTimer = null
      this.element.classList.remove("content-window--opening", "content-window--opening-active")
    }, CONTENT_WINDOW_OPEN_ANIMATION_MS)
  }

  playCloseAnimation(onClosed) {
    this.cancelVisibilityAnimation()
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClosed()
      return
    }

    this.element.classList.add("content-window--closing")
    this.closeAnimationTimer = window.setTimeout(() => {
      this.closeAnimationTimer = null
      onClosed()
    }, CONTENT_WINDOW_CLOSE_ANIMATION_MS)
  }

  cancelVisibilityAnimation() {
    if (this.openAnimationFrame) {
      window.cancelAnimationFrame(this.openAnimationFrame)
      this.openAnimationFrame = null
    }
    if (this.openAnimationTimer) {
      window.clearTimeout(this.openAnimationTimer)
      this.openAnimationTimer = null
    }
    if (this.closeAnimationTimer) {
      window.clearTimeout(this.closeAnimationTimer)
      this.closeAnimationTimer = null
    }
    this.element.classList.remove("content-window--opening", "content-window--opening-active", "content-window--closing")
  }

  ensureFrameLoaded() {
    if (!this.hasFrameTarget) return
    if (this.frameTarget.getAttribute("src") === this.currentUrl) return
    this.frameTarget.src = this.currentUrl
  }

  clearFrameForNavigation() {
    if (!this.hasFrameTarget) return
    this.stopFrameMediaPlayback()
    this.frameTarget.replaceChildren()
    this.frameTarget.removeAttribute("src")
    void this.frameTarget.offsetWidth
  }

  hardReloadFrame(url) {
    if (!this.hasFrameTarget) return
    this.clearFrameForNavigation()
    this.frameTarget.src = url
  }

  shouldResetLinkedDocumentOnClose() {
    return this.appKeyValue === "audio" || this.appKeyValue === "images"
  }

  resetLinkedDocumentSessionState() {
    this.stopFrameMediaPlayback()
    if (this.hasFrameIdValue) {
      try {
        window.sessionStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
        window.localStorage.removeItem(`nexus.linkedAppDocument.${this.frameIdValue}`)
      } catch (_) {}
    }
    this.currentUrl = this.buildAppUrl({ blank: false })
    this.clearOpenFileBadge()
    if (this.hasFrameTarget) {
      this.clearFrameForNavigation()
    }
  }

  stopFrameMediaPlayback() {
    if (!this.hasFrameTarget) return
    const mediaEls = this.frameTarget.querySelectorAll("audio, video")
    mediaEls.forEach((mediaEl) => {
      try {
        mediaEl.pause()
      } catch (_) {}
      try {
        mediaEl.removeAttribute("src")
        mediaEl.load()
      } catch (_) {}
    })
  }

  isLinkedApp() {
    return this.appKeyValue === "tasks" ||
      this.appKeyValue.startsWith("task-spawn-") ||
      this.appKeyValue === "quartz" ||
      this.appKeyValue.startsWith("quartz-spawn-")
  }

  /** Finder-linked document windows (Tasks, Quartz, Audio, Images) share restore + title badge behavior. */
  isLinkedDocumentApp() {
    return this.appKeyValue === "tasks" ||
      this.appKeyValue.startsWith("task-spawn-") ||
      this.appKeyValue === "audio" ||
      this.appKeyValue === "images" ||
      this.appKeyValue.startsWith("image-spawn-") ||
      this.appKeyValue === "quartz" ||
      this.appKeyValue.startsWith("quartz-spawn-")
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

    this.activeDrag = {
      offsetX: coords.x - rectLeft,
      offsetY: coords.y - rectTop,
      startX: coords.x,
      startY: coords.y,
      didMove: false
    }
    this.element.classList.add("content-window--drag-lift")
    this.element.classList.add("content-window--suppress-position-transition")

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("pointermove", this.boundPointerDragMove)
    document.addEventListener("pointerup", this.boundPointerDragEnd)
    document.addEventListener("pointercancel", this.boundPointerDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getCoords(event)
    if (!this.activeDrag.didMove) {
      const dx = Math.abs(coords.x - this.activeDrag.startX)
      const dy = Math.abs(coords.y - this.activeDrag.startY)
      if (dx < 2 && dy < 2) return
      this.activeDrag.didMove = true
    }
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
    const dragState = this.activeDrag
    const hadDrag = Boolean(dragState)
    const didMove = Boolean(dragState?.didMove)
    this.activeDrag = null
    this.element.classList.remove("content-window--drag-lift")
    this.element.classList.remove("content-window--suppress-position-transition")
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("pointermove", this.boundPointerDragMove)
    document.removeEventListener("pointerup", this.boundPointerDragEnd)
    document.removeEventListener("pointercancel", this.boundPointerDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
    this.clearAllEdgeGhosts()
    /* reconcile bails out while activeDrag is set — clear first so snap + saveWindowBounds run. */
    if (hadDrag && didMove) {
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

  prepareClonedWindowFrame(clone, frameId) {
    const frame = clone.querySelector("turbo-frame[data-content-window-target='frame']")
    if (!frame) return
    frame.id = frameId
    frame.removeAttribute("busy")
    frame.removeAttribute("complete")
    frame.removeAttribute("src")
    frame.replaceChildren()
  }

  prepareClonedWindowShell(clone, {
    frameId,
    title = "",
    openOnConnect = false
  } = {}) {
    clone.classList.add("is-hidden")
    clone.classList.remove("content-window--closing")
    if (openOnConnect) clone.dataset.openOnConnect = "true"
    this.prepareClonedWindowFrame(clone, frameId)
    this.syncOpenFileBadgeFor(clone, title)
    const editedEl = clone.querySelector("[data-nexus-open-file-edited]")
    if (editedEl) editedEl.hidden = true
    const pickerLayer = clone.querySelector("[data-content-window-target='savePickerLayer']")
    if (pickerLayer) {
      pickerLayer.hidden = true
      pickerLayer.setAttribute("aria-hidden", "true")
    }
    const pickerIframe = clone.querySelector("[data-content-window-target='savePickerIframe']")
    if (pickerIframe) pickerIframe.removeAttribute("src")
  }

  /** Clone the primary window shell into a new blank (unsaved) task window and open it. */
  spawnBlankTaskWindow() {
    const uid = `task-spawn-${Date.now()}`
    const clone = this.element.cloneNode(true)
    clone.dataset.contentWindowAppKeyValue = uid
    clone.dataset.contentWindowFrameIdValue = uid
    clone.dataset.contentWindowStorageKeyValue = uid
    clone.dataset.contentWindowHasLinkedAppSavePickerValue = "true"
    clone.dataset.isSpawnedTaskWindow = "true"
    // No spawnedFromDocumentId — blank window hasn't been saved yet
    this.prepareClonedWindowShell(clone, { frameId: uid, title: "", openOnConnect: true })
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
          : this.element.dataset.isSpawnedQuartzWindow === "true"
            ? "quartz"
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
