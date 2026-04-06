import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"
import { NEXUS_CLICKABLE_ROW_MAIN_CLASS } from "lib/nexus_ui"

export default class extends Controller {
  static targets = ["themesList", "activeThemeLabel"]
  static values = { workspaceUrl: String, settingsUrl: String }

  connect() {
    this.defaultShellModel = { hue: 180, saturation: 0, brightness: 15, alpha: 0.15 }
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
      fontTwoAlpha: 100
    }

    this.themes = []
    this.selectedThemeId = "default"
    this.activeThemeId = "default"
    this.activeThemeAppearanceSnapshot = this.buildAppearancePayload(
      this.defaultShellModel,
      this.defaultBackgroundModel,
      this.defaultContentModel
    )
    this.serverIsCustomLayout = false
    this.currentLiveAppearance = null
    this._lastRenderedThemesSignature = null
    this._lastRenderedCustomLayout = null

    this.boundThemeStatus = this.handleThemeStatus.bind(this)
    window.addEventListener("workspace:theme-status", this.boundThemeStatus)

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.loadPreferences())
    })
  }

  disconnect() {
    window.removeEventListener("workspace:theme-status", this.boundThemeStatus)
  }

  handleThemeStatus(event) {
    const detail = event?.detail || {}
    const previousActiveThemeId = this.activeThemeId
    const previousCustomLayout = this.serverIsCustomLayout
    const previousThemesSignature = this.themes.map((t) => `${t.id}:${t.name}:${t.locked ? 1 : 0}`).join("|")

    this.serverIsCustomLayout = Boolean(detail?.is_custom_layout)
    if (detail?.active_theme_id) this.activeThemeId = String(detail.active_theme_id)
    if (Array.isArray(detail?.themes)) this.themes = detail.themes
    if (detail?.appearance) {
      const snapshot = this.normalizedAppearanceSnapshot(detail.appearance)
      this.currentLiveAppearance = snapshot
      if (!this.serverIsCustomLayout) this.activeThemeAppearanceSnapshot = snapshot
    }
    this.selectedThemeId = this.resolveSelectableThemeId(this.selectedThemeId)
    this.refreshActionStatusBadges(false)

    const currentThemesSignature = this.themesListSignature()
    const structureChanged =
      previousThemesSignature !== currentThemesSignature || previousCustomLayout !== this.serverIsCustomLayout

    if (!structureChanged && this.themesListTarget?.children?.length) {
      this.patchThemesListVisuals()
      this.refreshActionStatusBadges(false)
      return
    }

    this.renderThemesList(false)
  }

  async loadPreferences() {
    if (!this.hasWorkspaceUrlValue) return
    try {
      const response = await fetch(this.workspaceUrlValue, { headers: { Accept: "application/json" } })
      if (!response.ok) return
      const payload = await response.json()
      const appearance = payload?.appearance
      this.serverIsCustomLayout = Boolean(payload?.is_custom_layout)
      this.themes = Array.isArray(payload?.themes) ? payload.themes : []
      this.activeThemeId = payload?.active_theme_id || "default"
      this.selectedThemeId = this.resolveSelectableThemeId(this.activeThemeId)
      if (appearance) {
        const snapshot = this.normalizedAppearanceSnapshot(appearance)
        this.activeThemeAppearanceSnapshot = snapshot
        this.currentLiveAppearance = snapshot
      }
      this.renderThemesList(false)
      this.refreshActionStatusBadges(false)
    } catch (_) {
      /* non-blocking */
    }
  }

  themesListSignature() {
    return this.themes.map((t) => `${t.id}:${t.name}:${t.locked ? 1 : 0}`).join("|")
  }

  canPatchThemesListInPlace() {
    if (!this.hasThemesListTarget || this.themesListTarget.children.length === 0) return false
    if (this._lastRenderedThemesSignature == null) return false
    if (this.themesListSignature() !== this._lastRenderedThemesSignature) return false
    if (Boolean(this.serverIsCustomLayout) !== Boolean(this._lastRenderedCustomLayout)) return false
    if (this.themesListTarget.querySelector(".settings-themes-item.is-renaming")) return false
    /* Inline rename/save swaps the label for an input; if we patch without a full rebuild, the stray input stays (e.g. Escape removes .is-renaming first). */
    if (this.themesListTarget.querySelector(".settings-themes-item-rename-input")) return false

    const unsavedEl = this.themesListTarget.querySelector("[data-unsaved-custom-theme]")
    if (Boolean(unsavedEl) !== Boolean(this.serverIsCustomLayout)) return false

    const themeRows = this.themesListTarget.querySelectorAll("li[data-settings-theme-id]")
    return themeRows.length === this.themes.length
  }

  patchThemesListVisuals() {
    if (!this.hasThemesListTarget) return
    this.themesListTarget.querySelectorAll("li[data-settings-theme-id]").forEach((li) => {
      const id = li.dataset.settingsThemeId
      const selected = id === this.selectedThemeId && !this.serverIsCustomLayout
      li.classList.toggle("is-active", selected)
      li.classList.toggle("is-selected", selected)

      const nameBtn = li.querySelector(".settings-themes-item-btn")
      if (!nameBtn) return
      let meta = nameBtn.querySelector(".settings-themes-item-meta")
      const showActive = id === this.activeThemeId && !this.serverIsCustomLayout
      if (showActive) {
        if (!meta) {
          meta = document.createElement("span")
          meta.className = "settings-themes-item-meta"
          meta.textContent = "(Active)"
          nameBtn.appendChild(meta)
        }
      } else if (meta) {
        meta.remove()
      }
    })
  }

  renderThemesList(shouldBroadcast = true) {
    if (!this.hasThemesListTarget) return

    if (this.canPatchThemesListInPlace()) {
      this.patchThemesListVisuals()
      this.refreshActionStatusBadges(shouldBroadcast)
      return
    }

    const sortedThemes = [...this.themes].sort((a, b) => {
      if (a.locked && !b.locked) return -1
      if (!a.locked && b.locked) return 1
      return a.name.localeCompare(b.name)
    })

    const scrollSnap = this.captureThemesListScrollParents()

    this.themesListTarget.innerHTML = ""

    if (this.serverIsCustomLayout) {
      this.themesListTarget.appendChild(this.buildUnsavedCustomThemeRow())
    }

    sortedThemes.forEach((theme) => {
      const li = document.createElement("li")
      li.setAttribute("role", "listitem")
      li.dataset.settingsThemeId = theme.id
      li.className =
        "settings-themes-item finder-file-item organizer-row finder-file-row nexus-standard-row finder-file-row--no-leading-icon"
      if (theme.id === this.selectedThemeId && !this.serverIsCustomLayout) {
        li.classList.add("is-active", "is-selected")
      }
      if (theme.locked) li.classList.add("is-locked")

      const left = document.createElement("div")
      left.className = `organizer-row-left finder-file-row-main nexus-standard-row__main ${NEXUS_CLICKABLE_ROW_MAIN_CLASS}`

      const nameBtn = document.createElement("button")
      nameBtn.type = "button"
      nameBtn.className = "settings-themes-item-btn"

      const nameLabel = document.createElement("span")
      nameLabel.className = "finder-file-name"
      nameLabel.textContent = theme.name
      nameBtn.appendChild(nameLabel)

      if (theme.id === this.activeThemeId && !this.serverIsCustomLayout) {
        const meta = document.createElement("span")
        meta.className = "settings-themes-item-meta"
        meta.textContent = "(Active)"
        nameBtn.appendChild(meta)
      }

      left.appendChild(nameBtn)
      li.appendChild(left)

      if (!theme.locked) {
        const actionsContainer = document.createElement("div")
        actionsContainer.className = "organizer-row-right settings-themes-item-actions"

        const renameBtn = document.createElement("button")
        renameBtn.type = "button"
        renameBtn.className = "item-action-btn settings-themes-item-rename-btn"
        renameBtn.title = "Rename"
        renameBtn.setAttribute("aria-label", "Rename theme")
        renameBtn.innerHTML = materialSymbolSvg("edit", "xs")
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          this.startInlineRename(li, theme)
        })

        const deleteBtn = document.createElement("button")
        deleteBtn.type = "button"
        deleteBtn.className = "item-action-btn item-action-delete settings-themes-item-delete-btn"
        deleteBtn.title = "Delete"
        deleteBtn.setAttribute("aria-label", "Delete theme")
        deleteBtn.innerHTML = materialSymbolSvg("delete", "xs")
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          this.selectedThemeId = theme.id
          this.deleteTheme()
        })

        actionsContainer.appendChild(renameBtn)
        actionsContainer.appendChild(deleteBtn)
        li.appendChild(actionsContainer)
      }

      li.addEventListener("click", async (e) => {
        if (e.target.closest(".item-action-btn")) return
        if (li.classList.contains("is-renaming")) return

        this.selectedThemeId = theme.id

        if (theme.id !== this.activeThemeId) {
          const confirmed = this.confirmThemeSwitch(theme.name)
          if (!confirmed) {
            this.selectedThemeId = this.resolveSelectableThemeId(this.activeThemeId)
            this.renderThemesList(false)
            return
          }
          await this.applyThemeById(theme.id)
          return
        }

        this.renderThemesList(false)
      })

      this.themesListTarget.appendChild(li)
    })

    this._lastRenderedThemesSignature = this.themesListSignature()
    this._lastRenderedCustomLayout = this.serverIsCustomLayout

    this.refreshActionStatusBadges(shouldBroadcast)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => this.restoreThemesListScrollParents(scrollSnap))
    })
  }

  /**
   * Rebuilding the list clears nodes and resets scroll on overflow ancestors.
   * Snapshot scrollTop/scrollLeft on every scrollable parent so we can restore after render.
   */
  captureThemesListScrollParents() {
    if (!this.hasThemesListTarget) return []
    const snap = []
    const seen = new Set()
    const push = (el) => {
      if (!el || seen.has(el)) return
      seen.add(el)
      snap.push({ el, top: el.scrollTop, left: el.scrollLeft })
    }

    let node = this.themesListTarget
    while (node && node !== document.documentElement) {
      const style = window.getComputedStyle(node)
      const oy = style.overflowY
      const ox = style.overflowX
      const canScrollY =
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        (node.scrollHeight > node.clientHeight + 1 || node.scrollTop > 0)
      const canScrollX =
        (ox === "auto" || ox === "scroll" || ox === "overlay") &&
        (node.scrollWidth > node.clientWidth + 1 || node.scrollLeft > 0)
      if (canScrollY || canScrollX) push(node)
      node = node.parentElement
    }

    const root = document.scrollingElement
    if (
      root &&
      !seen.has(root) &&
      (root.scrollHeight > root.clientHeight + 1 ||
        root.scrollWidth > root.clientWidth + 1 ||
        root.scrollTop > 0 ||
        root.scrollLeft > 0)
    ) {
      push(root)
    }

    return snap
  }

  restoreThemesListScrollParents(snap) {
    if (!Array.isArray(snap) || snap.length === 0) return
    for (let i = snap.length - 1; i >= 0; i--) {
      const { el, top, left } = snap[i]
      try {
        if (el && el.isConnected) {
          el.scrollTop = top
          el.scrollLeft = left
        }
      } catch (_err) {
        /* non-blocking */
      }
    }
  }

  buildUnsavedCustomThemeRow() {
    const li = document.createElement("li")
    li.setAttribute("role", "listitem")
    li.className =
      "settings-themes-item settings-themes-unsaved-row finder-file-item organizer-row finder-file-row nexus-standard-row finder-file-row--no-leading-icon"
    li.dataset.unsavedCustomTheme = "true"

    const left = document.createElement("div")
    left.className = "organizer-row-left finder-file-row-main nexus-standard-row__main settings-themes-unsaved-row-main"

    const nameBtn = document.createElement("button")
    nameBtn.type = "button"
    nameBtn.className = "settings-themes-item-btn"

    const nameLabel = document.createElement("span")
    nameLabel.className = "finder-file-name"
    nameLabel.textContent = "Unsaved Theme"
    nameBtn.appendChild(nameLabel)

    left.appendChild(nameBtn)
    li.appendChild(left)

    const actionsContainer = document.createElement("div")
    actionsContainer.className = "organizer-row-right settings-themes-item-actions"

    const saveBtn = document.createElement("button")
    saveBtn.type = "button"
    saveBtn.className = "item-action-btn settings-themes-item-unsaved-save-btn"
    saveBtn.title = "Save As"
    saveBtn.setAttribute("aria-label", "Save As")
    saveBtn.innerHTML = materialSymbolSvg("save", "xs")
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.beginUnsavedThemeInlineSave(li)
    })

    const studioBtn = document.createElement("button")
    studioBtn.type = "button"
    studioBtn.className = "item-action-btn settings-themes-item-unsaved-studio-btn"
    studioBtn.title = "Open Theme Studio"
    studioBtn.setAttribute("aria-label", "Open Theme Studio")
    studioBtn.innerHTML = materialSymbolSvg("tune", "xs")
    studioBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.openThemeStudio({ beginSave: false })
    })

    actionsContainer.appendChild(saveBtn)
    actionsContainer.appendChild(studioBtn)
    li.appendChild(actionsContainer)

    return li
  }

  beginUnsavedThemeInlineSave(li) {
    if (!li || li.dataset.unsavedCustomTheme !== "true" || li.classList.contains("is-renaming")) return

    li.classList.add("is-renaming")
    const left = li.querySelector(".organizer-row-left")
    const button = li.querySelector(".settings-themes-item-btn")
    if (button) button.remove()

    const input = document.createElement("input")
    input.type = "text"
    input.className = "settings-themes-item-rename-input"
    input.placeholder = "Theme name…"
    input.maxLength = 64
    input.autocomplete = "off"
    input.spellcheck = "false"
    input.setAttribute("aria-label", "New theme name")

    let settled = false
    const finish = async (submit) => {
      if (settled) return
      settled = true

      if (!submit) {
        li.classList.remove("is-renaming")
        this.renderThemesList(false)
        return
      }

      const name = input.value.trim().slice(0, 64)
      if (!name) {
        li.classList.remove("is-renaming")
        this.renderThemesList(false)
        return
      }

      const payload = await this.submitThemeAction({
        action: "save",
        name,
        appearance: this.currentAppearanceSnapshot()
      })
      if (!payload) {
        settled = false
        li.classList.remove("is-renaming")
        this.renderThemesList(false)
        return
      }

      this.refreshThemesFromPayload(payload)
      if (payload?.appearance) this.applyAppearanceSnapshot(payload.appearance)
      li.classList.remove("is-renaming")
      this.renderThemesList(true)
    }

    input.addEventListener("blur", () => {
      finish(true)
    })

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        input.blur()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        finish(false)
      }
    })

    if (left) left.appendChild(input)
    else li.insertBefore(input, li.querySelector(".settings-themes-item-actions"))
    input.focus()
  }

  openThemeStudio({ beginSave = false } = {}) {
    try {
      if (beginSave) {
        sessionStorage.setItem("nexus.themeStudio.beginSaveOnShow", "1")
      } else {
        sessionStorage.removeItem("nexus.themeStudio.beginSaveOnShow")
      }
    } catch (_err) {
      /* non-blocking */
    }

    const frame = this.element.closest("turbo-frame")
    const base = (this.settingsUrlValue || "/apps/settings").toString().trim() || "/apps/settings"
    const url = new URL(base, window.location.origin)
    url.searchParams.set("section", "theme_studio")
    if (frame?.id) url.searchParams.set("frame_id", frame.id)

    if (frame?.tagName === "TURBO-FRAME") {
      frame.src = `${url.pathname}${url.search}`
      return
    }

    window.location.assign(`${url.pathname}${url.search}`)
  }

  startInlineRename(li, theme) {
    li.classList.add("is-renaming")
    this.selectedThemeId = theme.id

    const left = li.querySelector(".organizer-row-left")
    const button = li.querySelector(".settings-themes-item-btn")
    if (button) button.remove()

    const input = document.createElement("input")
    input.type = "text"
    input.className = "settings-themes-item-rename-input"
    input.value = theme.name
    input.maxLength = 64
    input.autocomplete = "off"
    input.spellcheck = "false"

    const submitRename = async () => {
      const newName = input.value.trim()
      if (!newName || newName === theme.name) {
        li.classList.remove("is-renaming")
        this.renderThemesList(false)
        return
      }

      const payload = await this.submitThemeAction({ action: "rename", theme_id: theme.id, name: newName })
      if (payload) this.refreshThemesFromPayload(payload)
      li.classList.remove("is-renaming")
      this.renderThemesList(true)
    }

    input.addEventListener("blur", submitRename)
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault()
        submitRename()
      }
      if (e.key === "Escape") {
        e.preventDefault()
        li.classList.remove("is-renaming")
        this.renderThemesList(false)
      }
    })

    if (left) left.appendChild(input)
    else li.insertBefore(input, li.querySelector(".settings-themes-item-actions"))
    input.focus()
    input.select()
  }

  async deleteTheme() {
    const selected = this.selectedTheme()
    if (!selected || selected.locked) return
    if (!window.confirm(`Delete theme "${selected.name}"?`)) return

    const payload = await this.submitThemeAction({ action: "delete", theme_id: selected.id })
    if (!payload) return
    this.refreshThemesFromPayload(payload)
    this.selectedThemeId = payload.active_theme_id || "default"
    this.renderThemesList(true)
  }

  selectedTheme() {
    return this.themes.find((theme) => theme.id === this.selectedThemeId) || null
  }

  confirmThemeSwitch(themeName) {
    if (!this.serverIsCustomLayout) return true
    return window.confirm(
      `Applying theme '${themeName}' will replace your current unsaved theme.`
    )
  }

  async applyThemeById(themeId) {
    const payload = await this.submitThemeAction({ action: "apply", theme_id: themeId })
    if (!payload) {
      this.renderThemesList(false)
      return
    }

    this.refreshThemesFromPayload(payload)
    if (payload?.appearance) this.applyAppearanceSnapshot(payload.appearance)
    this.serverIsCustomLayout = Boolean(payload?.is_custom_layout)
    this.renderThemesList(true)
  }

  async submitThemeAction(themePayload) {
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    if (!this.hasWorkspaceUrlValue) return null
    try {
      const response = await fetch(this.workspaceUrlValue, {
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
    if (typeof payload?.is_custom_layout === "boolean") {
      this.serverIsCustomLayout = payload.is_custom_layout
    }
    if (payload?.appearance) {
      const snapshot = this.normalizedAppearanceSnapshot(payload.appearance)
      this.activeThemeAppearanceSnapshot = snapshot
      this.currentLiveAppearance = snapshot
    }
    this.selectedThemeId = this.resolveSelectableThemeId(this.selectedThemeId)
  }

  applyAppearanceSnapshot(appearance) {
    const a = appearance || {}
    const dBg = this.defaultBackgroundModel
    const dCt = this.defaultContentModel

    const shellModel = {
      hue: this.clampHue(a.hue),
      saturation: this.clampPercent(a.saturation),
      brightness: this.clampPercent(a.brightness),
      alpha: this.clampTransparency(a.transparency)
    }

    const backgroundModel = {
      colorOneHue: this.clampHue(Number.isFinite(Number(a.color_1_hue)) ? a.color_1_hue : dBg.colorOneHue),
      colorOneSaturation: this.clampPercent(Number.isFinite(Number(a.color_1_saturation)) ? a.color_1_saturation : dBg.colorOneSaturation),
      colorOneBrightness: this.clampPercent(Number.isFinite(Number(a.color_1_brightness)) ? a.color_1_brightness : dBg.colorOneBrightness),
      colorTwoHue: this.clampHue(Number.isFinite(Number(a.color_2_hue)) ? a.color_2_hue : dBg.colorTwoHue),
      colorTwoSaturation: this.clampPercent(Number.isFinite(Number(a.color_2_saturation)) ? a.color_2_saturation : dBg.colorTwoSaturation),
      colorTwoBrightness: this.clampPercent(Number.isFinite(Number(a.color_2_brightness)) ? a.color_2_brightness : dBg.colorTwoBrightness),
      angle: this.clampAngle(Number.isFinite(Number(a.angle)) ? a.angle : dBg.angle)
    }

    const contentModel = {
      fontOne: this.clampPercent(Number.isFinite(Number(a.font_1)) ? a.font_1 : dCt.fontOne),
      fontOneAlpha: this.clampPercent(Number.isFinite(Number(a.font_1_alpha)) ? a.font_1_alpha : dCt.fontOneAlpha),
      fontTwo: this.clampPercent(Number.isFinite(Number(a.font_2)) ? a.font_2 : dCt.fontTwo),
      fontTwoAlpha: this.clampPercent(Number.isFinite(Number(a.font_2_alpha)) ? a.font_2_alpha : dCt.fontTwoAlpha)
    }

    this.applyWindowShellModel(shellModel)
    this.applyDesktopBackgroundModel(backgroundModel)
    this.applyContentToneModel(contentModel)
    this.activeThemeAppearanceSnapshot = this.normalizedAppearanceSnapshot(appearance)
    this.currentLiveAppearance = this.activeThemeAppearanceSnapshot
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

  applyContentToneModel(model) {
    const root = document.documentElement
    root.style.setProperty("--font-1-tone", String(Math.round(this.clampPercent(model.fontOne))))
    root.style.setProperty("--font-1-alpha", (this.clampPercent(model.fontOneAlpha) / 100).toFixed(2))
    root.style.setProperty("--font-2-tone", String(Math.round(this.clampPercent(model.fontTwo))))
    root.style.setProperty("--font-2-alpha", (this.clampPercent(model.fontTwoAlpha) / 100).toFixed(2))
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
      font_2_alpha: Math.round(contentModel.fontTwoAlpha)
    }
  }

  normalizedAppearanceSnapshot(appearance) {
    const a = appearance || {}
    const dBg = this.defaultBackgroundModel
    const dCt = this.defaultContentModel

    const shellModel = {
      hue: this.clampHue(a.hue),
      saturation: this.clampPercent(a.saturation),
      brightness: this.clampPercent(a.brightness),
      alpha: this.clampTransparency(a.transparency)
    }

    const backgroundModel = {
      colorOneHue: this.clampHue(Number.isFinite(Number(a.color_1_hue)) ? a.color_1_hue : dBg.colorOneHue),
      colorOneSaturation: this.clampPercent(Number.isFinite(Number(a.color_1_saturation)) ? a.color_1_saturation : dBg.colorOneSaturation),
      colorOneBrightness: this.clampPercent(Number.isFinite(Number(a.color_1_brightness)) ? a.color_1_brightness : dBg.colorOneBrightness),
      colorTwoHue: this.clampHue(Number.isFinite(Number(a.color_2_hue)) ? a.color_2_hue : dBg.colorTwoHue),
      colorTwoSaturation: this.clampPercent(Number.isFinite(Number(a.color_2_saturation)) ? a.color_2_saturation : dBg.colorTwoSaturation),
      colorTwoBrightness: this.clampPercent(Number.isFinite(Number(a.color_2_brightness)) ? a.color_2_brightness : dBg.colorTwoBrightness),
      angle: this.clampAngle(Number.isFinite(Number(a.angle)) ? a.angle : dBg.angle)
    }

    const contentModel = {
      fontOne: this.clampPercent(Number.isFinite(Number(a.font_1)) ? a.font_1 : dCt.fontOne),
      fontOneAlpha: this.clampPercent(Number.isFinite(Number(a.font_1_alpha)) ? a.font_1_alpha : dCt.fontOneAlpha),
      fontTwo: this.clampPercent(Number.isFinite(Number(a.font_2)) ? a.font_2 : dCt.fontTwo),
      fontTwoAlpha: this.clampPercent(Number.isFinite(Number(a.font_2_alpha)) ? a.font_2_alpha : dCt.fontTwoAlpha)
    }

    return this.buildAppearancePayload(shellModel, backgroundModel, contentModel)
  }

  currentAppearanceSnapshot() {
    if (this.currentLiveAppearance) return this.normalizedAppearanceSnapshot(this.currentLiveAppearance)
    if (this.activeThemeAppearanceSnapshot) return this.normalizedAppearanceSnapshot(this.activeThemeAppearanceSnapshot)
    return this.buildAppearancePayload(this.defaultShellModel, this.defaultBackgroundModel, this.defaultContentModel)
  }

  refreshActionStatusBadges(shouldBroadcast = true) {
    const activeTheme = this.themes.find((t) => t.id === this.activeThemeId)
    const activeThemeName = activeTheme?.name || "Default"

    if (this.hasActiveThemeLabelTarget) {
      this.activeThemeLabelTarget.textContent = this.serverIsCustomLayout ? "Custom (unsaved)" : activeThemeName
    }

    if (!shouldBroadcast) return

    window.dispatchEvent(
      new CustomEvent("workspace:theme-status", {
        detail: {
          active_theme_name: activeThemeName,
          active_theme_id: this.activeThemeId,
          is_custom_layout: this.serverIsCustomLayout,
          appearance: this.currentAppearanceSnapshot(),
          themes: this.themes
        }
      })
    )
  }

  resolveSelectableThemeId(preferredId) {
    const preferred = String(preferredId || "")
    if (preferred && this.themes.some((t) => t.id === preferred)) return preferred
    if (this.selectedThemeId && this.themes.some((t) => t.id === this.selectedThemeId)) return this.selectedThemeId
    if (this.activeThemeId && this.themes.some((t) => t.id === this.activeThemeId)) return this.activeThemeId
    const defaultTheme = this.themes.find((t) => t.id === "default")
    if (defaultTheme) return "default"
    return this.themes[0]?.id || "default"
  }

  clampHue(value) {
    if (!Number.isFinite(Number(value))) return this.defaultShellModel.hue
    return Math.min(360, Math.max(0, Number(value)))
  }

  clampPercent(value) {
    if (!Number.isFinite(Number(value))) return 0
    return Math.min(100, Math.max(0, Number(value)))
  }

  clampTransparency(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return 0.15
    return Math.min(0.95, Math.max(0.15, n))
  }

  clampAngle(value) {
    if (!Number.isFinite(Number(value))) return this.defaultBackgroundModel.angle
    return Math.min(360, Math.max(0, Number(value)))
  }
}
