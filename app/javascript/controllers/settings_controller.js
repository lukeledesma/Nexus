import { Controller } from "@hotwired/stimulus"
import { createOsWindowSizer } from "lib/os_window_sizing"

export default class extends Controller {
  static targets = [
    "window",
    "title",
    "stamp",
    "actions",
    "interfaceSection",
    "backgroundSection",
    "themesSection",
    "backButton",
    "shellStatus",
    "backgroundStatus",
    "themeStatus",
    "themesList",
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
    this.windowWidth = 320
    this.viewportMargin = 6
    this.dockLeftBoundary = 41
    this.activeDrag = null
    this.defaultTitle = "Settings"
    this.defaultStamp = this.hasStampTarget ? this.stampTarget.textContent : ""
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

    this.themes = []
    this.themeDraft = null
    this.selectedThemeId = "default"
    this.activeThemeId = "default"
    this.activeThemeAppearanceSnapshot = this.buildAppearancePayload(this.defaultShellModel, this.defaultBackgroundModel)
    this.serverIsCustomLayout = false
    this.currentLiveAppearance = null

    this.boundDragMove = this.handleDragMove.bind(this)
    this.boundDragEnd = this.stopDrag.bind(this)
    this.boundToggleRequest = this.handleToggleRequest.bind(this)
    this.boundWindowInteraction = this.handleWindowInteraction.bind(this)
    this.boundThemeStatus = this.handleThemeStatus.bind(this)
    this.persistPreferencesTimer = null

    this.restoreWindowBounds()
    this.windowSizer = createOsWindowSizer({
      windowId: "settings",
      windowElement: this.windowTarget,
      contentElement: this.windowTarget.querySelector(".settings-panel"),
      viewportMargin: this.viewportMargin,
      isWindowOpen: () => !this.windowTarget.classList.contains("is-hidden")
    })
    this.windowSizer.observeContent()
    this.initializeControls()
    this.showMainView()
    window.addEventListener("settings:toggle", this.boundToggleRequest)
    window.addEventListener("workspace:theme-status", this.boundThemeStatus)
    this.windowTarget.addEventListener("mousedown", this.boundWindowInteraction)
  }

  disconnect() {
    this.stopDrag()
    if (this.persistPreferencesTimer) clearTimeout(this.persistPreferencesTimer)
    if (this.windowSizer) this.windowSizer.disconnect()
    window.removeEventListener("settings:toggle", this.boundToggleRequest)
    window.removeEventListener("workspace:theme-status", this.boundThemeStatus)
    this.windowTarget.removeEventListener("mousedown", this.boundWindowInteraction)
  }

  handleWindowInteraction() {
    this.bringToFront()
  }

