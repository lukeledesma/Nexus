import { Controller } from "@hotwired/stimulus"
import {
  clearLinkedAppPickerDraft,
  LINKED_APP_BEFORE_SAVE_PICKER,
  writeLinkedAppPickerDraft
} from "lib/linked_app_picker_draft"

const STORAGE_KEY = "nexus.workTimer.v1"
const HOUR_MS = 3600000
const ENTRY_DATE_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

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

/** Collapses 2+ trailing newlines from time card notes (phantom blank lines after refresh). */
function normalizeTrailingTimeCardNotesNewlines(text) {
  return String(text || "").replace(/\r/g, "").replace(/\n{2,}$/, "")
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
}

function validSentenceCountFromNotes(text, requiredCount = Infinity) {
  const lines = String(text || "").replaceAll("\r", "").split("\n")
  const dashPrefix = /^(\s*)-\s*(.*)$/
  const timeRangePrefix = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/
  let count = 0
  let inTimeBlock = false

  for (const raw of lines) {
    const trimmed = raw.replace(/\s+$/g, "").trim()
    if (!trimmed) continue

    // Check if this is a time range header
    if (timeRangePrefix.test(trimmed)) {
      inTimeBlock = true
      continue
    }

    // Count dash-prefixed entries
    if (inTimeBlock) {
      const dashMatch = dashPrefix.exec(trimmed)
      if (dashMatch) {
        const body = String(dashMatch[2] || "").trim()
        if (/\S/.test(body)) count += 1
        continue
      }
    }

    // Legacy H-prefix format
    const countingHeaderPrefix = /^\s*h(\d+)\s*:/i
    const m = countingHeaderPrefix.exec(trimmed)
    if (m) {
      const hNum = parseInt(m[1], 10)
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

// Parses "HH:MM-HH:MM" or "HH:MM - HH:MM" at the start of a line.
// Returns { startMin, endMin, durationMin, raw } or null.
function parseTimeRangePrefix(line) {
  const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(line.trim())
  if (!m) return null
  const startMin = parseTimeStringToMinutes(m[1])
  const endMin = parseTimeStringToMinutes(m[2])
  if (startMin === null || endMin === null) return null
  let durationMin = endMin - startMin
  if (durationMin < 0) durationMin += 24 * 60
  return { startMin, endMin, durationMin, raw: m[0] }
}

// Scans all lines for time-range entries and returns structured data.
// Entries are dash-prefixed lines following a time range.
// Handles both closed (HH:MM-HH:MM) and open (HH:MM-) ranges.
function parseEntriesFromNotes(text) {
  const entries = []
  const lines = String(text || "").replaceAll("\r", "").split("\n")
  let currentRange = null
  let currentEntryCount = 0
  let rangeIdCounter = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Check if this is a closed time range: HH:MM-HH:MM
    const closedMatch = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(.*)$/.exec(trimmed)
    if (closedMatch) {
      // Save previous range if exists
      if (currentRange) {
        currentRange.completedCount = currentEntryCount
        entries.push(currentRange)
      }
      // Start new closed range
      const startMin = parseTimeStringToMinutes(closedMatch[1])
      const endMin = parseTimeStringToMinutes(closedMatch[2])
      if (startMin !== null && endMin !== null) {
        let durationMin = endMin - startMin
        if (durationMin < 0) durationMin += 24 * 60
        const description = closedMatch[3].replace(/^\s*[-–:]\s*/, "").trim()
        const requiredCount = Math.ceil(durationMin / 60)
        currentRange = {
          id: String(rangeIdCounter++),
          startMin,
          endMin,
          durationMin,
          description,
          customerLabel: description,
          requiredCount,
          completedCount: 0,
          isOpen: false
        }
        currentEntryCount = 0
      }
      continue
    }

    // Check if this is an open time range: HH:MM-
    const openMatch = /^(\d{1,2}:\d{2})\s*[-–]\s*(?!\d)(.*)$/.exec(trimmed)
    if (openMatch) {
      // Save previous range if exists
      if (currentRange) {
        currentRange.completedCount = currentEntryCount
        entries.push(currentRange)
      }
      // Start new open range
      const startMin = parseTimeStringToMinutes(openMatch[1])
      if (startMin !== null) {
        const description = openMatch[2].replace(/^\s*[-–:]\s*/, "").trim()
        currentRange = {
          id: String(rangeIdCounter++),
          startMin,
          endMin: null,
          durationMin: null,
          description,
          customerLabel: description,
          requiredCount: null,
          completedCount: 0,
          isOpen: true
        }
        currentEntryCount = 0
      }
      continue
    }

    // Check if this is a dash-prefixed entry
    if (trimmed.startsWith("-")) {
      if (currentRange) {
        const body = trimmed.replace(/^\s*-\s*/, "")
        if (/\S/.test(body)) currentEntryCount++
      }
      continue
    }

    // First non-dash child line under a range is treated as the customer label.
    if (currentRange && !currentRange.customerLabel) {
      currentRange.customerLabel = trimmed
    }
  }

  // Save last range
  if (currentRange) {
    currentRange.completedCount = currentEntryCount
    entries.push(currentRange)
  }

  return entries
}

function formatDuration(minutes) {
  if (minutes <= 0) return "0m"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function elapsedMsSinceMinuteOfDay(startMin) {
  if (!Number.isInteger(startMin)) return 0

  const now = new Date()
  const start = new Date(now)
  start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1)
  }

  return Math.max(0, now.getTime() - start.getTime())
}

function formatChromeWorkedDuration(ms, includeSeconds = false) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (includeSeconds) return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  return `${pad2(hours)}:${pad2(minutes)}`
}

