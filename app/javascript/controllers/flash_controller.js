import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { delay: { type: Number, default: 10000 } }

  connect() {
    const notices = this.element.querySelectorAll(".notice, .alert")
    if (notices.length === 0) return
    this.dismissTimeout = setTimeout(() => {
      notices.forEach(el => el.remove())
      this.dismissTimeout = null
    }, this.delayValue)
  }

  disconnect() {
    if (this.dismissTimeout) clearTimeout(this.dismissTimeout)
  }
}
