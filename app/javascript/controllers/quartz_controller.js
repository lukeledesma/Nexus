/**
 * quartz_controller.js — Quartz unified text-app Stimulus controller
 *
 * Users type #commands (#timecard, #timer, #tasklist) anywhere in the document
 * to switch between modes. Everything below an unrecognised line is plain text.
 * All data lives in a single plain-text NEXUS_FILE document.
 *
 * Architecture:
 *   QUARTZ_MODES          — registry of mode objects
 *   segmentDocument()     — splits text into { mode, triggerLine, lines } blocks
 *   buildBackdropHtml()   — walks segments, delegates each line to mode.renderLine()
 *   QuartzController      — Stimulus controller: wires DOM, keyboard, timer ticks, persistence
 *
 * Adding a new mode: add an entry to QUARTZ_MODES with id, trigger, renderLine,
 * handleKeydown, and handleDashKey. Everything else is automatic.
 */

import { Controller } from "@hotwired/stimulus"

// ─────────────────────────────────────────────────────────────────────────────
// § Utilities
// ─────────────────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, "0") }

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function minutesToHHMM(totalMinutes) {
  return `${pad2(Math.floor(totalMinutes / 60) % 24)}:${pad2(totalMinutes % 60)}`
}

function parseHHMMToMinutes(v) {
  v = String(v ?? "").trim()
  // HH:MM
  let m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (m) {
    const h = +m[1], mn = +m[2]
    if (h <= 23 && mn <= 59) return h * 60 + mn
  }
  // Compact digits: 9→09:00, 900→09:00, 1030→10:30, 1345→13:45
  m = /^(\d{1,4})$/.exec(v)
  if (m) {
    const raw = m[1]
    const h  = raw.length <= 2 ? +raw : +raw.slice(0, -2)
    const mn = raw.length <= 2 ? 0   : +raw.slice(-2)
    if (h <= 23 && mn <= 59) return h * 60 + mn
  }
  return null
}

function roundedNowMin(nearest = 5) {
  const now = new Date()
  const total = now.getHours() * 60 + now.getMinutes()
  return Math.round(total / nearest) * nearest % (24 * 60)
}

/** Expand a start-time shorthand token → "HH:MM", or null if not recognised. */
function expandTimeToken(token) {
  const v = String(token ?? "").trim().toLowerCase()
  if (!v) return null
  if (v === "now") return minutesToHHMM(roundedNowMin(5))
  const mins = parseHHMMToMinutes(v)
  return Number.isInteger(mins) ? minutesToHHMM(mins) : null
}

/** Format wall-clock minutes-since-midnight as "hh:mm AM/PM". */
function fmtWallClock(totalMin) {
  const h24 = Math.floor(totalMin / 60) % 24
  const m   = totalMin % 60
  const ampm = h24 >= 12 ? "PM" : "AM"
  const h12  = h24 % 12 || 12
  return `${pad2(h12)}:${pad2(m)} ${ampm}`
}

/** Format current wall-clock time as "HH:MM:SS" (24h, second precision). */
function fmtWallClockSec() {
  const n = new Date()
  return `${pad2(n.getHours())}:${pad2(n.getMinutes())}:${pad2(n.getSeconds())}`
}

/** Format an absolute timestamp (ms) as "HH:MM:SS" (24h). */
function fmtWallClockFromMs(ms) {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** Parse "HH:MM:SS" 24h → total seconds since midnight, or null. */
function parseWallClockSec(str) {
  const m24 = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(String(str ?? "").trim())
  if (m24) return +m24[1] * 3600 + +m24[2] * 60 + +m24[3]
  // Legacy AM/PM fallback so old saved timers still reconstruct
  const m12 = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(str ?? "").trim())
  if (!m12) return null
  let h = +m12[1]; const mn = +m12[2]
  if (m12[3].toUpperCase() === "PM" && h !== 12) h += 12
  if (m12[3].toUpperCase() === "AM" && h === 12) h = 0
  return h * 3600 + mn * 60
}

/** Parse "hh:mm AM/PM" → minutes since midnight, or null. */
function parseWallClock(str) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(str ?? "").trim())
  if (!m) return null
  let h = +m[1]; const mn = +m[2]
  if (m[3].toUpperCase() === "PM" && h !== 12) h += 12
  if (m[3].toUpperCase() === "AM" && h === 12) h = 0
  return h * 60 + mn
}

/** Format total seconds as "MM:SS" or "HH:MM:SS". */
function fmtCountdown(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

/** Format total seconds always as "HH:MM:SS". */
function fmtCountdownFull(secs) {
  const h = Math.floor(Math.max(0, secs) / 3600)
  const m = Math.floor((Math.max(0, secs) % 3600) / 60)
  const s = Math.max(0, secs) % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

/** Format seconds as user-friendly duration text, e.g. "10m 50s". */
function fmtDurationHuman(secs) {
  const total = Math.max(0, Math.round(secs))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/**
 * Parse a human duration spec into { totalSeconds, normalized }.
 * Accepts: "10m", "1h30m", "15s", "4h2m15s", "10:30" (MM:SS),
 *          "1:30:45" (HH:MM:SS), plus relaxed MM:SS edits like "10:".
 */
function parseDuration(raw) {
  const v = String(raw ?? "").trim().toLowerCase()
  if (!v) return null

  // Relaxed MM:SS shortcuts used during timer row edits.
  // Examples: "10:" -> 10:00, "10:0" -> 10:00, "10:1" -> 10:01, "10:2" -> 10:20
  let relaxed = /^(\d+):$/.exec(v)
  if (relaxed) {
    const m = +relaxed[1]
    const total = m * 60
    return total > 0 ? { totalSeconds: total, normalized: fmtCountdown(total) } : null
  }

  relaxed = /^(\d+):(\d)$/.exec(v)
  if (relaxed) {
    const m = +relaxed[1]
    const d = +relaxed[2]
    // Keep common shorthand intuitive while staying within 0..59 seconds.
    const s = d === 0 ? 0 : (d === 1 ? 1 : (d <= 5 ? d * 10 : d))
    const total = m * 60 + s
    return total > 0 ? { totalSeconds: total, normalized: fmtCountdown(total) } : null
  }

  // Named units
  const named = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v)
  if (named && (named[1] || named[2] || named[3])) {
    const total = (+named[1] || 0) * 3600 + (+named[2] || 0) * 60 + (+named[3] || 0)
    return total > 0 ? { totalSeconds: total, normalized: fmtCountdown(total) } : null
  }

  // Colon-separated
  const colon = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(v)
  if (colon) {
    const parts = colon[3] != null
      ? [+colon[1], +colon[2], +colon[3]]
      : [0, +colon[1], +colon[2]]
    const total = parts[0] * 3600 + parts[1] * 60 + parts[2]
    return total > 0 ? { totalSeconds: total, normalized: fmtCountdown(total) } : null
  }

  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// § Regexes (shared across modes)
// ─────────────────────────────────────────────────────────────────────────────

const CLOSED_RANGE_RE = /^(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})(.*)$/
const OPEN_RANGE_RE   = /^(\d{1,2}:\d{2}\s*[-–]\s*)(?!\d)(.*)$/
const DASH_LINE_RE    = /^(\s*)(-)(\s*)(.*?)$/      // groups: indent, dash, gap, body
const TASK_RE         = /^(\s*)([☐☑])\s*(.*?)$/
// Wall-clock side accepts both new "HH:MM:SS" (24h) and legacy "hh:mm AM/PM"
const TIMER_LINE_RE   = /^(\d{1,2}:\d{2}(?::\d{2})?)\s*-\s*(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM))$/i
const TIMER_VISIBLE_LINE_RE = /^(\d{1,2}:\d{2}(?::\d{2})?)$/
const TRIGGER_RE      = /^(#[a-z][a-z0-9_-]*)(.*)$/i

// ─────────────────────────────────────────────────────────────────────────────
// § Mode: TIMECARD
// ─────────────────────────────────────────────────────────────────────────────

function parseTimecardMeta(lines) {
  const completionMap = new Map()   // lineIndex → completedEntryCount
  const labelMap      = new Map()   // lineIndex → customerLabel
  const isOpenMap     = new Map()   // lineIndex → bool
  const idMap         = new Map()   // lineIndex → string id
  let idCounter = 0, lastRange = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "")
    if (CLOSED_RANGE_RE.test(line)) {
      lastRange = i
      completionMap.set(i, 0); labelMap.set(i, "")
      isOpenMap.set(i, false); idMap.set(i, String(idCounter++))
    } else if (OPEN_RANGE_RE.test(line)) {
      lastRange = i
      completionMap.set(i, 0); labelMap.set(i, "")
      isOpenMap.set(i, true); idMap.set(i, String(idCounter++))
    } else if (lastRange >= 0 && DASH_LINE_RE.test(line)) {
      const dm = DASH_LINE_RE.exec(line)
      if (/\S/.test(dm[4])) completionMap.set(lastRange, (completionMap.get(lastRange) || 0) + 1)
    } else if (lastRange >= 0 && line.trim() && !labelMap.get(lastRange)) {
      labelMap.set(lastRange, line.trim())
    }
  }

  return { completionMap, labelMap, isOpenMap, idMap }
}