function summarizeWorkedHoursFromNotes(text) {
  const entries = parseEntriesFromNotes(text)
  if (!entries.length) {
    return { hasValue: false, label: "", isOpen: false }
  }

  let totalMs = 0
  for (const entry of entries) {
    if (entry.isOpen) {
      totalMs += elapsedMsSinceMinuteOfDay(entry.startMin)
      continue
    }
    if (Number.isFinite(entry.durationMin)) {
      totalMs += Number(entry.durationMin) * 60000
    }
  }

  const lastEntry = entries[entries.length - 1]
  const isOpen = Boolean(lastEntry?.isOpen)
  return {
    hasValue: true,
    label: formatChromeWorkedDuration(totalMs, isOpen),
    isOpen
  }
}

// Extracts start time (first time range start) and end time (last time range end) from notes.
// Returns { startMin, endMin, isOngoing } where isOngoing is true if last range is open (HH:MM- format).
// Returns { startMin: null, endMin: null, isOngoing: false } if no ranges found.
function extractTimeSpanFromNotes(text) {
  const lines = String(text || "").replaceAll("\r", "").split("\n")
  let firstStartMin = null
  let lastEndMin = null
  let isOngoing = false

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    
    // Check for closed range: HH:MM-HH:MM
    const closedMatch = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/.exec(trimmed)
    if (closedMatch) {
      const startMin = parseTimeStringToMinutes(closedMatch[1])
      const endMin = parseTimeStringToMinutes(closedMatch[2])
      if (startMin !== null && endMin !== null) {
        if (firstStartMin === null) firstStartMin = startMin
        lastEndMin = endMin
        isOngoing = false
      }
      continue
    }

    // Check for open range: HH:MM- (no end time)
    const openMatch = /^(\d{1,2}:\d{2})\s*[-–]\s*(?!\d)/.exec(trimmed)
    if (openMatch) {
      const startMin = parseTimeStringToMinutes(openMatch[1])
      if (startMin !== null) {
        if (firstStartMin === null) firstStartMin = startMin
        lastEndMin = null // Open range has no end
        isOngoing = true
      }
    }
  }

  return {
    startMin: firstStartMin,
    endMin: lastEndMin,
    isOngoing
  }
}

function buildNotesHtml(text) {
  if (!text) return ''
  const lines = text.split('\n')
  const result = []
  const dashPrefix = /^(\s*)(-)\s*(.*?)$/
  const closedTimeRangePrefix = /^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})(.*)$/
  const openTimeRangePrefix = /^(\d{1,2}:\d{2}\s*[-–])(.*)$/

  // Build maps of time-range lines to completion count, projected label text, and whether they're open.
  const timeRangeCompletionMap = new Map()
  const timeRangeLabelMap = new Map()
  const timeRangeIdMap = new Map()
  const timeRangeIsOpenMap = new Map()
  let timeRangeIdCounter = 0
  let lastTimeRangeIndex = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    const closedMatch = closedTimeRangePrefix.test(trimmed)
    const openMatch = /^(\d{1,2}:\d{2})\s*[-–]\s*(?!\d)/.test(trimmed)
    
    if (closedMatch) {
      lastTimeRangeIndex = i
      timeRangeCompletionMap.set(i, 0)
      timeRangeLabelMap.set(i, "")
      timeRangeIdMap.set(i, String(timeRangeIdCounter++))
      timeRangeIsOpenMap.set(i, false)
    } else if (openMatch) {
      lastTimeRangeIndex = i
      timeRangeCompletionMap.set(i, 0)
      timeRangeLabelMap.set(i, "")
      timeRangeIdMap.set(i, String(timeRangeIdCounter++))
      timeRangeIsOpenMap.set(i, true)
    } else if (lastTimeRangeIndex >= 0 && dashPrefix.test(trimmed)) {
      const dashMatch = dashPrefix.exec(trimmed)
      const body = String(dashMatch[3] || "").trim()
      if (/\S/.test(body)) {
        timeRangeCompletionMap.set(lastTimeRangeIndex, (timeRangeCompletionMap.get(lastTimeRangeIndex) || 0) + 1)
      }
    } else if (lastTimeRangeIndex >= 0 && trimmed) {
      const existing = timeRangeLabelMap.get(lastTimeRangeIndex) || ""
      if (!existing) {
        timeRangeLabelMap.set(lastTimeRangeIndex, trimmed)
      }
    }
  }

  // Render each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Empty indented line directly after a time range => ghost customer hint.
    if (/^\s+$/.test(line)) {
      let prevIndex = i - 1
      while (prevIndex >= 0 && lines[prevIndex].trim() === "") prevIndex -= 1
      const prevTrimmed = prevIndex >= 0 ? lines[prevIndex].trim() : ""
      if (closedTimeRangePrefix.test(prevTrimmed) || /^(\d{1,2}:\d{2})\s*[-–]\s*(?!\d)/.test(prevTrimmed)) {
        result.push(`${escapeHtml(line)}<span class="time-card-app__ghost-text">Customer</span>`)
        continue
      }
    }

    // Closed time-range line: color-code based on completion
    const closedMatch = closedTimeRangePrefix.exec(trimmed)
    if (closedMatch) {
      const range = parseTimeRangePrefix(trimmed)
      if (range) {
        const completedCount = timeRangeCompletionMap.get(i) || 0
        const rangeRequiredCount = Math.ceil(range.durationMin / 60)
        let cls = 'time-card-app__notes-prefix time-card-app__notes-prefix--time-range '
        if (completedCount >= rangeRequiredCount) {
          cls += 'time-card-app__notes-prefix--done'
        } else if (completedCount > 0) {
          cls += 'time-card-app__notes-prefix--pending'
        } else {
          cls += 'time-card-app__notes-prefix--missing'
        }
        const sameLineSuffix = closedMatch[2]
        const projectedLabel = (timeRangeLabelMap.get(i) || "").trim()
        const projected = !/\S/.test(sameLineSuffix) && projectedLabel
          ? `<span class="time-card-app__time-range-label">${escapeHtml(projectedLabel)}</span>`
          : ""
        const rangeId = timeRangeIdMap.get(i)
        const rangeIdAttr = rangeId ? ` data-range-id="${escapeHtml(rangeId)}"` : ""
        result.push(`<span class="${cls}"${rangeIdAttr}>${escapeHtml(closedMatch[1])}</span>${projected}${escapeHtml(sameLineSuffix)}`)
        continue
      }
    }

    // Open time-range line: always purple
    const openMatch = openTimeRangePrefix.exec(trimmed)
    if (openMatch) {
      let cls = 'time-card-app__notes-prefix time-card-app__notes-prefix--time-range time-card-app__notes-prefix--ongoing'
      const rangeId = timeRangeIdMap.get(i)
      const rangeIdAttr = rangeId ? ` data-range-id="${escapeHtml(rangeId)}"` : ""
      const sameLineSuffix = openMatch[2]
      const projectedLabel = (timeRangeLabelMap.get(i) || "").trim()
      const projected = !/\S/.test(sameLineSuffix) && projectedLabel
        ? `<span class="time-card-app__time-range-label">${escapeHtml(projectedLabel)}</span>`
        : ""
      result.push(`<span class="${cls}"${rangeIdAttr}>${escapeHtml(openMatch[1])}</span>${projected}${escapeHtml(sameLineSuffix)}`)
      continue
    }

    // Dash-prefixed entry: style the dash
    const dashMatch = dashPrefix.exec(trimmed)
    if (dashMatch) {
      const before = line.slice(0, line.indexOf('-'))
      const after = line.slice(line.indexOf('-') + 1)
      if (/^\s*$/.test(after)) {
        result.push(`${escapeHtml(before)}<span class="time-card-app__entry-dash">-</span> <span class="time-card-app__ghost-text">Entry</span>`)
      } else {
        result.push(`${escapeHtml(before)}<span class="time-card-app__entry-dash">-</span>${escapeHtml(after)}`)
      }
      continue
    }

    // Regular line
    result.push(escapeHtml(line))
  }

  return result.join('\n')
}