  handleThemeStatus(event) {
    const isCustomLayout = Boolean(event?.detail?.is_custom_layout)
    this.serverIsCustomLayout = isCustomLayout
    if (event?.detail?.appearance) {
      this.currentLiveAppearance = event.detail.appearance
    }
    this.refreshActionStatusBadges()
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
    if (this.windowSizer) this.windowSizer.syncOnOpen()
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

  showShell(event) {
    if (event) event.preventDefault()

    this.currentView = "shell"
    this.actionsTarget.classList.add("hidden")
    this.interfaceSectionTarget.classList.remove("hidden")
    this.backgroundSectionTarget.classList.add("hidden")
    this.themesSectionTarget.classList.add("hidden")
    this.backButtonTarget.classList.remove("hidden")
    this.titleTarget.textContent = "Shell"
    this.stampTarget.textContent = "Adjust desktop shell color and transparency."
    this.snapWindowToActiveContent()
  }

  showBackground(event) {
    if (event) event.preventDefault()

    this.currentView = "background"
    this.actionsTarget.classList.add("hidden")
    this.interfaceSectionTarget.classList.add("hidden")
    this.backgroundSectionTarget.classList.remove("hidden")
    this.themesSectionTarget.classList.add("hidden")
    this.backButtonTarget.classList.remove("hidden")
    this.titleTarget.textContent = "Background"
    this.stampTarget.textContent = "Adjust desktop gradient colors and angle."
    this.snapWindowToActiveContent()
  }

  showThemes(event) {
    if (event) event.preventDefault()

    this.currentView = "themes"
    this.actionsTarget.classList.add("hidden")
      if (this.hasInterfaceSectionTarget) this.interfaceSectionTarget.classList.add("hidden")
      if (this.hasBackgroundSectionTarget) this.backgroundSectionTarget.classList.add("hidden")
    this.themesSectionTarget.classList.remove("hidden")
    this.backButtonTarget.classList.remove("hidden")
    this.titleTarget.textContent = "Saved Themes"
    this.stampTarget.textContent = "Select, rename, delete, and add layouts."
    this.renderThemesList()
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
    if (this.hasBackgroundSectionTarget) this.backgroundSectionTarget.classList.add("hidden")
    if (this.hasThemesSectionTarget) this.themesSectionTarget.classList.add("hidden")
    if (this.hasBackButtonTarget) this.backButtonTarget.classList.add("hidden")
    if (this.hasTitleTarget) this.titleTarget.textContent = this.defaultTitle
    if (this.hasStampTarget) this.stampTarget.textContent = this.defaultStamp
    this.refreshActionStatusBadges()
    this.snapWindowToActiveContent()
  }

  initializeControls() {
    this.initializeShellControls()
    this.initializeBackgroundControls()
    this.refreshActionStatusBadges()
    this.loadPreferencesFromConfig()
  }

  initializeShellControls() {
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
      hue: this.clampHue(this.readCurrentCssNumber("--window-bg-h", this.defaultShellModel.hue)),
      saturation: this.clampPercent(this.readCurrentCssNumber("--window-bg-saturation", this.defaultShellModel.saturation)),
      brightness: this.clampPercent(this.readCurrentCssNumber("--window-bg-brightness", this.defaultShellModel.brightness)),
      alpha: this.clampTransparency(this.readCurrentCssNumber("--window-bg-alpha", this.defaultShellModel.alpha))
    }

    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
  }

  initializeBackgroundControls() {
    if (
      !this.hasBgOneHueSliderTarget ||
      !this.hasBgOneHueValueTarget ||
      !this.hasBgOneSaturationSliderTarget ||
      !this.hasBgOneSaturationValueTarget ||
      !this.hasBgOneBrightnessSliderTarget ||
      !this.hasBgOneBrightnessValueTarget ||
      !this.hasBgTwoHueSliderTarget ||
      !this.hasBgTwoHueValueTarget ||
      !this.hasBgTwoSaturationSliderTarget ||
      !this.hasBgTwoSaturationValueTarget ||
      !this.hasBgTwoBrightnessSliderTarget ||
      !this.hasBgTwoBrightnessValueTarget ||
      !this.hasBgAngleSliderTarget ||
      !this.hasBgAngleValueTarget
    ) return

    const model = {
      colorOneHue: this.clampHue(this.readCurrentCssNumber("--desktop-bg-1-hue", this.defaultBackgroundModel.colorOneHue)),
      colorOneSaturation: this.clampPercent(this.readCurrentCssNumber("--desktop-bg-1-saturation", this.defaultBackgroundModel.colorOneSaturation)),
      colorOneBrightness: this.clampPercent(this.readCurrentCssNumber("--desktop-bg-1-brightness", this.defaultBackgroundModel.colorOneBrightness)),
      colorTwoHue: this.clampHue(this.readCurrentCssNumber("--desktop-bg-2-hue", this.defaultBackgroundModel.colorTwoHue)),
      colorTwoSaturation: this.clampPercent(this.readCurrentCssNumber("--desktop-bg-2-saturation", this.defaultBackgroundModel.colorTwoSaturation)),
      colorTwoBrightness: this.clampPercent(this.readCurrentCssNumber("--desktop-bg-2-brightness", this.defaultBackgroundModel.colorTwoBrightness)),
      angle: this.clampAngle(this.readCurrentCssNumber("--desktop-bg-angle", this.defaultBackgroundModel.angle))
    }

    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
  }

