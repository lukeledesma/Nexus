import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["trigger", "popup", "datatypeSelect", "encodeSelect", "typeSelect"]

  // Lifecycle and initial option mapping.
  connect() {
    this.boundClose = this.close.bind(this)
    this.boundFocusInClose = this.handleFocusInClose.bind(this)
    this.boundKeydown = this.handleKeydown.bind(this)
    this.boundViewportUpdate = this.updatePopupPosition.bind(this)
    const el = document.getElementById("data-type-picker-type-options")
    try {
      this.typeOptions = el && el.textContent ? JSON.parse(el.textContent) : []
    } catch (_) {
      this.typeOptions = []
    }
    this.reverseMap = {}
    this.typeOptions.forEach((opt) => {
      const key = `${this.normalizeCode(opt.datatype)}_${this.normalizeCode(opt.encode)}`
      if (!this.reverseMap[key]) this.reverseMap[key] = opt.label
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

  // Popup open/close behavior and outside-dismiss.
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
    this.setSelectByNormalizedCode(this.datatypeSelectTarget, dt)
    this.setSelectByNormalizedCode(this.encodeSelectTarget, enc)
    const key = `${dt}_${enc}`
    const label = this.reverseMap[key] || "Unique"
    this.typeSelectTarget.value = label
    this.updateUniqueHighlight()
    this.bindViewportTracking()
    document.addEventListener("click", this.boundClose, true)
    document.addEventListener("focusin", this.boundFocusInClose, true)
    document.addEventListener("keydown", this.boundKeydown)
  }

  close(e) {
    if (e && e.type === "click") {
      if (this.popupTarget.contains(e.target)) return
      if (this.currentTrigger && this.currentTrigger.contains(e.target)) return
    }
    if (this.currentTrigger) {
      this.currentTrigger.blur()
    }
    this.currentTrigger = null
    this.popupTarget.classList.add("hidden")
    this.popupTarget.setAttribute("aria-hidden", "true")
    this.unbindViewportTracking()
    document.removeEventListener("click", this.boundClose, true)
    document.removeEventListener("focusin", this.boundFocusInClose, true)
    document.removeEventListener("keydown", this.boundKeydown)
  }

  // Keep popup anchored while viewport/zoom/scroll changes.
  bindViewportTracking() {
    window.addEventListener("resize", this.boundViewportUpdate)
    document.addEventListener("scroll", this.boundViewportUpdate, true)
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", this.boundViewportUpdate)
      window.visualViewport.addEventListener("scroll", this.boundViewportUpdate)
    }
  }

  unbindViewportTracking() {
    window.removeEventListener("resize", this.boundViewportUpdate)
    document.removeEventListener("scroll", this.boundViewportUpdate, true)
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.boundViewportUpdate)
      window.visualViewport.removeEventListener("scroll", this.boundViewportUpdate)
    }
  }

  updatePopupPosition() {
    if (!this.currentTrigger || this.popupTarget.classList.contains("hidden")) return
    this.positionPopup(this.currentTrigger)
  }

  // Keyboard interactions.
  handleFocusInClose(e) {
    if (this.popupTarget.classList.contains("hidden")) return
    if (this.popupTarget.contains(e.target)) return
    if (this.currentTrigger && this.currentTrigger.contains(e.target)) return
    this.close()
  }

  handleKeydown(e) {
    if (!this.popupTarget.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault()
        this.close()
      } else if (e.key === "Enter") {
        e.preventDefault()
        this.commitAndClose()
      }
    }
  }

  // Commit and positioning.
  commitAndClose() {
    const dt = this.datatypeSelectTarget.value
    const enc = this.encodeSelectTarget.value
    const label = this.typeSelectTarget.value
    this.writeToRow(dt, enc, label)
    this.close()
  }

  positionPopup(trigger) {
    const td = trigger.closest("td")
    const rect = (td || trigger).getBoundingClientRect()
    const popup = this.popupTarget
    // Align popup outer edges to the table cell border lines.
    const borderAlign = 1
    popup.style.position = "fixed"
    popup.style.top = `${Math.round(rect.bottom - borderAlign)}px`
    popup.style.left = `${Math.round(rect.left - borderAlign)}px`
    popup.style.transform = "none"
  }

  // Dropdown synchronization helpers.
  fromType(e) {
    const label = this.typeSelectTarget.value
    if (label === "Unique") return
    const opt = this.typeOptions.find((o) => o.label === label)
    if (!opt) return
    const dt = this.normalizeCode(opt.datatype)
    const enc = this.normalizeCode(opt.encode)
    this.setSelectByNormalizedCode(this.datatypeSelectTarget, dt)
    this.setSelectByNormalizedCode(this.encodeSelectTarget, enc)
    this.updateUniqueHighlight()
    this.blurPopupSelect(e)
  }

  fromCodes(e) {
    const dt = this.normalizeCode(this.datatypeSelectTarget.value)
    const enc = this.normalizeCode(this.encodeSelectTarget.value)
    const key = `${dt}_${enc}`
    const label = this.reverseMap[key] || "Unique"
    this.typeSelectTarget.value = label
    this.updateUniqueHighlight()
    this.blurPopupSelect(e)
  }

  blurPopupSelect(e) {
    const target = e && e.target
    if (!target || target.tagName !== "SELECT") return
    requestAnimationFrame(() => target.blur())
  }

  setSelectByNormalizedCode(selectEl, code) {
    const normalized = this.normalizeCode(code)
    const option = Array.from(selectEl.options).find((opt) => this.normalizeCode(opt.value) === normalized)
    selectEl.value = option ? option.value : normalized
  }

  // UI rendering helpers.
  buildTooltip(datatypeLabel, encodeLabel, datatypeCode, encodeCode) {
    const dt = (datatypeLabel || "").trim() || "Unknown"
    const enc = (encodeLabel || "").trim() || "Unknown"
    const dtCode = this.normalizeCode(datatypeCode)
    const encCode = this.normalizeCode(encodeCode)
    return `Datatype - ${dtCode}: ${dt}\nEncode - ${encCode}: ${enc}`
  }

  codeLabelFromSelect(selectEl, code) {
    const normalized = this.normalizeCode(code)
    const option = Array.from(selectEl.options).find((opt) => this.normalizeCode(opt.value) === normalized)
    if (option) return option.textContent.trim()
    return `Code ${normalized}`
  }

  codeSummary(datatypeCode, encodeCode, datatypeLabel, encodeLabel) {
    const dtCode = this.normalizeCode(datatypeCode)
    const encCode = this.normalizeCode(encodeCode)
    const dtText = this.stripLeadingCode(datatypeLabel) || "Unknown"
    const encText = this.stripLeadingCode(encodeLabel) || "Unknown"
    return `Datatype - ${dtCode}:${dtText} & Encode - ${encCode}:${encText}`
  }

  stripLeadingCode(label) {
    return String(label || "").trim().replace(/^\d+\s*:\s*/, "")
  }

  statusValueForKind(kind, formatLabel, datatypeCode, encodeCode, datatypeLabel, encodeLabel) {
    if (kind === "Unique") {
      return this.codeSummary(datatypeCode, encodeCode, datatypeLabel, encodeLabel)
    }
    return (formatLabel || "").trim() || "(blank)"
  }

  updateUniqueHighlight() {
    const label = this.typeSelectTarget.value
    if (label === "Unique") {
      this.typeSelectTarget.classList.add("data-type-unique")
    } else {
      this.typeSelectTarget.classList.remove("data-type-unique")
    }
  }

  // Row write + status event dispatch.
  writeToRow(datatype, encode, label) {
    if (!this.currentTrigger) return
    const td = this.currentTrigger.closest("td")
    if (!td) return
    const hiddenValue = td.querySelector("input.cell[name*='Data Type']")
    const hiddenRawDt = td.querySelector("input[name*='_raw_datatype']")
    const hiddenRawEnc = td.querySelector("input[name*='_raw_encode']")
    const beforeLabel = this.currentTrigger.dataset.value || hiddenValue?.value || ""
    const beforeDatatype = this.normalizeCode(this.currentTrigger.dataset.rawDatatype || hiddenRawDt?.value || "0")
    const beforeEncode = this.normalizeCode(this.currentTrigger.dataset.rawEncode || hiddenRawEnc?.value || "255")
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
    const dtLabel = opt ? opt.datatype_label : this.codeLabelFromSelect(this.datatypeSelectTarget, datatype)
    const encLabel = opt ? opt.encode_label : this.codeLabelFromSelect(this.encodeSelectTarget, encode)
    this.currentTrigger.title = this.buildTooltip(dtLabel, encLabel, datatype, encode)
    const beforeKind = beforeLabel === "Unique" ? "Unique" : "Formatted"
    const beforeKey = `${beforeDatatype}_${beforeEncode}`
    const beforeMappedLabel = this.reverseMap[beforeKey] || "Unique"
    const beforeOpt = this.typeOptions.find((o) => o.label === beforeMappedLabel)
    const beforeDtLabel = beforeOpt ? beforeOpt.datatype_label : this.codeLabelFromSelect(this.datatypeSelectTarget, beforeDatatype)
    const beforeEncLabel = beforeOpt ? beforeOpt.encode_label : this.codeLabelFromSelect(this.encodeSelectTarget, beforeEncode)
    const beforeStatusValue = this.statusValueForKind(beforeKind, beforeLabel, beforeDatatype, beforeEncode, beforeDtLabel, beforeEncLabel)
    const afterKind = label === "Unique" ? "Unique" : "Formatted"
    const afterStatusValue = this.statusValueForKind(afterKind, label, datatype, encode, dtLabel, encLabel)
    const statusKind = beforeKind !== afterKind ? "data-type-unique-transition" : "data-type-change"
    const transition = `${beforeKind.toLowerCase()}-to-${afterKind.toLowerCase()}`
    const form = this.element.closest("form")
    const row = this.currentTrigger.closest("tr.tag-data-row")
    const rowIndexMatch = hiddenValue && hiddenValue.name ? hiddenValue.name.match(/records\[(\d+)\]/) : null
    const rowIndex = rowIndexMatch ? rowIndexMatch[1] : null
    const delta = rowIndex == null ? null : {
      kind: "record_fields",
      rowIndex,
      fields: {
        "Data Type": label,
        _raw_datatype: datatype,
        _raw_encode: encode
      }
    }
    const status = {
      simple: "Data Type updated",
      detailed: `${beforeStatusValue} > ${afterStatusValue} (${beforeKind} > ${afterKind})`,
      meta: { kind: statusKind, transition }
    }
    if (form && form.dataset.controller && form.dataset.controller.includes("tag-table")) {
      form.dispatchEvent(new CustomEvent("tag-table:cell-changed", { bubbles: true, detail: { message: "Data Type updated", status, row, delta } }))
    }
  }
}
