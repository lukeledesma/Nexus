import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["expression", "result"]

  evaluate() {
    const raw = this.expressionTarget.value.toString().trim()
    if (!raw) {
      this.resultTarget.textContent = "Result: -"
      return
    }

    // Only allow arithmetic characters for this lightweight in-browser evaluator.
    if (!/^[0-9+\-*/().\s]+$/.test(raw)) {
      this.resultTarget.textContent = "Result: invalid expression"
      return
    }

    try {
      // eslint-disable-next-line no-new-func
      const value = Function(`\"use strict\"; return (${raw})`)()
      this.resultTarget.textContent = `Result: ${value}`
    } catch (_error) {
      this.resultTarget.textContent = "Result: invalid expression"
    }
  }
}
