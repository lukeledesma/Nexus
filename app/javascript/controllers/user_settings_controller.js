import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"
import { NEXUS_SHELL_MODE_STORAGE_KEY, syncNexusWorkspaceChrome } from "lib/nexus_workspace_chrome"

const THEME_ORDER = ["system", "dark", "light"]
const THEME_META = {
  system: { label: "System", icon: "desktop_windows" },
  dark: { label: "Dark", icon: "dark_mode" },
  light: { label: "Light", icon: "light_mode" }
}

export default class extends Controller {
  static targets = ["themeLabel", "themeButton"]

  connect() {
    this.loadThemePreference()
  }

  loadThemePreference() {
    const stored = localStorage.getItem(NEXUS_SHELL_MODE_STORAGE_KEY)
    this.currentTheme = THEME_ORDER.includes(stored) ? stored : "system"
    this.updateThemeUI()
  }

  cycleTheme() {
    const idx = THEME_ORDER.indexOf(this.currentTheme)
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length]
    this.currentTheme = next
    this.writeThemePreference(next)
    this.updateThemeUI()
  }

  writeThemePreference(theme) {
    localStorage.setItem(NEXUS_SHELL_MODE_STORAGE_KEY, theme)
    this.applyTheme(theme)
  }

  applyTheme(theme) {
    syncNexusWorkspaceChrome({ shell_mode: theme })
  }

  updateThemeUI() {
    const meta = THEME_META[this.currentTheme]
    
    // Update theme label text if target exists
    if (this.hasThemeLabelTarget) {
      this.themeLabelTarget.textContent = meta.label
    }
    
    // Update button with SVG if target exists
    if (this.hasThemeButtonTarget) {
      this.themeButtonTarget.title = `Switch theme (${meta.label})`
      this.themeButtonTarget.innerHTML = materialSymbolSvg(meta.icon, "xs")
    }
  }
}
