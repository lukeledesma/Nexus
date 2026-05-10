import { Controller } from "@hotwired/stimulus"

const STORAGE_KEY = "nexus.clock.app.v1"
const NOTICE_MS = 2600

function clampMs(value) {
  return Math.max(0, Number.parseInt(value || 0, 10) || 0)
}

function nowMs() {
  return Date.now()
}

export default class extends Controller {
  static targets = [
    "tab",
    "panel",
    "notice",
    "soundToggle",
    "stopwatchDisplay",
    "stopwatchStartBtn",
    "lapsList",
    "timerDisplay",
    "timerStartBtn",
    "timerPauseBtn",
    "timerCustomInput",
    "timerAutoRepeatInput"
  ]

  connect() {
    this.noticeTimer = null
    this.renderTimer = null
    this.lastPersistAt = 0
    this.state = this.defaultState()
    this.loadState()
    this.repairLongRunningSessions()
    this.persistState(true)
    this.bindKeyboard()
    this.renderAll()
    this.renderTimer = window.setInterval(() => this.tick(), 200)
  }

  disconnect() {
    this.unbindKeyboard()
    if (this.renderTimer) {
      window.clearInterval(this.renderTimer)
      this.renderTimer = null
    }
    if (this.noticeTimer) {
      window.clearTimeout(this.noticeTimer)
      this.noticeTimer = null
    }
    this.persistState(true)
  }

  defaultState() {
    return {
      activeTab: "stopwatch",
      settings: { soundEnabled: true },
      stopwatch: {
        status: "idle",
        startedAtMs: null,
        elapsedBeforeRunMs: 0,
        laps: []
      },
      timer: {
        status: "idle",
        startedAtMs: null,
        elapsedBeforeRunMs: 0,
        durationMs: 0,
        autoRepeat: false
      }
    }
  }

  switchTab(event) {
    const tab = String(event.currentTarget?.dataset?.tab || "").trim()
    if (!tab) return
    this.state.activeTab = tab
    this.persistState()
    this.renderTabs()
  }

  toggleSound() {
    this.state.settings.soundEnabled = Boolean(this.soundToggleTarget.checked)
    this.persistState()
  }

  startStopwatch() {
    if (this.state.stopwatch.status === "running") {
      this.pauseStopwatch()
      return
    }
    this.state.stopwatch.startedAtMs = nowMs()
    this.state.stopwatch.status = "running"
    this.persistState()
    this.renderStopwatch()
  }

  pauseStopwatch() {
    if (this.state.stopwatch.status !== "running") return
    const elapsed = this.readStopwatchElapsedMs()
    this.state.stopwatch.elapsedBeforeRunMs = elapsed
    this.state.stopwatch.startedAtMs = null
    this.state.stopwatch.status = "paused"
    this.persistState()
    this.renderStopwatch()
  }

  lapStopwatch() {
    if (this.state.stopwatch.status !== "running") return
    const total = this.readStopwatchElapsedMs()
    const previousTotal = this.state.stopwatch.laps.length > 0 ? this.state.stopwatch.laps[0].totalMs : 0
    const lapMs = total - previousTotal
    this.state.stopwatch.laps.unshift({
      id: `lap-${nowMs()}-${Math.random().toString(36).slice(2, 6)}`,
      totalMs: total,
      lapMs
    })
    this.persistState()
    this.renderStopwatchLaps()
  }

  resetStopwatch() {
    this.state.stopwatch = {
      status: "idle",
      startedAtMs: null,
      elapsedBeforeRunMs: 0,
      laps: []
    }
    this.persistState()
    this.renderStopwatch()
  }

  applyTimerTextInput() {
    const raw = String(this.timerCustomInputTarget.value || "").trim()
    if (!raw) {
      this.state.timer.durationMs = 0
      this.state.timer.elapsedBeforeRunMs = 0
      this.state.timer.startedAtMs = null
      this.state.timer.status = "idle"
      this.persistState()
      this.renderTimerPanel()
      return
    }
    const ms = this.parseDurationInput(raw)
    if (ms <= 0) {
      this.showNotice("Use formats like 25m, 1:30, or 1h 15m")
      return
    }
    this.state.timer.durationMs = ms
    this.state.timer.elapsedBeforeRunMs = 0
    this.state.timer.startedAtMs = null
    this.state.timer.status = "idle"
    this.persistState()
    this.renderTimerPanel()
  }

