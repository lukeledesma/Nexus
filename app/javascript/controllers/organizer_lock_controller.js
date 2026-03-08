import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["button"]
  static values = { locked: Boolean }

  connect() {
    this.lockedValue = true
    document.body.classList.remove("organizer-unlocked")
    this.updateButton()
  }

  toggle() {
    this.lockedValue = !this.lockedValue
    document.body.classList.toggle("organizer-unlocked", !this.lockedValue)
    this.updateButton()
  }

  updateButton() {
    if (!this.hasButtonTarget) return

    this.buttonTarget.textContent = this.lockedValue ? "🔒" : "🔓"
  }
}
