import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  openSettings(event) {
    event.preventDefault()
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "settings" } }))
    window.dispatchEvent(new CustomEvent("launcher:close"))
  }

  openUser(event) {
    event.preventDefault()
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "user" } }))
    window.dispatchEvent(new CustomEvent("launcher:close"))
  }
}