function parseTimeRange(lineStripped) {
  const m = CLOSED_RANGE_RE.exec(lineStripped)
  if (!m) return null
  const [startStr, endStr] = m[1].split(/[-–]/)
  const start = parseHHMMToMinutes(startStr.trim())
  const end   = parseHHMMToMinutes(endStr.trim())
  if (start == null || end == null) return null
  let dur = end - start; if (dur < 0) dur += 24 * 60
  return { startMin: start, endMin: end, durationMin: dur }
}

const TimecardMode = {
  id: "timecard",
  trigger: "#timecard",
  placeholder: "10:00-12:00 Client\n- Entry",

  renderLines(lines) {
    const { completionMap, labelMap, isOpenMap, idMap } = parseTimecardMeta(lines)
    const out = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const stripped = line.replace(/\s+$/, "")

      // Empty line after a time range → ghost "Customer" hint
      if (/^\s*$/.test(line)) {
        let prev = i - 1
        while (prev >= 0 && lines[prev].trim() === "") prev--
        const pl = prev >= 0 ? lines[prev].replace(/\s+$/, "") : ""
        if (CLOSED_RANGE_RE.test(pl) || OPEN_RANGE_RE.test(pl)) {
          out.push(`${escHtml(line)}<span class="quartz-ghost-text">Customer</span>`)
          continue
        }
        out.push(escHtml(line)); continue
      }

      // Closed range
      const cm = CLOSED_RANGE_RE.exec(stripped)
      if (cm) {
        const range = parseTimeRange(stripped)
        if (range) {
          const done = completionMap.get(i) || 0
          const req  = Math.ceil(range.durationMin / 60)
          let cls = "quartz-timecard__range"
          if (done >= req)  cls += " quartz-timecard__range--done"
          else if (done >= req / 2) cls += " quartz-timecard__range--pending"
          else              cls += " quartz-timecard__range--missing"
          const rid = idMap.get(i)
          const label = (labelMap.get(i) || "").trim()
          const suffix = cm[2]
          const projLabel = label && !/\S/.test(suffix)
            ? `<span class="quartz-timecard__range-label">${escHtml(label)}</span>` : ""
          out.push(`<span class="${cls}" data-range-id="${escHtml(rid)}">${escHtml(cm[1])}</span>${projLabel}${escHtml(suffix)}`)
          continue
        }
      }

      // Open range
      const om = OPEN_RANGE_RE.exec(stripped)
      if (om) {
        const rid = idMap.get(i)
        const label = (labelMap.get(i) || "").trim()
        const suffix = om[2]
        const projLabel = label && !/\S/.test(suffix)
          ? `<span class="quartz-timecard__range-label">${escHtml(label)}</span>` : ""
        out.push(`<span class="quartz-timecard__range quartz-timecard__range--ongoing" data-range-id="${escHtml(rid)}">${escHtml(om[1])}</span>${projLabel}${escHtml(suffix)}`)
        continue
      }

      // Dash entry — render dash styled, body unchanged, NO double-space
      const dm = DASH_LINE_RE.exec(stripped)
      if (dm) {
        const indent = escHtml(dm[1])
        const body   = dm[4]
        if (!body.trim()) {
          out.push(`${indent}<span class="quartz-entry-dash">-</span>${escHtml(dm[3])}<span class="quartz-ghost-text">Entry</span>`)
        } else {
          out.push(`${indent}<span class="quartz-entry-dash">-</span>${escHtml(dm[3] + body)}`)
        }
        continue
      }

      out.push(escHtml(line))
    }

    return out
  },

  /**
   * Handle the "-" key: expand time shorthand in-place.
   * e.g. "10" → "10:00-", "now" → "14:35-", "1345" → "13:45-"
   * Returns true if the event was handled.
   */
  handleDashKey(event, textarea) {
    const ss = textarea.selectionStart, se = textarea.selectionEnd
    if (ss !== se) return false  // has selection

    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, ss - 1)) + 1
    const lineEndIdx = text.indexOf("\n", ss)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const currentLine = text.slice(lineStart, lineEnd)

    // Don't expand on customer/entry lines
    if (DASH_LINE_RE.test(currentLine.trim())) return false
    // Don't expand if there's already a range on this line
    if (CLOSED_RANGE_RE.test(currentLine) || OPEN_RANGE_RE.test(currentLine)) return false

    const caretOffset = ss - lineStart
    const beforeCaret = currentLine.slice(0, caretOffset)
    const afterCaret  = currentLine.slice(caretOffset)
    if (/\S/.test(afterCaret)) return false   // text after cursor

    const match = /^(\s*)(\w+)\s*$/.exec(beforeCaret)
    if (!match) return false

    const expanded = expandTimeToken(match[2])
    if (!expanded) return false

    event.preventDefault()
    const replacement = `${match[1]}${expanded}-`
    textarea.setRangeText(replacement, lineStart, lineEnd, "end")
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    return true
  },

  handleKeydown(event, textarea) {
    // Intercept "-" for time shorthand expansion
    if (["-", "Minus", "Subtract", "NumpadSubtract"].includes(String(event.key || ""))) {
      return this.handleDashKey(event, textarea)
    }

    if (event.key !== "Enter") return false

    const ss = textarea.selectionStart, se = textarea.selectionEnd
    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, ss - 1)) + 1
    const lineEndIdx = text.indexOf("\n", se)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const currentLine = text.slice(lineStart, lineEnd)
    let normalized = currentLine.replace(/\s+$/, "")

    // On the ghost Customer row (blank line directly after a range), Enter should
    // commit the customer label instead of creating more blank ghost rows.
    if (/^\s*$/.test(currentLine)) {
      let prev = lineStart > 0 ? lineStart - 1 : -1
      if (prev >= 0 && text[prev] === "\n") prev -= 1
      const prevLineEnd = prev
      const prevLineStart = prevLineEnd >= 0 ? text.lastIndexOf("\n", prevLineEnd) + 1 : 0
      const prevLine = prevLineEnd >= 0 ? text.slice(prevLineStart, prevLineEnd + 1).replace(/\s+$/, "") : ""
      if (CLOSED_RANGE_RE.test(prevLine) || OPEN_RANGE_RE.test(prevLine)) {
        event.preventDefault()
        textarea.setRangeText("Customer", lineStart, lineEnd, "end")
        textarea.dispatchEvent(new Event("input", { bubbles: true }))
        return true
      }
    }

    // Empty dash entry → delete the line, ready for new range
    if (/^\s*-\s*$/.test(currentLine)) {
      event.preventDefault()
      textarea.setRangeText("", lineStart, lineEnd, "start")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      return true
    }

    // Try expanding end-time token (e.g. "10:00-now" → "10:00-14:35")
    const endToken = /^(\d{1,2}:\d{2}\s*[-–]\s*)(\S+)\s*$/.exec(normalized)
    if (endToken && !/^\d{1,2}:\d{2}$/.test(endToken[2])) {
      const exp = expandTimeToken(endToken[2])
      if (exp) normalized = `${endToken[1]}${exp}`
    }

    // Determine what to insert on the next line
    const isClosed = /^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}\s*$/.test(normalized)
    const isOpen   = /^\d{1,2}:\d{2}\s*[-–]\s*$/.test(normalized)
    const dashM    = /^(\s*)-\s.+$/.exec(normalized)
    const isCustomer = normalized.trim().length > 0
      && !isClosed && !isOpen && !DASH_LINE_RE.test(normalized.trim())
      && !/^\d{1,2}:\d{2}/.test(normalized.trim())

    let nextPrefix = null
    if (isClosed || isOpen) {
      nextPrefix = ""  // customer line — no indent
    } else if (isCustomer) {
      nextPrefix = "- "  // first entry
    } else if (dashM) {
      const indent = /^(\s*)/.exec(dashM[0])[1]
      nextPrefix = `${indent}- `
    }

    if (nextPrefix === null) return false

    event.preventDefault()
    const replacement = normalized !== currentLine
      ? `${normalized}\n${nextPrefix}`
      : `\n${nextPrefix}`
    const insertAt = normalized !== currentLine ? lineStart : ss
    const insertEnd = normalized !== currentLine ? lineEnd : se
    textarea.setRangeText(replacement, insertAt, insertEnd, "end")
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    return true
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Mode: TIMER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Timer anchor map: Map<anchorKey, { totalSeconds, startedAtMs, targetAtMs }>
 * Keyed by canonical timestamp-bearing rows when available; otherwise by visible
 * spec row text. This avoids resets when unrelated lines are inserted above.
 */
