import { Controller } from "@hotwired/stimulus"

const TAB_STOPWATCH = "stopwatch"
const TAB_TIMER = "timer"

const PRESETS = {
  [TAB_TIMER]: 0
}

export default class extends Controller {
  static targets = ["startBtn", "hoursInput", "minutesInput", "secondsInput"]
  static values = { initialState: Object }

  connect() {
    const initialState = this.hasInitialStateValue ? this.initialStateValue : {}
    const mode = initialState?.mode === TAB_STOPWATCH ? TAB_STOPWATCH : TAB_TIMER

    this.activeTab = mode
    this.running = Boolean(initialState?.running)
    this.state = {
      [TAB_STOPWATCH]: Number.isFinite(Number(initialState?.stopwatch_seconds)) ? Math.max(0, Math.floor(Number(initialState.stopwatch_seconds))) : 0,
      [TAB_TIMER]: Number.isFinite(Number(initialState?.timer_seconds)) ? Math.max(0, Math.floor(Number(initialState.timer_seconds))) : PRESETS[TAB_TIMER]
    }
    this.seconds = this.state[this.activeTab]
    this.baselineSeconds = this.seconds
    this.savedAt = this.parseDate(initialState?.updated_at)
    this.interval = null

    this.restoreFromSavedState()

    this.render()

    if (this.running) this.startTicking()
  }

  disconnect() {
    this.stopTicking()
  }

  toggle() {
    if (this.running) {
      this.pause()
      return
    }

    this.start()
  }

  reset() {
    this.stopTicking()
    this.running = false
    this.state[this.activeTab] = this.defaultSecondsForMode(this.activeTab)
    this.seconds = this.state[this.activeTab]
    this.savedAt = new Date()

    this.render()
    this.persistState()
  }

  selectTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (![TAB_STOPWATCH, TAB_TIMER].includes(tab)) return
    if (tab === this.activeTab) return

    if (this.running) {
      this.flashPauseWarning()
      return
    }

