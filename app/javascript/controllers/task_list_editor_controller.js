import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["list", "payload"]

  connect() {
    this.boundWindowState = this.handleWindowState.bind(this)
    window.addEventListener("app-window:state", this.boundWindowState)
    this.#refreshAll()
  }

  disconnect() {
    if (this.autosaveTimer) {
      window.clearTimeout(this.autosaveTimer)
      this.autosaveTimer = null
    }
    window.removeEventListener("app-window:state", this.boundWindowState)
  }

  handleWindowState(event) {
    if (event.detail?.appKey !== "singular-task-list") return
    if (event.detail?.open !== false) return
    this.#commitActiveEditIfAny()
  }

  addTask(event) {
    event.preventDefault()
    if (!this.#commitActiveEditIfAny()) return

    const existingUnnamedMain = this.#findUnnamedMainRow()
    if (existingUnnamedMain) {
      this.#startEditRow(existingUnnamedMain)
      this.#refreshAll()
      return
    }

    const row = this.#buildMainTaskRow("", false, [])
    this.listTarget.appendChild(row)
    this.#startEditRow(row)
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  handleListClick(event) {
    const row = event.target.closest(".task-item-row")
    if (!row) return

    const actionTarget = event.target.closest(".row-plus, .item-action-btn, .task-toggle")

    if (actionTarget?.matches(".row-plus")) {
      this.addSubtask(event)
      return
    }

    if (actionTarget?.matches(".item-action-delete")) {
      this.removeTask(event)
      return
    }

    if (actionTarget?.matches(".item-action-btn") && !actionTarget.classList.contains("item-action-delete")) {
      this.startEdit(event)
      return
    }

    this.#commitActiveEditIfAny(row)

    if (row.querySelector(".task-edit-input")) return

    event.preventDefault()
    
    // For main tasks with subtasks, toggle collapsed state instead of completion
    if (row.matches(".task-item-row--main")) {
      const subtasks = this.#subtasksFor(row)
      if (subtasks.length > 0) {
        this.#toggleCollapsed(row)
        this.#refreshAll()
        return
      }
    }

    this.#toggleRowComplete(row)
    this.#refreshAll()
    this.#triggerAutosave()
  }

  handleListKeydown(event) {
    const input = event.target.closest(".task-edit-input")
    if (!input) return

    if (event.key === "Enter") {
      event.preventDefault()
      this.#finishEdit(input, true)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      this.#finishEdit(input, false)
    }
  }

  startEdit(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.target.closest(".task-item-row")
    if (!row) return

    const activeInput = row.querySelector(".task-edit-input")
    if (activeInput) {
      this.#finishEdit(activeInput, true)
      return
    }

    this.#startEditRow(row)
  }

  addSubtask(event) {
    event.preventDefault()
    event.stopPropagation()

    if (!this.#commitActiveEditIfAny()) return

    const mainRow = event.target.closest(".task-item-row--main")
    if (!mainRow) return

    const existingUnnamedSubtask = this.#findUnnamedSubtaskRow(mainRow)
    if (existingUnnamedSubtask) {
      this.#startEditRow(existingUnnamedSubtask)
      this.#refreshAll()
      return
    }

    const subtaskRow = this.#buildSubtaskRow("", false)
    const insertionPoint = this.#lastSubtaskFor(mainRow)

    if (insertionPoint) {
      insertionPoint.insertAdjacentElement("afterend", subtaskRow)
    } else {
      mainRow.insertAdjacentElement("afterend", subtaskRow)
    }

    // Always expand parent when adding a subtask so the new row is visible.
    mainRow.dataset.collapsed = "false"


    this.#startEditRow(subtaskRow)
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  removeTask(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.target.closest(".task-item-row")
    if (!row) return

    const taskName = row.querySelector("[data-role='task-text']")?.textContent?.trim() || "task"
    if (!confirm(`Delete "${taskName}"?`)) return

    if (row.matches(".task-item-row--main")) {
      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
    } else if (row.matches(".task-item-row--subtask")) {
      // If removing last subtask, remove group classes from main
      const mainRow = this.#findMainRowForSubtask(row)
      row.remove()
      if (mainRow && this.#subtasksFor(mainRow).length === 0) {
        mainRow.classList.remove("task-item-group--head")
        mainRow.dataset.collapsed = "false"
      }
      this.#refreshAll()
      this.#triggerAutosave()
      return
    }

    row.remove()
    this.#refreshAll()
    this.#triggerAutosave()
  }

  #startEditRow(row) {
    const rowInput = row.querySelector(".task-edit-input")
    if (rowInput) {
      rowInput.focus()
      rowInput.select()
      return
    }

    this.#commitActiveEditIfAny(row)

    this.#clearEditingState()
    row.classList.add("is-editing")

    const textNode = row.querySelector("[data-role='task-text']")
    if (!textNode) return

    const currentValue = textNode.textContent.trim()
    const input = document.createElement("input")
    input.type = "text"
    input.className = "task-edit-input"
    input.value = currentValue
    input.dataset.originalValue = currentValue
    input.placeholder = row.matches(".task-item-row--subtask") ? "Subtask..." : "Task..."

    textNode.replaceWith(input)
    input.focus()
    input.select()

    this.#bindEditBlur(input)
  }

  #finishEdit(input, save) {
    const row = input.closest(".task-item-row")
    if (!row) return

    const originalValue = (input.dataset.originalValue || "").trim()
    let value = save ? input.value.trim() : originalValue

    // Finalization rule:
    // 1) Blank with original -> revert to original
    // 2) Blank without original (new row) -> delete row
    // 3) Non-blank -> save new value
    if (save && value.length === 0) {
      value = originalValue
    }

    if (value.length === 0) {
      this.#removeEditingRow(input)
      return
    }

    const text = document.createElement("span")
    text.dataset.role = "task-text"
    text.className = row.matches(".task-item-row--subtask") ? "task-item-text task-item-text--subtask" : "task-item-text"
    text.textContent = value

    input.replaceWith(text)

    row.classList.remove("is-editing")
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  #bindEditBlur(input) {
    input.addEventListener("blur", () => this.#finishEdit(input, true), { once: true })
  }

  #clearEditingState() {
    this.listTarget.querySelectorAll(".task-item-row.is-editing").forEach((row) => {
      row.classList.remove("is-editing")
    })
  }

  #activeEditInput(excludeRow = null) {
    const inputs = Array.from(this.listTarget.querySelectorAll(".task-edit-input"))
    if (!excludeRow) return inputs[0] || null
    return inputs.find((input) => !excludeRow.contains(input)) || null
  }

  #commitActiveEditIfAny(excludeRow = null) {
    const activeInput = this.#activeEditInput(excludeRow)
    if (!activeInput) return true
    this.#finishEdit(activeInput, true)
    return !activeInput.isConnected
  }

  #rowValue(row) {
    const input = row.querySelector(".task-edit-input")
    if (input) return input.value.trim()
    return row.querySelector("[data-role='task-text']")?.textContent.trim() || ""
  }

  #findUnnamedMainRow() {
    const mainRows = Array.from(this.listTarget.querySelectorAll(".task-item-row--main"))
    return mainRows.find((row) => this.#rowValue(row).length === 0) || null
  }

  #findUnnamedSubtaskRow(mainRow) {
    const subtasks = this.#subtasksFor(mainRow)
    return subtasks.find((row) => this.#rowValue(row).length === 0) || null
  }

  #removeEditingRow(input) {
    const row = input.closest(".task-item-row")
    if (!row) return

    if (row.matches(".task-item-row--main")) {
      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
      row.remove()
      this.#refreshAll()
      this.#triggerAutosave(0)
      return
    }

    if (row.matches(".task-item-row--subtask")) {
      const mainRow = this.#findMainRowForSubtask(row)
      row.remove()
      if (mainRow && this.#subtasksFor(mainRow).length === 0) {
        mainRow.classList.remove("task-item-group--head")
        mainRow.dataset.collapsed = "false"
      }
      this.#refreshAll()
      this.#triggerAutosave(0)
    }
  }

  #toggleRowComplete(row) {
    if (row.matches(".task-item-row--subtask")) {
      row.classList.toggle("task-item-row--checked")
      return
    }

    const subtasks = this.#subtasksFor(row)
    if (subtasks.length > 0) {
      const allSubtasksFilledAndChecked = subtasks.every((subtask) => {
        const text = subtask.querySelector("[data-role='task-text']")?.textContent.trim() || ""
        return text.length > 0 && subtask.classList.contains("task-item-row--checked")
      })

      if (!allSubtasksFilledAndChecked) return
      row.classList.add("task-item-row--checked")
      row.dataset.mainChecked = "true"
      return
    }

    row.dataset.mainChecked = row.dataset.mainChecked === "true" ? "false" : "true"
  }

  #toggleCollapsed(row) {
    if (!row.matches(".task-item-row--main")) return

    const isCollapsed = row.dataset.collapsed === "true"
    row.dataset.collapsed = isCollapsed ? "false" : "true"
  }

  #subtasksFor(mainRow) {
    const subtasks = []
    let cursor = mainRow.nextElementSibling

    while (cursor && !cursor.matches(".task-item-row--main")) {
      if (cursor.matches(".task-item-row--subtask")) {
        subtasks.push(cursor)
      }
      cursor = cursor.nextElementSibling
    }

    return subtasks
  }

  #lastSubtaskFor(mainRow) {
    const subtasks = this.#subtasksFor(mainRow)
    return subtasks[subtasks.length - 1]
  }

  #findMainRowForSubtask(subtaskRow) {
    let cursor = subtaskRow.previousElementSibling
    while (cursor) {
      if (cursor.matches(".task-item-row--main")) {
        return cursor
      }
      cursor = cursor.previousElementSibling
    }
    return null
  }

  #buildMainTaskRow(text, checked, subtasks) {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--main organizer-row"
    row.dataset.mainChecked = checked ? "true" : "false"
    row.dataset.hasSubtasks = subtasks.length > 0 ? "true" : "false"

    row.innerHTML =
      '<div class="organizer-row-left row-left">' +
        `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle task completion">${checked ? "✓" : "○"}</span>` +
        `<span class="task-item-text" data-role="task-text">${this.#escapeHtml(text)}</span>` +
      "</div>" +
      '<div class="organizer-row-right">' +
        '<span class="task-progress-bar" aria-hidden="true"><span class="task-progress-bar-fill"></span></span>' +
        '<span class="task-progress-label"></span>' +
        '<span class="row-plus" title="Add subtask">+</span>' +
        '<span class="item-action-btn" title="Rename">&#9998;</span>' +
        '<span class="item-action-btn item-action-delete" title="Delete">&times;</span>' +
      "</div>"

    const subtaskRows = subtasks.map((subtask) => this.#buildSubtaskRow(subtask.text, subtask.checked))
    if (subtaskRows.length > 0) row.classList.add("task-item-group--head")
    this.#insertRowsAfter(row, subtaskRows)

    return row
  }

  #insertRowsAfter(row, rows) {
    let cursor = row
    rows.forEach((subtaskRow) => {
      cursor.insertAdjacentElement("afterend", subtaskRow)
      cursor = subtaskRow
    })
  }

  #buildSubtaskRow(text, checked) {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--subtask organizer-row task-item-group--child"
    if (checked) row.classList.add("task-item-row--checked")

    row.innerHTML =
      '<div class="organizer-row-left row-left">' +
        `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle subtask completion">${checked ? "✓" : "○"}</span>` +
        `<span class="task-item-text task-item-text--subtask" data-role="task-text">${this.#escapeHtml(text)}</span>` +
      "</div>" +
      '<div class="organizer-row-right">' +
        '<span class="item-action-btn" title="Rename">&#9998;</span>' +
        '<span class="item-action-btn item-action-delete" title="Delete">&times;</span>' +
      "</div>"

    return row
  }

  #refreshAll() {
    const mainRows = Array.from(this.listTarget.querySelectorAll(".task-item-row--main"))

    mainRows.forEach((mainRow) => {
      const subtasks = this.#subtasksFor(mainRow)
      const subtaskCount = subtasks.length
      const checkedSubtasks = subtasks.filter((row) => row.classList.contains("task-item-row--checked")).length
      if (subtaskCount === 0) mainRow.dataset.collapsed = "false"
      const isCollapsed = mainRow.dataset.collapsed === "true"
      mainRow.dataset.hasSubtasks = subtaskCount > 0 ? "true" : "false"

      if (subtaskCount > 0) {
        const completion = checkedSubtasks / subtaskCount
        mainRow.style.setProperty("--completion", completion.toString())

        const allFilledAndChecked = subtasks.every((subtask) => {
          const text = subtask.querySelector("[data-role='task-text']")?.textContent.trim() || ""
          return text.length > 0 && subtask.classList.contains("task-item-row--checked")
        })

        mainRow.classList.toggle("task-item-row--checked", allFilledAndChecked)
        mainRow.dataset.mainChecked = allFilledAndChecked ? "true" : "false"
      } else {
        const mainChecked = mainRow.dataset.mainChecked === "true"
        mainRow.style.setProperty("--completion", mainChecked ? "1" : "0")
        mainRow.classList.toggle("task-item-row--checked", mainChecked)
      }

      const mainChecked = mainRow.dataset.mainChecked === "true"
      const mainToggle = mainRow.querySelector(".task-toggle")
      if (mainToggle) mainToggle.textContent = mainChecked ? "✓" : "○"

      const fill = mainRow.querySelector(".task-progress-bar-fill")
      const label = mainRow.querySelector(".task-progress-label")
      if (fill) fill.style.removeProperty("width")

      if (label) {
        label.textContent = subtaskCount > 0 ? `${checkedSubtasks}/${subtaskCount}` : ""
      }

      mainRow.classList.toggle("task-item-group--head", subtaskCount > 0 && !isCollapsed)
      mainRow.classList.toggle("task-item-group--tail", subtaskCount === 0 || isCollapsed)
      subtasks.forEach((subtask, index) => {
        subtask.classList.toggle("is-collapsed", isCollapsed)
        subtask.setAttribute("aria-hidden", isCollapsed ? "true" : "false")
        subtask.classList.add("task-item-group--child")
        subtask.classList.toggle("task-item-group--tail", index === subtaskCount - 1)

        const subToggle = subtask.querySelector(".task-toggle")
        if (subToggle) subToggle.textContent = subtask.classList.contains("task-item-row--checked") ? "✓" : "○"
      })
    })

    this.#syncPayload()
  }

  #syncPayload() {
    if (!this.hasPayloadTarget) return

    const tasks = []
    const rows = Array.from(this.listTarget.querySelectorAll(".task-item-row"))

    rows.forEach((row) => {
      if (!row.matches(".task-item-row--main")) return

      const text = row.querySelector("[data-role='task-text']")?.textContent.trim() || ""
      if (!text) return

      const subtasks = this.#subtasksFor(row).map((subtask) => ({
        text: subtask.querySelector("[data-role='task-text']")?.textContent.trim() || "",
        checked: subtask.classList.contains("task-item-row--checked")
      })).filter((subtask) => subtask.text.length > 0)

      const checked = subtasks.length > 0
        ? subtasks.every((subtask) => subtask.checked)
        : row.dataset.mainChecked === "true"

      tasks.push({ text, checked, subtasks })
    })

    this.payloadTarget.value = JSON.stringify(tasks)
  }

  #triggerAutosave(delay = 80) {
    const form = this.element.querySelector("form") || this.listTarget.closest("form")
    if (!form) return

    if (this.autosaveTimer) window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = window.setTimeout(() => {
      form.dispatchEvent(new Event("autosave:trigger", { bubbles: true }))
      this.autosaveTimer = null
    }, delay)
  }

  #escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  }
}