  startTimer() {
    if (this.state.timer.durationMs <= 0) {
      const ms = this.parseDurationInput(String(this.timerCustomInputTarget.value || "").trim())
      if (ms > 0) {
        this.state.timer.durationMs = ms
        this.state.timer.elapsedBeforeRunMs = 0
      } else {
        this.showNotice("Set a timer duration first")
        return
      }
    }
    if (this.state.timer.status === "running") {
      this.stopTimer()
      return
    }
    this.state.timer.startedAtMs = nowMs()
    this.state.timer.status = "running"
    this.persistState()
    this.renderTimerPanel()
  }

  pauseTimer() {
    if (this.state.timer.status !== "running") return
    const elapsed = this.readTimerElapsedMs()
    this.state.timer.elapsedBeforeRunMs = elapsed
    this.state.timer.startedAtMs = null
    this.state.timer.status = "paused"
    this.persistState()
    this.renderTimerPanel()
  }

  stopTimer() {
    if (this.state.timer.status === "idle") return
    this.state.timer.status = "idle"
    this.state.timer.startedAtMs = null
    this.state.timer.elapsedBeforeRunMs = 0
    this.persistState()
    this.renderTimerPanel()
  }

  resetTimer() {
    this.state.timer.status = "idle"
    this.state.timer.startedAtMs = null
    this.state.timer.elapsedBeforeRunMs = 0
    this.state.timer.durationMs = 0
    this.persistState()
    this.renderTimerPanel()
  }

  toggleTimerAutoRepeat() {
    this.state.timer.autoRepeat = Boolean(this.timerAutoRepeatInputTarget.checked)
    this.persistState()
  }

  tick() {
    this.renderStopwatchDisplayOnly()
    this.renderTimerDisplayOnly()
    this.checkTimerCompletion()

    if (this.isAnyClockRunning() && nowMs() - this.lastPersistAt > 5000) {
      this.persistState()
    }
  }

  isAnyClockRunning() {
    return this.state.stopwatch.status === "running" || this.state.timer.status === "running"
  }

  checkTimerCompletion() {
    if (this.state.timer.status !== "running") return
    const remaining = this.state.timer.durationMs - this.readTimerElapsedMs()
    if (remaining > 0) return

    if (this.state.timer.autoRepeat) {
      this.state.timer.startedAtMs = nowMs()
      this.state.timer.elapsedBeforeRunMs = 0
      this.state.timer.status = "running"
      this.handleTimerCompletion()
    } else {
      this.state.timer.status = "idle"
      this.state.timer.startedAtMs = null
      this.state.timer.elapsedBeforeRunMs = 0
      this.handleTimerCompletion()
    }
    this.persistState()
    this.renderTimerPanel()
  }

  handleTimerCompletion() {
    window.dispatchEvent(new CustomEvent("app-window:toggle", { detail: { appKey: "clock" } }))
    if (this.state.settings.soundEnabled) this.playAlertTone()
  }

  readStopwatchElapsedMs() {
    const base = clampMs(this.state.stopwatch.elapsedBeforeRunMs)
    if (this.state.stopwatch.status !== "running" || !this.state.stopwatch.startedAtMs) return base
    return base + Math.max(0, nowMs() - this.state.stopwatch.startedAtMs)
  }

  readTimerElapsedMs() {
    const base = clampMs(this.state.timer.elapsedBeforeRunMs)
    if (this.state.timer.status !== "running" || !this.state.timer.startedAtMs) return base
    return base + Math.max(0, nowMs() - this.state.timer.startedAtMs)
  }

  renderAll() {
    this.renderTabs()
    this.renderStopwatch()
    this.renderTimerPanel()
    this.soundToggleTarget.checked = Boolean(this.state.settings.soundEnabled)
    this.timerAutoRepeatInputTarget.checked = Boolean(this.state.timer.autoRepeat)
  }

  renderTabs() {
    this.tabTargets.forEach((tabEl) => {
      const active = tabEl.dataset.tab === this.state.activeTab
      tabEl.classList.toggle("is-active", active)
      tabEl.setAttribute("aria-selected", active ? "true" : "false")
    })
    this.panelTargets.forEach((panelEl) => {
      panelEl.hidden = panelEl.dataset.panel !== this.state.activeTab
    })
  }

