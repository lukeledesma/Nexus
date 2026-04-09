import { Controller } from "@hotwired/stimulus"
import { materialSymbolSvg } from "lib/material_symbols"

const STORAGE_KEY = "nexus.habitTracker.state.v1"
const DEMO_BACKUP_KEY = "nexus.habitTracker.state.backupBeforeHeatmapDemo.v1"
const DEMO_SEEDED_KEY = "nexus.habitTracker.demoSeedApplied.v1"
const CLEAR_HISTORY_ONCE_KEY = "nexus.habitTracker.historyClearedOnce.v1"
const LOG_YESTERDAY_ONCE_KEY = "nexus.habitTracker.logYesterdayOnce.v1"
const CHART_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
const HABIT_COLOR_PALETTE = ["#8b5cf6", "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#14b8a6", "#e879f9", "#84cc16", "#f97316", "#06b6d4"]

export default class extends Controller {
  static targets = ["panelRow", "content", "modal", "modalTitle", "saveButton", "nameInput", "typeSelect", "unitInput", "colorInput"]

  connect() {
    this.boundHabitAdd = this.handleHabitAdd.bind(this)
    window.addEventListener("nexus:habit-add", this.boundHabitAdd)
    this.modalMode = "create"
    this.modalHabitId = null
    this.trendCharts = []
    this.chartJsPromise = null
    this.pendingTrendResizeRaf = null
    this.trendResizeObserver = null
    this.pendingTrendResizeTimeouts = []
    this.boundWindowToggleResize = this.handleWindowToggleResize.bind(this)
    const saved = this.loadState()
    this.state = saved || { habits: [], logs: {}, view: "today" }
    if (!["today", "trends", "heatmap"].includes(this.state.view)) this.state.view = "today"
    const historyCleared = this.clearHistoryOnce()
    const seeded = historyCleared ? false : this.seedLastTenDaysRandomDemoOnce()
    const yesterdayLogged = this.logRequestedYesterdayOnce()
    if (this.ensureHabitColors() || seeded || historyCleared || yesterdayLogged) this.saveState()
    this.setupTrendResizeObserver()
    window.addEventListener("app-window:toggle", this.boundWindowToggleResize)
    this.render()
  }

  disconnect() {
    window.removeEventListener("nexus:habit-add", this.boundHabitAdd)
    window.removeEventListener("app-window:toggle", this.boundWindowToggleResize)
    this.teardownTrendResizeObserver()
    this.clearTrendCharts()
  }

  switchView(event) {
    const view = event.currentTarget.dataset.view
    this.state.view = ["today", "trends", "heatmap"].includes(view) ? view : "today"
    this.saveState()
    this.render()
  }

  openModalForCreate() {
    this.modalMode = "create"
    this.modalHabitId = null
    this.syncModalChrome()
    if (!this.hasModalTarget) return
    if (this.hasNameInputTarget) this.nameInputTarget.value = ""
    if (this.hasTypeSelectTarget) this.typeSelectTarget.value = "boolean"
    if (this.hasUnitInputTarget) this.unitInputTarget.value = ""
    if (this.hasColorInputTarget) this.colorInputTarget.value = this.randomHabitColor()
    this.modalTarget.hidden = false
    if (this.hasNameInputTarget) this.nameInputTarget.focus()
  }

  openModalForEdit(habitId) {
    const id = Number(habitId)
    if (!Number.isFinite(id)) return
    const habit = this.state.habits.find((h) => h.id === id)
    if (!habit || !this.hasModalTarget) return
    this.modalMode = "edit"
    this.modalHabitId = id
    this.syncModalChrome()
    if (this.hasNameInputTarget) this.nameInputTarget.value = habit.name
    if (this.hasTypeSelectTarget) this.typeSelectTarget.value = habit.type
    if (this.hasUnitInputTarget) this.unitInputTarget.value = habit.unit || ""
    if (this.hasColorInputTarget) this.colorInputTarget.value = this.normalizeColor(habit.color) || "#8b5cf6"
    this.modalTarget.hidden = false
    if (this.hasNameInputTarget) this.nameInputTarget.focus()
  }