const timerAnchors = new Map()

function timerAnchorKey(line1, line2 = "") {
  const t1 = String(line1 ?? "").trim()
  const t2 = String(line2 ?? "").trim()
  const m1 = TIMER_LINE_RE.exec(t1)
  const m2 = TIMER_LINE_RE.exec(t2)
  if (m1 && m2) return `canon:${m1[1]}|${m1[2]}|${m2[2]}`
  return `visible:${t1}`
}

function ensureTimerAnchor(lineIndex, line1, line2) {
  const key = timerAnchorKey(line1, line2)
  if (timerAnchors.has(key)) return { key, anchor: timerAnchors.get(key) }

  // Reconstruct from wall-clock timestamps embedded in existing lines
  const m1 = TIMER_LINE_RE.exec(line1.trim())
  const m2 = line2 ? TIMER_LINE_RE.exec(line2.trim()) : null

  if (m1 && m2) {
    // Try second-precision 24h format first, fall back to legacy AM/PM minutes
    const startSec = parseWallClockSec(m1[2])
    const endSec   = parseWallClockSec(m2[2])
    if (startSec != null && endSec != null) {
      const dur = parseDuration(m1[1])?.totalSeconds ?? Math.max(0, endSec - startSec)
      const todayMs = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() })()
      let startMs = todayMs + startSec * 1000
      let endMs   = todayMs + endSec   * 1000
      if (endMs < startMs) endMs += 86400000
      const anchor = { totalSeconds: dur, startedAtMs: startMs, targetAtMs: endMs }
      timerAnchors.set(key, anchor)
      return { key, anchor }
    }
  }

  // Fresh timer from bare spec
  const spec = parseDuration(line1.trim())
  if (spec) {
    const now = Date.now()
    const anchor = { totalSeconds: spec.totalSeconds, startedAtMs: now, targetAtMs: now + spec.totalSeconds * 1000 }
    timerAnchors.set(key, anchor)
    return { key, anchor }
  }

  return { key, anchor: null }
}

function canonicalizeTimerBody(body) {
  const segments = segmentDocument(body)
  const out = []

  for (const seg of segments) {
    if (seg.triggerLine != null) out.push(seg.triggerLine)
    if (seg.mode?.id !== "timer") {
      out.push(...seg.lines)
      continue
    }

    for (let i = 0; i < seg.lines.length; i++) {
      const line1 = seg.lines[i]
      const line2 = seg.lines[i + 1] ?? ""
      const t1 = line1.trim()
      const t2 = line2.trim()

      if (TIMER_LINE_RE.test(t1) && TIMER_LINE_RE.test(t2)) {
        out.push(line1, line2)
        i += 1
        continue
      }

      if (TIMER_VISIBLE_LINE_RE.test(t1) && TIMER_VISIBLE_LINE_RE.test(t2)) {
        const { anchor } = ensureTimerAnchor(i, line1, line2)
        const spec = parseDuration(t1)
        const total = anchor?.totalSeconds ?? spec?.totalSeconds
        if (total && anchor) {
          out.push(`${fmtCountdown(total)} - ${fmtWallClockFromMs(anchor.startedAtMs)}`)
          out.push(`${fmtCountdown(total)} - ${fmtWallClockFromMs(anchor.targetAtMs)}`)
          i += 1
          continue
        }
      }

      out.push(line1)
    }
  }

  return out.join("\n")
}

function displayTimerBody(body) {
  const segments = segmentDocument(body)
  const out = []

  for (const seg of segments) {
    if (seg.triggerLine != null) out.push(seg.triggerLine)
    if (seg.mode?.id !== "timer") {
      out.push(...seg.lines)
      continue
    }

    for (let i = 0; i < seg.lines.length; i++) {
      const line1 = seg.lines[i]
      const line2 = seg.lines[i + 1] ?? ""
      const m1 = TIMER_LINE_RE.exec(line1.trim())
      const m2 = TIMER_LINE_RE.exec(line2.trim())
      if (m1 && m2) {
        const { anchor } = ensureTimerAnchor(i, line1, line2)
        const visibleLine1 = m1[1]
        const fallbackSecs = parseDuration(m2[1])?.totalSeconds
        const visibleLine2 = anchor
            ? fmtCountdown(timerRemaining(anchor))
          : (Number.isInteger(fallbackSecs) ? fmtCountdown(fallbackSecs) : m2[1])
        out.push(visibleLine1, visibleLine2)

        // Alias the anchor to the visible key so visible-mode editing keeps timing data.
        if (anchor) timerAnchors.set(timerAnchorKey(visibleLine1), anchor)
        i += 1
        continue
      }

      out.push(line1)
    }
  }

  return out.join("\n")
}

function pruneTimerAnchors(liveKeys) {
  for (const k of timerAnchors.keys()) {
    if (!liveKeys.has(k)) timerAnchors.delete(k)
  }
}

function timerRemaining(anchor) {
  return Math.max(0, Math.round((anchor.targetAtMs - Date.now()) / 1000))
}