  renderStopwatch() {
    this.renderStopwatchDisplayOnly()
    this.renderStopwatchLaps()
    const running = this.state.stopwatch.status === "running"
    this.stopwatchStartBtnTarget.textContent = running ? "Pause" : "Start"
  }

  renderStopwatchDisplayOnly() {
    this.stopwatchDisplayTarget.textContent = this.formatStopwatch(this.readStopwatchElapsedMs())
  }

  renderStopwatchLaps() {
    const laps = this.state.stopwatch.laps
    if (!laps || laps.length === 0) {
      this.lapsListTarget.innerHTML = '<p class="clock-app__empty">No laps</p>'
      return
    }
    const rows = laps
      .map((lap, index) => `
        <div class="clock-app__lap-row">
          <span>Lap ${laps.length - index}</span>
          <span>${this.formatStopwatch(lap.lapMs)}</span>
          <span>${this.formatStopwatch(lap.totalMs)}</span>
        </div>
      `)
      .join("")
    this.lapsListTarget.innerHTML = rows
  }

  renderTimerPanel() {
    this.renderTimerDisplayOnly()
    const running = this.state.timer.status === "running"
    const paused = this.state.timer.status === "paused"
    this.timerStartBtnTarget.textContent = running ? "Stop" : (paused ? "Resume" : "Start")
    this.timerPauseBtnTarget.disabled = !running
    this.timerAutoRepeatInputTarget.checked = Boolean(this.state.timer.autoRepeat)
    this.timerCustomInputTarget.value = this.formatDurationInput(this.state.timer.durationMs)
  }

  renderTimerDisplayOnly() {
    const remainingMs = Math.max(0, this.state.timer.durationMs - this.readTimerElapsedMs())
    this.timerDisplayTarget.textContent = this.formatTimer(remainingMs)
  }

  formatStopwatch(ms) {
    const total = Math.floor(ms / 10)
    const centis = total % 100
    const secs = Math.floor(total / 100) % 60
    const mins = Math.floor(total / 6000) % 60
    const hours = Math.floor(total / 360000)
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`
  }

  formatTimer(ms) {
    const totalSecs = Math.max(0, Math.ceil(ms / 1000))
    const secs = totalSecs % 60
    const mins = Math.floor(totalSecs / 60) % 60
    const hours = Math.floor(totalSecs / 3600)
    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  }

  parseDurationInput(raw) {
    if (!raw) return 0
    const normalized = String(raw).trim().toLowerCase()

    const unitMs = this.parseUnitDurationInput(normalized)
    if (unitMs > 0) return unitMs

    const parts = normalized.split(":").map((part) => part.trim()).filter((part) => part.length > 0)
    if (parts.length === 0 || parts.length > 3) return 0
    if (parts.some((part) => !part.match(/^\d+$/))) return 0

    let hours = 0
    let minutes = 0
    let seconds = 0
    if (parts.length === 3) {
      hours = Number.parseInt(parts[0], 10)
      minutes = Number.parseInt(parts[1], 10)
      seconds = Number.parseInt(parts[2], 10)
    } else if (parts.length === 2) {
      minutes = Number.parseInt(parts[0], 10)
      seconds = Number.parseInt(parts[1], 10)
    } else {
      minutes = Number.parseInt(parts[0], 10)
    }

    if (minutes > 59 && parts.length === 3) return 0
    if (seconds > 59) return 0
    return ((hours * 3600) + (minutes * 60) + seconds) * 1000
  }

  repairLongRunningSessions() {
    const now = nowMs()

    if (this.state.stopwatch.status === "running") {
      const elapsed = clampMs(this.state.stopwatch.elapsedBeforeRunMs)
      if (!Number.isFinite(this.state.stopwatch.startedAtMs)) {
        this.state.stopwatch.startedAtMs = now - elapsed
      }
    }

    if (this.state.timer.status === "running") {
      const elapsed = clampMs(this.state.timer.elapsedBeforeRunMs)
      if (!Number.isFinite(this.state.timer.startedAtMs)) {
        this.state.timer.startedAtMs = now - elapsed
      }
    }
  }

  parseUnitDurationInput(text) {
    if (!/[a-z]/.test(text)) return 0

    const tokenPattern = /(\d+)\s*(h(?:ours?)?|hr|hrs|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)/g
    let totalMs = 0
    let matchedLength = 0
    let match

    while ((match = tokenPattern.exec(text)) !== null) {
      const value = Number.parseInt(match[1], 10)
      const unit = match[2]
      matchedLength += match[0].length

      if (!Number.isFinite(value) || value < 0) return 0
      if (unit.startsWith("h")) totalMs += value * 3600000
      else if (unit.startsWith("m")) totalMs += value * 60000
      else totalMs += value * 1000
    }

    const compactText = text.replace(/\s+/g, "")
    const compactMatched = (text.match(tokenPattern) || []).join("").replace(/\s+/g, "")
    if (!compactMatched || compactMatched !== compactText) return 0

    return totalMs
  }

  formatDurationInput(ms) {
    const totalSeconds = Math.floor(clampMs(ms) / 1000)
    if (totalSeconds <= 0) return ""

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`
  }

