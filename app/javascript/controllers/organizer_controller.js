import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"

export default class extends Controller {
  static targets = [
    "newFolderForm", "newFolderInput",
    "itemModalBackdrop", "itemTypeButton", "itemTypeInput", "itemNameInput", "itemCreateSubmit"
  ]

  connect() {
    this.pendingFolderId = null
    this.draftRow = null
  }

  toggleFolder(event) {
    event.preventDefault()
    const button = event.currentTarget
    const folderId = button.dataset.folderId
    const panel = this.element.querySelector(`[data-folder-panel-id="${folderId}"]`)
    if (!panel) return

    const willOpen = panel.classList.contains("hidden")

    this.element.querySelectorAll(".folder-item-panel").forEach((itemPanel) => {
      itemPanel.classList.add("hidden")
    })
    this.element.querySelectorAll(".finder-item[data-folder-id]").forEach((folderButton) => {
      folderButton.classList.remove("is-folder-selected")
    })

    if (willOpen) {
      panel.classList.remove("hidden")
      button.classList.add("is-folder-selected")
    }
  }

  async addItem(event) {
    event.preventDefault()
    event.stopPropagation()

    const btn = event.currentTarget.closest(".finder-item")
    const folderId = btn?.dataset?.folderId
    if (!folderId) return

    const panel = this.#openFolderPanel(folderId)
    if (!panel) return

    this.#removeDraftRow()

    const emptyState = panel.querySelector(".finder-empty-child")
    if (emptyState) emptyState.remove()

    const draft = document.createElement("div")
    draft.className = "finder-item finder-item-child finder-item-draft"
    draft.dataset.folderId = folderId
    draft.innerHTML = `
      <input
        type="text"
        class="finder-rename-input finder-draft-name"
        placeholder="New item name..."
        aria-label="New item name"
      >
      <select class="finder-item-type-select" aria-label="Select item type">
        <option value="">Select type...</option>
        <option value="note">Note</option>
        <option value="task_list">Task List</option>
      </select>
    `

    panel.appendChild(draft)
    this.draftRow = draft

    const input = draft.querySelector(".finder-draft-name")
    const select = draft.querySelector(".finder-item-type-select")
    if (!input || !select) return

    input.focus()
    input.select()

    const cancelDraft = () => {
      if (this.#realItemCount(panel) === 0) {
        const empty = document.createElement("p")
        empty.className = "finder-empty finder-empty-child"
        empty.textContent = "No items yet"
        panel.appendChild(empty)
      }
      this.#removeDraftRow()
    }

    const submitDraft = async () => {
      if (draft.dataset.creating === "true") return

      const itemType = select.value
      if (itemType !== "note" && itemType !== "task_list") return

      draft.dataset.creating = "true"
      input.disabled = true
      select.disabled = true

      const defaultName = itemType === "task_list" ? "Untitled Task List" : "Untitled Note"
      const name = input.value.trim() || defaultName
      const path = itemType === "task_list" ? "/apps/task_lists" : "/apps/notes"

      const created = await this.#createItem(path, folderId, name, { autoOpen: false })
      if (created) {
        this.#removeDraftRow()
      } else {
        draft.dataset.creating = "false"
        input.disabled = false
        select.disabled = false
        input.focus()
      }
    }

    select.addEventListener("change", submitDraft)
    input.addEventListener("keydown", (keyEvent) => {
      if (keyEvent.key === "Enter") {
        keyEvent.preventDefault()
        submitDraft()
      }
      if (keyEvent.key === "Escape") {
        keyEvent.preventDefault()
        cancelDraft()
      }
    })

    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!this.draftRow || this.draftRow !== draft) return
        if (draft.dataset.creating === "true") return
        if (select.value) return
        if (!input.value.trim()) cancelDraft()
      }, 80)
    })
  }

  chooseItemType(event) {
    event.preventDefault()
    const selectedType = event.currentTarget.dataset.itemType
    this.itemTypeInputTarget.value = selectedType
    this.itemTypeButtonTargets.forEach((button) => {
      button.classList.toggle("is-selected", button.dataset.itemType === selectedType)
    })

    const defaultName = selectedType === "task_list" ? "Untitled Task List" : "Untitled Note"
    if (!this.itemNameInputTarget.value.trim()) this.itemNameInputTarget.value = defaultName

    this.itemNameInputTarget.disabled = false
    this.itemCreateSubmitTarget.disabled = false
    this.itemNameInputTarget.focus()
    this.itemNameInputTarget.select()
  }

  itemNameKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.#closeItemModal()
    }
  }

  cancelItemCreate(event) {
    event.preventDefault()
    this.#closeItemModal()
  }

  clickItemModalBackdrop(event) {
    if (event.target !== event.currentTarget) return
    this.#closeItemModal()
  }

  async submitNewItem(event) {
    event.preventDefault()
    if (!this.pendingFolderId) return

    const itemType = this.itemTypeInputTarget.value
    if (itemType !== "note" && itemType !== "task_list") {
      alert("Choose Note or Task List first.")
      return
    }

    const defaultName = itemType === "task_list" ? "Untitled Task List" : "Untitled Note"
    const name = this.itemNameInputTarget.value.trim() || defaultName
    const path = itemType === "task_list" ? "/apps/task_lists" : "/apps/notes"

    const created = await this.#createItem(path, this.pendingFolderId, name)
    if (created) this.#closeItemModal()
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

  renameItem(event) {
    event.preventDefault()
    event.stopPropagation()

    const btn = event.currentTarget.closest(".finder-item")
    const label = btn.querySelector(".finder-item-label")
    const itemId = btn.dataset.itemId
    const itemType = btn.dataset.itemType
    const original = label.textContent.trim()
    const path = itemType === "task_list" ? `/apps/task_lists/${itemId}` : `/apps/notes/${itemId}`
    const panel = btn.closest(".folder-item-panel")
    const folderId = panel?.dataset.folderPanelId

    btn.disabled = true
    this.#inlineInput(original, label, {
      onSave: async (newName) => {
        btn.disabled = false
        if (newName !== original) {
          const json = await this.#patch(path, { item: { name: newName } })
          const savedName = (json?.name || newName).toString().trim() || newName
          label.textContent = savedName
          if (folderId) this.#sortFolderItems(folderId)
        }
      },
      onCancel: () => { btn.disabled = false }
    })
  }

  async deleteItem(event) {
    event.preventDefault()
    event.stopPropagation()

    const btn = event.currentTarget.closest(".finder-item")
    const itemId = btn.dataset.itemId
    const itemType = btn.dataset.itemType
    const name = btn.querySelector(".finder-item-label").textContent.trim()
    const path = itemType === "task_list" ? `/apps/task_lists/${itemId}` : `/apps/notes/${itemId}`
    const panel = btn.closest(".folder-item-panel")
    const folderId = panel?.dataset.folderPanelId

    if (!confirm(`Delete "${name}"?`)) return

    const ok = await this.#delete(path)
    if (!ok) {
      alert("Could not delete item.")
      return
    }

    btn.remove()
    if (folderId) this.#adjustFolderCount(folderId, -1)

    if (panel && panel.querySelectorAll(".finder-item-child").length === 0) {
      const empty = document.createElement("p")
      empty.className = "finder-empty finder-empty-child"
      empty.textContent = "No items yet"
      panel.appendChild(empty)
    }
  }

  async #createItem(path, folderId, name, { autoOpen = true } = {}) {
    const data = new FormData()
    data.append("item[folder_id]", folderId)
    data.append("item[name]", name)

    const resp = await fetch(path, {
      method: "POST",
      headers: { "Accept": "application/json", "X-CSRF-Token": this.#csrf() },
      body: data
    })

    if (!resp.ok) {
      const json = await resp.json().catch(() => ({}))
      alert(json.errors?.join(", ") || "Could not create item.")
      return false
    }

    const { id, url } = await resp.json()
    const itemType = path.includes("task_lists") ? "task_list" : "note"
    const itemBtn = this.#insertNewItemUnderFolder({ folderId, itemId: id, itemType, name })

    if (itemBtn && autoOpen) {
      itemBtn.click()
    } else if (!itemBtn) {
      // Fallback if the item cannot be inserted for any reason.
      Turbo.visit(url, { frame: "app-pane" })
    }

    return true
  }

  #closeItemModal() {
    this.itemModalBackdropTarget.classList.remove("is-open")
    window.setTimeout(() => this.itemModalBackdropTarget.classList.add("hidden"), 180)
    this.pendingFolderId = null
    this.itemTypeInputTarget.value = ""
    this.itemNameInputTarget.value = ""
    this.itemNameInputTarget.disabled = true
    this.itemNameInputTarget.placeholder = "Choose a type first"
    this.itemCreateSubmitTarget.disabled = true
    this.itemTypeButtonTargets.forEach((button) => button.classList.remove("is-selected"))
  }

  #insertNewItemUnderFolder({ folderId, itemId, itemType, name }) {
    const panel = this.element.querySelector(`[data-folder-panel-id="${folderId}"]`)
    const folderButton = this.element.querySelector(`.finder-item[data-folder-id="${folderId}"]`)
    if (!panel || !folderButton) return null

    panel.classList.remove("hidden")
    folderButton.classList.add("is-folder-selected")

    const emptyState = panel.querySelector(".finder-empty-child")
    if (emptyState) emptyState.remove()

    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "finder-item finder-item-child"
    btn.dataset.finderTarget = "item"
    btn.dataset.itemId = String(itemId)
    btn.dataset.itemType = itemType
    btn.dataset.appId = `${itemType === "task_list" ? "task_lists" : "notes"}/${itemId}`
    btn.dataset.action = "click->finder#toggle"

    btn.innerHTML = `
      <span class="finder-item-label"></span>
      <span class="finder-item-meta finder-item-kind">${itemType === "task_list" ? "Task List" : "Note"}</span>
      <span class="finder-item-actions">
        <span class="item-action-btn" data-action="click->organizer#renameItem" title="Rename">&#9998;</span>
        <span class="item-action-btn item-action-delete" data-action="click->organizer#deleteItem" title="Delete">&times;</span>
      </span>
    `
    btn.querySelector(".finder-item-label").textContent = name

    const draft = panel.querySelector(".finder-item-draft")
    if (draft) {
      panel.insertBefore(btn, draft)
    } else {
      panel.appendChild(btn)
    }
    this.#sortFolderItems(folderId)
    this.#adjustFolderCount(folderId, 1)
    return btn
  }

  #sortFolderItems(folderId) {
    const panel = this.element.querySelector(`[data-folder-panel-id="${folderId}"]`)
    if (!panel) return

    const items = Array.from(panel.querySelectorAll(".finder-item-child:not(.finder-item-draft)"))
    if (items.length < 2) return

    items
      .sort((a, b) => {
        const aLabel = a.querySelector(".finder-item-label")?.textContent?.trim().toLowerCase() || ""
        const bLabel = b.querySelector(".finder-item-label")?.textContent?.trim().toLowerCase() || ""
        return aLabel.localeCompare(bLabel)
      })
      .forEach((item) => panel.appendChild(item))
  }

  #adjustFolderCount(folderId, delta) {
    const folderButton = this.element.querySelector(`.finder-item[data-folder-id="${folderId}"]`)
    if (!folderButton) return

    const countNode = folderButton.querySelector(".finder-item-meta")
    if (!countNode) return

    const current = Number.parseInt(countNode.textContent, 10)
    const safeCurrent = Number.isNaN(current) ? 0 : current
    const next = Math.max(0, safeCurrent + delta)
    countNode.textContent = String(next)
  }

  #openFolderPanel(folderId) {
    const panel = this.element.querySelector(`[data-folder-panel-id="${folderId}"]`)
    const folderButton = this.element.querySelector(`.finder-item[data-folder-id="${folderId}"]`)
    if (!panel || !folderButton) return null

    this.element.querySelectorAll(".folder-item-panel").forEach((itemPanel) => {
      itemPanel.classList.add("hidden")
    })
    this.element.querySelectorAll(".finder-item[data-folder-id]").forEach((row) => {
      row.classList.remove("is-folder-selected")
    })

    panel.classList.remove("hidden")
    folderButton.classList.add("is-folder-selected")
    return panel
  }

  #removeDraftRow() {
    if (!this.draftRow) return
    this.draftRow.remove()
    this.draftRow = null
  }

  #realItemCount(panel) {
    if (!panel) return 0
    return panel.querySelectorAll(".finder-item-child:not(.finder-item-draft)").length
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
