import { Controller } from "@hotwired/stimulus"
import { createOsWindowSizer } from "lib/os_window_sizing"
import { readDockPins, DOCK_HOVER_LABELS } from "lib/dock_pins"

export default class extends Controller {
  connect() {
    this.launcherWindow = document.getElementById("organizer-window")
    this.dockElement = document.getElementById("app-dock")
    this.launcherDockButton = this.dockElement?.querySelector(".app-dock-button--launcher")
    this.dockAppOpen = {}

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

    this.initializeWindows()
    this.applyWorkspaceThemeOnBoot()

    this.renderDockPinnedApps()
    this.dockElement?.addEventListener("click", this.boundDockClick)

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
    this.dockElement?.removeEventListener("click", this.boundDockClick)
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

  renderDockPinnedApps() {
    const dock = this.dockElement
    if (!dock) return
    dock.querySelectorAll("[data-dock-app-key]").forEach((el) => el.remove())
    this.refreshLauncherDockButtonRef()
    const launcherBtn = dock.querySelector(".app-dock-button--launcher")
    if (!launcherBtn) return

    const icons = this.readDockIconHtmlMap()
    const pins = readDockPins()
    let anchor = launcherBtn
    for (const key of pins) {
      const html = icons[key]
      if (!html) continue
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "app-dock-button app-dock-button--dock-app"
      btn.dataset.dockAppKey = key
      const label = DOCK_HOVER_LABELS[key] || key
      btn.setAttribute("data-hover-label", label)
      btn.setAttribute("aria-label", `Open ${label}`)
      btn.setAttribute("aria-pressed", "false")
      btn.innerHTML = html
      anchor.insertAdjacentElement("afterend", btn)
      anchor = btn
      const open = Boolean(this.dockAppOpen[key])
      this.updateDockAppButtonState(btn, open)
    }
    this.anchorLauncherToDock()
  }

  onDockClick(event) {
    const btn = event.target.closest?.("[data-dock-app-key]")
    if (!btn || !this.dockElement?.contains(btn)) return
    event.preventDefault()
    const key = btn.dataset.dockAppKey
    if (!key) return
    this.emitDockAppToggle(key)
  }

  emitDockAppToggle(key) {
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: key } }))
  }

  onDockPinsChanged() {
    this.renderDockPinnedApps()
    this.anchorLauncherToDock()
  }

  onOutsidePointerDown(event) {
    if (!this.launcherWindow || this.launcherWindow.classList.contains("is-hidden")) return
    const t = event.target
    if (typeof t.closest !== "function") return
    if (t.closest("#organizer-window")) return
    if (t.closest("#app-dock")) return
    this.closeLauncher()
  }

  updateDockAppButtonState(btn, isOpen) {
    btn.classList.toggle("is-active", isOpen)
    btn.setAttribute("aria-pressed", isOpen ? "true" : "false")
    const key = btn.dataset.dockAppKey
    const label = DOCK_HOVER_LABELS[key] || key
    btn.setAttribute("aria-label", isOpen ? `Hide ${label}` : `Open ${label}`)
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

  handleAppWindowState(event) {
    const key = event?.detail?.appKey
    if (!key) return
    this.dockAppOpen[key] = Boolean(event.detail.open)
    const btn = this.dockElement?.querySelector(`[data-dock-app-key="${key}"]`)
    if (btn) this.updateDockAppButtonState(btn, this.dockAppOpen[key])
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
    const border = this.clampInt(appearance.border, 0, 100, 20)
    const borderAlpha = this.clampInt(appearance.border_alpha, 0, 100, 100)

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
    root.style.setProperty("--border-tone", String(border))
    root.style.setProperty("--border-alpha", (borderAlpha / 100).toFixed(2))
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