const TimerMode = {
  id: "timer",
  trigger: "#timer",
  placeholder: "25m  ·  1h30m  ·  90s",

  renderLines(lines) {
    const out = []
    const liveKeys = new Set()
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      const nextTrimmed = (lines[i + 1] ?? "").trim()
      const isExistingLine1 = TIMER_LINE_RE.test(trimmed)
      const isVisiblePair = TIMER_VISIBLE_LINE_RE.test(trimmed) && TIMER_VISIBLE_LINE_RE.test(nextTrimmed)
      const spec = !isExistingLine1 && !isVisiblePair ? parseDuration(trimmed) : null

      if (spec) {
        // Bare spec not yet expanded
        out.push(`<span class="quartz-timer__spec">${escHtml(line)}</span>`)
        i++; continue
      }

      if (isExistingLine1 || isVisiblePair) {
        const line2 = lines[i + 1] ?? ""
        const { key, anchor } = ensureTimerAnchor(i, line, line2)
        liveKeys.add(key)

        const remaining = anchor ? timerRemaining(anchor) : null
        const m1 = TIMER_LINE_RE.exec(trimmed)
        const durLabel   = m1?.[1] ?? trimmed
        const rid = `timer-${key}`

        out.push(
          `<span class="quartz-timer__line1" data-range-id="${escHtml(rid)}">` +
          `<span class="quartz-timer__duration">${escHtml(durLabel)}</span>` +
          `</span>`
        )

        if (i + 1 < lines.length && (isExistingLine1 || isVisiblePair)) {
          i++
          const m2 = TIMER_LINE_RE.exec(lines[i].trim())
          const rawFallback = (m2?.[1] ?? lines[i].trim())
          const fallbackSecs = parseDuration(rawFallback)?.totalSeconds
          const cdText = remaining != null
            ? fmtCountdown(remaining)
            : (Number.isInteger(fallbackSecs) ? fmtCountdown(fallbackSecs) : rawFallback)
          let cdCls        = "quartz-timer__countdown"
          if (remaining != null) {
            if (remaining <= 0)  cdCls += " quartz-timer__countdown--done"
            else if (anchor && remaining <= anchor.totalSeconds / 2) cdCls += " quartz-timer__countdown--warning"
          }
          const cdId = `qtcd-${key.replace(/[^a-z0-9]/gi, "-")}`
          out.push(
            `<span class="quartz-timer__line2" data-range-id="${escHtml(rid)}">` +
            `<span class="${cdCls}" id="${cdId}">${escHtml(cdText)}</span>` +
            `</span>`
          )
        }

        i++; continue
      }

      out.push(escHtml(line))
      i++
    }

    pruneTimerAnchors(liveKeys)
    return out
  },

  handleDashKey() { return false },

  handleKeydown(event, textarea) {
    const ss = textarea.selectionStart, se = textarea.selectionEnd
    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, ss - 1)) + 1
    const lineEndIdx = text.indexOf("\n", se)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const currentLineRaw = text.slice(lineStart, lineEnd)
    const currentLine = currentLineRaw.trim()

    const hasPrevLine = lineStart > 0
    let prevLineRaw = ""
    let prevLineIndex = -1
    let prevStart = -1
    let prevEnd = -1
    let prev2Raw = ""
    let prev2Start = -1
    let prev2End = -1
    if (hasPrevLine) {
      prevEnd = lineStart - 1
      prevStart = text.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1
      prevLineRaw = text.slice(prevStart, prevEnd)
      prevLineIndex = text.slice(0, prevStart).split("\n").length - 1

      if (prevStart > 0) {
        prev2End = prevStart - 1
        prev2Start = text.lastIndexOf("\n", Math.max(0, prev2End - 1)) + 1
        prev2Raw = text.slice(prev2Start, prev2End)
      }
    }

    const onTimerCountdownLine = hasPrevLine && (
      (TIMER_LINE_RE.test(prevLineRaw.trim()) && TIMER_LINE_RE.test(currentLine)) ||
      (TIMER_VISIBLE_LINE_RE.test(prevLineRaw.trim()) && TIMER_VISIBLE_LINE_RE.test(currentLine))
    )

    const isEditingKey = (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1)
      || event.key === "Backspace" || event.key === "Delete"

    if (onTimerCountdownLine && isEditingKey) {
      event.preventDefault()
      // Countdown row is display-only: never mutate source input row from here.
      const { key } = ensureTimerAnchor(prevLineIndex, prevLineRaw, currentLineRaw)
      const safeId = key.replace(/[^a-z0-9]/gi, "-")
      const cdEl = document.getElementById(`qtcd-${safeId}`)
      if (cdEl) {
        cdEl.classList.remove("quartz-timer__countdown--blocked")
        void cdEl.offsetWidth
        cdEl.classList.add("quartz-timer__countdown--blocked")
      }
      const nextPos = lineEnd < text.length ? lineEnd + 1 : lineEnd
      textarea.setSelectionRange(nextPos, nextPos)
      return true
    }

    // Delete on the row below a timer countdown asks to cancel the timer.
    const prevIsCountdown =
      (TIMER_LINE_RE.test(prevLineRaw.trim()) || TIMER_VISIBLE_LINE_RE.test(prevLineRaw.trim()))
    const prev2IsInput =
      (TIMER_LINE_RE.test(prev2Raw.trim()) || TIMER_VISIBLE_LINE_RE.test(prev2Raw.trim()))
    const onRowBelowCountdown = hasPrevLine && prevStart > 0 && prevIsCountdown && prev2IsInput
    const currentRowEmpty = currentLineRaw.trim().length === 0

    const shouldConfirmCancel = onRowBelowCountdown && !event.metaKey && !event.ctrlKey && !event.altKey && (
      event.key === "Delete" || (event.key === "Backspace" && currentRowEmpty)
    )

    if (shouldConfirmCancel) {
      event.preventDefault()
      const ok = window.confirm("Cancel this timer and delete both timer rows?")
      if (!ok) return true

      textarea.setRangeText("", prev2Start, lineStart, "start")
      textarea.setSelectionRange(prev2Start, prev2Start)
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
      return true
    }

    // If editing the first row of a timer pair, collapse (delete) the countdown row.
    // This keeps timer rows behaving like an insert/delete pair while preserving
    // anchor data for potential re-generation.
    const hasNextLine = lineEnd < text.length
    const nextLineStart = hasNextLine ? lineEnd + 1 : text.length
    const nextLineEndIdx = text.indexOf("\n", nextLineStart)
    const nextLineEnd = nextLineEndIdx === -1 ? text.length : nextLineEndIdx
    const nextLineRaw = text.slice(nextLineStart, nextLineEnd)
    const onTimerEntryLineForEdit =
      (TIMER_LINE_RE.test(currentLine) || TIMER_VISIBLE_LINE_RE.test(currentLine)) &&
      (TIMER_LINE_RE.test(nextLineRaw.trim()) || TIMER_VISIBLE_LINE_RE.test(nextLineRaw.trim()))

    if (onTimerEntryLineForEdit && isEditingKey) {
      const removeEnd = nextLineEndIdx === -1 ? nextLineEnd : nextLineEnd + 1
      textarea.setRangeText("", nextLineStart, removeEnd, "preserve")
      // Keep caret on the first row where the user is actively editing.
      textarea.setSelectionRange(ss, se)
    }

    if (event.key !== "Enter") return false

    // Enter on the first row of an existing timer pair should jump below the
    // countdown row, not split the pair by inserting a line in between.
    const nextLine = nextLineRaw.trim()
    const onTimerEntryLineForEnter =
      (TIMER_LINE_RE.test(currentLine) || TIMER_VISIBLE_LINE_RE.test(currentLine)) &&
      (TIMER_LINE_RE.test(nextLine) || TIMER_VISIBLE_LINE_RE.test(nextLine))
    if (onTimerEntryLineForEnter) {
      event.preventDefault()
      const belowCountdownPos = nextLineEnd < text.length ? nextLineEnd + 1 : nextLineEnd
      textarea.setSelectionRange(belowCountdownPos, belowCountdownPos)
      return true
    }

    // Canonical line with embedded wall-clock is already expanded.
    // Visible timer rows (e.g. 10:20) should still be expandable when lone.
    if (TIMER_LINE_RE.test(currentLine)) return false

    const spec = parseDuration(currentLine)
    if (!spec) return false

    event.preventDefault()
    const line1  = `${spec.normalized}`
    const line2  = `${fmtCountdown(spec.totalSeconds)}`
    textarea.setRangeText(`${line1}\n${line2}\n`, lineStart, lineEnd, "end")
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    return true
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Mode: TASKLIST
// ─────────────────────────────────────────────────────────────────────────────