  closeModal() {
    if (!this.hasModalTarget) return
    this.modalTarget.hidden = true
    this.modalMode = "create"
    this.modalHabitId = null
    this.syncModalChrome()
    if (this.hasNameInputTarget) this.nameInputTarget.value = ""
    if (this.hasTypeSelectTarget) this.typeSelectTarget.value = "boolean"
    if (this.hasUnitInputTarget) this.unitInputTarget.value = ""
    if (this.hasColorInputTarget) this.colorInputTarget.value = "#8b5cf6"
  }

  backdropClick(event) {
    if (event.target === event.currentTarget) this.closeModal()
  }

  saveHabit() {
    const name = (this.nameInputTarget?.value || "").trim()
    if (!name) {
      this.nameInputTarget?.focus()
      return
    }
    const type = (this.typeSelectTarget?.value || "boolean") === "number" ? "number" : "boolean"
    const unit = (this.unitInputTarget?.value || "").trim()
    const color = this.normalizeColor(this.colorInputTarget?.value) || this.randomHabitColor()
    if (this.modalMode === "edit") {
      const id = Number(this.modalHabitId)
      const habit = this.state.habits.find((h) => h.id === id)
      if (habit) {
        habit.name = name
        habit.type = type
        habit.unit = unit
        habit.color = color
      }
    } else {
      const nextId = this.nextHabitId()
      this.state.habits.push({ id: nextId, name, type, unit, color })
    }
    this.saveState()
    this.closeModal()
    this.render()
  }

  render() {
    this.renderPanelRows()
    this.renderContent()
  }

  renderPanelRows() {
    if (!this.hasPanelRowTarget) return
    this.panelRowTargets.forEach((row) => {
      row.classList.toggle("is-active", row.dataset.view === this.state.view)
    })
  }