  updateHue(event) {
    const model = this.currentShellModel()
    model.hue = this.clampHue(Number.parseInt(event.currentTarget.value, 10))
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateSaturation(event) {
    const model = this.currentShellModel()
    model.saturation = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBrightness(event) {
    const model = this.currentShellModel()
    model.brightness = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateTransparency(event) {
    const model = this.currentShellModel()
    const value = Number.parseInt(event.currentTarget.value, 10)
    model.alpha = this.clampTransparency((Number.isFinite(value) ? value : 50) / 100)
    this.applyWindowShellModel(model)
    this.syncInterfaceControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgOneHue(event) {
    const model = this.currentBackgroundModel()
    model.colorOneHue = this.clampHue(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgOneSaturation(event) {
    const model = this.currentBackgroundModel()
    model.colorOneSaturation = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgOneBrightness(event) {
    const model = this.currentBackgroundModel()
    model.colorOneBrightness = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgTwoHue(event) {
    const model = this.currentBackgroundModel()
    model.colorTwoHue = this.clampHue(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgTwoSaturation(event) {
    const model = this.currentBackgroundModel()
    model.colorTwoSaturation = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgTwoBrightness(event) {
    const model = this.currentBackgroundModel()
    model.colorTwoBrightness = this.clampPercent(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  updateBgAngle(event) {
    const model = this.currentBackgroundModel()
    model.angle = this.clampAngle(Number.parseInt(event.currentTarget.value, 10))
    this.applyDesktopBackgroundModel(model)
    this.syncBackgroundControls(model)
    this.schedulePersistPreferences()
    this.refreshActionStatusBadges()
  }

  addTheme(event) {
    if (event) event.preventDefault()
    if (this.themeDraft) {
      this.focusDraftInput()
      return
    }

    this.themeDraft = { id: "__draft_theme__", name: "" }
    this.renderThemesList()
    this.focusDraftInput()
  }

  startInlineRename(li, theme) {
    li.classList.add("is-renaming")
    this.selectedThemeId = theme.id

    // Remove the button
    const button = li.querySelector(".settings-themes-item-btn")
    if (button) button.remove()

    // Create inline input
    const input = document.createElement("input")
    input.type = "text"
    input.className = "settings-themes-item-rename-input"
    input.value = theme.name
    input.maxLength = 64
    input.autocomplete = "off"
    input.spellcheck = "false"

    // Handle submit
    const submitRename = async () => {
      const newName = input.value.trim()
      if (!newName || newName === theme.name) {
        li.classList.remove("is-renaming")
        this.renderThemesList()
        return
      }

      const payload = await this.submitThemeAction({ action: "rename", theme_id: theme.id, name: newName })
      if (payload) {
        this.refreshThemesFromPayload(payload)
      }
      li.classList.remove("is-renaming")
      this.renderThemesList()
    }

    input.addEventListener("blur", submitRename)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        submitRename()
      }
      if (e.key === "Escape") {
        li.classList.remove("is-renaming")
        this.renderThemesList()
      }
    })

    li.insertBefore(input, li.querySelector(".settings-themes-item-actions"))
    input.focus()
    input.select()
  }

  async deleteTheme(event) {
    if (event) event.preventDefault()
    const selected = this.selectedTheme()
    if (!selected || selected.locked) return
    if (!window.confirm(`Delete theme "${selected.name}"?`)) return

    const payload = await this.submitThemeAction({ action: "delete", theme_id: selected.id })
    if (!payload) return
    this.refreshThemesFromPayload(payload)
    this.selectedThemeId = payload.active_theme_id || "default"
    this.renderThemesList()
  }

  async applyTheme(event) {
    if (event) event.preventDefault()
    const selected = this.selectedTheme()
    if (!selected) return

    if (selected.id !== this.activeThemeId) {
      const confirmed = this.confirmThemeSwitch(selected.name)
      if (!confirmed) return
    }

    await this.applyThemeById(selected.id)
  }

  selectedTheme() {
    return this.themes.find(theme => theme.id === this.selectedThemeId) || null
  }

  nextThemeName() {
    const base = "Custom Layout"
    const existing = new Set(this.themes.map(theme => theme.name.toLowerCase()))
    if (!existing.has(base.toLowerCase())) return base

    let suffix = 2
    while (existing.has(`${base} ${suffix}`.toLowerCase())) {
      suffix += 1
    }

    return `${base} ${suffix}`
  }

  renderThemesList() {
    if (!this.hasThemesListTarget) return

    const sortedThemes = [...this.themes].sort((a, b) => {
      if (a.locked && !b.locked) return -1
      if (!a.locked && b.locked) return 1
      return a.name.localeCompare(b.name)
    })

    this.themesListTarget.innerHTML = ""

    sortedThemes.forEach(theme => {
      const li = document.createElement("li")
      li.className = "settings-themes-item"
      if (theme.id === this.selectedThemeId) li.classList.add("is-active")
      if (theme.locked) li.classList.add("is-locked")

      const button = document.createElement("button")
      button.type = "button"
      button.className = "settings-themes-item-btn"
      button.textContent = theme.name
      button.addEventListener("click", async () => {
        if (this.themeDraft) this.themeDraft = null
        this.selectedThemeId = theme.id

        if (theme.id !== this.activeThemeId) {
          const confirmed = this.confirmThemeSwitch(theme.name)
          if (!confirmed) {
            this.selectedThemeId = this.activeThemeId || this.selectedThemeId
            this.renderThemesList()
            return
          }

          await this.applyThemeById(theme.id)
          return
        }

        this.renderThemesList()
      })

      if (theme.id === this.activeThemeId || theme.locked) {
        const meta = document.createElement("span")
        meta.className = "settings-themes-item-meta"
        const labels = []
        if (theme.locked) labels.push("Default")
        if (theme.id === this.activeThemeId) labels.push("Active")
        meta.textContent = `(${labels.join(" • ")})`
        button.appendChild(meta)
      }

      li.appendChild(button)

      // Add action buttons (pencil for rename, × for delete) if not locked
      if (!theme.locked) {
        const actionsContainer = document.createElement("div")
        actionsContainer.className = "settings-themes-item-actions"

        const renameBtn = document.createElement("button")
        renameBtn.type = "button"
        renameBtn.className = "settings-themes-item-action-btn settings-themes-item-rename-btn"
        renameBtn.title = "Rename"
        renameBtn.textContent = "✎"
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          this.startInlineRename(li, theme)
        })

        const deleteBtn = document.createElement("button")
        deleteBtn.type = "button"
        deleteBtn.className = "settings-themes-item-action-btn settings-themes-item-delete-btn"
        deleteBtn.title = "Delete"
        deleteBtn.textContent = "×"
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          this.selectedThemeId = theme.id
          this.deleteTheme()
        })

        actionsContainer.appendChild(renameBtn)
        actionsContainer.appendChild(deleteBtn)
        li.appendChild(actionsContainer)
      }

      this.themesListTarget.appendChild(li)
    })

    this.renderDraftThemeRow()

    this.refreshActionStatusBadges()
  }

  renderDraftThemeRow() {
    if (!this.themeDraft || !this.hasThemesListTarget) return

    const li = document.createElement("li")
    li.className = "settings-themes-item is-renaming is-active"

    const input = document.createElement("input")
    input.type = "text"
    input.className = "settings-themes-item-rename-input"
    input.value = this.themeDraft.name || ""
    input.maxLength = 64
    input.autocomplete = "off"
    input.spellcheck = "false"
    input.placeholder = "Theme..."

    const finalizeDraft = async (save) => {
      const name = save ? input.value.trim().slice(0, 64) : ""
      this.themeDraft = null

      if (!name) {
        this.renderThemesList()
        return
      }

      const appearance = this.currentLiveAppearance || this.activeThemeAppearanceSnapshot
      const payload = await this.submitThemeAction({ action: "save", name, appearance })
      if (payload) {
        this.refreshThemesFromPayload(payload)
        this.selectedThemeId = payload.active_theme_id || this.selectedThemeId
      }
      this.renderThemesList()
    }

    input.addEventListener("blur", () => finalizeDraft(true), { once: true })
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        finalizeDraft(true)
      }
      if (e.key === "Escape") {
        e.preventDefault()
        finalizeDraft(false)
      }
    })

    li.appendChild(input)
    this.themesListTarget.appendChild(li)
  }

  focusDraftInput() {
    if (!this.hasThemesListTarget) return
    const input = this.themesListTarget.querySelector(".settings-themes-item.is-renaming .settings-themes-item-rename-input")
    if (!input) return
    input.focus()
    input.select()
  }

  async applyThemeById(themeId) {
    const payload = await this.submitThemeAction({ action: "apply", theme_id: themeId })
    if (!payload) {
      this.renderThemesList()
      return
    }

    this.refreshThemesFromPayload(payload)
    if (payload?.appearance) {
      this.applyAppearanceSnapshot(payload.appearance)
    }
    this.serverIsCustomLayout = Boolean(payload?.is_custom_layout)
    this.renderThemesList()
    this.refreshActionStatusBadges()
    this.snapWindowToActiveContent()
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
    } catch (_) {
      return null
    }
  }

  refreshThemesFromPayload(payload) {
    this.themes = Array.isArray(payload?.themes) ? payload.themes : []
    this.activeThemeId = payload?.active_theme_id || this.activeThemeId
    if (payload?.appearance) {
      this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(payload.appearance)
    }
    if (!this.themes.some(theme => theme.id === this.selectedThemeId)) {
      this.selectedThemeId = this.activeThemeId || "default"
    }
  }

  applyAppearanceSnapshot(appearance) {
    const shellModel = {
      hue: this.clampHue(appearance.hue),
      saturation: this.clampPercent(appearance.saturation),
      brightness: this.clampPercent(appearance.brightness),
      alpha: this.clampTransparency(appearance.transparency)
    }

    const backgroundModel = {
      colorOneHue: this.clampHue(Number.isFinite(Number(appearance.color_1_hue)) ? appearance.color_1_hue : this.defaultBackgroundModel.colorOneHue),
      colorOneSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_1_saturation)) ? appearance.color_1_saturation : this.defaultBackgroundModel.colorOneSaturation),
      colorOneBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_1_brightness)) ? appearance.color_1_brightness : this.defaultBackgroundModel.colorOneBrightness),
      colorTwoHue: this.clampHue(Number.isFinite(Number(appearance.color_2_hue)) ? appearance.color_2_hue : this.defaultBackgroundModel.colorTwoHue),
      colorTwoSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_2_saturation)) ? appearance.color_2_saturation : this.defaultBackgroundModel.colorTwoSaturation),
      colorTwoBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_2_brightness)) ? appearance.color_2_brightness : this.defaultBackgroundModel.colorTwoBrightness),
      angle: this.clampAngle(Number.isFinite(Number(appearance.angle)) ? appearance.angle : this.defaultBackgroundModel.angle)
    }

    this.applyWindowShellModel(shellModel)
    this.applyDesktopBackgroundModel(backgroundModel)

    if (this.hasShellControlTargets()) {
      this.syncInterfaceControls(shellModel)
    }
    if (this.hasBackgroundControlTargets()) {
      this.syncBackgroundControls(backgroundModel)
    }

    this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)
    this.currentLiveAppearance = this.activeThemeAppearanceSnapshot
  }

  confirmThemeSwitch(themeName) {
    if (!this.serverIsCustomLayout) return true

    return window.confirm(`Apply color theme \"${themeName}\" now? Unsaved custom changes will be lost unless you save them first.`)
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

  applyDesktopBackgroundModel(model) {
    const root = document.documentElement
    root.style.setProperty("--desktop-bg-1-hue", String(Math.round(model.colorOneHue)))
    root.style.setProperty("--desktop-bg-1-saturation", `${Math.round(model.colorOneSaturation)}%`)
    root.style.setProperty("--desktop-bg-1-brightness", `${Math.round(model.colorOneBrightness)}%`)
    root.style.setProperty("--desktop-bg-2-hue", String(Math.round(model.colorTwoHue)))
    root.style.setProperty("--desktop-bg-2-saturation", `${Math.round(model.colorTwoSaturation)}%`)
    root.style.setProperty("--desktop-bg-2-brightness", `${Math.round(model.colorTwoBrightness)}%`)
    root.style.setProperty("--desktop-bg-angle", `${Math.round(model.angle)}deg`)
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

  syncBackgroundControls(model) {
    this.bgOneHueSliderTarget.value = String(Math.round(model.colorOneHue))
    this.bgOneSaturationSliderTarget.value = String(Math.round(model.colorOneSaturation))
    this.bgOneBrightnessSliderTarget.value = String(Math.round(model.colorOneBrightness))
    this.bgTwoHueSliderTarget.value = String(Math.round(model.colorTwoHue))
    this.bgTwoSaturationSliderTarget.value = String(Math.round(model.colorTwoSaturation))
    this.bgTwoBrightnessSliderTarget.value = String(Math.round(model.colorTwoBrightness))
    this.bgAngleSliderTarget.value = String(Math.round(model.angle))

    this.bgOneHueValueTarget.textContent = `${Math.round(model.colorOneHue)}°`
    this.bgOneSaturationValueTarget.textContent = `${Math.round(model.colorOneSaturation)}%`
    this.bgOneBrightnessValueTarget.textContent = `${Math.round(model.colorOneBrightness)}%`
    this.bgTwoHueValueTarget.textContent = `${Math.round(model.colorTwoHue)}°`
    this.bgTwoSaturationValueTarget.textContent = `${Math.round(model.colorTwoSaturation)}%`
    this.bgTwoBrightnessValueTarget.textContent = `${Math.round(model.colorTwoBrightness)}%`
    this.bgAngleValueTarget.textContent = `${Math.round(model.angle)}°`
  }

  currentShellModel() {
    const hue = this.clampHue(Number.parseInt(this.hueSliderTarget.value, 10))
    const saturation = this.clampPercent(Number.parseInt(this.saturationSliderTarget.value, 10))
    const brightness = this.clampPercent(Number.parseInt(this.brightnessSliderTarget.value, 10))
    const alpha = this.clampTransparency(Number.parseInt(this.transparencySliderTarget.value, 10) / 100)
    return { hue, saturation, brightness, alpha }
  }

  currentBackgroundModel() {
    const colorOneHue = this.clampHue(Number.parseInt(this.bgOneHueSliderTarget.value, 10))
    const colorOneSaturation = this.clampPercent(Number.parseInt(this.bgOneSaturationSliderTarget.value, 10))
    const colorOneBrightness = this.clampPercent(Number.parseInt(this.bgOneBrightnessSliderTarget.value, 10))
    const colorTwoHue = this.clampHue(Number.parseInt(this.bgTwoHueSliderTarget.value, 10))
    const colorTwoSaturation = this.clampPercent(Number.parseInt(this.bgTwoSaturationSliderTarget.value, 10))
    const colorTwoBrightness = this.clampPercent(Number.parseInt(this.bgTwoBrightnessSliderTarget.value, 10))
    const angle = this.clampAngle(Number.parseInt(this.bgAngleSliderTarget.value, 10))
    return {
      colorOneHue,
      colorOneSaturation,
      colorOneBrightness,
      colorTwoHue,
      colorTwoSaturation,
      colorTwoBrightness,
      angle
    }
  }

  schedulePersistPreferences() {
    if (this.persistPreferencesTimer) clearTimeout(this.persistPreferencesTimer)

    this.persistPreferencesTimer = setTimeout(() => {
      this.persistAppearance()
    }, 120)
  }

  async persistAppearance() {
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    const shell = this.currentShellModel()
    const background = this.currentBackgroundModel()

    try {
      await fetch("/workspace_preferences", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify({
          appearance: this.buildAppearancePayload(shell, background)
        })
      })
    } catch (_) {
      // Keep UI responsive even if persistence fails.
    }
  }

  async loadPreferencesFromConfig() {
    try {
      const response = await fetch("/workspace_preferences", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return

      const payload = await response.json()
      const appearance = payload?.appearance
      if (!appearance) return
        this.serverIsCustomLayout = Boolean(payload?.is_custom_layout)

      const shellModel = {
        hue: this.clampHue(appearance.hue),
        saturation: this.clampPercent(appearance.saturation),
        brightness: this.clampPercent(appearance.brightness),
        alpha: this.clampTransparency(appearance.transparency)
      }

      const backgroundModel = {
        colorOneHue: this.clampHue(Number.isFinite(Number(appearance.color_1_hue)) ? appearance.color_1_hue : this.defaultBackgroundModel.colorOneHue),
        colorOneSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_1_saturation)) ? appearance.color_1_saturation : this.defaultBackgroundModel.colorOneSaturation),
        colorOneBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_1_brightness)) ? appearance.color_1_brightness : this.defaultBackgroundModel.colorOneBrightness),
        colorTwoHue: this.clampHue(Number.isFinite(Number(appearance.color_2_hue)) ? appearance.color_2_hue : this.defaultBackgroundModel.colorTwoHue),
        colorTwoSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_2_saturation)) ? appearance.color_2_saturation : this.defaultBackgroundModel.colorTwoSaturation),
        colorTwoBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_2_brightness)) ? appearance.color_2_brightness : this.defaultBackgroundModel.colorTwoBrightness),
        angle: this.clampAngle(Number.isFinite(Number(appearance.angle)) ? appearance.angle : this.defaultBackgroundModel.angle)
      }

      this.applyWindowShellModel(shellModel)
      this.applyDesktopBackgroundModel(backgroundModel)

      if (this.hasShellControlTargets()) {
        this.syncInterfaceControls(shellModel)
      }
      if (this.hasBackgroundControlTargets()) {
        this.syncBackgroundControls(backgroundModel)
      }

      this.themes = Array.isArray(payload?.themes) ? payload.themes : []
      this.activeThemeId = payload?.active_theme_id || "default"
      this.selectedThemeId = this.activeThemeId
      this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)
      this.currentLiveAppearance = this.activeThemeAppearanceSnapshot
      this.renderThemesList()
      this.refreshActionStatusBadges()
    } catch (_) {
      // Non-blocking fallback to existing CSS values.
    }
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

  refreshActionStatusBadges() {
    const activeTheme = this.themes.find(theme => theme.id === this.activeThemeId)
    const activeThemeName = activeTheme?.name || "DEFAULT"
    const hasUnsavedAppearance = this.hasAppearanceControlTargets()
      ? this.hasUnsavedAppearanceChanges()
      : this.serverIsCustomLayout

    if (this.hasShellStatusTarget) {
      this.shellStatusTarget.textContent = hasUnsavedAppearance ? "CUSTOM" : activeThemeName
    }
    if (this.hasBackgroundStatusTarget) {
      this.backgroundStatusTarget.textContent = hasUnsavedAppearance ? "CUSTOM" : activeThemeName
    }
    if (this.hasThemeStatusTarget) {
      this.themeStatusTarget.textContent = hasUnsavedAppearance ? "CUSTOM" : activeThemeName
    }

    window.dispatchEvent(new CustomEvent("workspace:theme-status", {
      detail: {
        active_theme_name: activeThemeName,
        is_custom_layout: hasUnsavedAppearance
      }
    }))
  }

  hasUnsavedAppearanceChanges() {
    if (!this.hasAppearanceControlTargets()) return false

    const current = this.currentAppearanceSnapshot()
    const baseline = this.activeThemeAppearanceSnapshot || this.buildAppearancePayload(this.defaultShellModel, this.defaultBackgroundModel)
    const keys = Object.keys(current)
    return keys.some((key) => {
      if (key === "transparency") {
        return Math.abs(Number(current[key]) - Number(baseline[key])) > 0.005
      }

      return Number(current[key]) !== Number(baseline[key])
    })
  }

  hasShellControlTargets() {
    return (
      this.hasHueSliderTarget &&
      this.hasHueValueTarget &&
      this.hasSaturationSliderTarget &&
      this.hasSaturationValueTarget &&
      this.hasBrightnessSliderTarget &&
      this.hasBrightnessValueTarget &&
      this.hasTransparencySliderTarget &&
      this.hasTransparencyValueTarget
    )
  }

  hasBackgroundControlTargets() {
    return (
      this.hasBgOneHueSliderTarget &&
      this.hasBgOneHueValueTarget &&
      this.hasBgOneSaturationSliderTarget &&
      this.hasBgOneSaturationValueTarget &&
      this.hasBgOneBrightnessSliderTarget &&
      this.hasBgOneBrightnessValueTarget &&
      this.hasBgTwoHueSliderTarget &&
      this.hasBgTwoHueValueTarget &&
      this.hasBgTwoSaturationSliderTarget &&
      this.hasBgTwoSaturationValueTarget &&
      this.hasBgTwoBrightnessSliderTarget &&
      this.hasBgTwoBrightnessValueTarget &&
      this.hasBgAngleSliderTarget &&
      this.hasBgAngleValueTarget
    )
  }

  hasAppearanceControlTargets() {
    return this.hasShellControlTargets() && this.hasBackgroundControlTargets()
  }

  currentAppearanceSnapshot() {
    return this.buildAppearancePayload(this.currentShellModel(), this.currentBackgroundModel())
  }

  normalizedAppearanceSnapshot(appearance) {
    const shellModel = {
      hue: this.clampHue(appearance.hue),
      saturation: this.clampPercent(appearance.saturation),
      brightness: this.clampPercent(appearance.brightness),
      alpha: this.clampTransparency(appearance.transparency)
    }

    const backgroundModel = {
      colorOneHue: this.clampHue(Number.isFinite(Number(appearance.color_1_hue)) ? appearance.color_1_hue : this.defaultBackgroundModel.colorOneHue),
      colorOneSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_1_saturation)) ? appearance.color_1_saturation : this.defaultBackgroundModel.colorOneSaturation),
      colorOneBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_1_brightness)) ? appearance.color_1_brightness : this.defaultBackgroundModel.colorOneBrightness),
      colorTwoHue: this.clampHue(Number.isFinite(Number(appearance.color_2_hue)) ? appearance.color_2_hue : this.defaultBackgroundModel.colorTwoHue),
      colorTwoSaturation: this.clampPercent(Number.isFinite(Number(appearance.color_2_saturation)) ? appearance.color_2_saturation : this.defaultBackgroundModel.colorTwoSaturation),
      colorTwoBrightness: this.clampPercent(Number.isFinite(Number(appearance.color_2_brightness)) ? appearance.color_2_brightness : this.defaultBackgroundModel.colorTwoBrightness),
      angle: this.clampAngle(Number.isFinite(Number(appearance.angle)) ? appearance.angle : this.defaultBackgroundModel.angle)
    }

    return this.buildAppearancePayload(shellModel, backgroundModel)
  }

  isShellDefault(model) {
    return (
      Math.round(model.hue) === this.defaultShellModel.hue &&
      Math.round(model.saturation) === this.defaultShellModel.saturation &&
      Math.round(model.brightness) === this.defaultShellModel.brightness &&
      Math.abs(model.alpha - this.defaultShellModel.alpha) < 0.005
    )
  }

  isBackgroundDefault(model) {
    return (
      Math.round(model.colorOneHue) === this.defaultBackgroundModel.colorOneHue &&
      Math.round(model.colorOneSaturation) === this.defaultBackgroundModel.colorOneSaturation &&
      Math.round(model.colorOneBrightness) === this.defaultBackgroundModel.colorOneBrightness &&
      Math.round(model.colorTwoHue) === this.defaultBackgroundModel.colorTwoHue &&
      Math.round(model.colorTwoSaturation) === this.defaultBackgroundModel.colorTwoSaturation &&
      Math.round(model.colorTwoBrightness) === this.defaultBackgroundModel.colorTwoBrightness &&
      Math.round(model.angle) === this.defaultBackgroundModel.angle
    )
  }

  readCurrentCssNumber(variableName, fallback) {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim()
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return fallback
    return parsed
  }

  clampHue(value) {
    if (!Number.isFinite(value)) return this.defaultShellModel.hue
    return Math.min(360, Math.max(0, value))
  }

  clampPercent(value) {
    if (!Number.isFinite(value)) return 0
    return Math.min(100, Math.max(0, value))
  }

  clampTransparency(value) {
    return Math.min(0.95, Math.max(0.15, value))
  }

  clampAngle(value) {
    if (!Number.isFinite(value)) return this.defaultBackgroundModel.angle
    return Math.min(360, Math.max(0, value))
  }

  snapWindowToActiveContent() {
    if (!this.windowSizer) return
    this.windowSizer.syncOnOpen()
  }

  restoreWindowBounds() {
    const bounds = this.readStoredBounds("nexus.window.settings.bounds")
    if (!bounds) {
      this.positionWindow()
      return
    }

    this.windowTarget.style.left = `${bounds.left}px`
    this.windowTarget.style.top = `${bounds.top}px`
    this.windowTarget.style.width = `${this.windowWidth}px`
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
    } catch (_) {
      return null
    }
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
    const currentHeight = Math.ceil(this.windowTarget.getBoundingClientRect().height)
    const height = Math.max(1, Math.min(currentHeight || 1, Math.max(1, vh - 40)))
    const desiredTop = defaultTop + dbHealthHeight + rowGap
    const left = Math.max(leftColumnLeft, Math.min(leftColumnLeft, vw - this.viewportMargin - width))
    const top = Math.max(this.viewportMargin, Math.min(desiredTop, vh - this.viewportMargin - height))

    this.windowTarget.style.width = `${width}px`
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

}
