import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["toggle", "lockIcon", "tableContainer", "sortLink", "editable", "headerEditable", "selectModeBtn"]

  connect() {
    this.reorderMode = false
    this.selectMode = false
    sessionStorage.removeItem("nexus_workspace_unlocked")
    this.locked = true
    this.updateUi()
  }

  toggle() {
    this.locked = !this.locked
    if (this.locked) {
      this.reorderMode = false
      this.selectMode = false
      this.clearRowSelections()
      sessionStorage.removeItem("nexus_workspace_unlocked")
    } else {
      sessionStorage.setItem("nexus_workspace_unlocked", "1")
    }
    this.updateUi()
  }

  toggleSelectMode() {
    if (this.locked) return
    this.selectMode = !this.selectMode
    this.reorderMode = this.selectMode
    if (!this.selectMode) this.clearRowSelections()
    this.updateUi()
  }

  clearRowSelections() {
    this.element.querySelectorAll("tr.tag-data-row.row-selected").forEach(tr => tr.classList.remove("row-selected"))
  }

  preventSortWhenLocked(e) {
    if (this.locked) e.preventDefault()
  }

  updateUi() {
    if (this.hasLockIconTarget) {
      this.lockIconTarget.textContent = this.locked ? "🔒" : "🔓"
    }

    this.element.classList.toggle("workspace-locked", this.locked)
    this.element.classList.toggle("workspace-reorder-mode", this.reorderMode)
    this.element.classList.toggle("workspace-select-mode", this.selectMode)

    if (this.hasTableContainerTarget) {
      this.tableContainerTarget.classList.toggle("workspace-locked", this.locked)
    }

    this.element.querySelectorAll("tr.tag-data-row").forEach(tr => {
      tr.draggable = this.reorderMode
    })

    if (this.hasSelectModeBtnTarget) {
      this.selectModeBtnTarget.classList.toggle("btn-active", this.selectMode)
      this.selectModeBtnTarget.disabled = this.locked
      this.selectModeBtnTarget.title = "Select Rows"
    }

    if (this.hasEditableTarget) {
      const disableCells = this.locked || this.reorderMode || this.selectMode
      this.editableTargets.forEach(el => {
        el.disabled = disableCells
      })
    }
    if (this.hasHeaderEditableTarget) {
      this.headerEditableTargets.forEach(el => {
        el.disabled = this.locked
      })
    }
  }
}
