import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["title", "rows", "row", "tasksPayload", "status", "resetPanel", "resetDay", "lastResetAt", "editModalBackdrop", "editInput"]
  static values = { debounce: { type: Number, default: 300 } }

  connect() {
    this.timer = null
    this.editingContext = null
    this.completionFrameIds = new Map()
    this.expandedMainIndices = new Set()
    this.boundKeydown = this.handleKeydown.bind(this)
    this.boundRowClick = this.toggleRow.bind(this)
    this.tasks = this.readTasksFromDom()
    this.resetDays = this.readResetDays()
    this.syncResetButtons()
    this.setupRowClickListener()
    this.renderTasks()
    window.addEventListener("keydown", this.boundKeydown)
  }

  disconnect() {
    if (this.timer) clearTimeout(this.timer)
    this.completionFrameIds.forEach((frameId) => cancelAnimationFrame(frameId))
    this.completionFrameIds.clear()
    window.removeEventListener("keydown", this.boundKeydown)
    if (this.hasRowsTarget) {
      this.rowsTarget.removeEventListener("click", this.boundRowClick)
    }
  }

  setupRowClickListener() {
    if (this.hasRowsTarget) {
      this.rowsTarget.addEventListener("click", this.boundRowClick)
    }
  }

  scheduleCompletionUpdate(row, ratio) {
    const pending = this.completionFrameIds.get(row)
    if (pending) cancelAnimationFrame(pending)

    const frameId = requestAnimationFrame(() => {
      row.style.setProperty("--completion", ratio)
      this.completionFrameIds.delete(row)
    })

    this.completionFrameIds.set(row, frameId)
  }

  handleKeydown(event) {
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.classList?.contains("workspace-clock--toggle")) {
      event.preventDefault()
      this.toggleResetSettings()
      return
    }

    if (event.key !== "Escape") return
    if (!this.hasEditModalBackdropTarget) return
    if (this.editModalBackdropTarget.classList.contains("hidden")) return
    event.preventDefault()
    this.closeTaskEdit()
  }

  toggleRow(event) {
    const row = event.target.closest("[data-clickable]")
    if (!row) return
    if (event.target.closest(".row-pencil") || event.target.closest(".row-plus")) return

    const mainIndex = Number(row.dataset.mainIndex)
    const subIndex = row.dataset.subIndex != null ? Number(row.dataset.subIndex) : null
    if (!Number.isInteger(mainIndex) || !this.tasks[mainIndex]) return

    if (Number.isInteger(subIndex)) {
      this.toggleSubtask(mainIndex, subIndex)
      return
    }

    const mainTask = this.tasks[mainIndex]
    if (mainTask.subtasks.length > 0) {
      if (this.expandedMainIndices.has(mainIndex)) this.expandedMainIndices.delete(mainIndex)
      else this.expandedMainIndices.add(mainIndex)
      this.renderTasks()
      return
    }

    mainTask.checked = !mainTask.checked
    this.renderTasks()
    this.queueSave()
  }

  toggleSubtask(mainIndex, subIndex) {
    const mainTask = this.tasks[mainIndex]
    const subtask = mainTask?.subtasks?.[subIndex]
    if (!subtask) return

    subtask.checked = !subtask.checked
    this.recalculateMainCompletion(mainTask)
    this.renderTasks()
    this.applyCompletionToMainRow(mainIndex)
    this.queueSave()
  }

  editRow(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.currentTarget.closest("[data-main-index]")
    const mainIndex = Number(row?.dataset?.mainIndex)
    const subIndex = row?.dataset?.subIndex != null ? Number(row.dataset.subIndex) : null
    if (!Number.isInteger(mainIndex) || !this.tasks[mainIndex]) return

    const task = Number.isInteger(subIndex) ? this.tasks[mainIndex].subtasks[subIndex] : this.tasks[mainIndex]
    if (!task) return

    this.editingContext = { mainIndex, subIndex: Number.isInteger(subIndex) ? subIndex : null }
    if (this.hasEditInputTarget) this.editInputTarget.value = task.text || ""
    if (this.hasEditModalBackdropTarget) {
      this.editModalBackdropTarget.classList.remove("hidden")
      this.editModalBackdropTarget.setAttribute("aria-hidden", "false")
    }
    requestAnimationFrame(() => {
      if (!this.hasEditInputTarget) return
      this.editInputTarget.focus()
      this.editInputTarget.select()
    })
  }

  addTask() {
    this.tasks.push({ text: "New Task", checked: false, subtasks: [] })
    this.renderTasks()
    this.queueSave()
  }

  addSubtask(event) {
    event.preventDefault()
    event.stopPropagation()

    const row = event.currentTarget.closest("[data-main-index]")
    const mainIndex = Number(row?.dataset?.mainIndex)
    if (!Number.isInteger(mainIndex) || !this.tasks[mainIndex]) return

    const mainTask = this.tasks[mainIndex]
    mainTask.subtasks.push({ text: "New Subtask", checked: false })
    this.expandedMainIndices.add(mainIndex)
    this.recalculateMainCompletion(mainTask)
    this.renderTasks()
    this.queueSave()
  }

  remapExpandedIndicesAfterMainDelete(deletedMainIndex) {
    const nextExpanded = new Set()
    this.expandedMainIndices.forEach((mainIndex) => {
      if (mainIndex < deletedMainIndex) nextExpanded.add(mainIndex)
      if (mainIndex > deletedMainIndex) nextExpanded.add(mainIndex - 1)
    })
    this.expandedMainIndices = nextExpanded
  }

  clickEditModalBackdrop(event) {
    if (!this.hasEditModalBackdropTarget) return
    if (event.target !== this.editModalBackdropTarget) return
    this.closeTaskEdit()
  }

  closeTaskEdit() {
    this.editingContext = null
    if (!this.hasEditModalBackdropTarget) return
    this.editModalBackdropTarget.classList.add("hidden")
    this.editModalBackdropTarget.setAttribute("aria-hidden", "true")
  }

  saveTaskEdit(event) {
    event.preventDefault()
    const context = this.editingContext
    if (!context || !this.tasks[context.mainIndex]) {
      this.closeTaskEdit()
      return
    }

    const task = Number.isInteger(context.subIndex)
      ? this.tasks[context.mainIndex].subtasks[context.subIndex]
      : this.tasks[context.mainIndex]
    if (!task) {
      this.closeTaskEdit()
      return
    }

    const nextText = this.hasEditInputTarget ? this.editInputTarget.value.trim() : ""
    task.text = nextText
    this.renderTasks()
    this.queueSave()
    this.closeTaskEdit()
  }

  deleteTask(event) {
    event.preventDefault()
    const context = this.editingContext
    if (!context || !this.tasks[context.mainIndex]) {
      this.closeTaskEdit()
      return
    }

    if (Number.isInteger(context.subIndex)) {
      this.tasks[context.mainIndex].subtasks.splice(context.subIndex, 1)
      this.recalculateMainCompletion(this.tasks[context.mainIndex])
      if (this.tasks[context.mainIndex].subtasks.length === 0) {
        this.expandedMainIndices.delete(context.mainIndex)
      }
    } else {
      this.tasks.splice(context.mainIndex, 1)
      this.remapExpandedIndicesAfterMainDelete(context.mainIndex)
    }
    this.renderTasks()
    this.queueSave()
    this.closeTaskEdit()
  }

  toggleResetSettings() {
    this.resetPanelTarget.classList.toggle("hidden")
  }

  toggleResetDay(event) {
    event.preventDefault()
    const button = event.currentTarget
    const day = Number(button.dataset.dayIndex)
    if (!Number.isInteger(day)) return

    if (this.resetDays.has(day)) this.resetDays.delete(day)
    else this.resetDays.add(day)

    this.syncResetButtons()
    this.syncResetHiddenInputs()
    this.queueSave()
  }

  queueSave() {
    this.setStatus("Saving...")
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.saveNow(), this.debounceValue)
  }

  readTasksFromDom() {
    const raw = this.tasksPayloadTarget.value || "[]"
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter((task) => task && typeof task === "object")
        .map((task) => {
          const subtasks = Array.isArray(task.subtasks)
            ? task.subtasks
              .filter((subtask) => subtask && typeof subtask === "object")
              .map((subtask) => ({
                text: String(subtask.text || ""),
                checked: !!subtask.checked
              }))
            : []

          const normalized = {
            text: String(task.text || ""),
            checked: !!task.checked,
            subtasks
          }
          this.recalculateMainCompletion(normalized)
          return normalized
        })
    } catch (_error) {
      return []
    }
  }

  recalculateMainCompletion(mainTask) {
    if (!mainTask) return
    if (!Array.isArray(mainTask.subtasks)) mainTask.subtasks = []
    if (mainTask.subtasks.length === 0) return

    mainTask.checked = mainTask.subtasks.every((subtask) => !!subtask.checked)
  }

  computeCompletionRatio(task) {
    const subs = task.subtasks || []
    if (subs.length === 0) return null

    const done = subs.filter((subtask) => subtask.checked).length
    return done / subs.length
  }

  applyCompletionToMainRow(mainIndex) {
    const mainTask = this.tasks[mainIndex]
    const mainRow = this.rowsTarget.querySelector(`.task-item-row--main[data-main-index="${mainIndex}"]`)
    if (!mainTask || !mainRow) return

    const ratio = this.computeCompletionRatio(mainTask)
    if (ratio !== null) {
      this.scheduleCompletionUpdate(mainRow, ratio)
    } else {
      const pending = this.completionFrameIds.get(mainRow)
      if (pending) {
        cancelAnimationFrame(pending)
        this.completionFrameIds.delete(mainRow)
      }
      mainRow.style.removeProperty("--completion")
    }
  }

  readResetDays() {
    return new Set(this.resetDayTargets.map((input) => Number(input.value)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))
  }

  syncResetButtons() {
    this.element.querySelectorAll(".reset-day-button").forEach((button) => {
      const day = Number(button.dataset.dayIndex)
      const active = this.resetDays.has(day)
      button.classList.toggle("btn-primary", active)
      button.classList.toggle("btn-secondary", !active)
    })
  }

  syncResetHiddenInputs() {
    this.resetDayTargets.forEach((input) => input.remove())
    Array.from(this.resetDays).sort((a, b) => a - b).forEach((day) => {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = "document[reset_days][]"
      input.value = String(day)
      input.dataset.taskListTarget = "resetDay"
      this.element.appendChild(input)
    })
  }

  renderTasks() {
    const previousCompletionByMainIndex = new Map()
    this.rowsTarget.querySelectorAll(".task-item-row--main").forEach((row) => {
      const mainIndex = Number(row.dataset.mainIndex)
      if (!Number.isInteger(mainIndex)) return

      const rawCompletion = row.style.getPropertyValue("--completion").trim()
      if (rawCompletion === "") return

      const completion = Number(rawCompletion)
      if (!Number.isNaN(completion)) previousCompletionByMainIndex.set(mainIndex, completion)
    })

    this.previousCompletionByMainIndex = previousCompletionByMainIndex
    this.tasksPayloadTarget.value = JSON.stringify(this.tasks)
    const shell = this.rowsTarget.closest(".task-list-shell")
    if (shell) {
      shell.style.setProperty("--task-count", String(this.tasks.length))
      shell.classList.toggle("task-list-shell--empty", this.tasks.length === 0)
    }
    this.rowsTarget.innerHTML = ""

    this.tasks.forEach((task, mainIndex) => {
      this.recalculateMainCompletion(task)
      const isExpanded = this.expandedMainIndices.has(mainIndex)
      this.rowsTarget.appendChild(this.buildMainRow(task, mainIndex, isExpanded))

      if (isExpanded) {
        task.subtasks.forEach((subtask, subIndex) => {
          this.rowsTarget.appendChild(this.buildSubtaskRow(subtask, mainIndex, subIndex))
        })
      }
    })
  }

  buildMainRow(task, mainIndex, isExpanded = false) {
    const hasSubtasks = task.subtasks.length > 0
    const shouldHaveTail = !hasSubtasks || !isExpanded
    const row = document.createElement("div")
    row.className = `organizer-row task-item-row task-item-row--main ${hasSubtasks && isExpanded ? "task-item-group--head" : ""} ${shouldHaveTail ? "task-item-group--tail" : ""} ${task.checked ? "task-item-row--checked" : ""}`
    row.dataset.taskListTarget = "row"
    row.dataset.mainIndex = String(mainIndex)
    row.dataset.clickable = "true"

    const ratio = this.computeCompletionRatio(task)
    if (ratio !== null) {
      const previous = this.previousCompletionByMainIndex?.get(mainIndex)
      if (previous != null && !Number.isNaN(previous)) {
        row.style.setProperty("--completion", previous)
        this.scheduleCompletionUpdate(row, ratio)
      } else {
        row.style.setProperty("--completion", ratio)
      }
    } else {
      row.style.removeProperty("--completion")
    }

    const left = document.createElement("div")
    left.className = "row-left"

    const text = document.createElement("span")
    text.className = "task-item-text"
    text.textContent = task.text || "Untitled Task"
    left.appendChild(text)

    const right = document.createElement("div")
    right.className = "row-right"

    const addSubtask = document.createElement("button")
    addSubtask.type = "button"
    addSubtask.className = "row-plus"
    addSubtask.textContent = "+"
    addSubtask.dataset.action = "click->task-list#addSubtask"
    right.appendChild(addSubtask)

    const edit = document.createElement("button")
    edit.type = "button"
    edit.className = "row-pencil"
    edit.textContent = "✎"
    edit.dataset.action = "click->task-list#editRow"
    right.appendChild(edit)

    row.appendChild(left)
    row.appendChild(right)
    return row
  }

  buildSubtaskRow(subtask, mainIndex, subIndex) {
    const siblings = this.tasks[mainIndex]?.subtasks || []
    const isLast = subIndex === siblings.length - 1
    const row = document.createElement("div")
    row.className = `organizer-row task-item-row task-item-row--subtask task-item-group--child ${isLast ? "task-item-group--tail" : ""} ${subtask.checked ? "task-item-row--checked" : ""}`
    row.dataset.taskListTarget = "row"
    row.dataset.mainIndex = String(mainIndex)
    row.dataset.subIndex = String(subIndex)
    row.dataset.clickable = "true"

    const left = document.createElement("div")
    left.className = "row-left"

    const text = document.createElement("span")
    text.className = "task-item-text task-item-text--subtask"
    text.textContent = subtask.text || "Untitled Subtask"
    left.appendChild(text)

    const right = document.createElement("div")
    right.className = "row-right"
    const edit = document.createElement("button")
    edit.type = "button"
    edit.className = "row-pencil"
    edit.textContent = "✎"
    edit.dataset.action = "click->task-list#editRow"
    right.appendChild(edit)

    row.appendChild(left)
    row.appendChild(right)
    return row
  }

  async saveNow() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.tasksPayloadTarget.value = JSON.stringify(this.tasks)
    this.syncResetHiddenInputs()

    const form = this.element
    const body = new FormData(form)
    if (!body.has("_method")) body.set("_method", "patch")

    const csrf = document.querySelector("meta[name='csrf-token']")
    if (csrf?.content && !body.has("authenticity_token")) {
      body.set("authenticity_token", csrf.content)
    }

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body,
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json",
          "X-CSRF-Token": csrf?.content || ""
        },
        credentials: "same-origin"
      })

      if (!response.ok) {
        this.setStatus("Save failed")
        return
      }

      this.setStatus("Saved")
    } catch (_error) {
      this.setStatus("Save failed")
    }
  }

  setStatus(message) {
    if (!this.hasStatusTarget) return
    this.statusTarget.textContent = message
  }
}
