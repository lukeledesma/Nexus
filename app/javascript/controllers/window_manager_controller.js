import { Controller } from "@hotwired/stimulus"
import { createOsWindowSizer } from "lib/os_window_sizing"
import {
  readDockPins,
  writeDockPins,
  DOCK_HOVER_LABELS,
  DOCK_APP_KEY_ORDER,
  PINNABLE_APP_KEYS,
  readDockRunningOrder,
  writeDockRunningOrder,
  mergeOpenRunningOrder
} from "lib/dock_pins"
import {
  captureDockButtonRects,
  flipDockZoneFromPrevRects,
  captureDockFullLayoutRects,
  flipDockFullLayout,
  flipDockSingleElement
} from "lib/dock_flip"

const DOCK_DRAG_THRESHOLD_PX = 8

export default class extends Controller {
  connect() {
    this.launcherWindow = document.getElementById("organizer-window")
    this.dockElement = document.getElementById("app-dock")
    this.launcherDockButton = this.dockElement?.querySelector(".app-dock-button--launcher")
    this.dockAppOpen = {}
    this.foregroundAppKey = null

    this.viewportMarginPx = 6
    this.bottomDockBoundary = this.viewportMarginPx
    this.defaultOrganizerWidth = 320
    this.launcherDockGapPx = 10
    this._dockIconHtml = null

    this.boundAppWindowState = this.handleAppWindowState.bind(this)
    this.boundLauncherToggle = this.toggleLauncher.bind(this)
    this.boundLauncherClose = this.handleLauncherCloseRequest.bind(this)
    this.boundDockPinsChanged = this.onDockPinsChanged.bind(this)
    this.boundDockClick = this.onDockClick.bind(this)
    this.boundOutsidePointer = this.onOutsidePointerDown.bind(this)
    this.boundDockPointerDown = this.onDockPointerDown.bind(this)
    this.boundDockPointerMove = this.onDockPointerMove.bind(this)
    this.boundDockPointerUp = this.onDockPointerUp.bind(this)

    this.initializeWindows()
    this.applyWorkspaceThemeOnBoot()

    this.renderDockApps()
    this.dockElement?.addEventListener("click", this.boundDockClick)
    this.dockElement?.addEventListener("pointerdown", this.boundDockPointerDown, true)

    this.launcherSizer = createOsWindowSizer({
      windowId: "launcher",
      windowElement: this.launcherWindow,
      contentElement: this.launcherWindow?.querySelector(".organizer-panel"),
      viewportMargin: this.viewportMarginPx,
      isWindowOpen: () => !this.launcherWindow?.classList.contains("is-hidden"),
      onHeightApplied: () => this.anchorLauncherToDock()
    })
    this.launcherSizer.observeContent()

    window.addEventListener("app-window:state", this.boundAppWindowState)
    window.addEventListener("launcher:toggle", this.boundLauncherToggle)
    window.addEventListener("launcher:close", this.boundLauncherClose)
    window.addEventListener("dock-pins:changed", this.boundDockPinsChanged)
    document.addEventListener("pointerdown", this.boundOutsidePointer, true)

    if (this.launcherWindow) {
      this.launcherWindow.addEventListener("mousedown", () => this.bringLauncherToFront())
    }
    this.refreshLauncherDockButtonRef()
  }

  disconnect() {
    this.endDockPointerTracking(true)
    this.dockElement?.removeEventListener("click", this.boundDockClick)
    this.dockElement?.removeEventListener("pointerdown", this.boundDockPointerDown, true)
    document.removeEventListener("pointerdown", this.boundOutsidePointer, true)
    window.removeEventListener("app-window:state", this.boundAppWindowState)
    window.removeEventListener("launcher:toggle", this.boundLauncherToggle)
    window.removeEventListener("launcher:close", this.boundLauncherClose)
    window.removeEventListener("dock-pins:changed", this.boundDockPinsChanged)
    if (this.launcherSizer) this.launcherSizer.disconnect()
  }

