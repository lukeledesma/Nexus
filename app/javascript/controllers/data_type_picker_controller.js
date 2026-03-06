import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["trigger", "popup", "datatypeSelect", "encodeSelect", "typeSelect"]

  connect() {
    this.boundClose = this.close.bind(this)
    this.boundKeydown = this.handleKeydown.bind(this)
    const el = document.getElementById("data-type-picker-type-options")
    try {
      this.typeOptions = el && el.textContent ? JSON.parse(el.textContent) : []
    } catch (_) {
      this.typeOptions = []
    }
    this.reverseMap = {}
    this.typeOptions.forEach((opt) => {
      const key = `${this.normalizeCode(opt.datatype)}_${this.normalizeCode(opt.encode)}`
      this.reverseMap[key] = opt.label
    })
  }

  normalizeCode(code) {
    if (code == null) return "0"
    const s = String(code).trim().replace(/^0+/, "")
    return s === "" ? "0" : s
  }

  disconnect() {
    this.close()
  }

  open(e) {
    const trigger = e.currentTarget
    if (trigger.disabled) return
    e.preventDefault()
    e.stopPropagation()
    if (this.currentTrigger === trigger) {
      this.close()
      return
    }
    this.currentTrigger = trigger
    const dt = this.normalizeCode(trigger.dataset.rawDatatype || "0")
    const enc = this.normalizeCode(trigger.dataset.rawEncode || "255")
    this.popupTarget.classList.remove("hidden")
    this.popupTarget.setAttribute("aria-hidden", "false")
    this.positionPopup(trigger)
    this.datatypeSelectTarget.value = dt
    this.encodeSelectTarget.value = enc
    const key = `${dt}_${enc}`
    const label = this.reverseMap[key] || "Unique"
    this.typeSelectTarget.value = label
    this.updateUniqueHighlight()
    document.addEventListener("click", this.boundClose, true)
    document.addEventListener("keydown", this.boundKeydown)
  }

  close(e) {
    if (e && e.type === "click") {
      if (this.popupTarget.contains(e.target)) return
      if (this.triggerTargets.some((t) => t.contains(e.target))) return
    }
    if (this.currentTrigger) {
      this.currentTrigger.blur()
    }
    this.currentTrigger = null
    this.popupTarget.classList.add("hidden")
    this.popupTarget.setAttribute("aria-hidden", "true")
    document.removeEventListener("click", this.boundClose, true)
    document.removeEventListener("keydown", this.boundKeydown)
  }

  handleKeydown(e) {
    if (!this.popupTarget.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault()
        this.close()
      } else if (e.key === "Enter" && this.popupTarget.contains(document.activeElement)) {
        e.preventDefault()
        this.commitAndClose()
      }
    }
  }

  commitAndClose() {
    const dt = this.datatypeSelectTarget.value
    const enc = this.encodeSelectTarget.value
    const label = this.typeSelectTarget.value
    this.writeToRow(dt, enc, label)
    this.close()
  }

  positionPopup(trigger) {
    const rect = trigger.getBoundingClientRect()
    const popup = this.popupTarget
    popup.style.position = "fixed"
    popup.style.top = `${rect.bottom + 4}px`
    popup.style.left = `${rect.left}px`
    popup.style.transform = "none"
  }

  fromType() {
    const label = this.typeSelectTarget.value
    if (label === "Unique") return
    const opt = this.typeOptions.find((o) => o.label === label)
    if (!opt) return
    const dt = this.normalizeCode(opt.datatype)
    const enc = this.normalizeCode(opt.encode)
    this.datatypeSelectTarget.value = dt
    this.encodeSelectTarget.value = enc
    this.updateUniqueHighlight()
  }

  fromCodes() {
    const dt = this.datatypeSelectTarget.value
    const enc = this.encodeSelectTarget.value
    const key = `${dt}_${enc}`
    const label = this.reverseMap[key] || "Unique"
    this.typeSelectTarget.value = label
    this.updateUniqueHighlight()
  }

  updateUniqueHighlight() {
    const label = this.typeSelectTarget.value
    if (label === "Unique") {
      this.typeSelectTarget.classList.add("data-type-unique")
    } else {
      this.typeSelectTarget.classList.remove("data-type-unique")
    }
  }

  writeToRow(datatype, encode, label) {
    if (!this.currentTrigger) return
    const td = this.currentTrigger.closest("td")
    if (!td) return
    const hiddenValue = td.querySelector("input.cell[name*='Data Type']")
    const hiddenRawDt = td.querySelector("input[name*='_raw_datatype']")
    const hiddenRawEnc = td.querySelector("input[name*='_raw_encode']")
    if (hiddenValue) hiddenValue.value = label
    if (hiddenRawDt) hiddenRawDt.value = datatype
    if (hiddenRawEnc) hiddenRawEnc.value = encode
    this.currentTrigger.textContent = label || "—"
    this.currentTrigger.dataset.value = label
    this.currentTrigger.dataset.rawDatatype = datatype
    this.currentTrigger.dataset.rawEncode = encode
    if (label === "Unique") this.currentTrigger.classList.add("data-type-unique")
    else this.currentTrigger.classList.remove("data-type-unique")
    const opt = this.typeOptions.find((o) => o.label === label)
    const dtLabel = opt ? opt.datatype_label : ""
    const encLabel = opt ? opt.encode_label : ""
    this.currentTrigger.title = [dtLabel, encLabel].filter(Boolean).join(" / ") || "Data type"
    const form = this.element.closest("form")
    const row = this.currentTrigger.closest("tr.tag-data-row")
    if (form && form.dataset.controller && form.dataset.controller.includes("tag-table")) {
      form.dispatchEvent(new CustomEvent("tag-table:cell-changed", { bubbles: true, detail: { message: "Data Type updated", row } }))
    }
  }
}