function serializeTimeCardDocument(state) {
  const notes = String(state.notesText || "")
  const startTime = Number.isInteger(state.clockInMinutes) ? minutesToTimeString(state.clockInMinutes) : ""
  const endTime = Number.isInteger(state.clockOutMinutes) ? minutesToTimeString(state.clockOutMinutes) : ""
  const clockInAtMs = Number.isFinite(Number(state.clockInAtMs)) && Number(state.clockInAtMs) > 0 ? String(Number(state.clockInAtMs)) : ""
  const clockOutAtMs = Number.isFinite(Number(state.clockOutAtMs)) && Number(state.clockOutAtMs) > 0 ? String(Number(state.clockOutAtMs)) : ""
  const entryDate = normalizeEntryDate(state.entryDate, "")

  return [
    "# NEXUS_FILE v1",
    "# kind: time_card",
    "# title: Time Card",
    `# entry_date: ${entryDate}`,
    `# start_time: ${startTime}`,
    `# end_time: ${endTime}`,
    `# running: ${state.running === true}`,
    `# clock_in_at_ms: ${clockInAtMs}`,
    `# clock_out_at_ms: ${clockOutAtMs}`,
    "",
    notes
  ].join("\n")
}

function buildDefaultState() {
  return {
    entryDate: todayIsoDateString(),
    clockInMinutes: null,
    clockInAtMs: null,
    clockOutAtMs: null,
    clockOutMinutes: null,
    running: false,
    notesText: ""
  }
}

function normalizeState(raw, fallbackClockIn = null, defaultRunning = false) {
  const base = {
    entryDate: todayIsoDateString(),
    clockInMinutes: fallbackClockIn,
    clockInAtMs: defaultRunning && fallbackClockIn != null ? Date.now() : null,
    clockOutAtMs: null,
    clockOutMinutes: null,
    running: defaultRunning,
    notesText: ""
  }
  const parsed = raw && typeof raw === "object" ? raw : {}
  const clockInMinutes = parsed?.clockInMinutes == null
    ? base.clockInMinutes
    : Number.isInteger(parsed?.clockInMinutes)
      ? Math.max(0, Math.min(23 * 60 + 59, parsed.clockInMinutes))
      : base.clockInMinutes
  const clockInAtMs = Number.isFinite(parsed?.clockInAtMs)
    ? Number(parsed.clockInAtMs)
    : (clockInMinutes != null && base.running ? startTimestampFromClockInMinutes(clockInMinutes) : base.clockInAtMs)
  const clockOutAtMs = Number.isFinite(parsed?.clockOutAtMs) ? Number(parsed.clockOutAtMs) : null
  const clockOutMinutes = Number.isInteger(parsed?.clockOutMinutes) ? parsed.clockOutMinutes : null
  const running = clockInMinutes == null ? false : parsed?.running === false ? false : Boolean(parsed?.running ?? base.running)
  const notesText = normalizeTrailingTimeCardNotesNewlines(parsed?.notesText ?? base.notesText)
  const entryDate = normalizeEntryDate(parsed?.entryDate, base.entryDate)

  return {
    entryDate,
    clockInMinutes,
    clockInAtMs,
    clockOutAtMs,
    clockOutMinutes,
    running,
    notesText
  }
}