const TasklistMode = {
  id: "tasklist",
  trigger: "#tasklist",
  placeholder: "☐ Task description",

  renderLines(lines) {
    return lines.map(line => {
      const m = TASK_RE.exec(line)
      if (!m) return escHtml(line)

      const indent = escHtml(m[1])
      const box    = m[2]
      const body   = m[3]
      const done   = box === "☑"
      const cdCls  = done ? "quartz-task__checkbox quartz-task__checkbox--done" : "quartz-task__checkbox"
      const bodyCls = done ? "quartz-task__body quartz-task__body--done" : "quartz-task__body"

      if (!body.trim()) {
        return `${indent}<span class="${cdCls}">${escHtml(box)}</span> <span class="quartz-ghost-text">Task description</span>`
      }
      return `${indent}<span class="${cdCls}">${escHtml(box)}</span> <span class="${bodyCls}">${escHtml(body)}</span>`
    })
  },

  handleDashKey() { return false },

  handleKeydown(event, textarea) {
    if (event.key !== "Enter") return false

    const ss = textarea.selectionStart, se = textarea.selectionEnd
    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, ss - 1)) + 1
    const lineEndIdx = text.indexOf("\n", se)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    const currentLine = text.slice(lineStart, lineEnd)

    if (/^\s*$/.test(currentLine)) return false

    const m = TASK_RE.exec(currentLine)
    if (!m) return false

    event.preventDefault()
    const indent = m[1]
    const body   = m[3].trim()

    if (!body) {
      // Empty checkbox row + Enter → convert to plain blank row and stay there.
      textarea.setRangeText("", lineStart, lineEnd, "start")
    } else {
      // Has content → add next empty checkbox
      textarea.setRangeText(`\n${indent}☐ `, ss, se, "end")
    }

    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    return true
  },

  /**
   * Toggle checkbox on click — map Y position in textarea → line index.
   * Returns { text, caretPos } or null.
   */
  handleClick(event, textarea) {
    const hit = taskCheckboxHitAtEvent(event, textarea)
    if (!hit || !hit.hitBox) return null

    const lines = textarea.value.split("\n")
    lines[hit.lineIdx] = hit.line.replace(TASK_RE, (_, indent, box, body) => {
      const toggled = box === "☑" ? "☐" : "☑"
      return `${indent}${toggled} ${body}`
    })

    const text = lines.join("\n")
    const before = lines.slice(0, hit.lineIdx).join("\n")
    const lineStart = hit.lineIdx === 0 ? 0 : before.length + 1
    const caretPos = lineStart + lines[hit.lineIdx].length

    return { text, caretPos }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Mode registry
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// § Mode: MATH
// ─────────────────────────────────────────────────────────────────────────────

const MathMode = {
  id: "math",
  trigger: "#math",
  placeholder: "2 + 2\n3 * (4 + 5)",

  renderLines(lines) {
    return lines.map(line => {
      const expr = line.trim()
      if (!expr) return escHtml(line)
      try {
        // Only allow safe math expressions
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${expr})`)()
        if (typeof result === "number" && isFinite(result)) {
          return `<span class=\"quartz-math-expr\">${escHtml(line)}</span> = <span class=\"quartz-math-result\">${escHtml(result)}</span>`
        }
        return `<span class=\"quartz-math-expr\">${escHtml(line)}</span> <span class=\"quartz-math-error\">(not a number)</span>`
      } catch {
        return `<span class=\"quartz-math-expr\">${escHtml(line)}</span> <span class=\"quartz-math-error\">(error)</span>`
      }
    })
  },

  handleDashKey() { return false },
  handleKeydown() { return false }
}

const QUARTZ_MODES     = [TimecardMode, TimerMode, TasklistMode, MathMode]
const MODE_BY_TRIGGER  = new Map(QUARTZ_MODES.map(m => [m.trigger.toLowerCase(), m]))

let _textMeasureCanvas = null

function measureTextWidth(text, style) {
  const canvas = _textMeasureCanvas || (_textMeasureCanvas = document.createElement("canvas"))
  const ctx = canvas.getContext("2d")
  if (!ctx) return text.length * 8
  ctx.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return ctx.measureText(text).width
}

function taskCheckboxHitAtEvent(event, textarea) {
  const rect = textarea.getBoundingClientRect()
  const style = getComputedStyle(textarea)
  const relY = event.clientY - rect.top + textarea.scrollTop
  const lineH = parseFloat(style.lineHeight) || 14
  const padTop = parseFloat(style.paddingTop) || 8
  const lineIdx = Math.floor((relY - padTop) / lineH)
  if (lineIdx < 0) return null

  const lines = textarea.value.split("\n")
  const line = lines[lineIdx]
  if (!line) return null

  const m = TASK_RE.exec(line)
  if (!m) return null

  const relX = event.clientX - rect.left + textarea.scrollLeft
  const padLeft = parseFloat(style.paddingLeft) || 8
  const indentW = measureTextWidth(m[1], style)
  const boxW = measureTextWidth(m[2], style)
  const boxStartX = padLeft + indentW
  const boxEndX = boxStartX + boxW
  const hitBox = relX >= boxStartX && relX <= (boxEndX + 2)

  return { lineIdx, line, hitBox }
}

// ─────────────────────────────────────────────────────────────────────────────
// § Document segmentation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split raw text into segments: [{ mode, triggerLine, lines, globalStartLine }]
 * Lines that don't fall under any trigger are rendered as plain text (null mode).
 */
function segmentDocument(text) {
  const rawLines = text.split("\n")
  const segments = []
  let currentMode = null, triggerLine = null, currentLines = [], startLine = 0
  const seenTriggers = new Set()

  function flush(nextStart) {
    if (currentLines.length > 0 || triggerLine != null) {
      segments.push({ mode: currentMode, triggerLine, lines: [...currentLines], globalStartLine: startLine })
    }
    currentLines = []; startLine = nextStart; triggerLine = null
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const m = TRIGGER_RE.exec(line.trim())
    const matched = m ? MODE_BY_TRIGGER.get(m[1].toLowerCase()) : null
    if (matched) {
      const triggerKey = m[1].toLowerCase()
      if (!seenTriggers.has(triggerKey)) {
        flush(i)
        currentMode = matched
        triggerLine = line
        seenTriggers.add(triggerKey)
      } else {
        flush(i)
        segments.push({ mode: null, triggerLine: line, lines: [], globalStartLine: i, invalidTrigger: true })
        currentMode = null
        startLine = i + 1
      }
    } else {
      currentLines.push(line)
    }
  }

  flush(rawLines.length)
  return segments
}

function isFirstRecognizedTriggerOccurrenceAtLine(text, lineStart) {
  const lines = text.split("\n")
  let chars = 0
  let currentLineTrigger = null

  for (const line of lines) {
    if (chars === lineStart) {
      const m = TRIGGER_RE.exec(line.trim())
      const key = m?.[1]?.toLowerCase()
      if (key && MODE_BY_TRIGGER.has(key)) currentLineTrigger = key
      break
    }
    chars += line.length + 1
  }

  if (!currentLineTrigger) return false

  chars = 0
  for (const line of lines) {
    if (chars >= lineStart) break
    const m = TRIGGER_RE.exec(line.trim())
    const key = m?.[1]?.toLowerCase()
    if (key === currentLineTrigger && MODE_BY_TRIGGER.has(key)) return false
    chars += line.length + 1
  }

  return true
}

/** Return the active mode at a given character offset in the document. */
function modeAtOffset(text, offset) {
  let mode = null, chars = 0
  const seenTriggers = new Set()
  for (const line of text.split("\n")) {
    const lineEnd = chars + line.length
    if (chars <= offset && offset <= lineEnd + 1) break
    const m = TRIGGER_RE.exec(line.trim())
    if (m) {
      const key = m[1].toLowerCase()
      const matched = MODE_BY_TRIGGER.get(key)
      if (matched) {
        if (!seenTriggers.has(key)) {
          mode = matched
          seenTriggers.add(key)
        } else {
          mode = null
        }
      }
    }
    chars = lineEnd + 1
  }
  return mode
}

