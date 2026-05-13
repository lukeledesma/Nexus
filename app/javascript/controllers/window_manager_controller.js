import { Controller } from "@hotwired/stimulus"
import { syncNexusDesktopWallpaper, syncNexusWorkspaceChrome } from "lib/nexus_workspace_chrome"

function themeStatusIncludesWallpaper(detail) {
  if (!detail || typeof detail !== "object") return false
  return (
    Object.prototype.hasOwnProperty.call(detail, "wallpaper_background_kind") ||
    Object.prototype.hasOwnProperty.call(detail, "wallpaper_image_document_id")
  )
}

/** Logged-in desktop shell: theme sync only (apps open via side panel / `app-window:toggle`). */
export default class extends Controller {
  connect() {
    this.boundWorkspaceThemeStatus = this.handleWorkspaceThemeStatus.bind(this)
    this.boundWallpaperChanged = this.handleWallpaperChanged.bind(this)
    window.addEventListener("workspace:theme-status", this.boundWorkspaceThemeStatus)
    window.addEventListener("nexus:wallpaper-changed", this.boundWallpaperChanged)
    this.applyWorkspaceThemeOnBoot()
  }

  disconnect() {
    window.removeEventListener("workspace:theme-status", this.boundWorkspaceThemeStatus)
    window.removeEventListener("nexus:wallpaper-changed", this.boundWallpaperChanged)
  }

  async applyWorkspaceThemeOnBoot() {
    try {
      const response = await fetch("/workspace_preferences", { headers: { Accept: "application/json" } })
      if (!response.ok) return
      const payload = await response.json()
      syncNexusWorkspaceChrome({
        active_theme_id: payload?.active_theme_id,
        appearance: payload?.appearance,
        shell_mode: payload?.shell_mode
      })
      syncNexusDesktopWallpaper(payload || {})
    } catch (_error) {
      // non-blocking
    }
  }

  handleWorkspaceThemeStatus(event) {
    const d = event?.detail || {}
    syncNexusWorkspaceChrome({
      active_theme_id: d.active_theme_id,
      appearance: d.appearance,
      shell_mode: d.shell_mode
    })
    if (themeStatusIncludesWallpaper(d)) {
      syncNexusDesktopWallpaper(d)
    }
  }

  handleWallpaperChanged(event) {
    const d = event?.detail || {}
    syncNexusDesktopWallpaper({
      wallpaper_background_kind: d.wallpaper_background_kind,
      wallpaper_image_document_id: d.wallpaper_image_document_id
    })
  }
}