async function playOverdueAlertTone(controller) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return

  controller.audioCtx ||= new AudioContextClass()
  if (controller.audioCtx.state === "suspended") {
    try {
      await controller.audioCtx.resume()
    } catch (_e) {
      return
    }
  }

  const now = controller.audioCtx.currentTime
  const oscillator = controller.audioCtx.createOscillator()
  const gain = controller.audioCtx.createGain()

  oscillator.type = "sine"
  oscillator.frequency.setValueAtTime(659.25, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

  oscillator.connect(gain)
  gain.connect(controller.audioCtx.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.18)
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
    "serializedContent",
    "timelineBar",
    "dateBadge",
    "datePopover",
    "datePopoverMonthLabel",
    "datePopoverWeekdays",
    "datePopoverGrid"
  ]

  static values = {
    linkedDocumentId: Number,
    initialState: Object
  }

  connect() {
    this.boundChromeClearRequest = this.handleChromeClearRequest.bind(this)
    this.boundChromeDatePickerRequest = this.handleChromeDatePickerRequest.bind(this)
    this.boundBeforeSavePicker = this.handleBeforeSavePicker.bind(this)
    this.boundAutosaveBeforeSubmit = this.handleAutosaveBeforeSubmit.bind(this)
    this.boundDocumentPointerDown = this.handleDocumentPointerDown.bind(this)
    this.boundDocumentKeydown = this.handleDocumentKeydown.bind(this)
    this.boundDatePopoverClick = this.handleDatePopoverClick.bind(this)
    this.boundRemoteDocumentChanged = this.handleRemoteDocumentChanged.bind(this)
    this.boundViewportChange = () => {
      if (!this.hasNotesInputTarget) return
      this.renderBackdrop(this.notesInputTarget.value)
      this.renderTimeline()
      this.positionDatePopover()
    }
    this.boundNotesScroll = () => this.syncBackdropScroll()
    this.boundBackdropScroll = () => {
      if (this.notesBackdropTarget.scrollTop !== 0) this.notesBackdropTarget.scrollTop = 0
      if (this.notesBackdropTarget.scrollLeft !== 0) this.notesBackdropTarget.scrollLeft = 0
    }
    window.addEventListener("nexus:time-card-clear-request", this.boundChromeClearRequest)
    window.addEventListener("nexus:time-card-open-date-picker", this.boundChromeDatePickerRequest)
    this.element.addEventListener("autosave:before-submit", this.boundAutosaveBeforeSubmit)
    window.addEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    window.addEventListener("resize", this.boundViewportChange)
    window.addEventListener("scroll", this.boundViewportChange, true)
    window.addEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
    this.backdropSyncFrame = null
    this.chromeHoursTicker = null
    this.currentHighlightedRangeId = null
    this.datePopoverOpen = false
    this.visibleEntryDateMonth = isoDateMonthString(todayIsoDateString())
    this.datePopoverPlaceholder = null
    this.datePopoverElement = this.hasDatePopoverTarget ? this.datePopoverTarget : null
    this.datePopoverMonthLabelElement = this.hasDatePopoverMonthLabelTarget ? this.datePopoverMonthLabelTarget : null
    this.datePopoverWeekdaysElement = this.hasDatePopoverWeekdaysTarget ? this.datePopoverWeekdaysTarget : null
    this.datePopoverGridElement = this.hasDatePopoverGridTarget ? this.datePopoverGridTarget : null
    this.state = this.isLinkedDocumentMode()
      ? normalizeState(this.initialStateValue, null, false)
      : this.loadState()

    this.mountDatePopoverToBody()
    this.datePopoverElement?.addEventListener("click", this.boundDatePopoverClick)

    this.setupRangeHoverDelegation()
    this.renderAll()
    if (this.hasNotesInputTarget) {
      this.notesInputTarget.addEventListener("scroll", this.boundNotesScroll)
    }
    if (this.hasNotesBackdropTarget) {
      this.notesBackdropTarget.addEventListener("scroll", this.boundBackdropScroll)
    }
  }

  disconnect() {
    this.stopChromeHoursTicker()
    window.removeEventListener("nexus:time-card-clear-request", this.boundChromeClearRequest)
    window.removeEventListener("nexus:time-card-open-date-picker", this.boundChromeDatePickerRequest)
    this.element.removeEventListener("autosave:before-submit", this.boundAutosaveBeforeSubmit)
    window.removeEventListener(LINKED_APP_BEFORE_SAVE_PICKER, this.boundBeforeSavePicker)
    window.removeEventListener("resize", this.boundViewportChange)
    window.removeEventListener("scroll", this.boundViewportChange, true)
    window.removeEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown, true)
    document.removeEventListener("keydown", this.boundDocumentKeydown, true)
    this.element?.removeEventListener("mouseenter", this.boundRangeMouseEnter, true)
    this.element?.removeEventListener("mouseleave", this.boundRangeMouseLeave, true)
    if (this.backdropSyncFrame) {
      window.cancelAnimationFrame(this.backdropSyncFrame)
      this.backdropSyncFrame = null
    }
    if (this.hasNotesInputTarget) {
      this.notesInputTarget.removeEventListener("scroll", this.boundNotesScroll)
    }
    if (this.hasNotesBackdropTarget) {
      this.notesBackdropTarget.removeEventListener("scroll", this.boundBackdropScroll)
    }
    this.datePopoverElement?.removeEventListener("click", this.boundDatePopoverClick)
    this.unmountDatePopoverFromBody()
  }

  setupRangeHoverDelegation() {
    if (!this.boundRangeMouseEnter) {
      this.boundRangeMouseEnter = (e) => this.handleRangeMouseEnter(e)
      this.boundRangeMouseLeave = (e) => this.handleRangeMouseLeave(e)
    }
    this.element.addEventListener("mouseenter", this.boundRangeMouseEnter, true)
    this.element.addEventListener("mouseleave", this.boundRangeMouseLeave, true)
  }

  handleRangeMouseEnter(event) {
    const segment = event.target.closest(".time-card-timeline__segment[data-range-id]")
    if (segment) {
      const rangeId = segment.getAttribute("data-range-id")
      if (rangeId) this.highlightRange(rangeId, true)
    }
  }

  handleRangeMouseLeave(event) {
    const segment = event.target.closest(".time-card-timeline__segment[data-range-id]")
    if (segment) {
      const rangeId = segment.getAttribute("data-range-id")
      if (rangeId) this.highlightRange(rangeId, false)
    }
  }

  isLinkedDocumentMode() {
    return this.hasLinkedDocumentIdValue && Number(this.linkedDocumentIdValue) > 0
  }

  handleBeforeSavePicker(event) {
    const frame = this.element.closest("turbo-frame")
    if (!frame || event.detail?.frameId !== frame.id) return

    this.updateSerializedContent()

    if (this.isLinkedDocumentMode()) {
      clearLinkedAppPickerDraft(frame.id)
      return
    }

    writeLinkedAppPickerDraft(frame.id, {
      app: "time_card",
      noteText: this.serializedContentTarget.value
    })
  }

  handleAutosaveBeforeSubmit(event) {
    // Ensure serialized content is up-to-date before autosave form submission
    this.saveState()
    this.updateSerializedContent()
  }

  handleRemoteDocumentChanged(event) {
    const detail = event?.detail || {}
    const incomingId = Number(detail.document_id)
    const linkedId = Number(this.linkedDocumentIdValue || 0)
    if (!Number.isInteger(incomingId) || incomingId <= 0) return
    if (!Number.isInteger(linkedId) || linkedId <= 0) return
    if (incomingId !== linkedId) return
    if (String(detail.content_type || "") !== "note") return

    // Avoid clobbering active local editing
    if (this.hasNotesInputTarget && document.activeElement === this.notesInputTarget) return

    // Parse the incoming content and update state
    const incoming = String(detail.content || "")
    const decoded = this.#parseTimeCardContent(incoming)
    if (!decoded) return

    // Only update if content actually changed
    const current = serializeTimeCardDocument(this.state)
    if (incoming === current) return

    this.state = decoded
    this.renderAll()
  }

  #parseTimeCardContent(content) {
    const lines = String(content || "").split(/\r?\n/)
    const parsed = {
      entryDate: todayIsoDateString(),
      clockInMinutes: null,
      clockInAtMs: null,
      clockOutAtMs: null,
      clockOutMinutes: null,
      running: false,
      notesText: ""
    }

    let headerEndIndex = lines.length
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.startsWith("#")) {
        headerEndIndex = i
        break
      }

      const match = /^#\s+(\w+):\s*(.*)$/.exec(line)
      if (!match) continue

      const key = match[1]
      const value = match[2].trim()

      switch (key) {
        case "entry_date":
          parsed.entryDate = normalizeEntryDate(value, parsed.entryDate)
          break
        case "start_time":
          parsed.clockInMinutes = value ? parseTimeStringToMinutes(value) : null
          break
        case "end_time":
          parsed.clockOutMinutes = value ? parseTimeStringToMinutes(value) : null
          break
        case "running":
          parsed.running = value === "true"
          break
        case "clock_in_at_ms":
          parsed.clockInAtMs = value ? Number(value) : null
          break
        case "clock_out_at_ms":
          parsed.clockOutAtMs = value ? Number(value) : null
          break
      }
    }

    while (headerEndIndex < lines.length && lines[headerEndIndex].trim() === "") {
      headerEndIndex++
    }

    const notesLines = lines.slice(headerEndIndex)
    parsed.notesText = normalizeTrailingTimeCardNotesNewlines(notesLines.join("\n"))

    return normalizeState(parsed, null, this.state.running)
  }

  updateNotes() {
    const text = this.notesInputTarget.value
    this.state.notesText = text
    this.saveState()
    this.renderBackdrop(text)
    this.renderTimeline()
    this.updateChromeHoursBadge()
  }

  updateEntryDate(eventOrValue) {
    const proposedValue = typeof eventOrValue === "string"
      ? eventOrValue
      : eventOrValue?.target?.value
    const next = normalizeEntryDate(proposedValue, this.state.entryDate)
    if (next === this.state.entryDate) {
      this.renderEntryDate()
      return
    }
    this.state.entryDate = next
    this.saveState()
    this.renderEntryDate()
    this.requestDocumentAutosave()
    this.closeDatePopover()
  }

  showPreviousEntryDateMonth(event) {
    if (event) event.preventDefault()
    this.visibleEntryDateMonth = shiftIsoMonth(this.visibleEntryDateMonth, -1)
    this.renderDatePopoverCalendar()
  }

  showNextEntryDateMonth(event) {
    if (event) event.preventDefault()
    this.visibleEntryDateMonth = shiftIsoMonth(this.visibleEntryDateMonth, 1)
    this.renderDatePopoverCalendar()
  }

  handleNotesKeydown(event) {
    if (event.key !== "Enter") return
    if (event.defaultPrevented) return
    if (!this.hasNotesInputTarget) return

    const textarea = this.notesInputTarget
    const start = Number(textarea.selectionStart)
    const end = Number(textarea.selectionEnd)
    if (!Number.isInteger(start) || !Number.isInteger(end)) return

    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1
    const lineEndIndex = text.indexOf("\n", end)
    const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex
    const currentLine = text.slice(lineStart, lineEnd)

    // Enter on an empty dash entry should exit the block:
    // remove the placeholder entry line and place cursor on a clean line.
    if (/^\s*-\s*$/.test(currentLine)) {
      event.preventDefault()
      textarea.setRangeText("", lineStart, lineEnd, "start")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      return
    }

    // Option A flow:
    // 1) Time range line (closed or open) => next line starts as customer label (2-space indent)
    // 2) Customer label line => next line starts as dash entry
    // 3) Dash entry line => continue dash entry list
    let nextPrefix = ""
    const closedTimeRangeAtEnd = /^\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\s*$/.test(currentLine)
    const openTimeRangeAtEnd = /^\s*\d{1,2}:\d{2}\s*[-–]\s*$/.test(currentLine)
    if (closedTimeRangeAtEnd || openTimeRangeAtEnd) {
      nextPrefix = "  "
    } else if (/^\s{2,}(?!-)\S.*$/.test(currentLine)) {
      nextPrefix = "  - "
    } else {
      const entry = /^(\s*)-\s.*$/.exec(currentLine)
      if (entry) {
        nextPrefix = `${entry[1]}- `
      }
    }

    if (!nextPrefix) return

    event.preventDefault()
    const oldScrollTop = textarea.scrollTop
    const oldMaxScroll = textarea.scrollHeight - textarea.clientHeight

    textarea.setRangeText(`\n${nextPrefix}`, start, end, "end")

    // Reading scrollHeight forces a synchronous layout flush so the value is current.
    const newMaxScroll = textarea.scrollHeight - textarea.clientHeight
    const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 18
    if (oldScrollTop >= oldMaxScroll - lineHeight * 2) {
      textarea.scrollTop = newMaxScroll
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  }

  syncBackdropScroll() {
    if (!this.hasNotesBackdropTarget) return
    const textarea = this.notesInputTarget
    const backdrop = this.notesBackdropTarget
    const inner = backdrop.firstElementChild
    if (!inner) return
    // Keep backdrop itself pinned at zero — the inner wrapper moves via transform
    // so backdrop.scrollHeight is never read and stale-height bugs can't occur.
    backdrop.scrollTop = 0
    backdrop.scrollLeft = 0
    inner.style.transform =
      `translateY(${-textarea.scrollTop}px) translateX(${-textarea.scrollLeft}px)`
  }

  scheduleBackdropScrollSync() {
    if (this.backdropSyncFrame) {
      window.cancelAnimationFrame(this.backdropSyncFrame)
    }

    this.backdropSyncFrame = window.requestAnimationFrame(() => {
      this.backdropSyncFrame = null
      this.syncBackdropScroll()
    })
  }

  renderTimeline() {
    if (!this.hasTimelineBarTarget) return
    const TOTAL_MIN = 24 * 60
    const entries = parseEntriesFromNotes(this.state.notesText)
    const trackParts = []
    const labelParts = []

    // Background band for overall session
    if (this.state.clockInMinutes != null) {
      const sessionEnd = this.state.running
        ? (new Date().getHours() * 60 + new Date().getMinutes())
        : this.state.clockOutMinutes
      if (sessionEnd != null) {
        const left = (this.state.clockInMinutes / TOTAL_MIN) * 100
        let dur = sessionEnd - this.state.clockInMinutes
        if (dur < 0) dur += TOTAL_MIN
        const width = (dur / TOTAL_MIN) * 100
        trackParts.push(`<span class="time-card-timeline__band" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%"></span>`)
      }
    }

    // Entry segments with color classes matching time-range state
    for (const entry of entries) {
      const left = (entry.startMin / TOTAL_MIN) * 100
      const rangeIdAttr = entry.id ? ` data-range-id="${escapeHtml(entry.id)}"` : ""

      if (entry.isOpen) {
        // Open range: calculate width from start to current time, always purple
        const now = new Date()
        const currentMin = now.getHours() * 60 + now.getMinutes()
        const width = Math.max(1, ((currentMin - entry.startMin) / TOTAL_MIN) * 100)
        const customer = String(entry.customerLabel || "").trim()
        const label = `${minutesToTimeString(entry.startMin)}–(ongoing)${customer ? ' • ' + customer : ''}`
        trackParts.push(`<span class="time-card-timeline__segment time-card-timeline__segment--ongoing"${rangeIdAttr} style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeHtml(label)}"></span>`)
      } else {
        // Closed range: render with completion-based colors
        const width = (Math.max(1, entry.durationMin) / TOTAL_MIN) * 100
        const customer = String(entry.customerLabel || "").trim()
        const label = `${minutesToTimeString(entry.startMin)}–${minutesToTimeString(entry.endMin)}${customer ? ' • ' + customer : ''}`
        const rangeRequiredCount = Math.ceil(entry.durationMin / 60)
        let colorClass = "time-card-timeline__segment"
        if (entry.completedCount >= rangeRequiredCount) {
          colorClass += " time-card-timeline__segment--done"
        } else if (entry.completedCount > 0) {
          colorClass += " time-card-timeline__segment--pending"
        } else {
          colorClass += " time-card-timeline__segment--missing"
        }
        trackParts.push(`<span class="${colorClass}"${rangeIdAttr} style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeHtml(label)}"></span>`)
      }
    }

    // Tick marks and labels at 6h intervals
    const TICK_HOURS = [6, 12, 18]
    for (const h of TICK_HOURS) {
      const pct = (h / 24) * 100
      trackParts.push(`<span class="time-card-timeline__tick" style="left:${pct}%"></span>`)
      labelParts.push(`<span class="time-card-timeline__label" style="left:${pct}%">${pad2(h)}:00</span>`)
    }

    this.timelineBarTarget.innerHTML =
      `<div class="time-card-timeline__track">${trackParts.join('')}</div>` +
      `<div class="time-card-timeline__labels">${labelParts.join('')}</div>`
  }

  highlightRange(rangeId, active) {
    const value = String(rangeId)
    if (active) {
      this.currentHighlightedRangeId = value
    } else {
      this.currentHighlightedRangeId = null
    }
    const segments = this.element.querySelectorAll(`.time-card-timeline__segment[data-range-id="${value}"]`)
    const ranges = this.element.querySelectorAll(`.time-card-app__notes-prefix--time-range[data-range-id="${value}"]`)
    for (const el of segments) {
      el.classList.toggle("is-highlighted", active)
    }
    for (const el of ranges) {
      el.classList.toggle("is-highlighted", active)
    }
  }

  renderBackdrop(text) {
    if (!this.hasNotesBackdropTarget) return
    this.notesBackdropTarget.innerHTML =
      `<div>${buildNotesHtml(text ?? this.notesInputTarget.value)}</div>`
    if (this.currentHighlightedRangeId) {
      const ranges = this.element.querySelectorAll(`.time-card-app__notes-prefix--time-range[data-range-id="${this.currentHighlightedRangeId}"]`)
      for (const el of ranges) {
        el.classList.add("is-highlighted")
      }
    }
    this.syncBackdropScroll()
    this.scheduleBackdropScrollSync()
  }

  updateSerializedContent() {
    if (!this.hasSerializedContentTarget) return
    this.serializedContentTarget.value = serializeTimeCardDocument(this.state)
  }

  requestDocumentAutosave() {
    if (!this.isLinkedDocumentMode()) return
    const form = this.element.querySelector("form")
    if (!form) return
    form.dispatchEvent(new CustomEvent("autosave:trigger"))
  }

  renderAll() {
    // Only set textarea value on initial render — do not overwrite user edits in progress.
    // The server-loaded value is rendered by ERB; localStorage state takes priority thereafter.
    if (this.notesInputTarget.value !== this.state.notesText) {
      this.notesInputTarget.value = this.state.notesText
    }
    this.updateSerializedContent()
    this.renderEntryDate()
    this.renderBackdrop(this.state.notesText)
    this.renderTimeline()
    this.updateChromeHoursBadge()
  }

  renderEntryDate() {
    const normalized = normalizeEntryDate(this.state.entryDate, todayIsoDateString())
    this.state.entryDate = normalized
    this.visibleEntryDateMonth = isoDateMonthString(normalized)

    if (!this.hasDateBadgeTarget) return

    const labelDate = new Date(`${normalized}T00:00:00`)
    const validDate = Number.isFinite(labelDate.getTime()) ? labelDate : new Date()
    const label = validDate.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric"
    })
    this.dateBadgeTarget.textContent = `Entry date: ${label}`
  }

  updateChromeHoursBadge() {
    const summary = summarizeWorkedHoursFromNotes(this.state.notesText)
    window.dispatchEvent(new CustomEvent("nexus:time-card-chrome-hours", {
      detail: {
        frameId: this.currentFrameId(),
        label: summary.hasValue ? summary.label : "",
        isOpen: summary.isOpen
      }
    }))
    this.syncChromeHoursTicker(summary.isOpen)
  }

  syncChromeHoursTicker(shouldRun) {
    if (!shouldRun) {
      this.stopChromeHoursTicker()
      return
    }
    if (this.chromeHoursTicker) return

    this.chromeHoursTicker = window.setInterval(() => {
      this.renderTimeline()
      this.updateChromeHoursBadge()
    }, 1000)
  }

  stopChromeHoursTicker() {
    if (!this.chromeHoursTicker) return
    window.clearInterval(this.chromeHoursTicker)
    this.chromeHoursTicker = null
  }

  hasCompletedClockOutState() {
    return !this.state.running && this.state.clockInMinutes != null && this.state.clockOutMinutes != null
  }

  handleChromeClearRequest(event) {
    const requestedFrameId = event.detail?.frameId
    if (requestedFrameId && requestedFrameId !== this.currentFrameId()) return
    this.clearSessionData()
  }

  handleChromeDatePickerRequest(event) {
    const requestedFrameId = event.detail?.frameId
    if (requestedFrameId && requestedFrameId !== this.currentFrameId()) return
    this.toggleDatePopover()
  }

  toggleDatePopover() {
    if (this.datePopoverOpen) {
      this.closeDatePopover()
      return
    }
    this.openDatePopover()
  }

  openDatePopover() {
    if (!this.datePopoverElement) return
    this.mountDatePopoverToBody()
    this.visibleEntryDateMonth = isoDateMonthString(this.state.entryDate)
    this.datePopoverOpen = true
    this.datePopoverElement.hidden = false
    this.renderDatePopoverCalendar()
    this.positionDatePopover()
    document.addEventListener("pointerdown", this.boundDocumentPointerDown, true)
    document.addEventListener("keydown", this.boundDocumentKeydown, true)
  }

  closeDatePopover() {
    if (!this.datePopoverElement) return
    this.datePopoverOpen = false
    this.datePopoverElement.hidden = true
    document.removeEventListener("pointerdown", this.boundDocumentPointerDown, true)
    document.removeEventListener("keydown", this.boundDocumentKeydown, true)
  }

  mountDatePopoverToBody() {
    if (!this.datePopoverElement) return
    if (this.datePopoverElement.parentElement === document.body) return
    if (!this.datePopoverPlaceholder) {
      this.datePopoverPlaceholder = document.createComment("time-card-date-popover")
    }
    this.datePopoverElement.parentNode?.insertBefore(this.datePopoverPlaceholder, this.datePopoverElement)
    document.body.appendChild(this.datePopoverElement)
  }

  unmountDatePopoverFromBody() {
    if (!this.datePopoverElement) return
    if (!this.datePopoverPlaceholder?.parentNode) return
    this.datePopoverPlaceholder.parentNode.insertBefore(this.datePopoverElement, this.datePopoverPlaceholder)
    this.datePopoverPlaceholder.parentNode.removeChild(this.datePopoverPlaceholder)
    this.datePopoverPlaceholder = null
  }

  handleDocumentPointerDown(event) {
    if (!this.datePopoverOpen) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(".time-card-date-popover")) return
    const trigger = this.timeCardDateTriggerButton()
    if (trigger && (target === trigger || trigger.contains(target))) return
    this.closeDatePopover()
  }

  handleDocumentKeydown(event) {
    if (!this.datePopoverOpen) return
    if (event.key !== "Escape") return
    event.preventDefault()
    this.closeDatePopover()
  }

  handleDatePopoverClick(event) {
    const target = event.target instanceof Element ? event.target.closest("button") : null
    if (!target) return

    if (target.classList.contains("time-card-date-popover__nav-prev")) {
      event.preventDefault()
      this.showPreviousEntryDateMonth()
      return
    }

    if (target.classList.contains("time-card-date-popover__nav-next")) {
      event.preventDefault()
      this.showNextEntryDateMonth()
      return
    }

    const nextDate = target.dataset.entryDate
    if (nextDate) {
      event.preventDefault()
      this.updateEntryDate(nextDate)
    }
  }

  renderDatePopoverCalendar() {
    if (!this.datePopoverElement || !this.datePopoverGridElement || !this.datePopoverMonthLabelElement) return

    const selected = datePartsFromIso(this.state.entryDate)
    const visibleMonth = parseIsoMonth(this.visibleEntryDateMonth)
    if (!visibleMonth) return

    const today = datePartsFromIso(todayIsoDateString())
    const weeks = buildCalendarWeeks(visibleMonth.year, visibleMonth.month)

    this.datePopoverMonthLabelElement.textContent = formatMonthLabel(visibleMonth.year, visibleMonth.month)
    if (this.datePopoverWeekdaysElement) {
      this.datePopoverWeekdaysElement.innerHTML = ENTRY_DATE_WEEKDAYS
        .map((label) => `<span class="time-card-date-popover__weekday">${escapeHtml(label)}</span>`)
        .join("")
    }
    this.datePopoverGridElement.innerHTML = weeks.map((week) => week.map((cell) => {
      const iso = isoDateFromParts(cell.year, cell.month, cell.day)
      const classes = ["time-card-date-popover__day"]
      if (!cell.inCurrentMonth) classes.push("is-outside-month")
      if (selected && iso === isoDateFromParts(selected.year, selected.month, selected.day)) classes.push("is-selected")
      if (today && iso === isoDateFromParts(today.year, today.month, today.day)) classes.push("is-today")
      return `<button type="button" class="${classes.join(" ")}" data-entry-date="${iso}" data-action="click->time-card#selectEntryDateFromCalendar">${cell.day}</button>`
    }).join("")).join("")
  }

  selectEntryDateFromCalendar(event) {
    event.preventDefault()
    const next = event.currentTarget?.dataset?.entryDate
    if (!next) return
    this.updateEntryDate(next)
  }

  positionDatePopover() {
    if (!this.datePopoverOpen || !this.datePopoverElement) return
    const trigger = this.timeCardDateTriggerButton()
    if (!trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const popover = this.datePopoverElement
    popover.style.left = "0px"
    popover.style.top = "0px"

    const popoverRect = popover.getBoundingClientRect()
    const gap = 8
    const viewportPadding = 12
    let left = triggerRect.left + (triggerRect.width / 2) - (popoverRect.width / 2)
    let top = triggerRect.bottom + gap
    const maxLeft = window.innerWidth - popoverRect.width - viewportPadding
    left = Math.min(Math.max(viewportPadding, left), Math.max(viewportPadding, maxLeft))

    const maxTop = window.innerHeight - popoverRect.height - viewportPadding
    if (top > maxTop) {
      top = Math.max(viewportPadding, triggerRect.top - popoverRect.height - gap)
    }

    popover.style.left = `${Math.round(left)}px`
    popover.style.top = `${Math.round(top)}px`
  }

  timeCardDateTriggerButton() {
    const windowShell = this.element.closest("section.content-window")
    if (!windowShell) return null
    return windowShell.querySelector(".content-window-time-card-date")
  }

  currentFrameId() {
    const frame = this.element.closest("turbo-frame")
    return frame?.id || "time-card-pane"
  }


  loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return normalizeState(buildDefaultState(), null, false)

      return normalizeState(JSON.parse(raw), null, false)
    } catch (_e) {
      return normalizeState(buildDefaultState(), null, false)
    }
  }

  saveState() {
    if (this.isLinkedDocumentMode()) {
      this.updateSerializedContent()
      return
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (_e) {
      // non-blocking
    }

    this.updateSerializedContent()
  }

  clearSessionData() {
    this.state.notesText = ""
    this.saveState()
    this.renderAll()
    this.requestDocumentAutosave()
  }

}