  showNotice(text) {
    this.noticeTarget.hidden = false
    this.noticeTarget.textContent = text
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer)
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTarget.hidden = true
      this.noticeTarget.textContent = ""
      this.noticeTimer = null
    }, NOTICE_MS)
  }

  playAlertTone() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = "sine"
      oscillator.frequency.value = 880
      gain.gain.value = 0.04
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.16)
      window.setTimeout(() => ctx.close(), 220)
    } catch (_error) {
      // non-blocking
    }
  }

  bindKeyboard() {
    this.boundKeydown = this.onKeydown.bind(this)
    window.addEventListener("keydown", this.boundKeydown)
  }

  unbindKeyboard() {
    if (!this.boundKeydown) return
    window.removeEventListener("keydown", this.boundKeydown)
    this.boundKeydown = null
  }

  onKeydown(event) {
    if (!(event.target instanceof Element)) return
    if (event.target.closest("input, textarea, select")) return

    if (event.key === "1") this.setActiveTab("stopwatch")
    if (event.key === "2") this.setActiveTab("timer")

    if (event.key === " ") {
      event.preventDefault()
      if (this.state.activeTab === "stopwatch") this.startStopwatch()
      if (this.state.activeTab === "timer") this.startTimer()
    }

    if (event.key.toLowerCase() === "r") {
      if (this.state.activeTab === "stopwatch") this.resetStopwatch()
      if (this.state.activeTab === "timer") this.resetTimer()
    }

    if (event.key.toLowerCase() === "l" && this.state.activeTab === "stopwatch") {
      this.lapStopwatch()
    }
  }

  setActiveTab(tab) {
    if (this.state.activeTab === tab) return
    this.state.activeTab = tab
    this.persistState()
    this.renderTabs()
  }

  persistState(force = false) {
    const now = nowMs()
    if (!force && now - this.lastPersistAt < 120) return
    this.lastPersistAt = now
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (_error) {
      // non-blocking
    }
  }

  loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== "object") return

      this.state.activeTab = ["stopwatch", "timer"].includes(parsed.activeTab) ? parsed.activeTab : "stopwatch"
      this.state.settings.soundEnabled = Boolean(parsed?.settings?.soundEnabled)

      this.state.stopwatch = {
        status: ["idle", "running", "paused"].includes(parsed?.stopwatch?.status) ? parsed.stopwatch.status : "idle",
        startedAtMs: Number.isFinite(parsed?.stopwatch?.startedAtMs) ? parsed.stopwatch.startedAtMs : null,
        elapsedBeforeRunMs: clampMs(parsed?.stopwatch?.elapsedBeforeRunMs),
        laps: Array.isArray(parsed?.stopwatch?.laps) ? parsed.stopwatch.laps.slice(0, 50).map((lap) => ({
          id: String(lap.id || `lap-${nowMs()}`),
          totalMs: clampMs(lap.totalMs),
          lapMs: clampMs(lap.lapMs)
        })) : []
      }

      this.state.timer = {
        status: ["idle", "running", "paused"].includes(parsed?.timer?.status) ? parsed.timer.status : "idle",
        startedAtMs: Number.isFinite(parsed?.timer?.startedAtMs) ? parsed.timer.startedAtMs : null,
        elapsedBeforeRunMs: clampMs(parsed?.timer?.elapsedBeforeRunMs),
        durationMs: clampMs(parsed?.timer?.durationMs),
        autoRepeat: Boolean(parsed?.timer?.autoRepeat)
      }
    } catch (_error) {
      // fallback to defaults
      this.state = this.defaultState()
    }
  }

  escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;")
  }
}
