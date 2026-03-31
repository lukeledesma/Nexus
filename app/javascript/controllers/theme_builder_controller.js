import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
    "statusText",
    "hueSlider",
    "hueValue",
    "saturationSlider",
    "saturationValue",
    "brightnessSlider",
    "brightnessValue",
    "transparencySlider",
    "transparencyValue",
    "bgOneHueSlider",
    "bgOneHueValue",
    "bgOneSaturationSlider",
    "bgOneSaturationValue",
    "bgOneBrightnessSlider",
    "bgOneBrightnessValue",
    "bgTwoHueSlider",
    "bgTwoHueValue",
    "bgTwoSaturationSlider",
    "bgTwoSaturationValue",
    "bgTwoBrightnessSlider",
    "bgTwoBrightnessValue",
    "bgAngleSlider",
    "bgAngleValue"
  ]

  connect() {
    this.defaultShellModel = {
      hue: 180,
      saturation: 0,
      brightness: 15,
      alpha: 0.15
    }
    this.defaultBackgroundModel = {
      colorOneHue: 240,
      colorOneSaturation: 28,
      colorOneBrightness: 14,
      colorTwoHue: 213,
      colorTwoSaturation: 73,
      colorTwoBrightness: 22,
      angle: 135
    }

    this.appearanceNotifyTimer = null
    this.activeThemeName = ""
    this.isCustomLayout = false
    this.activeThemeAppearanceSnapshot = this.buildAppearancePayload(this.defaultShellModel, this.defaultBackgroundModel)

    this.loadWorkspacePreferences()
  }

  disconnect() {
    if (this.appearanceNotifyTimer) clearTimeout(this.appearanceNotifyTimer)
  }

  async loadWorkspacePreferences() {
    try {
      const response = await fetch("/workspace_preferences", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return

      const payload = await response.json()
      const appearance = payload?.appearance || {}

      const shellModel = {
        hue: this.clampHue(appearance.hue),
        saturation: this.clampPercent(appearance.saturation),
        brightness: this.clampPercent(appearance.brightness),
        alpha: this.clampTransparency(appearance.transparency)
      }

      const backgroundModel = {
        colorOneHue: this.clampHue(appearance.color_1_hue),
        colorOneSaturation: this.clampPercent(appearance.color_1_saturation),
        colorOneBrightness: this.clampPercent(appearance.color_1_brightness),
        colorTwoHue: this.clampHue(appearance.color_2_hue),
        colorTwoSaturation: this.clampPercent(appearance.color_2_saturation),
        colorTwoBrightness: this.clampPercent(appearance.color_2_brightness),
        angle: this.clampAngle(appearance.angle)
      }

      this.activeThemeName = String(payload?.active_theme_name || "").trim()
      this.isCustomLayout = false
      this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)
      this.applyWindowShellModel(shellModel)
      this.syncShellControls(shellModel)
      this.applyDesktopBackgroundModel(backgroundModel)
      this.syncBackgroundControls(backgroundModel)
      this.broadcastThemeStatus(this.buildAppearancePayload(shellModel, backgroundModel), false)
    } catch (_error) {
      // Non-blocking fallback to existing CSS values.
    }
  }

  updateHue() {
    this.hueValueTarget.textContent = `${this.clampHue(this.hueSliderTarget.value)}°`
    this.applyWindowShellModel(this.currentShellModel())
    this.queueNotifyAppearanceChange()
  }

  updateSaturation() {
    this.saturationValueTarget.textContent = `${this.clampPercent(this.saturationSliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.queueNotifyAppearanceChange()
  }

  updateBrightness() {
    this.brightnessValueTarget.textContent = `${this.clampPercent(this.brightnessSliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.queueNotifyAppearanceChange()
  }

  updateTransparency() {
    this.transparencyValueTarget.textContent = `${this.clampTransparencyPercent(this.transparencySliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgOneHue() {
    this.bgOneHueValueTarget.textContent = `${this.clampHue(this.bgOneHueSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgOneSaturation() {
    this.bgOneSaturationValueTarget.textContent = `${this.clampPercent(this.bgOneSaturationSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgOneBrightness() {
    this.bgOneBrightnessValueTarget.textContent = `${this.clampPercent(this.bgOneBrightnessSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoHue() {
    this.bgTwoHueValueTarget.textContent = `${this.clampHue(this.bgTwoHueSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoSaturation() {
    this.bgTwoSaturationValueTarget.textContent = `${this.clampPercent(this.bgTwoSaturationSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoBrightness() {
    this.bgTwoBrightnessValueTarget.textContent = `${this.clampPercent(this.bgTwoBrightnessSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  updateBgAngle() {
    this.bgAngleValueTarget.textContent = `${this.clampAngle(this.bgAngleSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.queueNotifyAppearanceChange()
  }

  queueNotifyAppearanceChange() {
    if (this.appearanceNotifyTimer) clearTimeout(this.appearanceNotifyTimer)
    this.appearanceNotifyTimer = setTimeout(() => this.notifyAppearanceChange(), 180)
  }

  notifyAppearanceChange() {
    this.isCustomLayout = true
    const appearance = this.buildAppearancePayload(this.currentShellModel(), this.currentBackgroundModel())
    this.broadcastThemeStatus(appearance, true)
  }

  broadcastThemeStatus(appearance, isCustom) {
    const name = this.activeThemeName || "Default"
    const statusValue = isCustom ? "CUSTOM" : name
    if (this.hasStatusTextTarget) this.statusTextTarget.textContent = statusValue
    window.dispatchEvent(new CustomEvent("workspace:theme-status", {
      detail: {
        active_theme_name: name,
        is_custom_layout: isCustom,
        appearance
      }
    }))
  }

  currentShellModel() {
    return {
      hue: this.clampHue(this.hueSliderTarget.value),
      saturation: this.clampPercent(this.saturationSliderTarget.value),
      brightness: this.clampPercent(this.brightnessSliderTarget.value),
      alpha: this.clampTransparencyFromPercent(this.transparencySliderTarget.value)
    }
  }

  currentBackgroundModel() {
    return {
      colorOneHue: this.clampHue(this.bgOneHueSliderTarget.value),
      colorOneSaturation: this.clampPercent(this.bgOneSaturationSliderTarget.value),
      colorOneBrightness: this.clampPercent(this.bgOneBrightnessSliderTarget.value),
      colorTwoHue: this.clampHue(this.bgTwoHueSliderTarget.value),
      colorTwoSaturation: this.clampPercent(this.bgTwoSaturationSliderTarget.value),
      colorTwoBrightness: this.clampPercent(this.bgTwoBrightnessSliderTarget.value),
      angle: this.clampAngle(this.bgAngleSliderTarget.value)
    }
  }

  syncShellControls(model) {
    this.hueSliderTarget.value = String(model.hue)
    this.hueValueTarget.textContent = `${model.hue}°`

    this.saturationSliderTarget.value = String(model.saturation)
    this.saturationValueTarget.textContent = `${model.saturation}%`

    this.brightnessSliderTarget.value = String(model.brightness)
    this.brightnessValueTarget.textContent = `${model.brightness}%`

    const alphaPercent = this.clampTransparencyPercent(model.alpha * 100)
    this.transparencySliderTarget.value = String(alphaPercent)
    this.transparencyValueTarget.textContent = `${alphaPercent}%`
  }

  syncBackgroundControls(model) {
    this.bgOneHueSliderTarget.value = String(model.colorOneHue)
    this.bgOneHueValueTarget.textContent = `${model.colorOneHue}°`

    this.bgOneSaturationSliderTarget.value = String(model.colorOneSaturation)
    this.bgOneSaturationValueTarget.textContent = `${model.colorOneSaturation}%`

    this.bgOneBrightnessSliderTarget.value = String(model.colorOneBrightness)
    this.bgOneBrightnessValueTarget.textContent = `${model.colorOneBrightness}%`

    this.bgTwoHueSliderTarget.value = String(model.colorTwoHue)
    this.bgTwoHueValueTarget.textContent = `${model.colorTwoHue}°`

    this.bgTwoSaturationSliderTarget.value = String(model.colorTwoSaturation)
    this.bgTwoSaturationValueTarget.textContent = `${model.colorTwoSaturation}%`

    this.bgTwoBrightnessSliderTarget.value = String(model.colorTwoBrightness)
    this.bgTwoBrightnessValueTarget.textContent = `${model.colorTwoBrightness}%`

    this.bgAngleSliderTarget.value = String(model.angle)
    this.bgAngleValueTarget.textContent = `${model.angle}°`
  }

  applyWindowShellModel(model) {
    const alpha = this.clampTransparency(model.alpha)
    document.documentElement.style.setProperty("--window-bg-h", String(this.clampHue(model.hue)))
    document.documentElement.style.setProperty("--window-bg-saturation", `${this.clampPercent(model.saturation)}%`)
    document.documentElement.style.setProperty("--window-bg-brightness", `${this.clampPercent(model.brightness)}%`)
    document.documentElement.style.setProperty("--window-bg-alpha", alpha.toFixed(2))
    document.documentElement.style.setProperty("--window-ui-hue", String(this.clampHue(model.hue)))
    document.documentElement.style.setProperty("--window-ui-saturation", `${this.clampPercent(model.saturation)}%`)
    document.documentElement.style.setProperty("--window-ui-brightness", `${this.clampPercent(model.brightness)}%`)
  }

  applyDesktopBackgroundModel(model) {
    document.documentElement.style.setProperty("--desktop-bg-1-hue", String(this.clampHue(model.colorOneHue)))
    document.documentElement.style.setProperty("--desktop-bg-1-saturation", `${this.clampPercent(model.colorOneSaturation)}%`)
    document.documentElement.style.setProperty("--desktop-bg-1-brightness", `${this.clampPercent(model.colorOneBrightness)}%`)
    document.documentElement.style.setProperty("--desktop-bg-2-hue", String(this.clampHue(model.colorTwoHue)))
    document.documentElement.style.setProperty("--desktop-bg-2-saturation", `${this.clampPercent(model.colorTwoSaturation)}%`)
    document.documentElement.style.setProperty("--desktop-bg-2-brightness", `${this.clampPercent(model.colorTwoBrightness)}%`)
    document.documentElement.style.setProperty("--desktop-bg-angle", `${this.clampAngle(model.angle)}deg`)
  }

  buildAppearancePayload(shellModel, backgroundModel) {
    return {
      hue: Math.round(shellModel.hue),
      saturation: Math.round(shellModel.saturation),
      brightness: Math.round(shellModel.brightness),
      transparency: Number(shellModel.alpha.toFixed(2)),
      color_1_hue: Math.round(backgroundModel.colorOneHue),
      color_1_saturation: Math.round(backgroundModel.colorOneSaturation),
      color_1_brightness: Math.round(backgroundModel.colorOneBrightness),
      color_2_hue: Math.round(backgroundModel.colorTwoHue),
      color_2_saturation: Math.round(backgroundModel.colorTwoSaturation),
      color_2_brightness: Math.round(backgroundModel.colorTwoBrightness),
      angle: Math.round(backgroundModel.angle)
    }
  }

  normalizedAppearanceSnapshot(appearance) {
    const shellModel = {
      hue: this.clampHue(appearance.hue),
      saturation: this.clampPercent(appearance.saturation),
      brightness: this.clampPercent(appearance.brightness),
      alpha: this.clampTransparency(appearance.transparency)
    }

    const backgroundModel = {
      colorOneHue: this.clampHue(appearance.color_1_hue),
      colorOneSaturation: this.clampPercent(appearance.color_1_saturation),
      colorOneBrightness: this.clampPercent(appearance.color_1_brightness),
      colorTwoHue: this.clampHue(appearance.color_2_hue),
      colorTwoSaturation: this.clampPercent(appearance.color_2_saturation),
      colorTwoBrightness: this.clampPercent(appearance.color_2_brightness),
      angle: this.clampAngle(appearance.angle)
    }

    return this.buildAppearancePayload(shellModel, backgroundModel)
  }

  clampHue(value) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return this.defaultShellModel.hue
    return Math.min(360, Math.max(0, parsed))
  }

  clampPercent(value) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return 0
    return Math.min(100, Math.max(0, parsed))
  }

  clampAngle(value) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return this.defaultBackgroundModel.angle
    return Math.min(360, Math.max(0, parsed))
  }

  clampTransparency(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return this.defaultShellModel.alpha
    return Math.min(0.95, Math.max(0.15, parsed))
  }

  clampTransparencyPercent(value) {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return 15
    return Math.min(95, Math.max(15, parsed))
  }

  clampTransparencyFromPercent(value) {
    return this.clampTransparency(this.clampTransparencyPercent(value) / 100)
  }
}
