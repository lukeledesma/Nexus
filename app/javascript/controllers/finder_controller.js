import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static targets = ["sidebar", "item"]

  connect() {
    this.openApp = null
    this.currentFolder = null
    this.transitionMs = 280
    this.scrollFadeDelayMs = 1100
    this.scrollRevealTimers = new Map()

    this.boundHandleScrollActivity = this.handleScrollActivity.bind(this)
    this.boundCloseComplete = this.handleCloseComplete.bind(this)
    this.boundRequestClose = this.handleRequestClose.bind(this)
    this.boundFinderOpen = this.handleFinderOpen.bind(this)
    document.addEventListener("scroll", this.boundHandleScrollActivity, true)
    window.addEventListener("app:closed:complete", this.boundCloseComplete)
    window.addEventListener("finder:request-close", this.boundRequestClose)
    window.addEventListener("finder:open", this.boundFinderOpen)
  }

  disconnect() {
    document.removeEventListener("scroll", this.boundHandleScrollActivity, true)
    window.removeEventListener("app:closed:complete", this.boundCloseComplete)
    window.removeEventListener("finder:request-close", this.boundRequestClose)
    window.removeEventListener("finder:open", this.boundFinderOpen)
    this.scrollRevealTimers.forEach((timerId, element) => {
      window.clearTimeout(timerId)
      element.classList.remove("is-scrolling")
    })
    this.scrollRevealTimers.clear()
  }

  // Called when a folder row is clicked — no expansion, just tracks selection.
  selectFolder(event) {
    this.currentFolder = event.currentTarget.dataset.folderId
  }

  toggle(event) {
    const item = event.currentTarget
    const appId = item.dataset.appId

    if (!appId) return

    if (this.openApp === appId) {
      this.close()
    } else {
      this.open(appId)
    }
  }

  open(appId) {
    this.openApp = appId
    this.highlight(appId)
    this.loadApp(appId)
    // Dispatch event for window manager to show main window
    window.dispatchEvent(new CustomEvent("app:opened", { detail: { appId } }))
  }

  close() {
    this.openApp = null
    this.highlight(null)
    // Dispatch event for window manager to hide main window
    window.dispatchEvent(new Event("app:closed"))
  }

  handleCloseComplete() {
    // Only clear when nothing was reopened during the close animation.
    if (!this.openApp) this.clearApp()
  }

  handleRequestClose(event) {
    const requestedAppId = event.detail?.appId
    if (!this.openApp) return
    if (requestedAppId && requestedAppId !== this.openApp) return
    this.close()
  }

  handleFinderOpen(event) {
    const appId = event.detail?.appId
    if (!appId) return
    this.open(appId)
  }

  loadApp(appId) {
    const frame = document.getElementById("app-pane")
    if (frame) {
      frame.classList.add("is-switching")
      Turbo.visit(`/apps/${appId}`, { frame: "app-pane" })
      window.setTimeout(() => {
        if (frame) frame.classList.remove("is-switching")
      }, this.transitionMs)
    }
  }

  clearApp() {
    const frame = document.getElementById("app-pane")
    if (frame) frame.innerHTML = ""
  }

  highlight(activeId) {
    this.itemTargets.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.appId === activeId)
    })
  }

  handleScrollActivity(event) {
    const element = event.target
    if (!(element instanceof Element)) return

    const isTracked =
      element.matches("#organizer") ||
      element.matches(".window-content") ||
      element.matches(".finder-app-frame")

    if (!isTracked) return

    element.classList.add("is-scrolling")

    const existingTimer = this.scrollRevealTimers.get(element)
    if (existingTimer) window.clearTimeout(existingTimer)

    const timerId = window.setTimeout(() => {
      element.classList.remove("is-scrolling")
      this.scrollRevealTimers.delete(element)
    }, this.scrollFadeDelayMs)

    this.scrollRevealTimers.set(element, timerId)
  }
}