// ─────────────────────────────────────────────────────────────────────────────
// § Backdrop renderer
// ─────────────────────────────────────────────────────────────────────────────

function buildBackdropHtml(segments) {
  const allLines = []

  for (const seg of segments) {
    if (seg.triggerLine != null) {
      const tm = TRIGGER_RE.exec(seg.triggerLine.trim())
      if (tm) {
        const triggerCls = seg.invalidTrigger ? "quartz-trigger quartz-trigger--invalid" : "quartz-trigger"
        allLines.push(`<span class="${triggerCls}">${escHtml(tm[1])}</span>${escHtml(tm[2])}`)
      } else {
        allLines.push(escHtml(seg.triggerLine))
      }
    }

    if (seg.mode) {
      allLines.push(...seg.mode.renderLines(seg.lines))
    } else {
      allLines.push(...seg.lines.map(escHtml))
    }
  }

  return allLines.join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// § Timeline renderer (contextual — shown when timecard or timer ranges exist)
// ─────────────────────────────────────────────────────────────────────────────

function renderTimeline(segments, containerEl) {
  if (!containerEl) return

  const entries = []
  for (const seg of segments) {
    if (seg.mode?.id === "timecard") {
      const { completionMap, labelMap, isOpenMap, idMap } = parseTimecardMeta(seg.lines)
      for (const [localIdx] of completionMap) {
        const line = seg.lines[localIdx].replace(/\s+$/, "")
        const id   = idMap.get(localIdx)
        if (isOpenMap.get(localIdx)) {
          const m = OPEN_RANGE_RE.exec(line)
          if (!m) continue
          const start = parseHHMMToMinutes(m[1].split(/[-–]/)[0].trim())
          if (start == null) continue
          entries.push({
            kind: "timecard",
            id,
            startMin: start,
            endMin: null,
            durationMin: 0,
            isOpen: true,
            completedCount: 0,
            requiredCount: 0,
            customerLabel: labelMap.get(localIdx) || ""
          })
        } else {
          const range = parseTimeRange(line)
          if (!range) continue
          const done = completionMap.get(localIdx) || 0
          const req  = Math.ceil(range.durationMin / 60)
          entries.push({
            kind: "timecard",
            id,
            ...range,
            isOpen: false,
            completedCount: done,
            requiredCount: req,
            customerLabel: labelMap.get(localIdx) || ""
          })
        }
      }
      continue
    }

    if (seg.mode?.id === "timer") {
      for (let i = 0; i < seg.lines.length; i++) {
        const line = seg.lines[i]
        const line2 = seg.lines[i + 1] ?? ""
        const isCanonical = TIMER_LINE_RE.test(line.trim()) && TIMER_LINE_RE.test(line2.trim())
        const isVisible   = TIMER_VISIBLE_LINE_RE.test(line.trim()) && TIMER_VISIBLE_LINE_RE.test(line2.trim())
        if (!isCanonical && !isVisible) continue

        const { key, anchor } = ensureTimerAnchor(i, line, line2)
        if (!anchor) continue

        const start = new Date(anchor.startedAtMs)
        const startMin = start.getHours() * 60 + start.getMinutes()
        const durationMin = Math.max(1, Math.ceil(anchor.totalSeconds / 60))
        entries.push({
          kind: "timer",
          id: `timer-${key}`,
          startMin,
          endMin: (startMin + durationMin) % (24 * 60),
          durationMin,
          isOpen: false,
          completedCount: 0,
          requiredCount: 0,
          customerLabel: ""
        })

        i += 1
      }
    }
  }

  if (entries.length === 0) {
    containerEl.hidden = true; containerEl.innerHTML = ""; return
  }

  containerEl.hidden = false
  const TOTAL = 24 * 60
  const track = []

  // Separate timers (document order) from timecard entries
  const timerEntries  = entries.filter(e => e.kind === "timer")
  const nonTimerEntries = entries.filter(e => e.kind !== "timer")

  // Render later-starting entries first so earlier-starting items sit on top.
  const ordered = [...nonTimerEntries].sort((a, b) => b.startMin - a.startMin)

  for (const e of ordered) {
    const left = (e.startMin / TOTAL * 100).toFixed(3)
    const rid  = e.id ? ` data-range-id="${escHtml(e.id)}"` : ""
    if (e.isOpen) {
      const now = new Date(); const cur = now.getHours() * 60 + now.getMinutes()
      const w = Math.max(0.5, ((cur - e.startMin) / TOTAL * 100)).toFixed(3)
      const tip = [
        `${e.customerLabel || "unspecified"}`,
        `${fmtWallClock(e.startMin)} - now`,
        `Entries: ${e.completedCount}`
      ].join("\n")
      track.push(`<span class="quartz-timeline__segment quartz-timeline__segment--ongoing"${rid} data-hover-summary="${escHtml(tip)}" style="left:${left}%;width:${w}%"></span>`)
    } else {
      const w = (Math.max(1, e.durationMin) / TOTAL * 100).toFixed(3)
      let cls = "quartz-timeline__segment"
      if (e.completedCount >= e.requiredCount) cls += " quartz-timeline__segment--done"
      else if (e.completedCount >= e.requiredCount / 2) cls += " quartz-timeline__segment--pending"
      else                                     cls += " quartz-timeline__segment--missing"
      const tip = [
        `${e.customerLabel || "unspecified"}`,
        `${fmtWallClock(e.startMin)} - ${e.endMin == null ? "--:--" : fmtWallClock(e.endMin)}`,
        `Duration: ${fmtCountdownFull(e.durationMin * 60)}`,
        `Entries: ${e.completedCount}/${e.requiredCount}`
      ].join("\n")
      track.push(`<span class="${cls}"${rid} data-hover-summary="${escHtml(tip)}" style="left:${left}%;width:${w}%"></span>`)
    }
  }

  for (const h of [6, 12, 18]) {
    const pct = (h / 24 * 100).toFixed(3)
    track.push(`<span class="quartz-timeline__tick" style="left:${pct}%"></span>`)
  }

  // Build per-timer progress bars (document order, stacked below timecard bar)
  const timerBars = timerEntries.map(e => {
    const anchorKey = e.id.startsWith("timer-") ? e.id.slice(6) : ""
    const anchor = anchorKey ? timerAnchors.get(anchorKey) : null
    const totalSec = anchor ? anchor.totalSeconds : e.durationMin * 60
    const rem      = anchor ? timerRemaining(anchor) : 0
    const elapsed  = totalSec - rem
    const pctFill  = Math.min(100, (elapsed / Math.max(1, totalSec) * 100)).toFixed(2)
    const safeId   = escHtml(e.id.replace(/[^a-z0-9]/gi, "-"))
    const beganAt  = anchor ? fmtWallClockFromMs(anchor.startedAtMs) : "--:--:--"
    const endsAt   = anchor ? fmtWallClockFromMs(anchor.targetAtMs) : "--:--:--"
    const tip = [
      `Began: ${beganAt}`,
      `Duration: ${fmtDurationHuman(totalSec)}`,
      `Ends: ${endsAt}`,
      `Remaining: ${fmtDurationHuman(rem)}`
    ].join("\n")
    let fillCls = "quartz-timer-bar__fill"
    if (rem <= 0)       fillCls += " quartz-timer-bar__fill--done"
    else if (rem <= totalSec / 2) fillCls += " quartz-timer-bar__fill--warning"
    return (
      `<div class="quartz-timer-bar" id="qtbr-${safeId}" data-range-id="${escHtml(e.id)}" data-hover-summary="${escHtml(tip)}">` +
        `<div class="quartz-timer-bar__track" data-hover-summary="${escHtml(tip)}">` +
          `<span class="${fillCls}" id="qtbf-${safeId}" data-hover-summary="${escHtml(tip)}" style="width:${pctFill}%"></span>` +
        `</div>` +
      `</div>`
    )
  }).join("")

  const hasTimerBars = timerEntries.length > 0
  const hasTimecard  = nonTimerEntries.length > 0

  containerEl.innerHTML =
    (hasTimecard
      ? `<div class="quartz-timeline__track">${track.join("")}</div>`
      : "") +
    (hasTimerBars ? timerBars : "")
}

// ─────────────────────────────────────────────────────────────────────────────
// § Codec helpers (mirrors QuartzDocumentCodec.rb)
// ─────────────────────────────────────────────────────────────────────────────

function dumpQuartzDoc(body) {
  return ["# NEXUS_FILE v1", "# kind: quartz", "# title: Quartz", "", body].join("\n")
}

function extractQuartzBody(raw) {
  const lines = (raw ?? "").split("\n")
  if (lines[0]?.trim() !== "# NEXUS_FILE v1") return ""
  let start = lines.length
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i].trim()
    if (s.startsWith("# ")) continue
    start = s === "" ? i + 1 : i; break
  }
  return lines.slice(start).join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// § Stimulus Controller