  refreshLauncherDockButtonRef() {
    this.launcherDockButton = this.dockElement?.querySelector(".app-dock-button--launcher")
  }

  readDockIconHtmlMap() {
    if (this._dockIconHtml) return this._dockIconHtml
    const el = document.getElementById("nexus-dock-icon-html")
    if (!el?.textContent) {
      this._dockIconHtml = {}
      return this._dockIconHtml
    }
    try {
      this._dockIconHtml = JSON.parse(el.textContent)
    } catch (_) {
      this._dockIconHtml = {}
    }
    return this._dockIconHtml
  }

  /**
   * Which app windows are visible — source of truth is the DOM (avoids missing
   * app-window:state when child controllers connect before window-manager).
   */
  syncDockOpenStateFromDom() {
    for (const key of DOCK_APP_KEY_ORDER) {
      this.dockAppOpen[key] = false
    }
    document.querySelectorAll("section.content-window.os-window").forEach((el) => {
      const key = el.getAttribute("data-content-window-app-key-value")
      if (!key || !DOCK_APP_KEY_ORDER.includes(key)) return
      this.dockAppOpen[key] = !el.classList.contains("is-hidden")
    })
  }

  renderDockApps() {
    const dock = this.dockElement
    if (!dock) return
    const pinnedEl = document.getElementById("app-dock-pinned")
    const runningEl = document.getElementById("app-dock-running")
    const dividerEl = document.getElementById("app-dock-running-divider")
    if (!pinnedEl || !runningEl || !dividerEl) return

    const prevLauncherBtn = dock.querySelector(".app-dock-button--launcher")
    const prevLauncherBtnRect = prevLauncherBtn?.getBoundingClientRect()
    const prevPinnedRects = captureDockButtonRects(pinnedEl)
    const prevRunningRects = captureDockButtonRects(runningEl)
    const launcherDividerEl = document.getElementById("app-dock-launcher-divider")
    const prevLb = launcherDividerEl?.getBoundingClientRect()
    const prevLauncherDividerRect =
      prevLb && prevLb.width > 0.5 && prevLb.height > 0.5 ? prevLb : null
    const prevDividerRect = dividerEl.hidden ? null : dividerEl.getBoundingClientRect()

    this.syncDockOpenStateFromDom()

    this.foregroundAppKey = this.computeForegroundAppKeyFromDom()

    pinnedEl.innerHTML = ""
    runningEl.innerHTML = ""

    this.refreshLauncherDockButtonRef()
    const launcherBtn = dock.querySelector(".app-dock-button--launcher")
    if (!launcherBtn) return

    const icons = this.readDockIconHtmlMap()
    const pins = readDockPins()
    const pinsSet = new Set(pins)

    for (const key of pins) {
      const html = icons[key]
      if (!html) continue
      const btn = this.createDockAppButton(key, html, "pinned")
      pinnedEl.appendChild(btn)
    }

    const openUnpinnedKeys = DOCK_APP_KEY_ORDER.filter(
      (k) => this.dockAppOpen[k] && !pinsSet.has(k)
    )
    const storedRunningOrder = readDockRunningOrder()
    const mergedRunningOrder = mergeOpenRunningOrder(storedRunningOrder, openUnpinnedKeys)
    if (JSON.stringify(mergedRunningOrder) !== JSON.stringify(storedRunningOrder)) {
      writeDockRunningOrder(mergedRunningOrder)
    }

    let runningCount = 0
    for (const key of mergedRunningOrder) {
      if (!this.dockAppOpen[key] || pinsSet.has(key)) continue
      const html = icons[key]
      if (!html) continue
      const btn = this.createDockAppButton(key, html, "running")
      runningEl.appendChild(btn)
      runningCount++
    }

    dividerEl.hidden = runningCount === 0

    runningEl.classList.toggle("app-dock-group--running-empty", runningCount === 0)

    flipDockZoneFromPrevRects(prevPinnedRects, pinnedEl)
    flipDockZoneFromPrevRects(prevRunningRects, runningEl)
    /* Anchor before launcher/divider FLIP so getBoundingClientRect isn’t skewed by transform. */
    this.anchorLauncherToDock()
    if (
      launcherBtn &&
      prevLauncherBtnRect &&
      prevLauncherBtnRect.width > 0.5 &&
      prevLauncherBtnRect.height > 0.5
    ) {
      flipDockSingleElement(prevLauncherBtnRect, launcherBtn)
    }
    if (launcherDividerEl && prevLauncherDividerRect) {
      const nextLb = launcherDividerEl.getBoundingClientRect()
      if (nextLb.width > 0.5 && nextLb.height > 0.5) {
        flipDockSingleElement(prevLauncherDividerRect, launcherDividerEl)
      }
    }
    if (prevDividerRect && !dividerEl.hidden) {
      flipDockSingleElement(prevDividerRect, dividerEl)
    }
  }

