import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "window",
    "title",
    "stamp",
    "actions",
    "interfaceSection",
    "backButton",
    "hueSlider",
    "hueValue",
    "saturationSlider",
    "saturationValue",
    "brightnessSlider",
    "brightnessValue",
    "transparencySlider",
    "transparencyValue"
  ]

  connect() {
    this.windowWidth = 320
    this.minimumWindowHeight = 125
    this.maximumWindowHeight = 407
    const actionCount = this.element.querySelectorAll(".settings-action").length || 1
    this.actionsWindowHeight = this.calculateCardGridWindowHeight(this.calculateGridRows(actionCount, 2))
    this.interfaceWindowHeight = 298
    this.windowHeight = this.actionsWindowHeight
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.activeDrag = null
    this.defaultTitle = "Settings"
    this.defaultStamp = this.hasStampTarget ? this.stampTarget.textContent : ""

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
    this.boundWindowInteraction = this.handleWindowInteraction.bind(this)
    this.persistAppearanceTimer = null

    this.restoreWindowBounds()
    this.initializeInterfaceControls()
    this.showMainView()
    window.addEventListener("settings:toggle", this.boundToggleRequest)
    this.windowTarget.addEventListener("mousedown", this.boundWindowInteraction)
  }

  disconnect() {
    this.stopDrag()
    if (this.persistAppearanceTimer) clearTimeout(this.persistAppearanceTimer)
    window.removeEventListener("settings:toggle", this.boundToggleRequest)
    this.windowTarget.removeEventListener("mousedown", this.boundWindowInteraction)
  }

  handleWindowInteraction() {
    this.bringToFront()
  }

  handleToggleRequest() {
    this.toggle()
  }

  toggle() {
    const shouldOpen = this.windowTarget.classList.contains("is-hidden")
    if (shouldOpen) {
      this.open()
      return
    }

    this.close()
  }

  open() {
    this.showMainView()
    this.windowTarget.classList.remove("is-hidden")
    this.bringToFront()
    this.emitWindowState(true)
  }

  close(event) {
    if (event) event.preventDefault()
    this.emitWindowState(false)
    this.windowTarget.classList.add("is-hidden")
  }

  emitWindowState(isOpen) {
    const rect = this.windowTarget.getBoundingClientRect()
    const z = Number.parseInt(this.windowTarget.style.zIndex || window.getComputedStyle(this.windowTarget).zIndex, 10)
    window.dispatchEvent(new CustomEvent("settings:state", {
      detail: {
        open: Boolean(isOpen),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        z: Number.isFinite(z) ? z : 1500
      }
    }))
  }

  startDrag(event) {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest(".settings-controls")) return

    this.beginDrag(event)
  }

  beginDrag(event) {
    if (this.windowTarget.classList.contains("is-hidden")) return

    event.preventDefault()
    this.bringToFront()

    const rect = this.windowTarget.getBoundingClientRect()
    const coords = this.getEventCoordinates(event)

    this.activeDrag = {
      offsetX: coords.x - rect.left,
      offsetY: coords.y - rect.top
    }

    document.addEventListener("mousemove", this.boundDragMove)
    document.addEventListener("mouseup", this.boundDragEnd)
    document.addEventListener("touchmove", this.boundDragMove, { passive: false })
    document.addEventListener("touchend", this.boundDragEnd)
  }

  handleDragMove(event) {
    if (!this.activeDrag) return
    if (event.touches) event.preventDefault()

    const coords = this.getEventCoordinates(event)
    const margin = this.viewportMargin
    const width = this.windowTarget.offsetWidth
    const height = this.windowTarget.offsetHeight
    const maxLeft = window.innerWidth - width - margin
    const maxTop = window.innerHeight - height - margin

    const left = Math.min(Math.max(coords.x - this.activeDrag.offsetX, this.dockLeftBoundary), Math.max(this.dockLeftBoundary, maxLeft))
    const top = Math.min(Math.max(coords.y - this.activeDrag.offsetY, margin), Math.max(margin, maxTop))

    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  stopDrag() {
    if (this.activeDrag) {
      this.saveWindowBounds()
      this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
    }
    this.activeDrag = null
    document.removeEventListener("mousemove", this.boundDragMove)
    document.removeEventListener("mouseup", this.boundDragEnd)
    document.removeEventListener("touchmove", this.boundDragMove)
    document.removeEventListener("touchend", this.boundDragEnd)
  }

  factoryReset(event) {
    if (event) event.preventDefault()
    if (!window.confirm("Factory reset desktop layout and interface defaults?")) return
    window.dispatchEvent(new CustomEvent("nexus:layout-reset"))
  }

  showInterface(event) {
    if (event) event.preventDefault()

    this.currentView = "interface"
    this.actionsTarget.classList.add("hidden")
    this.interfaceSectionTarget.classList.remove("hidden")
    this.backButtonTarget.classList.remove("hidden")
    this.titleTarget.textContent = "Interface"
    this.stampTarget.textContent = "Adjust desktop shell color and transparency."
    this.snapWindowToActiveContent()
  }

  showMain(event) {
    if (event) event.preventDefault()
    this.showMainView()
  }

  showMainView() {
    this.currentView = "main"
    if (this.hasActionsTarget) this.actionsTarget.classList.remove("hidden")
    if (this.hasInterfaceSectionTarget) this.interfaceSectionTarget.classList.add("hidden")
    if (this.hasBackButtonTarget) this.backButtonTarget.classList.add("hidden")
    if (this.hasTitleTarget) this.titleTarget.textContent = this.defaultTitle
    if (this.hasStampTarget) this.stampTarget.textContent = this.defaultStamp
    this.snapWindowToActiveContent()
  }

  initializeInterfaceControls() {
    if (
      !this.hasHueSliderTarget ||
      !this.hasHueValueTarget ||
      !this.hasSaturationSliderTarget ||
      !this.hasSaturationValueTarget ||
      !this.hasBrightnessSliderTarget ||
      !this.hasBrightnessValueTarget ||
      !this.hasTransparencySliderTarget ||
      !this.hasTransparencyValueTarget
    ) return

    const model = {
      hue: this.clampHue(this.readCurrentCssNumber("--window-bg-h", 232)),
      saturation: this.clampPercent(this.readCurrentCssNumber("--window-bg-saturation", 62)),
      brightness: this.clampPercent(this.readCurrentCssNumber("--window-bg-brightness", 18)),
      alpha: this.clampTransparency(this.readCurrentCssNumber("--window-bg-alpha", 0.5))
    }

    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.loadAppearanceFromConfig()
  }

  updateHue(event) {
    const hue = this.clampHue(Number.parseInt(event.currentTarget.value, 10))
    const model = this.currentShellModel()
    model.hue = hue
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistAppearance(model)
  }

  updateSaturation(event) {
    const saturation = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    const model = this.currentShellModel()
    model.saturation = saturation
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistAppearance(model)
  }

  updateBrightness(event) {
    const brightness = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    const model = this.currentShellModel()
    model.brightness = brightness
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistAppearance(model)
  }

  updateTransparency(event) {
    const value = Number.parseInt(event.currentTarget.value, 10)
    const model = this.currentShellModel()
    model.alpha = this.clampTransparency((Number.isFinite(value) ? value : 50) / 100)
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistAppearance(model)
  }

  applyWindowShellModel(model) {
    const root = document.documentElement
    root.style.setProperty("--window-bg-h", String(Math.round(model.hue)))
    root.style.setProperty("--window-bg-saturation", `${Math.round(model.saturation)}%`)
    root.style.setProperty("--window-bg-brightness", `${Math.round(model.brightness)}%`)
    root.style.setProperty("--window-bg-alpha", model.alpha.toFixed(2))
    root.style.setProperty("--window-ui-hue", String(Math.round(model.hue)))
    root.style.setProperty("--window-ui-saturation", `${Math.round(model.saturation)}%`)
    root.style.setProperty("--window-ui-brightness", `${Math.round(model.brightness)}%`)
  }

  syncInterfaceControls(model) {
    this.hueSliderTarget.value = String(Math.round(model.hue))
    this.saturationSliderTarget.value = String(Math.round(model.saturation))
    this.brightnessSliderTarget.value = String(Math.round(model.brightness))
    this.transparencySliderTarget.value = String(Math.round(model.alpha * 100))

    this.hueValueTarget.textContent = `${Math.round(model.hue)}°`
    this.saturationValueTarget.textContent = `${Math.round(model.saturation)}%`
    this.brightnessValueTarget.textContent = `${Math.round(model.brightness)}%`
    this.transparencyValueTarget.textContent = `${Math.round(model.alpha * 100)}%`
  }

  currentShellModel() {
    const hue = this.clampHue(Number.parseInt(this.hueSliderTarget.value, 10))
    const saturation = this.clampPercent(Number.parseInt(this.saturationSliderTarget.value, 10))
    const brightness = this.clampPercent(Number.parseInt(this.brightnessSliderTarget.value, 10))
    const alpha = this.clampTransparency(Number.parseInt(this.transparencySliderTarget.value, 10) / 100)
    return { hue, saturation, brightness, alpha }
  }

  schedulePersistAppearance(model) {
    if (this.persistAppearanceTimer) {
      clearTimeout(this.persistAppearanceTimer)
    }

    this.persistAppearanceTimer = setTimeout(() => {
      this.persistAppearance(model)
    }, 120)
  }

  async persistAppearance(model) {
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""

    try {
      await fetch("/workspace_preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({
          appearance: {
            hue: Math.round(model.hue),
            saturation: Math.round(model.saturation),
            brightness: Math.round(model.brightness),
            transparency: Number(model.alpha.toFixed(2))
          }
        })
      })
    } catch (_) {
      // Keep UI responsive even if persistence fails.
    }
  }

  async loadAppearanceFromConfig() {
    try {
      const response = await fetch("/workspace_preferences", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return

      const payload = await response.json()
      const appearance = payload?.appearance
      if (!appearance) return

      const model = {
        hue: this.clampHue(appearance.hue),
        saturation: this.clampPercent(appearance.saturation),
        brightness: this.clampPercent(appearance.brightness),
        alpha: this.clampTransparency(appearance.transparency)
      }

      this.applyWindowShellModel(model)
      this.syncInterfaceControls(model)
    } catch (_) {
      // Non-blocking fallback to existing CSS values.
    }
  }

  readCurrentCssNumber(variableName, fallback) {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return fallback
    return parsed
  }


  clampHue(value) {
    if (!Number.isFinite(value)) return 232
    return Math.min(360, Math.max(0, value))
  }

  clampPercent(value) {
    if (!Number.isFinite(value)) return 0
    return Math.min(100, Math.max(0, value))
  }

  clampTransparency(value) {
    return Math.min(0.95, Math.max(0.15, value))
  }

  setWindowHeight(height) {
    const bounded = Math.min(this.maximumWindowHeight, Math.max(this.minimumWindowHeight, Math.floor(height)))
    this.windowHeight = bounded
    this.windowTarget.style.height = `${bounded}px`
  }

  snapWindowToActiveContent() {
    window.requestAnimationFrame(() => {
      const panel = this.windowTarget.querySelector(".settings-panel")
      if (!panel) return

      // Use intrinsic panel content height; this avoids undercounting margins/gaps.
      const desired = Math.ceil(panel.scrollHeight + 2)

      this.setWindowHeight(desired)
    })
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.settings.bounds")
    if (!bounds) { this.positionWindow(); return }
    this.windowTarget.style.left   = `${bounds.left}px`
    this.windowTarget.style.top    = `${bounds.top}px`
    this.windowTarget.style.width  = `${this.windowWidth}px`
    this.windowTarget.style.height = `${this.windowHeight}px`
  }

  saveWindowBounds() {
    const rect = this.windowTarget.getBoundingClientRect()
    const bounds = { left: Math.round(rect.left), top: Math.round(rect.top) }
    try { localStorage.setItem("nexus.window.settings.bounds", JSON.stringify(bounds)) } catch (_) {}
  }

  readStoredBounds(key) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (typeof parsed?.left !== "number" || typeof parsed?.top !== "number") return null
      return parsed
    } catch (_) { return null }
  }

  getEventCoordinates(event) {
    if (event.touches) {
      return {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      }
    }

    return {
      x: event.clientX,
      y: event.clientY
    }
  }

  positionWindow() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const defaultTop = this.viewportMargin
    const rowGap = 15
    const dbHealthHeight = 235
    const leftColumnLeft = this.dockLeftBoundary
    const width = Math.min(this.windowWidth, Math.max(260, vw - 40))
    const height = Math.min(this.windowHeight, Math.max(this.minimumWindowHeight, vh - 40))
    const desiredTop = defaultTop + dbHealthHeight + rowGap
    const left = Math.max(leftColumnLeft, Math.min(leftColumnLeft, vw - this.viewportMargin - width))
    const top = Math.max(this.viewportMargin, Math.min(desiredTop, vh - this.viewportMargin - height))

    this.windowTarget.style.width = `${width}px`
    this.windowTarget.style.height = `${height}px`
    this.windowTarget.style.left = `${left}px`
    this.windowTarget.style.top = `${top}px`
  }

  bringToFront() {
    if (window.__nexusRestoringLayout) return
    const next = Number(window.__nexusDesktopZIndex || 1500) + 1
    window.__nexusDesktopZIndex = next
    this.windowTarget.style.zIndex = String(next)
    this.emitWindowState(!this.windowTarget.classList.contains("is-hidden"))
  }

  calculateGridRows(itemCount, columns = 2) {
    return Math.max(1, Math.ceil(itemCount / columns))
  }

  calculateCardGridWindowHeight(rows) {
    const baseChromeHeight = 75
    const cardHeight = 50
    const rowGap = 5
    return baseChromeHeight + (rows * cardHeight) + (Math.max(0, rows - 1) * rowGap)
  }
}
