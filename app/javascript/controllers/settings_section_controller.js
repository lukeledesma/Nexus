import { Controller } from "@hotwired/stimulus"

const VALID_SECTIONS = new Set(["saved_themes", "user"])

export default class extends Controller {
  static values = {
    current: String,
    explicit: Boolean,
    frameId: String,
    baseUrl: String
  }

  connect() {
    const current = this.currentValue.toString().trim()
    if (!VALID_SECTIONS.has(current)) return

    const stored = this.readStoredSection()
    const explicit = this.explicitValue === true
    const canRestore = !explicit && stored && VALID_SECTIONS.has(stored) && stored !== current

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