function todayIsoDateString() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function isoDateMonthString(value) {
  const normalized = normalizeEntryDate(value, todayIsoDateString())
  return normalized.slice(0, 7)
}

function parseIsoMonth(value) {
  const raw = String(value || "").trim()
  const match = /^(\d{4})-(\d{2})$/.exec(raw)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null
  return { year, month }
}

function shiftIsoMonth(isoMonth, delta) {
  const parsed = parseIsoMonth(isoMonth) || parseIsoMonth(isoDateMonthString(todayIsoDateString()))
  const shifted = new Date(parsed.year, parsed.month - 1 + delta, 1)
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`
}

function datePartsFromIso(value) {
  const normalized = normalizeEntryDate(value, "")
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized)
  if (!match) return null
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10)
  }
}

function isoDateFromParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function buildCalendarWeeks(year, month) {
  const first = new Date(year, month - 1, 1)
  const firstWeekday = first.getDay()
  const start = new Date(year, month - 1, 1 - firstWeekday)
  const weeks = []

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const week = []
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const cell = new Date(start)
      cell.setDate(start.getDate() + weekIndex * 7 + dayIndex)
      week.push({
        year: cell.getFullYear(),
        month: cell.getMonth() + 1,
        day: cell.getDate(),
        inCurrentMonth: cell.getMonth() === month - 1
      })
    }
    weeks.push(week)
  }

  return weeks
}

function formatMonthLabel(year, month) {
  const date = new Date(year, month - 1, 1)
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" })
}

function normalizeEntryDate(value, fallback = todayIsoDateString()) {
  const raw = String(value || "").trim()
  const fallbackRaw = String(fallback || "").trim()
  const candidate = raw || fallbackRaw || todayIsoDateString()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return todayIsoDateString()

  const [year, month, day] = candidate.split("-").map((n) => Number.parseInt(n, 10))
  const parsed = new Date(year, month - 1, day)
  if (!Number.isFinite(parsed.getTime())) return todayIsoDateString()
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return todayIsoDateString()
  return candidate
}
