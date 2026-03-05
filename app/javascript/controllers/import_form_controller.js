import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = []

  chooseFile() {
    const input = this.element.querySelector('input[type="file"]')
    if (input) input.click()
  }

  submit() {
    const input = this.element.querySelector('input[type="file"]')
    if (input && input.files.length) this.element.requestSubmit()
  }
}
