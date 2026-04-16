import { Controller } from "@hotwired/stimulus"

const STORAGE_OPEN_KEY = "nexus.desktop.sidePanelOpen"

/** Desktop top-left slide-out panel (Nexus OS shell). */
export default class extends Controller {
  static targets = ["toggle", "drawer"]

  connect() {
    const stored = this.readStoredOpen()
    const domOpen = this.element.classList.contains("desktop-side-panel-host--open")

    if (stored !== domOpen) {
      this.element.classList.add("desktop-side-panel-host--hydrating")
      this.applyOpenDom(stored)
    } else {
      this.open = domOpen
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.element.classList.remove("desktop-side-panel-host--hydrating")
      })
    })
  }

  toggle(event) {
    if (event) event.preventDefault()
    this.setOpen(!this.open)
  }

  close(event) {
    if (event) event.preventDefault()
    this.setOpen(false)
  }

  setOpen(next) {
    if (this.open === next) return
    this.applyOpenDom(next)
    this.persistOpen(next)
  }

  applyOpenDom(next) {
    this.open = next
    this.element.classList.toggle("desktop-side-panel-host--open", next)
    if (this.hasToggleTarget) {
      this.toggleTarget.setAttribute("aria-expanded", next ? "true" : "false")
      this.toggleTarget.setAttribute("aria-label", next ? "Close side panel" : "Open side panel")
      this.toggleTarget.setAttribute("title", next ? "Close panel" : "Open panel")
      this.toggleTarget.classList.toggle("is-active", next)
    }
    if (this.hasDrawerTarget) {
      this.drawerTarget.setAttribute("aria-hidden", next ? "false" : "true")
    }
  }

  readStoredOpen() {
    try {
      return window.localStorage.getItem(STORAGE_OPEN_KEY) === "1"
    } catch {
      return false
    }
  }

  persistOpen(open) {
    try {
      window.localStorage.setItem(STORAGE_OPEN_KEY, open ? "1" : "0")
    } catch {
      /* ignore quota / private mode */
    }
  }
}
