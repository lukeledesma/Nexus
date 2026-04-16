import { Controller } from "@hotwired/stimulus"
import { finderMultipartHeaders } from "lib/finder"

const VALID_SECTIONS = new Set(["saved_themes", "theme_studio", "user", "wallpaper"])
const OS_IMAGE_TYPES = new Set(["image/jpeg", "image/png"])

function osImageFilesFromDataTransfer(dt) {
  const files = dt?.files
  if (!files?.length) return []
  const out = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const t = (f.type || "").toLowerCase()
    if (OS_IMAGE_TYPES.has(t)) {
      out.push(f)
      continue
    }
    const name = (f.name || "").toLowerCase()
    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")) out.push(f)
  }
  return out
}

export default class extends Controller {
  static values = {
    current: String,
    explicit: Boolean,
    frameId: String,
    baseUrl: String
  }

  connect() {
    this._wallpaperDropHoverEl = null
    this.wallpaperFolderId = null
    this.wallpaperFolderUnavailable = null
    this.boundDragOver = this.handleSettingsDragOver.bind(this)
    this.boundDrop = this.handleSettingsDrop.bind(this)
    this.element.addEventListener("dragover", this.boundDragOver)
    this.element.addEventListener("drop", this.boundDrop)

    let current = this.currentValue.toString().trim()
    if (!VALID_SECTIONS.has(current)) return

    if (document.documentElement.dataset.nexusTheme === "classic" && current === "theme_studio") {
      current = "saved_themes"
      const frameId = this.frameIdValue.toString().trim()
      const baseUrl = this.baseUrlValue.toString().trim()
      if (frameId && baseUrl) {
        const nextUrl = new URL(baseUrl, window.location.origin)
        nextUrl.searchParams.set("section", "saved_themes")
        nextUrl.searchParams.set("frame_id", frameId)
        const frame = document.getElementById(frameId)
        if (frame && frame.tagName === "TURBO-FRAME") {
          frame.src = `${nextUrl.pathname}${nextUrl.search}`
          this.writeStoredSection("saved_themes")
          return
        }
      }
    }

    const stored = this.readStoredSection()
    const explicit = this.explicitValue === true
    const classicBlocksStudio =
      document.documentElement.dataset.nexusTheme === "classic" && stored === "theme_studio"
    const canRestore =
      !explicit && stored && VALID_SECTIONS.has(stored) && stored !== current && !classicBlocksStudio

    if (canRestore) {
      const frameId = this.frameIdValue.toString().trim()
      const baseUrl = this.baseUrlValue.toString().trim()
      if (frameId && baseUrl) {
        const nextUrl = new URL(baseUrl, window.location.origin)
        nextUrl.searchParams.set("section", stored)
        nextUrl.searchParams.set("frame_id", frameId)

        const frame = document.getElementById(frameId)
        if (frame && frame.tagName === "TURBO-FRAME") {
          frame.src = `${nextUrl.pathname}${nextUrl.search}`
          return
        }
      }
    }

    this.writeStoredSection(current)
  }

  disconnect() {
    this.clearWallpaperDropHover()
    this.element.removeEventListener("dragover", this.boundDragOver)
    this.element.removeEventListener("drop", this.boundDrop)
  }

  wallpaperSidebarRow() {
    return this.element.querySelector('[data-settings-section-key="wallpaper"] .finder-folder-link')
  }

  clearWallpaperDropHover() {
    if (!this._wallpaperDropHoverEl) return
    this._wallpaperDropHoverEl.classList.remove("finder-tree__row-line--drop-target")
    this._wallpaperDropHoverEl = null
  }

  handleSettingsDragOver(event) {
    const types = event.dataTransfer?.types ? Array.from(event.dataTransfer.types) : []
    if (!types.includes("Files")) {
      this.clearWallpaperDropHover()
      return
    }

    const wallpaperRow = this.wallpaperSidebarRow()
    const over = event.target.closest?.(".finder-folder-link")
    if (!wallpaperRow || !over || over !== wallpaperRow) {
      this.clearWallpaperDropHover()
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    if (this._wallpaperDropHoverEl !== wallpaperRow) {
      this.clearWallpaperDropHover()
      this._wallpaperDropHoverEl = wallpaperRow
      wallpaperRow.classList.add("finder-tree__row-line--drop-target")
    }
  }

  async handleSettingsDrop(event) {
    this.clearWallpaperDropHover()

    const wallpaperRow = this.wallpaperSidebarRow()
    const over = event.target.closest?.(".finder-folder-link")
    if (!wallpaperRow || !over || over !== wallpaperRow) return

    const dt = event.dataTransfer
    if (!dt?.files?.length) return

    event.preventDefault()
    event.stopPropagation()

    const images = osImageFilesFromDataTransfer(dt)
    if (images.length === 0) {
      window.alert("Only JPEG and PNG images can be dropped into Wallpaper.")
      return
    }

    const folderId = await this.ensureWallpaperFolderId()
    if (!folderId) {
      window.alert("Wallpaper folder is not available.")
      return
    }

    const formData = new FormData()
    images.forEach((file) => formData.append("files[]", file))
    const response = await fetch(`/documents/${encodeURIComponent(String(folderId))}/upload_images`, {
      method: "POST",
      headers: finderMultipartHeaders(),
      body: formData
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(data.error || "Could not upload wallpapers.")
      return
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      window.alert(data.errors.join("\n"))
    }
    if (Array.isArray(data.files) && data.files.length > 0) {
      window.dispatchEvent(new CustomEvent("settings:wallpaper-files-changed"))
    }
  }

  async ensureWallpaperFolderId() {
    if (Number.isFinite(this.wallpaperFolderId) && this.wallpaperFolderId > 0) return this.wallpaperFolderId
    if (this.wallpaperFolderUnavailable === true) return 0

    try {
      const response = await fetch("/apps/wallpaper_iimage/files", { headers: { Accept: "application/json" } })
      if (!response.ok) return 0
      const data = await response.json()
      const id = data?.folder_id ? Number(data.folder_id) : 0
      this.wallpaperFolderId = Number.isFinite(id) && id > 0 ? id : 0
      this.wallpaperFolderUnavailable = Boolean(data?.unavailable) || this.wallpaperFolderId <= 0
      return this.wallpaperFolderId
    } catch (_e) {
      return 0
    }
  }

  storageKey() {
    return "nexus.settings.activeSection"
  }

  readStoredSection() {
    try {
      const value = window.localStorage.getItem(this.storageKey()) || ""
      return value.toString().trim()
    } catch (_error) {
      return ""
    }
  }

  writeStoredSection(section) {
    try {
      window.localStorage.setItem(this.storageKey(), section)
    } catch (_error) {
      // non-blocking
    }
  }
}