  createDockAppButton(key, html, region) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "app-dock-button app-dock-button--dock-app"
    if (region === "running") btn.classList.add("app-dock-button--running")
    btn.dataset.dockAppKey = key
    btn.dataset.dockAppRegion = region
    const label = DOCK_HOVER_LABELS[key] || key
    btn.setAttribute("data-hover-label", label)
    btn.setAttribute("aria-pressed", "false")
    btn.innerHTML = html
    this.updateDockAppButtonState(btn, Boolean(this.dockAppOpen[key]), key === this.foregroundAppKey)
    return btn
  }

  onDockClick(event) {
    if (performance.now() < (this._dockSuppressClickUntil || 0)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const btn = event.target.closest?.("[data-dock-app-key]")
    if (!btn || !this.dockElement?.contains(btn)) return
    event.preventDefault()
    const key = btn.dataset.dockAppKey
    if (!key) return
    this.emitDockAppToggle(key)
  }

  pointInDockStrip(clientX, clientY) {
    const dock = this.dockElement
    if (!dock) return false
    const r = dock.getBoundingClientRect()
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
  }

  /**
   * Pinned strip rect for drag hit-testing. Empty `#app-dock-pinned` uses `display: contents`
   * so it has no layout box — synthesize the strip between launcher and running.
   */
  dockPinnedZoneRectForPointer(pinnedEl, launcherBtn, dock) {
    if (pinnedEl.querySelector("[data-dock-app-key]")) return pinnedEl.getBoundingClientRect()
    const lb = launcherBtn.getBoundingClientRect()
    const ld = document.getElementById("app-dock-launcher-divider")
    const ldBox = ld?.getBoundingClientRect()
    const left = ldBox && ldBox.width > 0.5 ? ldBox.right : lb.right
    const rd = document.getElementById("app-dock-running-divider")
    const rdBox = rd && !rd.hidden ? rd.getBoundingClientRect() : null
    const runningEl = document.getElementById("app-dock-running")
    let right = dock.getBoundingClientRect().right
    if (rdBox && rdBox.width > 0.5) right = Math.min(right, rdBox.left)
    else if (runningEl?.querySelector("[data-dock-app-key]")) {
      right = Math.min(right, runningEl.getBoundingClientRect().left)
    }
    const h = Math.max(lb.height, 28)
    return new DOMRect(left, lb.top, Math.max(8, right - left), h)
  }

  /**
   * Running strip rect when the zone uses `display: contents` and has no icons yet.
   */
  dockRunningZoneRectForPointer(runningEl, launcherBtn, dock) {
    if (runningEl.querySelector("[data-dock-app-key]")) return runningEl.getBoundingClientRect()
    const dr = dock.getBoundingClientRect()
    const rd = document.getElementById("app-dock-running-divider")
    const rdBox = rd && !rd.hidden ? rd.getBoundingClientRect() : null
    const pinnedEl = document.getElementById("app-dock-pinned")
    let left = dr.left
    if (rdBox && rdBox.width > 0.5) left = rdBox.right
    else if (pinnedEl?.querySelector("[data-dock-app-key]")) {
      left = pinnedEl.getBoundingClientRect().right
    } else {
      const lb = launcherBtn.getBoundingClientRect()
      const ld = document.getElementById("app-dock-launcher-divider")
      const ldBox = ld?.getBoundingClientRect()
      left = ldBox && ldBox.width > 0.5 ? ldBox.right : lb.right
    }
    const h = Math.max(dr.height, 28)
    return new DOMRect(left, dr.top, Math.max(8, dr.right - left), h)
  }

  dockInsertIndexForPointer(zoneEl, clientX, excludeBtn) {
    if (!zoneEl) return 0
    const buttons = [...zoneEl.querySelectorAll("[data-dock-app-key]")].filter((b) =>
      excludeBtn ? b !== excludeBtn : true
    )
    let idx = 0
    for (const b of buttons) {
      const br = b.getBoundingClientRect()
      if (clientX < br.left + br.width / 2) break
      idx++
    }
    return idx
  }

  syncDockDividerVisibility() {
    const runningEl = document.getElementById("app-dock-running")
    const dividerEl = document.getElementById("app-dock-running-divider")
    if (!runningEl || !dividerEl) return
    const n = runningEl.querySelectorAll("[data-dock-app-key]").length
    const draggingFromRunning =
      this._dockPtr?.active === true && this._dockPtr.region === "running"
    dividerEl.hidden = n === 0 && !draggingFromRunning
  }

  dockReorderZoneWithFlip(zoneEl, sourceBtn, insertIndex) {
    if (!zoneEl || !sourceBtn) return
    const dock = this.dockElement
    if (!dock) return
    this.syncDockDividerVisibility()
    const prev = captureDockFullLayoutRects(dock)
    const siblings = [...zoneEl.querySelectorAll("[data-dock-app-key]")].filter((b) => b !== sourceBtn)
    const ref = insertIndex >= siblings.length ? null : siblings[insertIndex]
    zoneEl.insertBefore(sourceBtn, ref)
    this.syncDockDividerVisibility()
    flipDockFullLayout(prev)
  }

  dockMoveButtonToZoneWithFlip(sourceBtn, targetZone, insertIndex) {
    if (!sourceBtn || !targetZone) return
    const dock = this.dockElement
    if (!dock) return
    this.syncDockDividerVisibility()
    const prev = captureDockFullLayoutRects(dock)
    const siblings = [...targetZone.querySelectorAll("[data-dock-app-key]")].filter((b) => b !== sourceBtn)
    const ref = insertIndex >= siblings.length ? null : siblings[insertIndex]
    targetZone.insertBefore(sourceBtn, ref)
    this.syncDockDividerVisibility()
    flipDockFullLayout(prev)
  }

  positionDockFloat(ptr, clientX, clientY) {
    if (!ptr?.floatEl) return
    const s = 25
    ptr.floatEl.style.left = `${Math.round(clientX - s / 2)}px`
    ptr.floatEl.style.top = `${Math.round(clientY - s / 2)}px`
  }

  endDockPointerTracking(forceRerender) {
    document.removeEventListener("pointermove", this.boundDockPointerMove)
    document.removeEventListener("pointerup", this.boundDockPointerUp)
    document.removeEventListener("pointercancel", this.boundDockPointerUp)
    this.dockElement?.classList.remove("app-dock--drag-active")
    const ptr = this._dockPtr
    if (!ptr) return
    ptr.floatEl?.remove()
    ptr.btn?.classList?.remove("app-dock-button--dock-ghost-source", "app-dock-button--dock-ghost-outside")
    this._dockPtr = null
    if (forceRerender) this.renderDockApps()
  }

  onDockPointerDown(event) {
    if (event.button !== 0) return
    const btn = event.target.closest?.("[data-dock-app-key][data-dock-app-region]")
    if (!btn || !this.dockElement?.contains(btn)) return

    this._dockPtr = {
      btn,
      key: btn.dataset.dockAppKey,
      region: btn.dataset.dockAppRegion,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      active: false,
      floatEl: null,
      previewSig: null
    }

    document.addEventListener("pointermove", this.boundDockPointerMove)
    document.addEventListener("pointerup", this.boundDockPointerUp)
    document.addEventListener("pointercancel", this.boundDockPointerUp)
  }

  onDockPointerMove(event) {
    const ptr = this._dockPtr
    if (!ptr) return

    const dx = event.clientX - ptr.startX
    const dy = event.clientY - ptr.startY
    const dist = Math.hypot(dx, dy)

    if (!ptr.active) {
      if (dist < DOCK_DRAG_THRESHOLD_PX) return
      ptr.active = true
      this.dockElement?.classList.add("app-dock--drag-active")
      this._dockSuppressClickUntil = performance.now() + 700
      ptr.floatEl = document.createElement("div")
      ptr.floatEl.className = "dock-drag-float"
      ptr.floatEl.innerHTML = ptr.btn.innerHTML
      document.body.appendChild(ptr.floatEl)
      ptr.btn.classList.add("app-dock-button--dock-ghost-source")
      try {
        ptr.btn.setPointerCapture(event.pointerId)
      } catch (_) {}
      this.positionDockFloat(ptr, event.clientX, event.clientY)
    }

    if (!ptr.active) return
    if (event.cancelable) event.preventDefault()
    this.positionDockFloat(ptr, event.clientX, event.clientY)

    const dock = this.dockElement
    const pinnedEl = document.getElementById("app-dock-pinned")
    const runningEl = document.getElementById("app-dock-running")
    const launcherBtn = dock?.querySelector(".app-dock-button--launcher")
    if (!pinnedEl || !runningEl || !launcherBtn) return

    const lr = launcherBtn.getBoundingClientRect()
    if (
      lr &&
      event.clientX >= lr.left &&
      event.clientX <= lr.right &&
      event.clientY >= lr.top &&
      event.clientY <= lr.bottom
    ) {
      ptr.previewSig = null
      ptr.btn.classList.add("app-dock-button--dock-ghost-outside")
      return
    }

    const inDock = this.pointInDockStrip(event.clientX, event.clientY)
    if (!inDock) {
      ptr.previewSig = null
      ptr.btn.classList.add("app-dock-button--dock-ghost-outside")
      return
    }

    const pad = 5
    const pr = this.dockPinnedZoneRectForPointer(pinnedEl, launcherBtn, dock)
    const rr = this.dockRunningZoneRectForPointer(runningEl, launcherBtn, dock)
    let inPinned =
      event.clientX >= pr.left - pad &&
      event.clientX <= pr.right + pad &&
      event.clientY >= pr.top - pad &&
      event.clientY <= pr.bottom + pad
    let inRunning =
      event.clientX >= rr.left - pad &&
      event.clientX <= rr.right + pad &&
      event.clientY >= rr.top - pad &&
      event.clientY <= rr.bottom + pad

    let hoverPinned = inPinned
    let hoverRunning = inRunning
    if (inDock && !inPinned && !inRunning) {
      const dr = dock.getBoundingClientRect()
      let mid
      if (rr.left >= pr.right - 2) {
        mid = (pr.right + rr.left) / 2
      } else {
        mid = lr.right + (dr.right - lr.right) / 2
      }
      hoverPinned = event.clientX < mid
      hoverRunning = event.clientX >= mid
    }

    const domZone = ptr.btn.closest("#app-dock-pinned")
      ? "pinned"
      : ptr.btn.closest("#app-dock-running")
        ? "running"
        : null

    ptr.btn.classList.remove("app-dock-button--dock-ghost-outside")

    const runPreview = (sig, fn) => {
      if (ptr.previewSig === sig) return
      ptr.previewSig = sig
      fn()
    }

    if (hoverPinned && domZone === "pinned") {
      const idx = this.dockInsertIndexForPointer(pinnedEl, event.clientX, ptr.btn)
      runPreview(`rp:${idx}`, () => this.dockReorderZoneWithFlip(pinnedEl, ptr.btn, idx))
      return
    }

    if (hoverRunning && domZone === "running") {
      const idx = this.dockInsertIndexForPointer(runningEl, event.clientX, ptr.btn)
      runPreview(`rr:${idx}`, () => this.dockReorderZoneWithFlip(runningEl, ptr.btn, idx))
      return
    }

    if (hoverRunning && domZone === "pinned") {
      const idx = this.dockInsertIndexForPointer(runningEl, event.clientX, null)
      runPreview(`tr:${idx}`, () => this.dockMoveButtonToZoneWithFlip(ptr.btn, runningEl, idx))
      return
    }

    if (hoverPinned && domZone === "running") {
      const idx = this.dockInsertIndexForPointer(pinnedEl, event.clientX, null)
      runPreview(`tp:${idx}`, () => this.dockMoveButtonToZoneWithFlip(ptr.btn, pinnedEl, idx))
      return
    }

    ptr.previewSig = null
    ptr.btn.classList.add("app-dock-button--dock-ghost-outside")
  }

  onDockPointerUp(event) {
    this.dockElement?.classList.remove("app-dock--drag-active")
    const ptr = this._dockPtr
    if (!ptr) return

    try {
      ptr.btn?.releasePointerCapture?.(event.pointerId)
    } catch (_) {}

    document.removeEventListener("pointermove", this.boundDockPointerMove)
    document.removeEventListener("pointerup", this.boundDockPointerUp)
    document.removeEventListener("pointercancel", this.boundDockPointerUp)

    if (!ptr.active) {
      this._dockPtr = null
      return
    }

    ptr.floatEl?.remove()
    ptr.floatEl = null
    ptr.btn.classList.remove("app-dock-button--dock-ghost-source", "app-dock-button--dock-ghost-outside")
    if (typeof ptr.btn.blur === "function") ptr.btn.blur()

    const pinnedEl = document.getElementById("app-dock-pinned")
    const runningEl = document.getElementById("app-dock-running")
    const inDock = this.pointInDockStrip(event.clientX, event.clientY)

    if (!pinnedEl || !runningEl) {
      this._dockPtr = null
      this.renderDockApps()
      return
    }

    if (!inDock) {
      this.syncDockOpenStateFromDom()
      const key = ptr.key
      if (
        ptr.region === "pinned" &&
        key &&
        PINNABLE_APP_KEYS.has(key) &&
        !this.dockAppOpen[key]
      ) {
        const nextPins = readDockPins().filter((k) => k !== key)
        writeDockPins(nextPins)
        window.dispatchEvent(new CustomEvent("dock-pins:changed", { detail: { pins: readDockPins() } }))
      }
      this._dockPtr = null
      this.renderDockApps()
      return
    }

    const pinKeys = [...pinnedEl.querySelectorAll("[data-dock-app-key]")]
      .map((b) => b.dataset.dockAppKey)
      .filter((k) => PINNABLE_APP_KEYS.has(k))
    const runKeys = [...runningEl.querySelectorAll("[data-dock-app-key]")]
      .map((b) => b.dataset.dockAppKey)
      .filter((k) => PINNABLE_APP_KEYS.has(k))

    writeDockPins(pinKeys)
    writeDockRunningOrder(runKeys)
    window.dispatchEvent(new CustomEvent("dock-pins:changed", { detail: { pins: readDockPins() } }))

    this._dockPtr = null
    this.renderDockApps()
  }

  emitDockAppToggle(key) {
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: key } }))
  }

  onDockPinsChanged() {
    this.renderDockApps()
  }

  onOutsidePointerDown(event) {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    const t = event.target
    if (typeof t.closest !== "function") return
    if (t.closest("#organizer-window")) return
    if (t.closest("#app-dock")) return
    this.closeLauncher()
  }

  updateDockAppButtonState(btn, isOpen, isForeground) {
    btn.classList.toggle("is-active", isOpen)
    btn.setAttribute("aria-pressed", isOpen ? "true" : "false")
    const key = btn.dataset.dockAppKey
    const label = DOCK_HOVER_LABELS[key] || key
    if (!isOpen) {
      btn.setAttribute("aria-label", `Open ${label}`)
    } else if (isForeground) {
      btn.setAttribute("aria-label", `Close ${label}`)
    } else {
      btn.setAttribute("aria-label", `Bring ${label} to front`)
    }
  }

  computeForegroundAppKeyFromDom() {
    let maxZ = -Infinity
    let topKey = null
    document.querySelectorAll("section.content-window.os-window:not(.is-hidden)").forEach((el) => {
      const key = el.getAttribute("data-content-window-app-key-value")
      if (!key) return
      const zRaw = el.style.zIndex || window.getComputedStyle(el).zIndex
      const z = Number.parseInt(zRaw, 10)
      const zc = Number.isFinite(z) ? z : 0
      if (zc >= maxZ) {
        maxZ = zc
        topKey = key
      }
    })
    return topKey
  }

  handleLauncherCloseRequest() {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    this.closeLauncher()
  }

  toggleLauncher(event) {
    if (event) event.preventDefault()
    if (!this.launcherWindow) return
    const isHidden = this.launcherWindow.classList.contains("is-hidden")
    if (isHidden) { this.openLauncher() } else { this.closeLauncher() }
  }

  handleAppWindowState(_event) {
    this.renderDockApps()
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════

  initializeWindows() {
    if (!this.launcherWindow) return
    this.launcherWindow.style.width = `${this.defaultOrganizerWidth}px`
    this.launcherWindow.classList.add("is-hidden")
    this.updateLauncherDockState(false)
  }

  /** Places the launcher panel above the dock icon, horizontally centered on it. */
  anchorLauncherToDock() {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    this.refreshLauncherDockButtonRef()
    if (!this.launcherDockButton) return

    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = this.viewportMarginPx
    const launcherWidth = this.defaultOrganizerWidth
    const gap = this.launcherDockGapPx
    const btn = this.launcherDockButton.getBoundingClientRect()
    const windowHeight = this.launcherWindow.offsetHeight || this.getLauncherWindowHeight()

    const centerX = btn.left + btn.width / 2
    let launcherLeft = Math.round(centerX - launcherWidth / 2)
    launcherLeft = Math.max(margin, Math.min(launcherLeft, vw - margin - launcherWidth))

    let launcherTop = Math.round(btn.top - windowHeight - gap)
    if (launcherTop < margin) {
      launcherTop = Math.round(btn.bottom + gap)
    }
    const maxTop = vh - this.bottomDockBoundary - windowHeight
    launcherTop = Math.max(margin, Math.min(launcherTop, maxTop))

    this.launcherWindow.style.left = `${launcherLeft}px`
    this.launcherWindow.style.top = `${launcherTop}px`
    this.launcherWindow.style.width = `${launcherWidth}px`
  }

  getLauncherWindowHeight() {
    const panel = this.launcherWindow?.querySelector(".organizer-panel")
    if (!panel) return 1
    return Math.max(1, Math.ceil(panel.scrollHeight), Math.ceil(panel.getBoundingClientRect().height))
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LAUNCHER toggle
  // ════════════════════════════════════════════════════════════════════════════

  openLauncher() {
    const win = this.launcherWindow
    win.style.opacity = "0"
    win.classList.remove("is-hidden")
    void win.offsetWidth
    if (this.launcherSizer) this.launcherSizer.syncOnOpen()
    this.bringLauncherToFront()
    this.updateLauncherDockState(true)
    requestAnimationFrame(() => {
      win.style.removeProperty("opacity")
      this.emitLauncherState(true)
    })
  }

  closeLauncher() {
    this.emitLauncherState(false)
    this.launcherWindow.style.removeProperty("opacity")
    this.launcherWindow.classList.add("is-hidden")
    this.updateLauncherDockState(false)
  }

  emitLauncherState(isOpen) {
    const rect = this.launcherWindow.getBoundingClientRect()
    const z = Number.parseInt(this.launcherWindow.style.zIndex || window.getComputedStyle(this.launcherWindow).zIndex, 10)
    window.dispatchEvent(new CustomEvent("launcher:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        z: Number.isFinite(z) ? z : 1500
      }
    }))
  }

  bringLauncherToFront() {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.launcherWindow.style.zIndex = String(next)
    this.emitLauncherState(true)
  }

  updateLauncherDockState(isOpen) {
    this.refreshLauncherDockButtonRef()
    if (!this.launcherDockButton) return
    this.launcherDockButton.classList.toggle("is-active", isOpen)
    this.launcherDockButton.setAttribute("aria-pressed", isOpen ? "true" : "false")
    this.launcherDockButton.setAttribute("aria-label", isOpen ? "Hide Launcher" : "Open Launcher")
  }

  async applyWorkspaceThemeOnBoot() {
    try {
      const response = await fetch("/workspace_preferences", { headers: { Accept: "application/json" } })
      if (!response.ok) return
      const payload = await response.json()
      const appearance = payload?.appearance
      if (!appearance) return
      this.applyThemeAppearance(appearance)
    } catch (_error) {
      // non-blocking
    }
  }

  applyThemeAppearance(appearance) {
    const root = document.documentElement
    const hue = this.clampInt(appearance.hue, 0, 360, 180)
    const saturation = this.clampInt(appearance.saturation, 0, 100, 0)
    const brightness = this.clampInt(appearance.brightness, 0, 100, 15)
    const alpha = this.clampFloat(appearance.transparency, 0.15, 0.95, 0.15)

    const color1Hue = this.clampInt(appearance.color_1_hue, 0, 360, 240)
    const color1Sat = this.clampInt(appearance.color_1_saturation, 0, 100, 28)
    const color1Bri = this.clampInt(appearance.color_1_brightness, 0, 100, 14)
    const color2Hue = this.clampInt(appearance.color_2_hue, 0, 360, 213)
    const color2Sat = this.clampInt(appearance.color_2_saturation, 0, 100, 73)
    const color2Bri = this.clampInt(appearance.color_2_brightness, 0, 100, 22)
    const angle = this.clampInt(appearance.angle, 0, 360, 135)

    const font1 = this.clampInt(appearance.font_1, 0, 100, 89)
    const font1Alpha = this.clampInt(appearance.font_1_alpha, 0, 100, 100)
    const font2 = this.clampInt(appearance.font_2, 0, 100, 63)
    const font2Alpha = this.clampInt(appearance.font_2_alpha, 0, 100, 100)

    root.style.setProperty("--window-bg-h", String(hue))
    root.style.setProperty("--window-bg-saturation", `${saturation}%`)
    root.style.setProperty("--window-bg-brightness", `${brightness}%`)
    root.style.setProperty("--window-bg-alpha", alpha.toFixed(2))
    root.style.setProperty("--window-ui-hue", String(hue))
    root.style.setProperty("--window-ui-saturation", `${saturation}%`)
    root.style.setProperty("--window-ui-brightness", `${brightness}%`)
    root.style.setProperty("--desktop-bg-1-hue", String(color1Hue))
    root.style.setProperty("--desktop-bg-1-saturation", `${color1Sat}%`)
    root.style.setProperty("--desktop-bg-1-brightness", `${color1Bri}%`)
    root.style.setProperty("--desktop-bg-2-hue", String(color2Hue))
    root.style.setProperty("--desktop-bg-2-saturation", `${color2Sat}%`)
    root.style.setProperty("--desktop-bg-2-brightness", `${color2Bri}%`)
    root.style.setProperty("--desktop-bg-angle", `${angle}deg`)
    root.style.setProperty("--font-1-tone", String(font1))
    root.style.setProperty("--font-1-alpha", (font1Alpha / 100).toFixed(2))
    root.style.setProperty("--font-2-tone", String(font2))
    root.style.setProperty("--font-2-alpha", (font2Alpha / 100).toFixed(2))
  }

  clampInt(value, min, max, fallback) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  }

  clampFloat(value, min, max, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  }

}
