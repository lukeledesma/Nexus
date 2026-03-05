import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "status"]

  showName() {
    const input = this.inputTarget
    if (input.files.length) {
      const name = input.files[0].name
      this.statusTarget.textContent = name
    } else {
      this.statusTarget.textContent = "No file selected"
    }
  }
}
