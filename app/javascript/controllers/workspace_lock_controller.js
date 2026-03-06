import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["toggle", "lockIcon", "tableContainer", "sortLink", "editable", "headerEditable", "selectModeBtn"]
  static values = { initialUnlocked: Boolean }

  connect() {
    this.reorderMode = false
    this.selectMode = false
    const fromSortNav = sessionStorage.getItem("nexus_workspace_sort_nav") === "1"
    this.locked = !fromSortNav && !this.initialUnlockedValue
    if (this.initialUnlockedValue && !this.locked) {
      sessionStorage.setItem("nexus_workspace_unlocked", "1")
      sessionStorage.setItem("nexus_workspace_path", window.location.pathname)
    }
    if (fromSortNav) {
      clearTimeout(this._sortNavClearTimeout)
      this._sortNavClearTimeout = setTimeout(() => {
        sessionStorage.removeItem("nexus_workspace_sort_nav")
        this._sortNavClearTimeout = null
      }, 500)
    } else {
      sessionStorage.removeItem("nexus_workspace_sort_nav")
    }
    this.boundPreventSort = this.preventSortWhenLocked.bind(this)
    this._sortLinks = this.hasSortLinkTarget ? [...this.sortLinkTargets] : []
    this._sortLinks.forEach(link => {
      link.addEventListener("click", this.boundPreventSort, true)
    })
    this.updateUi()
  }

  disconnect() {
    clearTimeout(this._sortNavClearTimeout)
    this._sortLinks && this._sortLinks.forEach(link => {
      link.removeEventListener("click", this.boundPreventSort, true)
    })
  }

  toggle() {
    this.locked = !this.locked
    if (this.locked) {
      this.reorderMode = false
      this.selectMode = false
      this.clearRowSelections()
      sessionStorage.removeItem("nexus_workspace_unlocked")
      sessionStorage.removeItem("nexus_workspace_path")
      sessionStorage.removeItem("nexus_workspace_sort_nav")
    } else {
      sessionStorage.setItem("nexus_workspace_unlocked", "1")
      sessionStorage.setItem("nexus_workspace_path", window.location.pathname)
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
    if (this.locked) {
      e.preventDefault()
      e.stopPropagation()
    } else {
      sessionStorage.setItem("nexus_workspace_sort_nav", "1")
    }
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
