import { Controller } from "@hotwired/stimulus"

const STORAGE_KEY = "nexus.workTimer.v1"
const HOUR_MS = 3600000

function pad2(n) {
  return String(n).padStart(2, "0")
}

function minutesToTimeString(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${pad2(h)}:${pad2(m)}`
}

function parseTimeStringToMinutes(value) {
  const v = String(value || "").trim()

  // Standard HH:MM format.
  const hhmm = /^(\d{2}):(\d{2})$/.exec(v)
  if (hhmm) {
    const h = Number.parseInt(hhmm[1], 10)
    const min = Number.parseInt(hhmm[2], 10)
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null
    if (h < 0 || h > 23 || min < 0 || min > 59) return null
    return h * 60 + min
  }

  // Smart numeric shorthand:
  // 9 -> 09:00, 103 -> 01:03, 1111 -> 11:11
  // 3-4 digits always treat last two as minutes.
  const digits = /^(\d{1,4})$/.exec(v)
  if (!digits) return null

  const raw = digits[1]
  let h = 0
  let min = 0

  if (raw.length <= 2) {
    h = Number.parseInt(raw, 10)
    min = 0
  } else {
    h = Number.parseInt(raw.slice(0, -2), 10)
    min = Number.parseInt(raw.slice(-2), 10)
  }

  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function elapsedFromClockInMinutes(clockInMinutes) {
  const now = new Date()
  const start = new Date(now)
  start.setHours(Math.floor(clockInMinutes / 60), clockInMinutes % 60, 0, 0)

  // If chosen time is ahead of now, treat as previous day clock-in.
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1)
  }

  return Math.max(0, now.getTime() - start.getTime())
}

function startTimestampFromClockInMinutes(clockInMinutes) {
  if (!Number.isInteger(clockInMinutes)) return Date.now()

  const now = new Date()
  const start = new Date(now)
  start.setHours(Math.floor(clockInMinutes / 60), clockInMinutes % 60, 0, 0)

  // If chosen time is ahead of now, treat as previous day clock-in.
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1)
  }

  return start.getTime()
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

function validSentenceCountFromNotes(text, requiredCount = Infinity) {
  const countingHeaderPrefix = /^\s*h(\d+)\s*:/i
  const lines = String(text || "").replaceAll("\r", "").split("\n")
  let count = 0

  for (const raw of lines) {
    const trimmed = raw.replace(/\s+$/g, "").trim()
    if (!trimmed) continue

    const m = countingHeaderPrefix.exec(trimmed)
    if (m) {
      const hNum = parseInt(m[1], 10)
      // Only count if this H-prefix is currently required (hNum <= requiredCount)
      if (hNum <= requiredCount) {
        const body = trimmed.replace(/^\s*h\d+\s*:\s*/i, "")
        if (/\S/.test(body)) count += 1
      }
    }
  }

  return count
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildNotesHtml(text, requiredCount) {
  if (!text) return ''
  const lines = text.split('\n')
  return lines.map(line => {
    const m = /^(\s*)(h(\d+)\s*:)(.*)$/i.exec(line)
    if (!m) return escapeHtml(line)
    const hNum = parseInt(m[3], 10)
    const hasBody = /\S/.test(m[4] || "")
    const cls = hNum > requiredCount
      ? 'time-card-app__notes-prefix time-card-app__notes-prefix--pending'
      : hasBody
        ? 'time-card-app__notes-prefix time-card-app__notes-prefix--done'
        : 'time-card-app__notes-prefix time-card-app__notes-prefix--missing'
    return escapeHtml(m[1]) + `<span class="${cls}">${escapeHtml(m[2])}</span>` + escapeHtml(m[4])
  }).join('\n')
}

function nextMissingRequiredPrefixNumber(text, requiredCount) {
  if (!Number.isFinite(requiredCount) || requiredCount <= 0) return null

  const lines = String(text || "").replaceAll("\r", "").split("\n")
  const completed = new Set()

  for (const line of lines) {
    const m = /^\s*h(\d+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue

    const hNum = parseInt(m[1], 10)
    if (!Number.isFinite(hNum) || hNum < 1 || hNum > requiredCount) continue
    if (/\S/.test(m[2] || "")) completed.add(hNum)
  }

  for (let i = 1; i <= requiredCount; i += 1) {
    if (!completed.has(i)) return i
  }

  return null
}

export default class extends Controller {
  static targets = [
    "clockInInput",
    "clockOutInput",
    "elapsedText",
    "nextDueText",
    "progressFill",
    "alertText",
    "ratioText",
    "notesInput",
    "notesBackdrop",
    "nextRequiredHint"
  ]

  static values = {
    notesUrl: String
  }

  connect() {
    this.boundChromeClearRequest = this.handleChromeClearRequest.bind(this)
    window.addEventListener("nexus:work-timer-clear-request", this.boundChromeClearRequest)
    this.state = this.loadState()

    // If localStorage has no notes but the server rendered some (via @notes_text in ERB), adopt them.
    const serverNotes = this.notesInputTarget.value
    if (!this.state.notesText && serverNotes) {
      this.state.notesText = serverNotes
    }

    this.renderAll()
    this.startTicker()
  }

  disconnect() {
    this.stopTicker()
    window.removeEventListener("nexus:work-timer-clear-request", this.boundChromeClearRequest)
    this.publishChromeClearVisibility(false)
  }

  clockInNow() {
    const now = Date.now()
    const d = new Date(now)
    this.state.clockInMinutes = d.getHours() * 60 + d.getMinutes()
    this.state.clockInAtMs = now
    this.state.clockOutAtMs = null
    this.state.clockOutMinutes = null
    this.state.running = true
    this.saveState()
    this.renderAll()
  }

  clockOutNow() {
    if (!this.state.running) return
    const now = Date.now()
    const d = new Date(now)
    this.state.clockOutAtMs = now
    this.state.clockOutMinutes = d.getHours() * 60 + d.getMinutes()
    this.state.running = false
    this.saveState()
    this.renderAll()
  }

  updateClockInManual(event) {
    const v = String(event.target.value || "").trim()
    if (v === "" || v === "--:--") {
      this.state.clockInMinutes = null
      this.state.clockInAtMs = null
      this.state.clockOutAtMs = null
      this.state.clockOutMinutes = null
      this.state.running = false
      this.saveState()
      this.renderAll()
      return
    }

    const mins = parseTimeStringToMinutes(v)
    if (mins === null) return
    this.state.clockInMinutes = mins
    this.state.clockInAtMs = null
    this.state.clockOutAtMs = null
    this.state.clockOutMinutes = null
    this.state.running = true
    this.saveState()
    this.renderAll()
  }

  applyClockInOnEnter(event) {
    if (event.key !== "Enter") return
    event.preventDefault()
    this.updateClockInManual(event)
    event.target.blur()
  }

  updateClockOutManual(event) {
    const v = String(event.target.value || "").trim()
    if (v === "" || v === "--:--") {
      this.state.clockOutMinutes = null
      this.state.clockOutAtMs = null
      this.state.running = this.state.clockInMinutes != null
      this.saveState()
      this.renderAll()
      return
    }
    const mins = parseTimeStringToMinutes(v)
    if (mins === null) return
    this.state.clockOutMinutes = mins
    this.state.clockOutAtMs = null
    this.state.running = false
    this.saveState()
    this.renderAll()
  }

  applyClockOutOnEnter(event) {
    if (event.key !== "Enter") return
    event.preventDefault()
    this.updateClockOutManual(event)
    event.target.blur()
  }

  updateNotes() {
    const text = this.notesInputTarget.value
    this.state.notesText = text
    this.saveState()
    this.updateStatus()
    this.renderBackdrop(text)
    this.scheduleServerSave(text)
  }

  handleNotesKeydown(event) {
    if (event.isComposing) return
    if (event.key !== "Enter") return
    if (!(event.metaKey || event.ctrlKey)) return

    event.preventDefault()
    const required = this.requiredSentenceCount()
    const missingPrefix = nextMissingRequiredPrefixNumber(this.state.notesText, required)
    const targetPrefix = missingPrefix ?? Math.max(1, required + 1)
    this.focusOrInsertPrefixLine(targetPrefix)
  }

  focusOrInsertPrefixLine(prefixNumber) {
    const input = this.notesInputTarget
    const text = String(input.value || "")
    const existing = new RegExp(`^\\s*h${prefixNumber}\\s*:.*$`, "im").exec(text)

    if (existing) {
      const lineStart = existing.index
      const lineEnd = text.indexOf("\n", lineStart)
      const caret = lineEnd === -1 ? text.length : lineEnd
      input.focus()
      input.setSelectionRange(caret, caret)
      return
    }

    const needsNewline = text.length > 0 && !text.endsWith("\n")
    const insert = `${needsNewline ? "\n" : ""}H${prefixNumber}: `
    const newText = text + insert

    input.value = newText
    input.focus()
    input.setSelectionRange(newText.length, newText.length)
    this.updateNotes()
  }

  syncBackdropScroll() {
    if (!this.hasNotesBackdropTarget) return
    this.notesBackdropTarget.scrollTop = this.notesInputTarget.scrollTop
    this.notesBackdropTarget.scrollLeft = this.notesInputTarget.scrollLeft
  }

  renderBackdrop(text) {
    if (!this.hasNotesBackdropTarget) return
    const required = this.requiredSentenceCount()
    this.notesBackdropTarget.innerHTML = buildNotesHtml(text ?? this.notesInputTarget.value, required)
    this.syncBackdropScroll()
  }

  scheduleServerSave(text) {
    if (this.serverSaveTimer) clearTimeout(this.serverSaveTimer)
    this.serverSaveTimer = setTimeout(() => this.saveNotesToServer(text), 600)
  }

  async saveNotesToServer(text) {
    if (!this.notesUrlValue) return
    try {
      const csrfToken = document.querySelector("meta[name='csrf-token']")?.content
      await fetch(this.notesUrlValue, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken || "",
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json"
        },
        body: JSON.stringify({ notes_text: text }),
        credentials: "same-origin"
      })
    } catch (_e) {
      // non-blocking
    }
  }

  renderAll() {
    this.clockInInputTarget.value = this.state.clockInMinutes != null
      ? minutesToTimeString(this.state.clockInMinutes)
      : "--:--"
    this.clockOutInputTarget.value = this.state.clockOutMinutes != null
      ? minutesToTimeString(this.state.clockOutMinutes)
      : "--:--"
    // Only set textarea value on initial render — do not overwrite user edits in progress.
    // The server-loaded value is rendered by ERB; localStorage state takes priority thereafter.
    if (this.notesInputTarget.value !== this.state.notesText) {
      this.notesInputTarget.value = this.state.notesText
    }
    this.renderBackdrop(this.state.notesText)
    const showSessionActions = this.hasCompletedClockOutState()
    this.publishChromeClearVisibility(showSessionActions)
    this.renderElapsed()
    this.updateStatus()
  }

  hasCompletedClockOutState() {
    return !this.state.running && this.state.clockInMinutes != null && this.state.clockOutMinutes != null
  }

  handleChromeClearRequest(event) {
    const requestedFrameId = event.detail?.frameId
    if (requestedFrameId && requestedFrameId !== this.currentFrameId()) return
    this.clearSessionData()
  }

  currentFrameId() {
    const frame = this.element.closest("turbo-frame")
    return frame?.id || "work-timer-pane"
  }

  publishChromeClearVisibility(show) {
    window.dispatchEvent(new CustomEvent("nexus:work-timer-clear-state", {
      detail: {
        frameId: this.currentFrameId(),
        show: Boolean(show)
      }
    }))
  }

  elapsedMs() {
    if (this.state.clockInMinutes == null) return 0

    const start = Number(this.state.clockInAtMs)
    if (Number.isFinite(start) && start > 0) {
      if (this.state.running) {
        return Math.max(0, Date.now() - start)
      }
      const end = Number(this.state.clockOutAtMs)
      if (Number.isFinite(end) && end > start) return Math.max(0, end - start)
      // clockOutAtMs was cleared by manual edit — fall through to minute-based
    }

    // Minute-based: manual clock-out entered
    if (this.state.clockOutMinutes != null && !this.state.running) {
      let diff = (this.state.clockOutMinutes - this.state.clockInMinutes) * 60000
      if (diff < 0) diff += 24 * 60 * 60000
      return Math.max(0, diff)
    }

    return elapsedFromClockInMinutes(this.state.clockInMinutes)
  }

  renderElapsed() {
    const elapsedMs = this.elapsedMs()
    this.elapsedTextTarget.textContent = formatElapsed(elapsedMs)
  }

  validSentenceCount(requiredCount) {
    return validSentenceCountFromNotes(this.state.notesText, requiredCount)
  }

  requiredSentenceCount() {
    const elapsedMs = this.elapsedMs()
    return Math.floor(elapsedMs / HOUR_MS)
  }

  nextDueMs(written, elapsedMs) {
    const required = Math.floor(elapsedMs / HOUR_MS)
    if (written < required) return 0

    const nextHourThreshold = (Math.max(required, written) + 1) * HOUR_MS
    return Math.max(0, nextHourThreshold - elapsedMs)
  }

  updateStatus() {
    const elapsedMs = this.elapsedMs()
    const required = Math.floor(elapsedMs / HOUR_MS)
    const written = this.validSentenceCount(required)
    const missing = Math.max(0, required - written)
    const nextDue = this.nextDueMs(written, elapsedMs)

    this.ratioTextTarget.textContent = `${written}/${required}`
    this.nextDueTextTarget.textContent =
      missing > 0 ? "Next required entry: overdue now" : `Next required entry in ${formatElapsed(nextDue)}`

    const creditedHours = Math.max(written, required)
    const cycleStart = creditedHours * HOUR_MS
    const cycleProgress = missing > 0 ? 1 : Math.max(0, Math.min(1, (elapsedMs - cycleStart) / HOUR_MS))
    this.progressFillTarget.style.width = `${Math.round(cycleProgress * 100)}%`
    this.progressFillTarget.classList.toggle("is-danger", missing > 0)
    this.ratioTextTarget.classList.toggle("is-danger", missing > 0)

    if (missing > 0) {
      this.alertTextTarget.textContent = `Missing ${missing} entr${missing === 1 ? "y" : "ies"} for current hours.`
      this.alertTextTarget.classList.add("is-visible")
      this.alertTextTarget.classList.remove("is-good")
    } else {
      this.alertTextTarget.textContent = "All caught up!"
      this.alertTextTarget.classList.remove("is-visible")
      this.alertTextTarget.classList.add("is-good")
    }

    if (this.hasNextRequiredHintTarget) {
      const missingPrefix = nextMissingRequiredPrefixNumber(this.state.notesText, required)
      this.nextRequiredHintTarget.textContent = missingPrefix
        ? `Required now: H${missingPrefix}:`
        : ""
    }

    // Re-render backdrop so prefix colors update as hours tick over.
    this.renderBackdrop(this.state.notesText)
  }

  startTicker() {
    this.stopTicker()
    this.ticker = window.setInterval(() => {
      this.renderElapsed()
      this.updateStatus()
    }, 1000)
  }

  stopTicker() {
    if (!this.ticker) return
    window.clearInterval(this.ticker)
    this.ticker = null
  }

  loadState() {
    const fallbackClockIn = (() => {
      const now = new Date()
      return now.getHours() * 60 + now.getMinutes()
    })()

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return {
          clockInMinutes: fallbackClockIn,
          clockInAtMs: Date.now(),
          clockOutAtMs: null,
          clockOutMinutes: null,
          running: true,
          notesText: ""
        }
      }

      const parsed = JSON.parse(raw)
      const clockInMinutes = parsed?.clockInMinutes == null
        ? null
        : Number.isInteger(parsed?.clockInMinutes)
          ? Math.max(0, Math.min(23 * 60 + 59, parsed.clockInMinutes))
          : fallbackClockIn
      const clockInAtMs = Number.isFinite(parsed?.clockInAtMs)
        ? Number(parsed.clockInAtMs)
        : startTimestampFromClockInMinutes(clockInMinutes)
      const clockOutAtMs = Number.isFinite(parsed?.clockOutAtMs) ? Number(parsed.clockOutAtMs) : null
      const clockOutMinutes = Number.isInteger(parsed?.clockOutMinutes) ? parsed.clockOutMinutes : null
      const running = clockInMinutes == null ? false : parsed?.running === false ? false : true
      const notesText = String(parsed?.notesText || "")

      return {
        clockInMinutes,
        clockInAtMs,
        clockOutAtMs,
        clockOutMinutes,
        running,
        notesText
      }
    } catch (_e) {
      return {
        clockInMinutes: fallbackClockIn,
        clockInAtMs: Date.now(),
        clockOutAtMs: null,
        clockOutMinutes: null,
        running: true,
        notesText: ""
      }
    }
  }

  saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (_e) {
      // non-blocking
    }
  }

  clearSessionData() {
    this.state.clockInMinutes = null
    this.state.clockInAtMs = null
    this.state.clockOutAtMs = null
    this.state.clockOutMinutes = null
    this.state.running = false
    this.state.notesText = ""
    this.saveState()
    this.renderAll()
  }

}