    this.stopTicking()
    this.running = false
    this.state[this.activeTab] = this.currentSeconds()
    this.activeTab = tab
    this.seconds = this.state[tab]
    this.baselineSeconds = this.seconds
    this.savedAt = new Date()
    this.render()
    this.persistState()
  }

  start() {
    this.seconds = this.state[this.activeTab]
    this.running = true
    this.savedAt = new Date()
    this.baselineSeconds = this.seconds
    this.startTicking()
    this.render()
    this.persistState()
  }

  pause() {
    this.seconds = this.currentSeconds()
    this.state[this.activeTab] = this.seconds
    this.stopTicking()
    this.running = false
    this.savedAt = new Date()
    this.render()
    this.persistState()
  }

  tick() {
    this.seconds = this.currentSeconds()
    this.state[this.activeTab] = this.seconds
    if (this.activeTab === TAB_TIMER && this.seconds <= 0) {
      this.seconds = 0
      this.state[TAB_TIMER] = 0
      this.stopTicking()
      this.running = false
      this.savedAt = new Date()
      this.persistState()
    }

    this.render()
  }

  startTicking() {
    this.stopTicking()
    this.interval = setInterval(() => this.tick(), 1000)
  }

  stopTicking() {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  currentSeconds() {
    if (!this.running) return this.state[this.activeTab]

    const now = new Date()
    const delta = Math.max(0, Math.floor((now.getTime() - this.savedAt.getTime()) / 1000))
    if (this.activeTab === TAB_STOPWATCH) {
      return this.baselineSeconds + delta
    }

    return Math.max(0, this.baselineSeconds - delta)
  }

  render() {
    const value = this.currentSeconds()
    this.seconds = value
    const parts = this.timeParts(value)
    const formatted = this.formatParts(parts)

    this.renderInputs(parts)
    this.renderTabs()
    this.renderStartButton(value)
    this.emitLauncherState(formatted)
  }

  renderInputs(parts) {
    const inputs = {
      hours: this.hoursInputTarget,
      minutes: this.minutesInputTarget,
      seconds: this.secondsInputTarget
    }

    Object.entries(inputs).forEach(([segment, input]) => {
      if (document.activeElement !== input) {
        input.value = parts[segment]
      }

      const editable = this.activeTab === TAB_TIMER && !this.running
      input.readOnly = !editable
      input.classList.toggle("is-editable", editable)
      input.setAttribute("aria-readonly", editable ? "false" : "true")
      input.tabIndex = editable ? 0 : -1
    })
  }

  renderTabs() {
    this.element.querySelectorAll(".timer-tab-btn").forEach((button) => {
      const active = button.dataset.tab === this.activeTab
      button.classList.toggle("is-active", active)
      button.setAttribute("aria-selected", active ? "true" : "false")
    })
  }

  renderStartButton(value) {
    this.startBtnTarget.classList.remove("is-warning")

    if (this.running) {
      this.startBtnTarget.textContent = "PAUSE"
      return
    }

    this.startBtnTarget.textContent = "START"
  }

  handleTimeFocus(event) {
    if (this.activeTab !== TAB_TIMER || this.running) return
    event.currentTarget.select()
  }

  handleTimeInput(event) {
    if (this.activeTab !== TAB_TIMER || this.running) return

    const input = event.currentTarget
    const segment = input.dataset.segment
    input.value = this.sanitizeSegmentValue(segment, input.value, false)
  }

  handleTimeBlur(event) {
    if (this.activeTab !== TAB_TIMER || this.running) return

    const input = event.currentTarget
    const segment = input.dataset.segment
    input.value = this.sanitizeSegmentValue(segment, input.value, true)
    this.seconds = this.readInputsAsSeconds()
    this.state[TAB_TIMER] = this.seconds
    this.baselineSeconds = this.seconds
    this.savedAt = new Date()
    this.render()
  }

  handleTimeKeydown(event) {
    if (this.activeTab !== TAB_TIMER || this.running) return

    if (event.key === "Enter") {
      event.preventDefault()
      event.currentTarget.blur()
      return
    }

    if (event.key === "ArrowLeft") {
      this.focusAdjacentSegment(event.currentTarget, -1)
      return
    }

    if (event.key === "ArrowRight") {
      this.focusAdjacentSegment(event.currentTarget, 1)
    }
  }

  focusAdjacentSegment(current, delta) {
    const segments = [this.hoursInputTarget, this.minutesInputTarget, this.secondsInputTarget]
    const index = segments.indexOf(current)
    if (index < 0) return

    const next = segments[index + delta]
    if (!next) return

    next.focus()
    next.select()
  }

  sanitizeSegmentValue(segment, rawValue, pad) {
    const digits = rawValue.replace(/\D/g, "").slice(0, 2)
    const fallback = digits.length > 0 ? digits : "0"
    const numeric = Number.parseInt(fallback, 10)

    let max = 99
    if (segment === "minutes" || segment === "seconds") max = 59

    const clamped = Math.min(max, Number.isFinite(numeric) ? numeric : 0)
    return pad ? clamped.toString().padStart(2, "0") : clamped.toString().slice(0, 2)
  }

  readInputsAsSeconds() {
    const hours = Number.parseInt(this.sanitizeSegmentValue("hours", this.hoursInputTarget.value, true), 10)
    const minutes = Number.parseInt(this.sanitizeSegmentValue("minutes", this.minutesInputTarget.value, true), 10)
    const seconds = Number.parseInt(this.sanitizeSegmentValue("seconds", this.secondsInputTarget.value, true), 10)

    return (hours * 3600) + (minutes * 60) + seconds
  }

  flashPauseWarning() {
    this.startBtnTarget.classList.remove("is-warning")
    void this.startBtnTarget.offsetWidth
    this.startBtnTarget.classList.add("is-warning")
    window.setTimeout(() => {
      this.startBtnTarget.classList.remove("is-warning")
    }, 360)
  }

  emitLauncherState(formattedTime) {
    // Show "-" in launcher button unless actively running
    const launcherDisplay = this.running ? formattedTime : "-"

    try {
      window.localStorage.setItem("nexus.timer.launcherDisplay", launcherDisplay)
    } catch (_error) {
      // Non-blocking.
    }

    window.dispatchEvent(new CustomEvent("timer:state", {
      detail: {
        tab: this.activeTab,
        time: formattedTime,
        launcherDisplay
      }
    }))
  }

  defaultSecondsForMode(mode) {
    return mode === TAB_STOPWATCH ? 0 : PRESETS[TAB_TIMER]
  }

  restoreFromSavedState() {
    // Only restore elapsed time if the timer was actually running
    if (!this.running) {
      return
    }

    if (!this.savedAt || Number.isNaN(this.savedAt.getTime())) {
      return
    }

    const now = new Date()
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - this.savedAt.getTime()) / 1000))

    if (elapsedSeconds <= 0) {
      return // No time has passed
    }

    // Apply elapsed time to the active tab only if it was running
    if (this.activeTab === TAB_STOPWATCH) {
      // Stopwatch counts up: add elapsed time
      this.state[TAB_STOPWATCH] = this.state[TAB_STOPWATCH] + elapsedSeconds
      this.seconds = this.state[TAB_STOPWATCH]
    } else if (this.activeTab === TAB_TIMER) {
      // Timer counts down: subtract elapsed time
      this.state[TAB_TIMER] = Math.max(0, this.state[TAB_TIMER] - elapsedSeconds)
      this.seconds = this.state[TAB_TIMER]

      if (this.seconds <= 0) {
        this.seconds = 0
        this.state[TAB_TIMER] = 0
        this.stopTicking()
        this.running = false
        this.persistState()
      }
    }

    this.baselineSeconds = this.seconds
    this.savedAt = new Date()
  }

  parseDate(value) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return new Date()

    return parsed
  }

  async persistState() {
    const csrfToken = document.querySelector("meta[name='csrf-token']")?.content || ""
    const payload = {
      mode: this.activeTab,
      running: this.running,
      stopwatch_seconds: this.state[TAB_STOPWATCH],
      timer_seconds: this.state[TAB_TIMER],
      saved_at: (this.savedAt || new Date()).toISOString()
    }

    try {
      await fetch("/apps/timer_state", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        body: JSON.stringify(payload)
      })
    } catch (_error) {
      // Keep timer interactions non-blocking.
    }
  }

  formatTime(totalSeconds, withHours) {
    const seconds = Math.max(0, Math.floor(totalSeconds))
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    if (withHours) {
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    }

    const totalMinutes = Math.floor(seconds / 60)
    return `${totalMinutes.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }

  timeParts(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds))
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60

    return {
      hours: h.toString().padStart(2, "0"),
      minutes: m.toString().padStart(2, "0"),
      seconds: s.toString().padStart(2, "0")
    }
  }

  formatParts(parts) {
    // Strip leading zero hours and minutes to show compact display
    // 00:22:12 → 22:12, 00:00:12 → 12, 01:05:08 → 01:05:08
    const hours = parseInt(parts.hours, 10)
    const minutes = parseInt(parts.minutes, 10)
    const seconds = parseInt(parts.seconds, 10)

    if (hours > 0) {
      // Show all three: HH:MM:SS
      return `${parts.hours}:${parts.minutes}:${parts.seconds}`
    }

    if (minutes > 0) {
      // Skip hours, show MM:SS
      return `${parts.minutes}:${parts.seconds}`
    }

    // Hours and minutes are 0, just show seconds
    return `${seconds}`
  }
}