// ─────────────────────────────────────────────────────────────────────────────

export default class extends Controller {
  static targets = ["notesInput", "notesBackdrop", "serializedContent", "timelineBar"]
  static values  = { linkedDocumentId: Number, initialBody: String }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connect() {
    this._segments  = []
    this._ticker    = null
    this._rafFrame  = null
    this._highlight = null

    this._onResize        = () => this._onViewportChange()
    this._onNotesScroll   = () => this.syncBackdropScroll()
    this._onNotesMouseDown = (e) => this._captureTaskToggleSelection(e)
    this._onRemoteChanged = (e) => this._handleRemoteChanged(e)
    this._onHoverTipMove  = (e) => this._handleHoverTipMove(e)
    this._onHoverTipLeave = () => this._hideHoverTip()

    window.addEventListener("resize", this._onResize)
    window.addEventListener("scroll", this._onResize, true)
    window.addEventListener("nexus:document-remote-changed", this._onRemoteChanged)
    this.notesInputTarget.addEventListener("scroll", this._onNotesScroll)
    this.notesInputTarget.addEventListener("mousedown", this._onNotesMouseDown)
    this.element.addEventListener("mousemove", this._onHoverTipMove, true)
    this.element.addEventListener("mouseleave", this._onHoverTipLeave, true)

    this._setupRangeHover()

    const body = displayTimerBody(this.initialBodyValue || "")
    this.notesInputTarget.value = body
    this._renderAll(body)
    this._startTicker()
  }

  disconnect() {
    window.removeEventListener("resize", this._onResize)
    window.removeEventListener("scroll", this._onResize, true)
    window.removeEventListener("nexus:document-remote-changed", this._onRemoteChanged)
    this.notesInputTarget.removeEventListener("scroll", this._onNotesScroll)
    this.notesInputTarget.removeEventListener("mousedown", this._onNotesMouseDown)
    this.element.removeEventListener("mousemove", this._onHoverTipMove, true)
    this.element.removeEventListener("mouseleave", this._onHoverTipLeave, true)
    this.element.removeEventListener("mouseenter", this._boundRangeEnter, true)
    this.element.removeEventListener("mouseleave", this._boundRangeLeave, true)
    this._hideHoverTip()
    if (this._hoverTipEl?.isConnected) this._hoverTipEl.remove()
    this._stopTicker()
    if (this._rafFrame) { cancelAnimationFrame(this._rafFrame); this._rafFrame = null }
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  updateNotes() {
    this._moveCaretOffTimerCountdownRow({ createRowIfMissing: true, dispatchInput: false })
    const text = this.notesInputTarget.value
    this._renderAll(text)
    this._scheduleAutosave()
  }

  syncBackdropScroll() {
    // Transform-based scroll sync — no scrollHeight reads, no drift
    const ta = this.notesInputTarget
    const bd = this.notesBackdropTarget
    const inner = bd.firstElementChild
    if (!inner) return
    bd.scrollTop = 0; bd.scrollLeft = 0
    inner.style.transform = `translateY(${-ta.scrollTop}px) translateX(${-ta.scrollLeft}px)`
  }

  handleNotesKeydown(event) {
    const movedFromCountdown = this._moveCaretOffTimerCountdownRow({ createRowIfMissing: true, dispatchInput: true })
    if (movedFromCountdown && event.key === "Enter") {
      event.preventDefault()
      return
    }

    const textarea = this.notesInputTarget

    // When the cursor is on a trigger line itself, modeAtOffset returns the
    // *previous* mode (it breaks before processing the current line). Handle
    // Enter on trigger lines here before delegating to mode-specific keydown.
    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) {
      const ss   = textarea.selectionStart
      const text = textarea.value
      const lineStart  = text.lastIndexOf("\n", ss - 1) + 1
      const lineEndIdx = text.indexOf("\n", ss)
      const lineEnd    = lineEndIdx === -1 ? text.length : lineEndIdx
      const currentLine = text.slice(lineStart, lineEnd)
      const tm = TRIGGER_RE.exec(currentLine.trim())
      if (tm) {
        const triggeredMode = MODE_BY_TRIGGER.get(tm[1].toLowerCase())
        if (triggeredMode && isFirstRecognizedTriggerOccurrenceAtLine(text, lineStart)) {
          event.preventDefault()
          const nextPrefix = triggeredMode.id === "tasklist" ? "☐ " : ""
          textarea.setRangeText(`\n${nextPrefix}`, ss, textarea.selectionEnd, "end")
          textarea.dispatchEvent(new Event("input", { bubbles: true }))
          return
        }
      }
    }

    const mode = modeAtOffset(textarea.value, textarea.selectionStart)
    if (!mode) return

    const handled = mode.handleKeydown(event, textarea)
    // If mode used setRangeText it already fired "input" — nothing more needed.
    void handled
  }

  handleNotesMousemove(event) {
    const textarea = this.notesInputTarget
    const hasTasklist = this._segments.some(s => s.mode?.id === "tasklist")
    if (!hasTasklist) {
      textarea.style.cursor = ""
      return
    }

    const hit = taskCheckboxHitAtEvent(event, textarea)
    textarea.style.cursor = hit?.hitBox ? "pointer" : ""
  }

  handleNotesClick(event) {
    if (this._moveCaretOffTimerCountdownRow({ createRowIfMissing: true, dispatchInput: true })) return

    const textarea = this.notesInputTarget
    // Only tasklist uses click (checkbox toggle)
    const hasTasklist = this._segments.some(s => s.mode?.id === "tasklist")
    if (!hasTasklist) return

    const toggleResult = TasklistMode.handleClick(event, textarea)
    if (toggleResult != null) {
      textarea.value = toggleResult.text
      textarea.setSelectionRange(toggleResult.caretPos, toggleResult.caretPos)
      this._renderAll(toggleResult.text)
      this._scheduleAutosave()
    }
    this._preTaskToggleSelection = null
  }

  _captureTaskToggleSelection(event) {
    const textarea = this.notesInputTarget
    const hasTasklist = this._segments.some(s => s.mode?.id === "tasklist")
    if (!hasTasklist) {
      this._preTaskToggleSelection = null
      return
    }

    const hit = taskCheckboxHitAtEvent(event, textarea)
    if (hit?.hitBox) {
      this._preTaskToggleSelection = {
        start: textarea.selectionStart,
        end: textarea.selectionEnd
      }
      return
    }

    this._preTaskToggleSelection = null
  }

