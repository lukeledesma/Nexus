import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static targets = ["window", "mainPane", "sidebar", "item"]

  connect() {
    this.openApp = null
    this.currentFolder = null
    this.transitionMs = 280
    this.expandTimer = null
    this.closeTimer = null
    this.closeEndHandler = null
    this.setLauncherAttached(false)
  }

  // Called when a folder row is clicked — no expansion, just tracks selection.
  selectFolder(event) {
    this.currentFolder = event.currentTarget.dataset.folderId
  }

  toggle(event) {
    const appId = event.currentTarget.dataset.appId

    if (!appId) return

    if (this.openApp === appId) {
      this.close()
    } else {
      this.open(appId)
    }
  }

  open(appId) {
    this.openApp = appId
    this.expand()
    this.highlight(appId)
    this.loadApp(appId)
  }

  close() {
    this.openApp = null
    this.highlight(null)
    this.collapse()
    this.clearApp()
  }

  loadApp(appId) {
    this.mainPaneTarget.classList.add("is-switching")
    Turbo.visit(`/apps/${appId}`, { frame: "app-pane" })
    window.setTimeout(() => this.mainPaneTarget.classList.remove("is-switching"), this.transitionMs)
  }

  clearApp() {
    const frame = document.getElementById("app-pane")
    if (frame) frame.innerHTML = ""
  }

  expand() {
    if (this.expandTimer) {
      window.clearTimeout(this.expandTimer)
      this.expandTimer = null
    }

    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer)
      this.closeTimer = null
    }

    this.removeCloseEndListener()

    const launcher = document.getElementById("launcher-window")
    if (launcher) launcher.classList.remove("animate-corners")

    // Open immediately; no corner-delay on expand.
    this.setLauncherAttached(true)

    this.windowTarget.classList.remove("collapsed")
    this.windowTarget.classList.add("expanded")

    this.mainPaneTarget.classList.remove("hidden")
    requestAnimationFrame(() => this.mainPaneTarget.classList.remove("opacity-0"))
  }

  collapse() {
    if (this.expandTimer) {
      window.clearTimeout(this.expandTimer)
      this.expandTimer = null
    }

    if (this.closeTimer) {
      window.clearTimeout(this.closeTimer)
      this.closeTimer = null
    }

    this.removeCloseEndListener()

    this.windowTarget.classList.remove("expanded")
    this.windowTarget.classList.add("collapsed")

    this.mainPaneTarget.classList.add("opacity-0")

    const finishClose = () => {
      if (!this.openApp) {
        this.mainPaneTarget.classList.add("hidden")

        const launcher = document.getElementById("launcher-window")
        if (launcher) launcher.classList.add("animate-corners")
        this.setLauncherAttached(false)
      }

      this.removeCloseEndListener()

      if (this.closeTimer) {
        window.clearTimeout(this.closeTimer)
        this.closeTimer = null
      }
    }

    this.closeEndHandler = (event) => {
      if (event.target !== this.mainPaneTarget) return
      if (event.propertyName !== "transform") return
      finishClose()
    }

    this.mainPaneTarget.addEventListener("transitionend", this.closeEndHandler)

    // Fallback in case transitionend does not fire (browser edge-case).
    this.closeTimer = window.setTimeout(finishClose, this.transitionMs + 120)
  }

  removeCloseEndListener() {
    if (!this.closeEndHandler) return
    this.mainPaneTarget.removeEventListener("transitionend", this.closeEndHandler)
    this.closeEndHandler = null
  }

  setLauncherAttached(attached) {
    const launcher = document.getElementById("launcher-window")
    if (!launcher) return

    launcher.classList.toggle("has-open-pane", attached)
  }

  highlight(activeId) {
    this.itemTargets.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.appId === activeId)
    })
  }
}
