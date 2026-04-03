import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = [
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
    "bgAngleValue",
    "fontOneSlider",
    "fontOneValue",
    "fontOneTransparencySlider",
    "fontOneTransparencyValue",
    "fontTwoSlider",
    "fontTwoValue",
    "fontTwoTransparencySlider",
    "fontTwoTransparencyValue",
    "borderSlider",
    "borderValue",
    "borderTransparencySlider",
    "borderTransparencyValue"
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
    this.defaultContentModel = {
      fontOne: 89,
      fontOneAlpha: 100,
      fontTwo: 63,
      fontTwoAlpha: 100,
      border: 20,
      borderAlpha: 100
    }

    this.appearanceNotifyTimer = null
    this.persistAppearanceTimer = null
    this.activeThemeName = ""
    this.activeThemeId = "default"
    this.isCustomLayout = false
    this.themes = []
    this.activeThemeAppearanceSnapshot = this.buildAppearancePayload(this.defaultShellModel, this.defaultBackgroundModel, this.defaultContentModel)
    this.boundThemeStatus = this.handleThemeStatus.bind(this)
    this.boundChromeSaveClick = this.beginSaveCustomTheme.bind(this)
    this.boundChromeNameBlur = this.submitCustomThemeName.bind(this)
    this.boundChromeNameKeydown = this.handleNameInputKeydown.bind(this)

    this.bindChromeControls()
    this.syncSliderThumbColors()
    this.loadWorkspacePreferences()
    window.addEventListener("workspace:theme-status", this.boundThemeStatus)
  }

  disconnect() {
    if (this.appearanceNotifyTimer) clearTimeout(this.appearanceNotifyTimer)
    if (this.persistAppearanceTimer) clearTimeout(this.persistAppearanceTimer)
    this.unbindChromeControls()
    window.removeEventListener("workspace:theme-status", this.boundThemeStatus)
  }

  toggleSection(event) {
    const trigger = event.currentTarget
    const section = trigger.closest(".theme-builder-section")
    if (!section) return

    section.classList.toggle("is-collapsed")
    const isExpanded = !section.classList.contains("is-collapsed")
    trigger.setAttribute("aria-expanded", isExpanded ? "true" : "false")
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

      const contentModel = {
        fontOne: this.clampPercent(Number.isFinite(Number(appearance.font_1)) ? appearance.font_1 : this.defaultContentModel.fontOne),
        fontOneAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_1_alpha)) ? appearance.font_1_alpha : this.defaultContentModel.fontOneAlpha),
        fontTwo: this.clampPercent(Number.isFinite(Number(appearance.font_2)) ? appearance.font_2 : this.defaultContentModel.fontTwo),
        fontTwoAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_2_alpha)) ? appearance.font_2_alpha : this.defaultContentModel.fontTwoAlpha),
        border: this.clampPercent(Number.isFinite(Number(appearance.border)) ? appearance.border : this.defaultContentModel.border),
        borderAlpha: this.clampPercent(Number.isFinite(Number(appearance.border_alpha)) ? appearance.border_alpha : this.defaultContentModel.borderAlpha)
      }

      this.themes = Array.isArray(payload?.themes) ? payload.themes : []
      this.activeThemeName = String(payload?.active_theme_name || "").trim()
      this.activeThemeId = String(payload?.active_theme_id || this.activeThemeId || "default")
      this.isCustomLayout = Boolean(payload?.is_custom_layout)
      this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)
      this.applyWindowShellModel(shellModel)
      this.syncShellControls(shellModel)
      this.applyDesktopBackgroundModel(backgroundModel)
      this.syncBackgroundControls(backgroundModel)
      this.applyContentToneModel(contentModel)
      this.syncContentControls(contentModel)
      this.syncSliderThumbColors()
      this.broadcastThemeStatus(this.buildAppearancePayload(shellModel, backgroundModel, contentModel), this.isCustomLayout)
    } catch (_error) {
      // Non-blocking fallback to existing CSS values.
    }
  }

  beginSaveCustomTheme(event) {
    if (event) event.preventDefault()
    if (!this.isCustomLayout) return
    const nameInput = this.nameInputElement()
    const statusText = this.statusTextElement()
    const saveButton = this.saveButtonElement()
    if (!nameInput) return

    nameInput.value = ""
    nameInput.classList.remove("theme-builder-hidden")
    if (statusText) statusText.classList.add("theme-builder-hidden")
    if (saveButton) saveButton.classList.add("theme-builder-hidden")
    nameInput.focus()
  }

  async submitCustomThemeName(event) {
    if (event) event.preventDefault()
    const nameInput = this.nameInputElement()
    const statusText = this.statusTextElement()
    if (!nameInput) return

    const name = nameInput.value.trim().slice(0, 64)
    if (!name) {
      this.cancelSaveCustomThemeName()
      return
    }

    const appearance = this.buildAppearancePayload(this.currentShellModel(), this.currentBackgroundModel(), this.currentContentModel())
    const payload = await this.submitThemeAction({ action: "save", name, appearance })
    if (!payload) {
      this.cancelSaveCustomThemeName()
      return
    }

    this.themes = Array.isArray(payload?.themes) ? payload.themes : this.themes
    this.activeThemeId = String(payload?.active_theme_id || this.activeThemeId || "default")
    this.activeThemeName = String(payload?.active_theme_name || this.activeThemeName || "Default").trim()
    this.isCustomLayout = Boolean(payload?.is_custom_layout)

    const appliedAppearance = payload?.appearance || appearance
    this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appliedAppearance)
    nameInput.classList.add("theme-builder-hidden")
    nameInput.value = ""
    if (statusText) statusText.classList.remove("theme-builder-hidden")
    this.broadcastThemeStatus(appliedAppearance, this.isCustomLayout, true)
  }

  handleNameInputKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      this.submitCustomThemeName()
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      this.cancelSaveCustomThemeName()
    }
  }

  cancelSaveCustomThemeName() {
    const nameInput = this.nameInputElement()
    const statusText = this.statusTextElement()
    if (!nameInput) return

    nameInput.classList.add("theme-builder-hidden")
    nameInput.value = ""
    if (statusText) statusText.classList.remove("theme-builder-hidden")
    this.updateStatusUi()
  }

  updateHue() {
    this.hueValueTarget.textContent = `${this.clampHue(this.hueSliderTarget.value)}°`
    this.applyWindowShellModel(this.currentShellModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateSaturation() {
    this.saturationValueTarget.textContent = `${this.clampPercent(this.saturationSliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBrightness() {
    this.brightnessValueTarget.textContent = `${this.clampPercent(this.brightnessSliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateTransparency() {
    this.transparencyValueTarget.textContent = `${this.clampTransparencyPercent(this.transparencySliderTarget.value)}%`
    this.applyWindowShellModel(this.currentShellModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgOneHue() {
    this.bgOneHueValueTarget.textContent = `${this.clampHue(this.bgOneHueSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgOneSaturation() {
    this.bgOneSaturationValueTarget.textContent = `${this.clampPercent(this.bgOneSaturationSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgOneBrightness() {
    this.bgOneBrightnessValueTarget.textContent = `${this.clampPercent(this.bgOneBrightnessSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoHue() {
    this.bgTwoHueValueTarget.textContent = `${this.clampHue(this.bgTwoHueSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoSaturation() {
    this.bgTwoSaturationValueTarget.textContent = `${this.clampPercent(this.bgTwoSaturationSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgTwoBrightness() {
    this.bgTwoBrightnessValueTarget.textContent = `${this.clampPercent(this.bgTwoBrightnessSliderTarget.value)}%`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBgAngle() {
    this.bgAngleValueTarget.textContent = `${this.clampAngle(this.bgAngleSliderTarget.value)}°`
    this.applyDesktopBackgroundModel(this.currentBackgroundModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateFontOne() {
    this.fontOneValueTarget.textContent = `${this.clampPercent(this.fontOneSliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateFontTwo() {
    this.fontTwoValueTarget.textContent = `${this.clampPercent(this.fontTwoSliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBorder() {
    this.borderValueTarget.textContent = `${this.clampPercent(this.borderSliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateFontOneTransparency() {
    this.fontOneTransparencyValueTarget.textContent = `${this.clampPercent(this.fontOneTransparencySliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateFontTwoTransparency() {
    this.fontTwoTransparencyValueTarget.textContent = `${this.clampPercent(this.fontTwoTransparencySliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  updateBorderTransparency() {
    this.borderTransparencyValueTarget.textContent = `${this.clampPercent(this.borderTransparencySliderTarget.value)}%`
    this.applyContentToneModel(this.currentContentModel())
    this.syncSliderThumbColors()
    this.queueNotifyAppearanceChange()
  }

  handleThemeStatus(event) {
    const detail = event?.detail || {}
    const nextIsCustomLayout = Boolean(detail?.is_custom_layout)
    if (Array.isArray(detail?.themes)) this.themes = detail.themes
    this.activeThemeId = String(detail?.active_theme_id || this.activeThemeId || "default")

    // Prevent an in-flight slider debounce from rebroadcasting stale custom state
    // after another controller has already applied a saved theme.
    if (!nextIsCustomLayout && this.appearanceNotifyTimer) {
      clearTimeout(this.appearanceNotifyTimer)
      this.appearanceNotifyTimer = null
    }

    if (!detail || !detail.appearance) {
      this.activeThemeName = String(detail?.active_theme_name || this.activeThemeName || "").trim()
      this.isCustomLayout = nextIsCustomLayout
      this.cancelSaveCustomThemeName()
      return
    }

    const appearance = detail.appearance
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

    const contentModel = {
      fontOne: this.clampPercent(Number.isFinite(Number(appearance.font_1)) ? appearance.font_1 : this.defaultContentModel.fontOne),
      fontOneAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_1_alpha)) ? appearance.font_1_alpha : this.defaultContentModel.fontOneAlpha),
      fontTwo: this.clampPercent(Number.isFinite(Number(appearance.font_2)) ? appearance.font_2 : this.defaultContentModel.fontTwo),
      fontTwoAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_2_alpha)) ? appearance.font_2_alpha : this.defaultContentModel.fontTwoAlpha),
      border: this.clampPercent(Number.isFinite(Number(appearance.border)) ? appearance.border : this.defaultContentModel.border),
      borderAlpha: this.clampPercent(Number.isFinite(Number(appearance.border_alpha)) ? appearance.border_alpha : this.defaultContentModel.borderAlpha)
    }

    this.activeThemeName = String(detail?.active_theme_name || this.activeThemeName || "").trim()
    this.isCustomLayout = nextIsCustomLayout
    this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)

    this.applyWindowShellModel(shellModel)
    this.syncShellControls(shellModel)
    this.applyDesktopBackgroundModel(backgroundModel)
    this.syncBackgroundControls(backgroundModel)
    this.applyContentToneModel(contentModel)
    this.syncContentControls(contentModel)
    this.syncSliderThumbColors()
    this.cancelSaveCustomThemeName()
  }

  syncSliderThumbColors() {
    const shell = this.currentShellModel()
    const background = this.currentBackgroundModel()

    const shellHue = this.clampHue(shell.hue)
    const shellSaturation = this.clampPercent(shell.saturation)
    const shellBrightness = this.clampPercent(shell.brightness)

    const bgOneHue = this.clampHue(background.colorOneHue)
    const bgOneSaturation = this.clampPercent(background.colorOneSaturation)
    const bgOneBrightness = this.clampPercent(background.colorOneBrightness)
    const bgTwoHue = this.clampHue(background.colorTwoHue)
    const bgTwoSaturation = this.clampPercent(background.colorTwoSaturation)
    const bgTwoBrightness = this.clampPercent(background.colorTwoBrightness)
    const angleMixPercent = (this.clampAngle(background.angle) / 360) * 100
    const content = this.currentContentModel()

    this.hueSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${shellHue} 100% 50%)`)
    this.saturationSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${shellHue} ${shellSaturation}% ${shellBrightness}%)`)
    this.brightnessSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${shellHue} ${shellSaturation}% ${shellBrightness}%)`)
    this.transparencySliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${shellHue} ${shellSaturation}% ${shellBrightness}%)`)

    this.bgOneHueSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgOneHue} 100% 50%)`)
    this.bgOneSaturationSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgOneHue} ${bgOneSaturation}% ${bgOneBrightness}%)`)
    this.bgOneBrightnessSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgOneHue} ${bgOneSaturation}% ${bgOneBrightness}%)`)

    this.bgTwoHueSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgTwoHue} 100% 50%)`)
    this.bgTwoSaturationSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgTwoHue} ${bgTwoSaturation}% ${bgTwoBrightness}%)`)
    this.bgTwoBrightnessSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(${bgTwoHue} ${bgTwoSaturation}% ${bgTwoBrightness}%)`)

    this.bgAngleSliderTarget.style.setProperty(
      "--slider-thumb-bg",
      `color-mix(in oklab, hsl(${bgOneHue} ${bgOneSaturation}% ${bgOneBrightness}%) ${100 - angleMixPercent}%, hsl(${bgTwoHue} ${bgTwoSaturation}% ${bgTwoBrightness}%) ${angleMixPercent}%)`
    )

    this.fontOneSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.fontOne)}%)`)
    this.fontOneTransparencySliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.fontOne)}% / ${this.clampPercent(content.fontOneAlpha)}%)`)
    this.fontTwoSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.fontTwo)}%)`)
    this.fontTwoTransparencySliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.fontTwo)}% / ${this.clampPercent(content.fontTwoAlpha)}%)`)
    this.borderSliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.border)}%)`)
    this.borderTransparencySliderTarget.style.setProperty("--slider-thumb-bg", `hsl(0 0% ${this.clampPercent(content.border)}% / ${this.clampPercent(content.borderAlpha)}%)`)
  }

  queueNotifyAppearanceChange() {
    if (this.appearanceNotifyTimer) clearTimeout(this.appearanceNotifyTimer)
    this.appearanceNotifyTimer = setTimeout(() => this.notifyAppearanceChange(), 180)
  }

  notifyAppearanceChange() {
    this.activeThemeId = "custom"
    this.isCustomLayout = true
    const appearance = this.buildAppearancePayload(this.currentShellModel(), this.currentBackgroundModel(), this.currentContentModel())
    this.persistAppearance(appearance)
    this.broadcastThemeStatus(appearance, true)
  }

  broadcastThemeStatus(appearance, isCustom, includeThemes = false) {
    const name = this.activeThemeName || "Default"
    this.updateStatusUi()
    const detail = {
      active_theme_name: name,
      active_theme_id: isCustom ? "custom" : this.activeThemeId,
      is_custom_layout: isCustom,
      appearance
    }
    if (includeThemes) detail.themes = this.themes

    window.dispatchEvent(new CustomEvent("workspace:theme-status", {
      detail
    }))
  }

  async submitThemeAction(themePayload) {
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""

    try {
      const response = await fetch("/workspace_preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({ theme: themePayload })
      })
      if (!response.ok) return null
      return response.json()
    } catch (_error) {
      return null
    }
  }

  updateStatusUi() {
    const nameInput = this.nameInputElement()
    const statusText = this.statusTextElement()
    const saveButton = this.saveButtonElement()

    if (!this.isCustomLayout && nameInput) {
      nameInput.classList.add("theme-builder-hidden")
      nameInput.value = ""
      if (statusText) statusText.classList.remove("theme-builder-hidden")
    }

    const statusValue = this.isCustomLayout ? "CUSTOM" : (this.activeThemeName || "Default")
    if (statusText) statusText.textContent = statusValue
    if (saveButton) {
      saveButton.classList.toggle("theme-builder-hidden", !this.isCustomLayout || (nameInput && !nameInput.classList.contains("theme-builder-hidden")))
    }
  }

  bindChromeControls() {
    const saveButton = this.saveButtonElement()
    const nameInput = this.nameInputElement()
    if (saveButton) saveButton.addEventListener("click", this.boundChromeSaveClick)
    if (nameInput) {
      nameInput.addEventListener("blur", this.boundChromeNameBlur)
      nameInput.addEventListener("keydown", this.boundChromeNameKeydown)
    }
  }

  unbindChromeControls() {
    const saveButton = this.saveButtonElement()
    const nameInput = this.nameInputElement()
    if (saveButton) saveButton.removeEventListener("click", this.boundChromeSaveClick)
    if (nameInput) {
      nameInput.removeEventListener("blur", this.boundChromeNameBlur)
      nameInput.removeEventListener("keydown", this.boundChromeNameKeydown)
    }
  }

  chromeRoot() {
    return this.element.closest(".content-window")
  }

  statusTextElement() {
    return this.chromeRoot()?.querySelector("[data-theme-studio-chrome='status']") || null
  }

  nameInputElement() {
    return this.chromeRoot()?.querySelector("[data-theme-studio-chrome='name-input']") || null
  }

  saveButtonElement() {
    return this.chromeRoot()?.querySelector("[data-theme-studio-chrome='save']") || null
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

  currentContentModel() {
    return {
      fontOne: this.clampPercent(this.fontOneSliderTarget.value),
      fontOneAlpha: this.clampPercent(this.fontOneTransparencySliderTarget.value),
      fontTwo: this.clampPercent(this.fontTwoSliderTarget.value),
      fontTwoAlpha: this.clampPercent(this.fontTwoTransparencySliderTarget.value),
      border: this.clampPercent(this.borderSliderTarget.value),
      borderAlpha: this.clampPercent(this.borderTransparencySliderTarget.value)
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

  syncContentControls(model) {
    this.fontOneSliderTarget.value = String(model.fontOne)
    this.fontOneValueTarget.textContent = `${model.fontOne}%`
    this.fontOneTransparencySliderTarget.value = String(model.fontOneAlpha)
    this.fontOneTransparencyValueTarget.textContent = `${model.fontOneAlpha}%`

    this.fontTwoSliderTarget.value = String(model.fontTwo)
    this.fontTwoValueTarget.textContent = `${model.fontTwo}%`
    this.fontTwoTransparencySliderTarget.value = String(model.fontTwoAlpha)
    this.fontTwoTransparencyValueTarget.textContent = `${model.fontTwoAlpha}%`

    this.borderSliderTarget.value = String(model.border)
    this.borderValueTarget.textContent = `${model.border}%`
    this.borderTransparencySliderTarget.value = String(model.borderAlpha)
    this.borderTransparencyValueTarget.textContent = `${model.borderAlpha}%`
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

  applyContentToneModel(model) {
    document.documentElement.style.setProperty("--font-1-tone", String(this.clampPercent(model.fontOne)))
    document.documentElement.style.setProperty("--font-1-alpha", (this.clampPercent(model.fontOneAlpha) / 100).toFixed(2))
    document.documentElement.style.setProperty("--font-2-tone", String(this.clampPercent(model.fontTwo)))
    document.documentElement.style.setProperty("--font-2-alpha", (this.clampPercent(model.fontTwoAlpha) / 100).toFixed(2))
    document.documentElement.style.setProperty("--border-tone", String(this.clampPercent(model.border)))
    document.documentElement.style.setProperty("--border-alpha", (this.clampPercent(model.borderAlpha) / 100).toFixed(2))
  }

  buildAppearancePayload(shellModel, backgroundModel, contentModel) {
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
      angle: Math.round(backgroundModel.angle),
      font_1: Math.round(contentModel.fontOne),
      font_1_alpha: Math.round(contentModel.fontOneAlpha),
      font_2: Math.round(contentModel.fontTwo),
      font_2_alpha: Math.round(contentModel.fontTwoAlpha),
      border: Math.round(contentModel.border),
      border_alpha: Math.round(contentModel.borderAlpha)
    }
  }

  persistAppearance(appearance) {
    if (this.persistAppearanceTimer) clearTimeout(this.persistAppearanceTimer)

    this.persistAppearanceTimer = setTimeout(async () => {
      const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""

      try {
        await fetch("/workspace_preferences", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken
          },
          body: JSON.stringify({ appearance })
        })
      } catch (_error) {
        // Keep UI responsive even when persistence fails.
      }
    }, 120)
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

    const contentModel = {
      fontOne: this.clampPercent(Number.isFinite(Number(appearance.font_1)) ? appearance.font_1 : this.defaultContentModel.fontOne),
      fontOneAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_1_alpha)) ? appearance.font_1_alpha : this.defaultContentModel.fontOneAlpha),
      fontTwo: this.clampPercent(Number.isFinite(Number(appearance.font_2)) ? appearance.font_2 : this.defaultContentModel.fontTwo),
      fontTwoAlpha: this.clampPercent(Number.isFinite(Number(appearance.font_2_alpha)) ? appearance.font_2_alpha : this.defaultContentModel.fontTwoAlpha),
      border: this.clampPercent(Number.isFinite(Number(appearance.border)) ? appearance.border : this.defaultContentModel.border),
      borderAlpha: this.clampPercent(Number.isFinite(Number(appearance.border_alpha)) ? appearance.border_alpha : this.defaultContentModel.borderAlpha)
    }

    return this.buildAppearancePayload(shellModel, backgroundModel, contentModel)
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
