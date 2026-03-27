import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    debounce: { type: Number, default: 250 },
    itemId: Number,
    itemType: String
  }

  connect() {
    this.boundDelegate = this.delegateSubmit.bind(this)
    this.boundTrigger = this.forceSubmit.bind(this)
    this.element.addEventListener("focusout", this.boundDelegate, true)
    this.element.addEventListener("change", this.boundDelegate, true)
    this.element.addEventListener("input", this.boundDelegate, true)
    this.element.addEventListener("autosave:trigger", this.boundTrigger)
    this.inFlight = false
    this.pending = false
  }

  disconnect() {
    this.element.removeEventListener("focusout", this.boundDelegate, true)
    this.element.removeEventListener("change", this.boundDelegate, true)
    this.element.removeEventListener("input", this.boundDelegate, true)
    this.element.removeEventListener("autosave:trigger", this.boundTrigger)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
  }

  delegateSubmit(e) {
    const t = e.target
    if (!t) return
    if (!["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return
    if (t.type === "hidden") return
    this.submit()
  }

  forceSubmit() {
    this.submit(0)
  }

  submit(delay = this.debounceValue) {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.#send()
      this.debounceTimer = null
    }, delay)
  }

  async #send() {
    const form = this.element
    if (!form || form.tagName !== "FORM" || !form.action) return

    if (this.inFlight) {
      this.pending = true
      return
    }

    const method = (form.getAttribute("method") || "post").toUpperCase()
    const body = new FormData(form)
    if (!body.has("_method")) body.set("_method", "patch")

    const nameBeforeSave = (body.get("item[name]") || "").toString().trim()
    const csrf = document.querySelector('meta[name="csrf-token"]')
    const token = csrf?.getAttribute("content")
    if (token && !body.has("authenticity_token")) body.set("authenticity_token", token)

    const headers = {
      "X-Requested-With": "XMLHttpRequest",
      "Accept": "application/json"
    }
    if (token) headers["X-CSRF-Token"] = token

    this.inFlight = true
    try {
      const response = await fetch(form.action, {
        method: method === "GET" ? "GET" : "POST",
        headers,
        body
      })

      if (!response.ok) return

      const json = await response.json().catch(() => ({}))
      const savedName = (json.name || nameBeforeSave || "").toString().trim()
      if (savedName.length > 0) this.#updateSidebarName(savedName)
      this.#publishSaveState(json)
    } catch (_error) {
      // Keep autosave silent; user can still press explicit Save.
    } finally {
      this.inFlight = false
      if (this.pending) {
        this.pending = false
        this.submit(0)
      }
    }
  }

  #updateSidebarName(newName) {
    if (!this.hasItemIdValue || !this.hasItemTypeValue) return

    const selector = `.finder-item[data-item-id="${this.itemIdValue}"][data-item-type="${this.itemTypeValue}"] .finder-item-label`
    document.querySelectorAll(selector).forEach((label) => {
      label.textContent = newName
    })
  }

  #publishSaveState(json) {
    const itemType = (json.item_type || this.itemTypeValue || "").toString().trim()
    if (!itemType) return

    const timestamp = (json.updated_at || "").toString().trim() || new Date().toISOString()

    window.dispatchEvent(new CustomEvent("nexus:item-saved", {
      detail: {
        itemType,
        timestamp
      }
    }))
  }
}
