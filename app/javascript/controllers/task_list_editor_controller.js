import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["list", "payload"]

  connect() {
    this.#refreshAll()
  }

  addTask(event) {
    event.preventDefault()
    const row = this.#buildMainTaskRow("", false, [], "")
    this.listTarget.appendChild(row)
    this.#startEditRow(row)
    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  handleListClick(event) {
    const row = event.target.closest(".task-item-row")
    if (!row) return

    const actionTarget = event.target.closest(".row-plus, .item-action-btn, .task-toggle, .row-note-toggle")

    if (actionTarget?.matches(".row-note-toggle")) {
      this.toggleNoteRow(event)
      return
    }

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

    this.#startEditRow(row)
  }

  toggleNoteRow(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.target.closest(".task-item-row")
    if (!row) return

    const existing = this.#attachedNoteRow(row)
    if (existing) {
      existing.remove()
      this.#syncRowNoteButtonState(row)
      this.#refreshAll()
      this.#syncPayload()
      this.#triggerAutosave()
      return
    }

    this.#closeOpenNoteRows(row)

    const noteRow = this.#buildNoteRow(row)
    row.insertAdjacentElement("afterend", noteRow)

    this.#syncRowNoteButtonState(row)
    this.#refreshAll()
    this.#syncPayload()
    this.#triggerAutosave()

    const input = noteRow.querySelector(".task-note-input")
    if (!input) return
    this.#resizeNoteInput(input)
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }

  addSubtask(event) {
    event.preventDefault()
    event.stopPropagation()

    const mainRow = event.target.closest(".task-item-row--main")
    if (!mainRow) return

    this.#closeOpenNoteRows()

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
      const mainNote = this.#attachedNoteRow(row)
      if (mainNote) mainNote.remove()

      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
    } else if (row.matches(".task-item-row--subtask")) {
      // If removing last subtask, remove group classes from main
      const mainRow = this.#findMainRowForSubtask(row)
      const noteRow = this.#attachedNoteRow(row)
      if (noteRow) noteRow.remove()
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

    input.addEventListener("blur", () => this.#finishEdit(input, true), { once: true })
  }

  #finishEdit(input, save) {
    const row = input.closest(".task-item-row")
    if (!row) return

    const value = save ? input.value.trim() : (input.dataset.originalValue || "")
    const text = document.createElement("span")
    text.dataset.role = "task-text"
    text.className = row.matches(".task-item-row--subtask") ? "task-item-text task-item-text--subtask" : "task-item-text"
    text.textContent = value

    input.replaceWith(text)

    if (save && value.length === 0) {
      this.#removeRowAndChildrenIfNeeded(row)
    }

    this.#refreshAll()
    this.#triggerAutosave(0)
  }

  #removeRowAndChildrenIfNeeded(row) {
    if (!row) return

    if (row.matches(".task-item-row--main")) {
      const mainNote = this.#attachedNoteRow(row)
      if (mainNote) mainNote.remove()

      let cursor = row.nextElementSibling
      while (cursor && !cursor.matches(".task-item-row--main")) {
        const next = cursor.nextElementSibling
        cursor.remove()
        cursor = next
      }
    } else if (row.matches(".task-item-row--subtask")) {
      const noteRow = this.#attachedNoteRow(row)
      if (noteRow) noteRow.remove()
    }

    row.remove()
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

    // Close all subtask notes when collapsing
    if (isCollapsed === false) {
      const subtasks = this.#subtasksFor(row)
      subtasks.forEach((subtask) => {
        const noteRow = this.#attachedNoteRow(subtask)
        if (noteRow) {
          noteRow.remove()
          this.#syncRowNoteButtonState(subtask)
        }
      })
    }
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
      if (cursor.matches(".task-item-row--main")) {
        break
      }
      cursor = cursor.previousElementSibling
    }
    return null
  }

  #buildMainTaskRow(text, checked, subtasks, note = "") {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--main organizer-row"
    row.dataset.mainChecked = checked ? "true" : "false"
    row.dataset.hasSubtasks = subtasks.length > 0 ? "true" : "false"
    row.dataset.note = note
    const noteButtonClasses = ["row-note-toggle"]
    if (this.#normalizedRowNote(row).length > 0) noteButtonClasses.push("has-saved-note")

    row.innerHTML =
      '<div class="organizer-row-left row-left">' +
        `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle task completion">${checked ? "✓" : "○"}</span>` +
        `<span class="task-item-text" data-role="task-text">${this.#escapeHtml(text)}</span>` +
        `<button type="button" class="${noteButtonClasses.join(" ")}" title="Toggle note" aria-label="Toggle note">≡</button>` +
      "</div>" +
      '<div class="organizer-row-right">' +
        '<span class="task-progress-bar" aria-hidden="true"><span class="task-progress-bar-fill" style="width: 0%;"></span></span>' +
        '<span class="task-progress-label"></span>' +
        '<span class="row-plus" title="Add subtask">+</span>' +
        '<span class="item-action-btn" title="Rename">&#9998;</span>' +
        '<span class="item-action-btn item-action-delete" title="Delete">&times;</span>' +
      "</div>"

    const subtaskRows = subtasks.map((subtask) => this.#buildSubtaskRow(subtask.text, subtask.checked, subtask.note || ""))
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

  #buildSubtaskRow(text, checked, note = "") {
    const row = document.createElement("li")
    row.className = "task-item-row task-item-row--subtask organizer-row task-item-group--child"
    if (checked) row.classList.add("task-item-row--checked")
    row.dataset.note = note
    const noteButtonClasses = ["row-note-toggle", "row-note-toggle--subtask"]
    if (this.#normalizedRowNote(row).length > 0) noteButtonClasses.push("has-saved-note")

    row.innerHTML =
      '<div class="organizer-row-left row-left">' +
        `<span class="task-toggle" role="button" tabindex="0" aria-label="Toggle subtask completion">${checked ? "✓" : "○"}</span>` +
        `<span class="task-item-text task-item-text--subtask" data-role="task-text">${this.#escapeHtml(text)}</span>` +
        `<button type="button" class="${noteButtonClasses.join(" ")}" title="Toggle note" aria-label="Toggle note">≡</button>` +
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
      this.#syncRowNoteButtonState(mainRow)

      const mainNote = this.#attachedNoteRow(mainRow)
      if (mainNote) {
        mainNote.classList.remove("is-collapsed")
        this.#syncNoteRowShape(mainNote)
      }

      const fill = mainRow.querySelector(".task-progress-bar-fill")
      const label = mainRow.querySelector(".task-progress-label")
      if (fill) {
        const percent = subtaskCount > 0
          ? (checkedSubtasks / subtaskCount) * 100
          : (mainRow.classList.contains("task-item-row--checked") ? 100 : 0)
        fill.style.width = `${Math.round(percent)}%`
      }

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
        this.#syncRowNoteButtonState(subtask)

        const noteRow = this.#attachedNoteRow(subtask)
        if (noteRow) {
          noteRow.classList.toggle("is-collapsed", isCollapsed)
          this.#syncNoteRowShape(noteRow)
        }

        const subToggle = subtask.querySelector(".task-toggle")
        if (subToggle) subToggle.textContent = subtask.classList.contains("task-item-row--checked") ? "✓" : "○"
      })

      // Re-sync after subtask collapse classes are applied so joined/tail shape is accurate.
      if (mainNote) this.#syncNoteRowShape(mainNote)
      subtasks.forEach((subtask) => {
        const noteRow = this.#attachedNoteRow(subtask)
        if (noteRow) this.#syncNoteRowShape(noteRow)
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
        checked: subtask.classList.contains("task-item-row--checked"),
        note: this.#normalizedRowNote(subtask)
      })).filter((subtask) => subtask.text.length > 0)

      const checked = subtasks.length > 0
        ? subtasks.every((subtask) => subtask.checked)
        : row.dataset.mainChecked === "true"

      tasks.push({ text, checked, note: this.#normalizedRowNote(row), subtasks })
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

  #normalizedRowNote(row) {
    return (row?.dataset?.note || "").replaceAll("\r\n", "\n").trimEnd()
  }

  #attachedNoteRow(row) {
    const next = row?.nextElementSibling
    if (!next || !next.matches(".task-note-row")) return null
    return next
  }

  #syncRowNoteButtonState(row) {
    const button = row.querySelector(".row-note-toggle")
    if (!button) return
    const hasOpenNote = !!this.#attachedNoteRow(row)
    const hasSavedNote = this.#normalizedRowNote(row).length > 0
    button.classList.toggle("is-active", hasOpenNote)
    button.classList.toggle("has-saved-note", hasSavedNote)
    row.classList.toggle("has-open-note", hasOpenNote)
    row.classList.toggle("has-note", hasSavedNote)
  }

  #closeOpenNoteRows(exceptionOwnerRow = null) {
    const noteRows = Array.from(this.listTarget.querySelectorAll(".task-note-row"))
    noteRows.forEach((noteRow) => {
      const owner = this.#ownerRowForNoteRow(noteRow)
      if (owner === exceptionOwnerRow) return
      noteRow.remove()
      if (owner) this.#syncRowNoteButtonState(owner)
    })
  }

  #ownerRowForNoteRow(noteRow) {
    const previous = noteRow?.previousElementSibling
    if (!previous || !previous.matches(".task-item-row")) return null
    return previous
  }

  #syncNoteRowShape(noteRow) {
    if (!noteRow) return

    const next = noteRow.nextElementSibling
    const joinsSubtask = !!next && next.matches(".task-item-row--subtask") && !next.classList.contains("is-collapsed")

    noteRow.classList.toggle("task-note-row--joined", joinsSubtask)
    noteRow.classList.toggle("task-note-row--tail", !joinsSubtask)
  }

  #buildNoteRow(ownerRow) {
    const row = document.createElement("li")
    row.className = `task-note-row ${ownerRow.matches(".task-item-row--subtask") ? "task-note-row--subtask" : "task-note-row--main"}`

    const wrapper = document.createElement("div")
    wrapper.className = "task-note-wrap"

    const input = document.createElement("textarea")
    input.className = "task-note-input"
    input.placeholder = ownerRow.matches(".task-item-row--subtask") ? "Add subtask note..." : "Add task note..."
    input.value = ownerRow.dataset.note || ""
    input.setAttribute("rows", "1")

    input.addEventListener("input", () => {
      ownerRow.dataset.note = input.value
      this.#syncRowNoteButtonState(ownerRow)
      this.#resizeNoteInput(input)
      this.#syncPayload()
      this.#triggerAutosave(120)
    })

    input.addEventListener("blur", () => {
      ownerRow.dataset.note = input.value
      this.#syncRowNoteButtonState(ownerRow)
      this.#syncPayload()
      this.#triggerAutosave(0)
    })

    wrapper.appendChild(input)
    row.appendChild(wrapper)
    return row
  }

  #resizeNoteInput(input) {
    input.style.height = "auto"
    input.style.height = `${Math.max(input.scrollHeight, 34)}px`
  }

  #escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  }
}
