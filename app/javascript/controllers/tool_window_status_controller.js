import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["subtitle"]

  static values = {
    itemType: String,
    updatedAt: String,
    staticText: String
  }

  connect() {
    this.boundSavedState = this.handleSavedState.bind(this)
    window.addEventListener("nexus:item-saved", this.boundSavedState)

    if (!this.hasSubtitleTarget) return

    if (this.hasStaticTextValue) {
      this.subtitleTarget.textContent = this.staticTextValue
      return
    }

    this.renderTimestamp(this.updatedAtValue)
  }

  disconnect() {
    window.removeEventListener("nexus:item-saved", this.boundSavedState)
  }

  handleSavedState(event) {
    if (!this.hasItemTypeValue) return

    const itemType = event.detail?.itemType
    if (itemType !== this.itemTypeValue) return

    this.renderTimestamp(event.detail?.timestamp)
  }

  renderTimestamp(value) {
    if (!this.hasSubtitleTarget) return

    const date = new Date(value)
    const label = this.labelForItemType(this.itemTypeValue)
    if (Number.isNaN(date.getTime())) {
      this.subtitleTarget.textContent = `${label} Updated just now`
      return
    }

    this.subtitleTarget.textContent = `${label} Updated ${date.toLocaleString()}`
  }

  labelForItemType(itemType) {
    if (itemType === "note") return "Notes"
    if (itemType === "task_list") return "Tasks"
    return "Item"
  }
}
