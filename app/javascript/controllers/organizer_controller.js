import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static targets = ["newFolderForm", "newFolderInput", "stamp", "conversionPair"]

  #conversionPairs = [
    { sae: '5/16"', metric: '8 mm' },
    { sae: '3/8"', metric: '10 mm' },
    { sae: '7/16"', metric: '11 mm' },
    { sae: '1/2"', metric: '13 mm' },
    { sae: '9/16"', metric: '14 mm' },
    { sae: '5/8"', metric: '16 mm' },
    { sae: '11/16"', metric: '17 mm' },
    { sae: '3/4"', metric: '19 mm' }
  ]

  #conversionIndex = 0
  #conversionInterval = null

  connect() {
    this.boundSavedState = this.handleSavedState.bind(this)
    window.addEventListener("nexus:item-saved", this.boundSavedState)
    this.loadPersistedStamp()
    this.startConversionCycle()
  }

  disconnect() {
    window.removeEventListener("nexus:item-saved", this.boundSavedState)
    this.stopConversionCycle()
  }

  toggleNewFolder(event) {
    event.stopPropagation()
    const form = this.newFolderFormTarget
    if (form.classList.contains("hidden")) {
      form.classList.remove("hidden")
      this.newFolderInputTarget.value = ""
      this.newFolderInputTarget.focus()
      this.newFolderInputTarget.select()
    } else {
      form.classList.add("hidden")
      this.newFolderInputTarget.value = ""
    }
  }

  newFolderKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.newFolderFormTarget.classList.add("hidden")
      this.newFolderInputTarget.value = ""
    }
  }

  async submitNewFolder(event) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const resp = await fetch(form.action, {
      method: "POST",
      headers: { "Accept": "application/json", "X-CSRF-Token": this.#csrf() },
      body: data
    })

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}))
      alert(json.errors?.join(", ") || "Could not create folder.")
      return
    }

    this.newFolderFormTarget.classList.add("hidden")
    this.newFolderInputTarget.value = ""
    Turbo.visit("/")
  }

  handleSavedState(event) {
    if (!this.hasStampTarget) return

    const itemType = event.detail?.itemType
    const timestamp = event.detail?.timestamp
    const label = this.labelForItemType(itemType)
    if (!label) return

    this.applyStamp(label, timestamp)
  }

  async loadPersistedStamp() {
    if (!this.hasStampTarget) return

    try {
      const response = await fetch("/db_health", {
        method: "GET",
        headers: { Accept: "application/json" }
      })
      if (!response.ok) return

      const payload = await response.json()
      const lastUpdated = payload?.organizer?.last_updated
      const label = lastUpdated?.label
      const timestamp = lastUpdated?.updated_at
      if (!label || !timestamp) return

      this.applyStamp(label, timestamp)
    } catch (_error) {
      // Keep organizer status non-blocking if metrics endpoint is unavailable.
    }
  }

  applyStamp(label, timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return

    if (this.latestUpdateAt && date <= this.latestUpdateAt) return
    this.latestUpdateAt = date

    this.stampTarget.textContent = `${label} Updated ${this.formatTimestamp(timestamp)}`
  }

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return "-"
    const units = ["B", "KB", "MB", "GB"]
    const index = Math.floor(Math.log(bytes) / Math.log(1024))
    const value = (bytes / Math.pow(1024, index)).toFixed(0)
    return `${value} ${units[index] || "B"}`
  }

  startConversionCycle() {
    if (!this.hasConversionPairTarget) return
    this.updateConversionDisplay()
    this.#conversionInterval = setInterval(() => this.cycleConversion(), 2000)
  }

  stopConversionCycle() {
    if (this.#conversionInterval) {
      clearInterval(this.#conversionInterval)
      this.#conversionInterval = null
    }
  }

  cycleConversion() {
    this.#conversionIndex = (this.#conversionIndex + 1) % this.#conversionPairs.length
    this.updateConversionDisplay()
  }

  updateConversionDisplay() {
    if (!this.hasConversionPairTarget) return
    const pair = this.#conversionPairs[this.#conversionIndex]
    this.conversionPairTarget.textContent = `${pair.sae} | ${pair.metric}`
  }

  labelForItemType(itemType) {
    if (itemType === "note") return "Notes"
    if (itemType === "task_list") return "Tasks"
    return null
  }

  launchApp(event) {
    const url = event.currentTarget.dataset.appUrl
    if (!url) return
    window.dispatchEvent(new CustomEvent("content-window:open", { detail: { url } }))
  }

  formatTimestamp(value) {
    if (!value) return "just now"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "just now"
    return date.toLocaleString()
  }

  renameFolder(event) {
    event.preventDefault()
    event.stopPropagation()
    const btn = event.currentTarget.closest(".finder-item")
    const label = btn.querySelector(".finder-item-label")
    const folderId = btn.dataset.folderId
    const original = label.textContent.trim()

    btn.disabled = true
    this.#inlineInput(original, label, {
      onSave: (newName) => {
        btn.disabled = false
        if (newName !== original) {
          this.#patch(`/apps/folders/${folderId}`, { folder: { name: newName } })
        }
      },
      onCancel: () => { btn.disabled = false }
    })
  }

  async deleteFolder(event) {
    event.preventDefault()
    event.stopPropagation()
    const btn = event.currentTarget.closest(".finder-item")
    const folderId = btn.dataset.folderId
    const name = btn.querySelector(".finder-item-label").textContent.trim()

    if (!confirm(`Delete "${name}" and all its items?`)) return

    await this.#delete(`/apps/folders/${folderId}`)
    Turbo.visit("/")
  }

  #inlineInput(value, node, { onSave, onCancel }) {
    const input = document.createElement("input")
    input.type = "text"
    input.value = value
    input.className = "finder-rename-input"
    node.replaceWith(input)
    input.focus()
    input.select()

    let settled = false
    const finish = (save) => {
      if (settled) return
      settled = true
      const newVal = input.value.trim() || value
      node.textContent = newVal
      input.replaceWith(node)
      if (save) onSave(newVal)
      else onCancel()
    }

    input.addEventListener("blur", () => finish(true))
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault()
        input.blur()
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault()
        settled = true
        node.textContent = value
        input.replaceWith(node)
        onCancel()
      }
    })
  }

  #csrf() {
    return document.querySelector("meta[name='csrf-token']")?.content
  }

  async #patch(path, body) {
    const response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": this.#csrf() },
      body: JSON.stringify(body)
    })

    if (!response.ok) return null
    return response.json().catch(() => ({}))
  }

  async #delete(path) {
    const response = await fetch(path, { method: "DELETE", headers: { "X-CSRF-Token": this.#csrf() } })
    return response.ok
  }
}