  _moveCaretOffTimerCountdownRow({ createRowIfMissing = false, dispatchInput = false } = {}) {
    const textarea = this.notesInputTarget
    const ss = textarea.selectionStart
    const se = textarea.selectionEnd
    if (ss !== se) return false

    const text = textarea.value
    const lineStart = text.lastIndexOf("\n", Math.max(0, ss - 1)) + 1
    const lineEndIdx = text.indexOf("\n", ss)
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx
    if (lineStart <= 0) return false

    const current = text.slice(lineStart, lineEnd).trim()
    const prevEnd = lineStart - 1
    const prevStart = text.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1
    const prev = text.slice(prevStart, prevEnd).trim()

    const isCountdownLine =
      (TIMER_LINE_RE.test(prev) && TIMER_LINE_RE.test(current)) ||
      (TIMER_VISIBLE_LINE_RE.test(prev) && TIMER_VISIBLE_LINE_RE.test(current))
    if (!isCountdownLine) return false

    if (createRowIfMissing && lineEnd >= text.length) {
      textarea.setRangeText("\n", text.length, text.length, "end")
      if (dispatchInput) textarea.dispatchEvent(new Event("input", { bubbles: true }))
    }

    const nextPos = lineEnd < textarea.value.length ? lineEnd + 1 : lineEnd
    textarea.setSelectionRange(nextPos, nextPos)
    return true
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _renderAll(text) {
    this._segments = segmentDocument(text)
    this._renderBackdrop()
    renderTimeline(this._segments, this.hasTimelineBarTarget ? this.timelineBarTarget : null)
    if (this._hoverTipTarget && !this.element.contains(this._hoverTipTarget)) this._hideHoverTip()
    this._updateSerializedContent(text)
  }

  _renderBackdrop() {
    const html = buildBackdropHtml(this._segments)
    this.notesBackdropTarget.innerHTML = `<div>${html}</div>`
    if (this._highlight) this._applyHighlight(this._highlight, true)
    this.syncBackdropScroll()
    this._scheduleScrollSync()
  }

  _scheduleScrollSync() {
    if (this._rafFrame) cancelAnimationFrame(this._rafFrame)
    this._rafFrame = requestAnimationFrame(() => {
      this.syncBackdropScroll()
      this._rafFrame = null
    })
  }

  // ── Timer ticker ───────────────────────────────────────────────────────────

  _startTicker() {
    if (this._ticker) return
    this._ticker = setInterval(() => this._tick(), 1000)
  }

  _stopTicker() {
    if (this._ticker) { clearInterval(this._ticker); this._ticker = null }
  }

  _tick() {
    if (!this._segments.some(s => s.mode?.id === "timer")) return
    for (const [key, anchor] of timerAnchors) {
      const rem    = timerRemaining(anchor)
      const safeId = key.replace(/[^a-z0-9]/gi, "-")

      // Update inline countdown text in the notes backdrop
      const cdEl = this.notesBackdropTarget.querySelector(`#qtcd-${safeId}`)
      if (cdEl) {
        cdEl.textContent = fmtCountdown(rem)
        cdEl.classList.remove("quartz-timer__countdown--warning", "quartz-timer__countdown--done")
        if (rem <= 0)       cdEl.classList.add("quartz-timer__countdown--done")
        else if (rem <= anchor.totalSeconds / 2) cdEl.classList.add("quartz-timer__countdown--warning")
      }

      // Update per-timer progress bar fill + tooltip
      const fillEl = this.hasTimelineBarTarget
        ? this.timelineBarTarget.querySelector(`#qtbf-timer-${safeId}`) : null
      const rowEl  = this.hasTimelineBarTarget
        ? this.timelineBarTarget.querySelector(`#qtbr-timer-${safeId}`) : null
      if (fillEl) {
        const totalSec = anchor.totalSeconds
        const elapsed  = totalSec - rem
        const pct = Math.min(100, (elapsed / Math.max(1, totalSec) * 100)).toFixed(2)
        fillEl.style.width = `${pct}%`
        if (rem <= 0)       fillEl.classList.add("quartz-timer-bar__fill--done")
        else if (rem <= totalSec / 2) fillEl.classList.add("quartz-timer-bar__fill--warning")
        else                fillEl.classList.remove("quartz-timer-bar__fill--done", "quartz-timer-bar__fill--warning")
      }
      const liveTip = [
        `Began: ${fmtWallClockFromMs(anchor.startedAtMs)}`,
        `Duration: ${fmtDurationHuman(anchor.totalSeconds)}`,
        `Ends: ${fmtWallClockFromMs(anchor.targetAtMs)}`,
        `Remaining: ${fmtDurationHuman(rem)}`
      ].join("\n")
      if (rowEl) {
        rowEl.dataset.hoverSummary = liveTip
      }
      if (fillEl) {
        fillEl.dataset.hoverSummary = liveTip
        const trackEl = fillEl.parentElement
        if (trackEl) trackEl.dataset.hoverSummary = liveTip
      }
    }
    this._refreshHoverTipText()
  }

  _ensureHoverTipEl() {
    if (this._hoverTipEl && this._hoverTipEl.isConnected) return this._hoverTipEl
    const el = document.createElement("div")
    el.className = "quartz-hover-tip"
    el.hidden = true
    document.body.appendChild(el)
    this._hoverTipEl = el
    return el
  }

  _handleHoverTipMove(event) {
    const target = event.target.closest("[data-hover-summary]")
    if (!target || !this.element.contains(target)) {
      this._hideHoverTip()
      return
    }

    this._hoverTipTarget = target
    const tipEl = this._ensureHoverTipEl()
    tipEl.textContent = target.dataset.hoverSummary || ""
    tipEl.hidden = false

    const pad = 12
    const x = event.clientX + pad
    const y = event.clientY + pad
    tipEl.style.left = `${x}px`
    tipEl.style.top = `${y}px`
  }

  _refreshHoverTipText() {
    if (!this._hoverTipTarget || !this._hoverTipEl || this._hoverTipEl.hidden) return
    if (!this._hoverTipTarget.isConnected) {
      this._hideHoverTip()
      return
    }
    this._hoverTipEl.textContent = this._hoverTipTarget.dataset.hoverSummary || ""
  }

  _hideHoverTip() {
    this._hoverTipTarget = null
    if (this._hoverTipEl) this._hoverTipEl.hidden = true
  }

  // ── Range hover cross-highlight ────────────────────────────────────────────

  _setupRangeHover() {
    this._boundRangeEnter = (e) => {
      const el = e.target.closest("[data-range-id]")
      if (el) this._applyHighlight(el.dataset.rangeId, true)
    }
    this._boundRangeLeave = (e) => {
      const el = e.target.closest("[data-range-id]")
      if (el) this._applyHighlight(el.dataset.rangeId, false)
    }
    this.element.addEventListener("mouseenter", this._boundRangeEnter, true)
    this.element.addEventListener("mouseleave", this._boundRangeLeave, true)
  }

  _applyHighlight(rangeId, active) {
    this._highlight = active ? rangeId : null
    for (const el of this.element.querySelectorAll(`[data-range-id="${rangeId}"]`)) {
      el.classList.toggle("is-highlighted", active)
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  _isLinkedMode() {
    return this.hasLinkedDocumentIdValue && Number(this.linkedDocumentIdValue) > 0
  }

  _updateSerializedContent(body) {
    if (!this.hasSerializedContentTarget) return
    this.serializedContentTarget.value = dumpQuartzDoc(canonicalizeTimerBody(body))
  }

  _scheduleAutosave() {
    if (!this._isLinkedMode()) return
    const form = this.element.querySelector("form")
    form?.dispatchEvent(new CustomEvent("autosave:trigger"))
  }

  _handleRemoteChanged(event) {
    const detail = event?.detail || {}
    if (Number(detail.document_id) !== Number(this.linkedDocumentIdValue)) return

    // Mirror the time card app behavior: never overwrite live typing with
    // ActionCable echo updates while the Quartz textarea is focused.
    if (document.activeElement === this.notesInputTarget) return

    const body = displayTimerBody(extractQuartzBody(detail.content?.toString() ?? ""))
    if (body !== this.notesInputTarget.value) {
      this.notesInputTarget.value = body
      this._renderAll(body)
    }
  }

  _onViewportChange() {
    if (!this.hasNotesInputTarget) return
    this._renderBackdrop()
    renderTimeline(this._segments, this.hasTimelineBarTarget ? this.timelineBarTarget : null)
  }
}