  renderContent() {
    if (!this.hasContentTarget) return
    if (this.state.view === "trends") {
      void this.renderTrends()
      return
    }
    if (this.state.view === "heatmap") {
      this.renderHeatmap()
      return
    }
    this.clearTrendCharts()

    if (this.state.habits.length === 0) {
      this.contentTarget.innerHTML = `<div class="habit-tracker-empty-state">Add a habit to start tracking.</div>`
      return
    }

    const date = this.todayString()
    const list = document.createElement("ul")
    list.className = "task-list-rows habit-tracker-today-list"
    list.setAttribute("role", "list")
    list.setAttribute("aria-label", "Habits for today")

    this.state.habits.forEach((h) => {
      const value = this.readLog(h.id, date)
      const done = this.isHabitDoneValue(value)
      const row = document.createElement("li")
      row.className = `task-item-row task-item-row--main organizer-row nexus-standard-row habit-tracker-today-row${done ? " task-item-row--checked" : ""}`
      const color = this.normalizeColor(h.color) || "#8b5cf6"
      const accentRgb = this.hexToRgbString(color)
      if (accentRgb) {
        row.style.setProperty("--habit-accent", color)
        row.style.setProperty("--habit-accent-rgb", accentRgb)
      }
      row.setAttribute("role", "listitem")
      row.tabIndex = 0
      row.dataset.habitId = String(h.id)
      row.setAttribute("aria-label", `${done ? "Completed" : "Incomplete"} habit ${h.name}`)
      const leadingSlot = `<span class="task-toggle" aria-hidden="true">${done ? materialSymbolSvg("check", "xs") : materialSymbolSvg("circle_outline", "xs")}</span>`
      const numericValue = Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0
      const numericSuffix = h.type === "number"
        ? `<span class="habit-tracker-inline-value">${numericValue}${h.unit ? ` ${this.escapeHtml(h.unit)}` : ""}</span>`
        : ""
      row.innerHTML = `
        <div class="organizer-row-left finder-file-row-main ${this.mainRowClass()}">
          <span class="nexus-standard-row__leading">${leadingSlot}</span>
          <span class="task-item-text">${this.escapeHtml(h.name)}${numericSuffix}</span>
        </div>
        <div class="organizer-row-right">
          <button type="button" class="item-action-btn" data-action="rename" title="Rename" aria-label="Rename ${h.name}">${materialSymbolSvg("edit", "xs")}</button>
          <button type="button" class="item-action-btn item-action-delete" data-action="delete" title="Delete" aria-label="Delete ${h.name}">${materialSymbolSvg("close", "xs")}</button>
        </div>
      `
      row.addEventListener("click", (event) => {
        if (event.target.closest(".organizer-row-right")) return
        if (h.type === "number") {
          this.promptNumericValue(h.id, h.name, value)
          return
        }
        this.toggleHabitForToday(h.id)
      })
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        if (h.type === "number") this.promptNumericValue(h.id, h.name, value)
        else this.toggleHabitForToday(h.id)
      })
      const leadingToggle = row.querySelector(".task-toggle")
      if (leadingToggle) {
        leadingToggle.addEventListener("click", (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (h.type === "number") this.promptNumericValue(h.id, h.name, value)
          else this.toggleHabitForToday(h.id)
        })
      }
      row.querySelector('[data-action="rename"]')?.addEventListener("click", (event) => this.beginEdit(event, h.id))
      row.querySelector('[data-action="delete"]')?.addEventListener("click", (event) => this.deleteHabit(event, h.id))
      list.appendChild(row)
    })

    this.contentTarget.innerHTML = ""
    this.contentTarget.appendChild(list)
  }

  async renderTrends() {
    if (this.state.habits.length === 0) {
      this.clearTrendCharts()
      this.contentTarget.innerHTML = `<div class="habit-tracker-empty-state">Trends will appear after you add habits.</div>`
      return
    }

    const days = this.lastDays(7).reverse()
    const hoverDateLabels = days.map((d) => {
      const [, month, day] = d.split("-")
      return `${Number(month)}/${Number(day)}`
    })
    const labels = days.map((d) => this.weekdayShortLabel(d))
    const datasetsByHabitId = {}
    const trendCards = this.state.habits.map((h) => {
      const values = days.map((d) => this.normalizeTrendValue(h, this.readLog(h.id, d)))
      datasetsByHabitId[String(h.id)] = values
      const avg = this.average(values)
      const avgLabel = h.type === "boolean" ? `${Math.round(avg * 100)}%` : `${avg.toFixed(1)}${h.unit ? ` ${h.unit}` : ""}`
      return `<article class="habit-tracker-trend-card">
        <header class="habit-tracker-trend-head">
          <span class="habit-tracker-card-title">${this.escapeHtml(h.name)}</span>
          <span class="habit-tracker-avg">avg ${avgLabel}</span>
        </header>
        <div class="habit-tracker-mini-chart">
          <canvas data-role="trend-chart" data-habit-id="${h.id}" aria-label="Trend chart for ${this.escapeHtml(h.name)}"></canvas>
        </div>
      </article>`
    }).join("")
    this.contentTarget.innerHTML = `<section class="habit-tracker-trends-wrap"><div class="habit-tracker-trends-grid">${trendCards}</div></section>`

    const Chart = await this.ensureChartJsLoaded()
    if (!Chart) return

    this.clearTrendCharts()
    this.contentTarget.querySelectorAll('[data-role="trend-chart"]').forEach((canvas) => {
      const habitId = String(canvas.dataset.habitId || "")
      const habit = this.state.habits.find((h) => String(h.id) === habitId)
      if (!habit) return
      const values = datasetsByHabitId[habitId] || []
      const color = this.normalizeColor(habit.color) || "#8b5cf6"
      const maxValue = Math.max(1, ...values)
      const yMax = habit.type === "boolean" ? 1 : Math.max(4, Math.ceil(maxValue * 1.1))
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      const chart = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            data: values,
            borderColor: color,
            backgroundColor: this.hexToRgba(color, 0.15),
            borderWidth: 2,
            pointRadius: 2.5,
            pointHoverRadius: 3.5,
            pointBackgroundColor: color,
            pointBorderWidth: 0,
            tension: 0.35,
            fill: true
          }]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#2b2538",
              borderColor: "rgba(255,255,255,0.14)",
              borderWidth: 1,
              titleColor: "#f3f3f4",
              bodyColor: "#d8d7df",
              displayColors: false,
              callbacks: {
                title: (items) => {
                  const idx = items?.[0]?.dataIndex
                  if (!Number.isFinite(idx)) return ""
                  return hoverDateLabels[idx]
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: "rgba(255,255,255,0.06)" },
              ticks: {
                color: "rgba(255,255,255,0.35)",
                maxTicksLimit: 7,
                font: { size: 10 }
              },
              border: { display: false }
            },
            y: {
              beginAtZero: true,
              max: yMax,
              grid: { color: "rgba(255,255,255,0.06)" },
              ticks: {
                color: "rgba(255,255,255,0.28)",
                maxTicksLimit: 3,
                font: { size: 10 }
              },
              border: { display: false }
            }
          }
        }
      })
      this.trendCharts.push(chart)
    })
    this.scheduleTrendResize()
    this.scheduleTrendResizeRetries()
  }

  renderHeatmap() {
    this.clearTrendCharts()
    if (this.state.habits.length === 0) {
      this.contentTarget.innerHTML = `<div class="habit-tracker-empty-state">Heatmap will appear after you add habits.</div>`
      return
    }

    const days = this.lastDays(365).reverse()
    const cards = this.state.habits.map((habit) => {
      const color = this.normalizeColor(habit.color) || "#8b5cf6"
      const rgb = this.hexToRgbString(color) || "139, 92, 246"
      const values = days.map((day) => this.normalizeTrendValue(habit, this.readLog(habit.id, day)))
      const peak = Math.max(1, ...values)
      const cells = values.map((value, idx) => {
        const day = days[idx]
        const dayLabel = this.formatMonthDay(day)
        const intensity = habit.type === "boolean" ? (value > 0 ? 1 : 0) : Math.min(1, value / peak)
        const alpha = value > 0 ? (0.28 + intensity * 0.62) : 0.08
        const hoverAlpha = Math.min(1, alpha + 0.18)
        const valueLabel = value > 0
          ? `${value}${habit.type === "number" && habit.unit ? ` ${habit.unit}` : ""}`
          : "none"
        return `<span class="habit-tracker-heatmap-cell" data-tip="${this.escapeHtml(`${dayLabel}: ${valueLabel}`)}" style="--cell-rgb: ${rgb}; --cell-alpha: ${alpha.toFixed(3)}; --cell-alpha-hover: ${hoverAlpha.toFixed(3)}"></span>`
      }).join("")
      return `<article class="habit-tracker-heatmap-card">
        <header class="habit-tracker-heatmap-head">
          <span class="habit-tracker-card-title">${this.escapeHtml(habit.name)}</span>
          <span class="habit-tracker-avg">${this.currentStreak(habit.id)} day streak</span>
        </header>
        <div class="habit-tracker-heatmap-grid">${cells}</div>
      </article>`
    }).join("")

    this.contentTarget.innerHTML = `<section class="habit-tracker-heatmap-wrap"><div class="habit-tracker-heatmap-list">${cards}</div></section>`
  }

  handleHabitAdd(event) {
    const frame = this.element.closest("turbo-frame")
    const expectedFrameId = frame?.id
    if (!expectedFrameId) return
    if (event.detail?.frameId !== expectedFrameId) return
    this.openModalForCreate()
  }

  normalizeTrendValue(habit, value) {
    if (habit.type === "boolean") return value ? 1 : 0
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  toggleHabitForToday(habitId) {
    const id = Number(habitId)
    if (!Number.isFinite(id)) return
    const date = this.todayString()
    const prev = this.readLog(id, date)
    if (this.isHabitDoneValue(prev)) {
      this.writeLog(id, date, null)
    } else {
      this.writeLog(id, date, 1)
    }
    this.saveState()
    this.renderContent()
  }

  setNumericHabitForToday(habitId, rawValue) {
    const id = Number(habitId)
    if (!Number.isFinite(id)) return
    const date = this.todayString()
    const raw = Number(rawValue)
    if (!Number.isFinite(raw) || raw <= 0) this.writeLog(id, date, null)
    else this.writeLog(id, date, raw)
    this.saveState()
    this.renderContent()
  }

  promptNumericValue(habitId, habitName, currentValue) {
    const current = Number.isFinite(Number(currentValue)) && Number(currentValue) > 0 ? Math.floor(Number(currentValue)) : 0
    const raw = window.prompt(`Enter value for "${habitName}"`, String(current))
    if (raw === null) return
    this.setNumericHabitForToday(habitId, raw)
  }

  beginEdit(event, habitId) {
    event.preventDefault()
    event.stopPropagation()
    this.openModalForEdit(habitId)
  }

  deleteHabit(event, habitId) {
    event.preventDefault()
    event.stopPropagation()
    const id = Number(habitId)
    if (!Number.isFinite(id)) return
    const habit = this.state.habits.find((h) => h.id === id)
    if (!habit) return
    if (!window.confirm(`Delete "${habit.name}"?`)) return
    this.state.habits = this.state.habits.filter((h) => h.id !== id)
    delete this.state.logs[String(id)]
    this.saveState()
    this.render()
  }

  isHabitDoneValue(value) {
    return value !== null && value !== undefined && value !== 0 && value !== false
  }

  mainRowClass() {
    return "nexus-standard-row__main"
  }

  syncModalChrome() {
    if (this.hasModalTitleTarget) this.modalTitleTarget.textContent = this.modalMode === "edit" ? "Edit habit" : "Add habit"
    if (this.hasSaveButtonTarget) this.saveButtonTarget.textContent = this.modalMode === "edit" ? "Save" : "Add"
  }

  escapeHtml(input) {
    return String(input)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
  }

  clearTrendCharts() {
    if (!Array.isArray(this.trendCharts) || this.trendCharts.length === 0) return
    this.trendCharts.forEach((chart) => {
      try { chart.destroy() } catch (_) {}
    })
    this.trendCharts = []
  }

  setupTrendResizeObserver() {
    if (!this.hasContentTarget) return
    if (this.trendResizeObserver) return
    this.trendResizeObserver = new ResizeObserver(() => this.scheduleTrendResize())
    this.trendResizeObserver.observe(this.contentTarget)
    window.addEventListener("resize", this.scheduleTrendResizeBound ||= this.scheduleTrendResize.bind(this))
  }

  teardownTrendResizeObserver() {
    if (this.trendResizeObserver) {
      this.trendResizeObserver.disconnect()
      this.trendResizeObserver = null
    }
    if (this.scheduleTrendResizeBound) {
      window.removeEventListener("resize", this.scheduleTrendResizeBound)
      this.scheduleTrendResizeBound = null
    }
    if (this.pendingTrendResizeRaf != null) {
      cancelAnimationFrame(this.pendingTrendResizeRaf)
      this.pendingTrendResizeRaf = null
    }
    this.clearTrendResizeTimeouts()
  }

  scheduleTrendResize() {
    if (this.state.view !== "trends") return
    if (this.pendingTrendResizeRaf != null) cancelAnimationFrame(this.pendingTrendResizeRaf)
    this.pendingTrendResizeRaf = requestAnimationFrame(() => {
      this.pendingTrendResizeRaf = null
      this.refreshTrendChartSizes()
    })
  }

  refreshTrendChartSizes() {
    if (!Array.isArray(this.trendCharts) || this.trendCharts.length === 0) return
    this.trendCharts.forEach((chart) => {
      try {
        const container = chart?.canvas?.parentElement
        const width = Math.floor(container?.clientWidth || 0)
        const height = Math.floor(container?.clientHeight || 0)
        if (width > 0 && height > 0) chart.resize(width, height)
        else chart.resize()
        chart.update("none")
      } catch (_) {}
    })
  }

  scheduleTrendResizeRetries() {
    this.clearTrendResizeTimeouts()
    ;[60, 160, 320].forEach((delay) => {
      const id = window.setTimeout(() => this.scheduleTrendResize(), delay)
      this.pendingTrendResizeTimeouts.push(id)
    })
  }

  clearTrendResizeTimeouts() {
    if (!Array.isArray(this.pendingTrendResizeTimeouts) || this.pendingTrendResizeTimeouts.length === 0) return
    this.pendingTrendResizeTimeouts.forEach((id) => clearTimeout(id))
    this.pendingTrendResizeTimeouts = []
  }

  handleWindowToggleResize(event) {
    const frame = this.element.closest("turbo-frame")
    const expectedFrameId = frame?.id
    if (!expectedFrameId) return
    if (event.detail?.frameId && event.detail.frameId !== expectedFrameId) return
    this.scheduleTrendResize()
    this.scheduleTrendResizeRetries()
  }

  normalizeColor(input) {
    const value = String(input || "").trim().toLowerCase()
    if (!/^#[0-9a-f]{6}$/.test(value)) return null
    return value
  }

  randomHabitColor() {
    const idx = Math.floor(Math.random() * HABIT_COLOR_PALETTE.length)
    return HABIT_COLOR_PALETTE[idx]
  }

  ensureHabitColors() {
    let changed = false
    this.state.habits.forEach((habit) => {
      const color = this.normalizeColor(habit?.color)
      if (color) {
        habit.color = color
        return
      }
      habit.color = this.randomHabitColor()
      changed = true
    })
    return changed
  }

  hexToRgbString(hex) {
    const color = this.normalizeColor(hex)
    if (!color) return null
    const r = Number.parseInt(color.slice(1, 3), 16)
    const g = Number.parseInt(color.slice(3, 5), 16)
    const b = Number.parseInt(color.slice(5, 7), 16)
    return `${r}, ${g}, ${b}`
  }

  hexToRgba(hex, alpha) {
    const rgb = this.hexToRgbString(hex)
    if (!rgb) return `rgba(139, 92, 246, ${alpha})`
    return `rgba(${rgb}, ${alpha})`
  }

  async ensureChartJsLoaded() {
    if (window.Chart) return window.Chart
    if (!this.chartJsPromise) {
      this.chartJsPromise = new Promise((resolve) => {
        const existing = document.querySelector('script[data-habit-tracker-chartjs="true"]')
        if (existing) {
          existing.addEventListener("load", () => resolve(window.Chart || null), { once: true })
          existing.addEventListener("error", () => resolve(null), { once: true })
          return
        }
        const script = document.createElement("script")
        script.src = CHART_JS_URL
        script.async = true
        script.dataset.habitTrackerChartjs = "true"
        script.addEventListener("load", () => resolve(window.Chart || null), { once: true })
        script.addEventListener("error", () => resolve(null), { once: true })
        document.head.appendChild(script)
      })
    }
    return this.chartJsPromise
  }

  average(values) {
    if (!values.length) return 0
    return values.reduce((sum, n) => sum + n, 0) / values.length
  }

  todayString() {
    return new Date().toISOString().slice(0, 10)
  }

  formatMonthDay(dateString) {
    const [year, month, day] = String(dateString).split("-")
    const d = new Date(Number(year), Number(month) - 1, Number(day))
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }

  weekdayShortLabel(dateString) {
    const [year, month, day] = String(dateString).split("-")
    const d = new Date(Number(year), Number(month) - 1, Number(day))
    return d.toLocaleDateString(undefined, { weekday: "short" })
  }

  lastDays(count) {
    const out = []
    for (let i = 0; i < count; i += 1) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }

  readLog(habitId, date) {
    return this.state.logs?.[habitId]?.[date] ?? null
  }

  writeLog(habitId, date, value) {
    const key = String(habitId)
    if (!this.state.logs[key]) this.state.logs[key] = {}
    if (value == null || value === 0 || value === false) {
      delete this.state.logs[key][date]
    } else {
      this.state.logs[key][date] = value
    }
  }

  currentStreak(habitId) {
    let streak = 0
    for (let i = 0; i < 365; i += 1) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const ds = d.toISOString().slice(0, 10)
      const v = this.readLog(habitId, ds)
      if (v == null || v === 0 || v === false) break
      streak += 1
    }
    return streak
  }

  nextHabitId() {
    const ids = this.state.habits.map((h) => Number(h.id)).filter((n) => Number.isFinite(n))
    return ids.length ? Math.max(...ids) + 1 : 1
  }

  saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (_) {}
  }

  clearHistoryOnce() {
    try {
      if (localStorage.getItem(CLEAR_HISTORY_ONCE_KEY) === "1") return false
      this.state.logs = {}
      localStorage.setItem(CLEAR_HISTORY_ONCE_KEY, "1")
      return true
    } catch (_) {
      return false
    }
  }

  normalizeHabitLookup(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  }

  findHabitByLookup(...candidates) {
    const normalizedCandidates = candidates.map((c) => this.normalizeHabitLookup(c))
    return this.state.habits.find((habit) => {
      const key = this.normalizeHabitLookup(habit.name)
      return normalizedCandidates.some((candidate) => key.includes(candidate) || candidate.includes(key))
    }) || null
  }

  setYesterdayValueByName(candidates, value) {
    const habit = this.findHabitByLookup(...candidates)
    if (!habit) return false
    const yesterday = this.lastDays(2)[1]
    if (value === false || value == null || value === 0) {
      this.writeLog(habit.id, yesterday, null)
      return true
    }
    if (habit.type === "number") {
      const n = Number(value)
      this.writeLog(habit.id, yesterday, Number.isFinite(n) && n > 0 ? n : null)
      return true
    }
    this.writeLog(habit.id, yesterday, value ? 1 : null)
    return true
  }

  logRequestedYesterdayOnce() {
    try {
      if (localStorage.getItem(LOG_YESTERDAY_ONCE_KEY) === "1") return false
      let changed = false
      changed = this.setYesterdayValueByName(["woke up"], 1000) || changed
      changed = this.setYesterdayValueByName(["brush teeth sun", "brushteeth sun"], false) || changed
      changed = this.setYesterdayValueByName(["shower", "take shower"], false) || changed
      changed = this.setYesterdayValueByName(["started working"], 1030) || changed
      changed = this.setYesterdayValueByName(["brush teeth moon", "brushteeth moon"], true) || changed
      changed = this.setYesterdayValueByName(["fell asleep"], 2) || changed
      localStorage.setItem(LOG_YESTERDAY_ONCE_KEY, "1")
      return changed
    } catch (_) {
      return false
    }
  }

  seedLastTenDaysRandomDemoOnce() {
    try {
      if (!Array.isArray(this.state.habits) || this.state.habits.length === 0) return false
      if (localStorage.getItem(DEMO_SEEDED_KEY) === "1") return false
      localStorage.setItem(DEMO_BACKUP_KEY, JSON.stringify(this.state))
      const days = this.lastDays(10)
      this.state.habits.forEach((habit) => {
        const key = String(habit.id)
        if (!this.state.logs[key]) this.state.logs[key] = {}
        days.forEach((date) => {
          if (habit.type === "number") {
            this.state.logs[key][date] = Math.floor(Math.random() * 12) + 1
          } else {
            this.state.logs[key][date] = Math.random() < 0.8 ? 1 : null
            if (this.state.logs[key][date] == null) delete this.state.logs[key][date]
          }
        })
      })
      localStorage.setItem(DEMO_SEEDED_KEY, "1")
      return true
    } catch (_) {
      return false
    }
  }

  loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return null
      if (!Array.isArray(parsed.habits)) parsed.habits = []
      parsed.habits = parsed.habits.map((h) => ({
        ...h,
        name: String(h?.name || "").trim(),
        type: h?.type === "number" ? "number" : "boolean",
        unit: String(h?.unit || ""),
        color: this.normalizeColor(h?.color) || this.randomHabitColor()
      })).filter((h) => h.name.length > 0)
      if (!parsed.logs || typeof parsed.logs !== "object") parsed.logs = {}
      if (!["today", "trends", "heatmap"].includes(parsed.view)) parsed.view = "today"
      return parsed
    } catch (_) {
      return null
    }
  }
}
