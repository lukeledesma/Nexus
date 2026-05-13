import { Controller } from "@hotwired/stimulus"
import { NexusUserState } from "lib/nexus_user_state"

const STORAGE_KEY = "calendar.events"
const STORAGE_CALS_KEY = "calendar.cals"
const STORAGE_VIEW_KEY = "calendar.view"
const STORAGE_VIEW_DATE_KEY = "calendar.viewDate"
const SYNCED_KEYS = new Set([STORAGE_KEY, STORAGE_CALS_KEY, STORAGE_VIEW_KEY, STORAGE_VIEW_DATE_KEY])
const LEGACY_KEY_BY_NEW = {
  [STORAGE_KEY]: "nexus.calendar.events.v1",
  [STORAGE_CALS_KEY]: "nexus.calendar.cals.v1",
  [STORAGE_VIEW_KEY]: "nexus.calendar.view.v1",
  [STORAGE_VIEW_DATE_KEY]: "nexus.calendar.viewDate.v1"
}

function readSyncedOrMigrate(key) {
  if (NexusUserState.has(key)) return NexusUserState.get(key)
  const legacyKey = LEGACY_KEY_BY_NEW[key]
  if (!legacyKey) return undefined
  try {
    const raw = window.localStorage.getItem(legacyKey)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw)
    NexusUserState.set(key, parsed)
    return parsed
  } catch (_e) {
    return undefined
  }
}

function readSyncedStringOrMigrate(key) {
  if (NexusUserState.has(key)) return NexusUserState.get(key)
  const legacyKey = LEGACY_KEY_BY_NEW[key]
  if (!legacyKey) return undefined
  const raw = window.localStorage.getItem(legacyKey)
  if (raw == null) return undefined
  NexusUserState.set(key, raw)
  return raw
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const EVENT_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"]
const MINUTES_PER_DAY = 24 * 60
const TIME_CARD_FILES_BY_DATE_URL = "/apps/time_card/files_by_date"
const TIME_CARD_MARKER_ICON = '<svg class="calendar-app__time-card-marker-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m787-145 28-28-75-75v-112h-40v128l87 87Zm-587 25q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v268q-19-9-39-15.5t-41-9.5v-243H200v560h242q3 22 9.5 42t15.5 38H200Zm0-120v40-560 243-3 280Zm80-40h163q3-21 9.5-41t14.5-39H280v80Zm0-160h244q32-30 71.5-50t84.5-27v-3H280v80Zm0-160h400v-80H280v80ZM720-40q-83 0-141.5-58.5T520-240q0-83 58.5-141.5T720-440q83 0 141.5 58.5T920-240q0 83-58.5 141.5T720-40Z"/></svg>'
const DEFAULT_CALS = [
  { id: "personal", name: "Personal", color: "#3b82f6", checked: true },
  { id: "work", name: "Work", color: "#10b981", checked: true },
  { id: "family", name: "Family", color: "#f59e0b", checked: true },
  { id: "holidays", name: "Holidays", color: "#8b5cf6", checked: true }
]

export default class extends Controller {
  static targets = [
    "miniTitle", "miniGrid", "mainTitle", "body", "searchInput",
    "modal", "modalTitle", "eventTitleInput", "eventDateInput", "allDaySelect",
    "timeFields", "startTimeInput", "endTimeInput", "deleteButton",
    "calendarList", "eventCalendarSelect", "colorPicker",
    "timeRail", "timeRailMarker", "timeRailLabel"
  ]

  connect() {
    this.today = new Date()
    this.currentView = this.readView()
    const restoredViewDate = this.readViewDate()
    this.viewDate = restoredViewDate || new Date(this.today)
    this.selectedDate = new Date(this.viewDate)
    this.miniDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), 1)
    this.searchQuery = ""
    this.editingEventId = null
    this.calendars = this.readCalendars()
    this.hasPendingChanges = false
    this.saveTimer = null
    this.saveInFlight = false
    this.savePending = false
    this.latestSaveToken = 0
    this.lastPersistedToken = 0
    this.remoteTimestamp = null
    this.timeCardFilesByDate = {}
    
    // Start from synced state (if any), then load from file as source of truth.
    const restoredEvents = readSyncedOrMigrate(STORAGE_KEY)
    this.events = Array.isArray(restoredEvents) ? this.readEvents() : []
    
    this.pickedColor = EVENT_COLORS[0]
    this.boundGlobalKeydown = (event) => this.handleGlobalKeydown(event)
    this.boundChromeNewEvent = (event) => this.handleChromeNewEvent(event)
    this.boundDragMove = (event) => this.handleEventDragMove(event)
    this.boundDragEnd = (event) => this.handleEventDragEnd(event)
    this.boundUserStateLoaded = (event) => this.handleUserStateLoaded(event)
    this.boundRemoteDocumentChanged = (event) => this.handleRemoteDocumentChanged(event)
    this.activeDrag = null
    this.suppressEditUntil = 0
    window.addEventListener("keydown", this.boundGlobalKeydown)
    window.addEventListener("nexus:calendar-new-event", this.boundChromeNewEvent)
    window.addEventListener("nexus:user-state-loaded", this.boundUserStateLoaded)
    window.addEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
    this.renderAll()

    this.loadTimeCardFilesByDate().then((loaded) => {
      if (loaded) this.renderBody()
    }).catch((_error) => {
      // non-blocking
    })
    
    // Load from file as the authoritative source. Only seed samples when no file exists.
    this.loadEventsFromFile().then((loaded) => {
      if (loaded) {
        this.renderAll()
        return
      }

      if (this.events.length === 0) {
        this.events = this.sampleEvents()
        this.persistEvents()
        this.renderAll()
      }
    }).catch((error) => {
      console.error("Failed to load events from file:", error)
    })

    // Listen for push notifications from the Action Cable sync channel.
    this.boundCalendarRemoteChanged = (event) => this.handleCalendarRemoteChanged(event)
    window.addEventListener("nexus:calendar-remote-changed", this.boundCalendarRemoteChanged)
  }

  disconnect() {
    window.removeEventListener("keydown", this.boundGlobalKeydown)
    window.removeEventListener("nexus:calendar-new-event", this.boundChromeNewEvent)
    window.removeEventListener("nexus:user-state-loaded", this.boundUserStateLoaded)
    window.removeEventListener("nexus:document-remote-changed", this.boundRemoteDocumentChanged)
    window.removeEventListener("pointermove", this.boundDragMove)
    window.removeEventListener("pointerup", this.boundDragEnd)
    window.removeEventListener("pointercancel", this.boundDragEnd)
    window.removeEventListener("nexus:calendar-remote-changed", this.boundCalendarRemoteChanged)
  }

  handleUserStateLoaded(event) {
    const changed = new Set(event.detail?.changedKeys || [])
    if (![...SYNCED_KEYS].some((k) => changed.has(k))) return

    if (changed.has(STORAGE_KEY)) this.events = this.readEvents()
    if (changed.has(STORAGE_CALS_KEY)) this.calendars = this.readCalendars()
    if (changed.has(STORAGE_VIEW_KEY)) this.currentView = this.readView()
    if (changed.has(STORAGE_VIEW_DATE_KEY)) {
      const restored = this.readViewDate()
      if (restored) {
        this.viewDate = restored
        this.selectedDate = new Date(restored)
        this.miniDate = new Date(restored.getFullYear(), restored.getMonth(), 1)
      }
    }
    this.renderAll()
  }

  handleRemoteDocumentChanged(event) {
    // When time card date changes, reload time cards to update calendar display
    const detail = event?.detail || {}
    if (String(detail.content_type || "") === "note") {
      // Time card changed; reload time cards by date
      this.loadTimeCardFilesByDate().then((loaded) => {
        if (loaded) this.renderBody()
      }).catch((_error) => {
        // non-blocking
      })
    }
  }

  async handleCalendarRemoteChanged({ detail }) {
    // Skip if our own write just echoed back (timestamps match).
    if (detail?.updated_at && detail.updated_at === this.remoteTimestamp) return
    // Skip if we have a local write in progress — our version will win.
    if (this.saveInFlight || this.savePending || this.latestSaveToken !== this.lastPersistedToken) return
    this.remoteTimestamp = detail?.updated_at || null
    const loaded = await this.loadEventsFromFile()
    if (loaded) this.renderAll()
  }

  readCalendars() {
    const parsed = readSyncedOrMigrate(STORAGE_CALS_KEY)
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CALS.map((c) => ({ ...c }))
    return parsed.map((c) => ({ ...c, checked: c.checked !== false }))
  }

  persistCalendars() {
    NexusUserState.set(STORAGE_CALS_KEY, this.calendars)
  }

  readEvents() {
    const parsed = readSyncedOrMigrate(STORAGE_KEY)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e) => e && typeof e.title === "string" && typeof e.date === "string")
  }

  persistEvents() {
    // Save to session storage immediately
    NexusUserState.set(STORAGE_KEY, this.events)

    // Track unsaved changes; latest token must reach disk before we emit "saved".
    this.latestSaveToken += 1
    
    // Publish dirty state immediately
    window.dispatchEvent(new CustomEvent("nexus:item-dirty", {
      detail: { frameId: this.currentFrameId(), itemType: "calendar_events" }
    }))
    
    // Clear any pending save timer
    if (this.saveTimer) clearTimeout(this.saveTimer)
    
    // Debounce the file save to avoid too many requests
    this.saveTimer = setTimeout(() => {
      this.persistEventsToFile()
    }, 250)
  }

  async persistEventsToFile() {
    if (this.saveInFlight) {
      this.savePending = true
      return
    }

    this.saveInFlight = true
    const tokenAtStart = this.latestSaveToken
    let savedTimestamp = null

    try {
      // Publish saving state before the fetch
      window.dispatchEvent(new CustomEvent("nexus:item-saving", {
        detail: { frameId: this.currentFrameId(), itemType: "calendar_events" }
      }))

      // Convert events array to a date-keyed object format
      const eventsByDate = {}
      this.events.forEach(event => {
        if (!eventsByDate[event.date]) {
          eventsByDate[event.date] = []
        }
        eventsByDate[event.date].push({
          title: event.title,
          time: event.start || "",
          end: event.end || "",
          color: event.color || "",
          calendar: event.cal || "personal",
          all_day: event.allDay || false
        })
      })

      const response = await fetch("/apps/calendar/save_events", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": this.getCsrfToken() },
        body: JSON.stringify({ events_json: JSON.stringify(eventsByDate) })
      })

      if (response.ok) {
        const json = await response.json()
        this.lastPersistedToken = Math.max(this.lastPersistedToken, tokenAtStart)
        savedTimestamp = json.updated_at || new Date().toISOString()
        // Keep remoteTimestamp in sync so the poller won't re-fetch our own write.
        if (json.updated_at) this.remoteTimestamp = json.updated_at
      } else {
        console.error("Failed to save calendar events")
      }
    } catch (error) {
      console.error("Error saving calendar events:", error)
    } finally {
      this.saveInFlight = false

      // If changes arrived while this request was in flight, flush again immediately.
      if (this.savePending || this.lastPersistedToken < this.latestSaveToken) {
        this.savePending = false
        this.persistEventsToFile()
        return
      }

      // Only mark as saved when the newest known change is persisted.
      if (this.lastPersistedToken >= this.latestSaveToken) {
        window.dispatchEvent(new CustomEvent("nexus:item-saved", {
          detail: {
            frameId: this.currentFrameId(),
            itemType: "calendar_events",
            timestamp: savedTimestamp || new Date().toISOString()
          }
        }))
      }
    }
  }

  async loadEventsFromFile() {
    try {
      const response = await fetch("/apps/calendar/draft_file")
      if (!response.ok) return false

      const data = await response.json()
      if (!data.ok || !data.events) return false

      // Convert from date-keyed object to events array
      const eventsByDate = data.events
      const events = []
      let eventId = 1

      Object.entries(eventsByDate).forEach(([date, dateEvents]) => {
        Array.isArray(dateEvents) && dateEvents.forEach(event => {
          const calendarId = (event.calendar || "personal").toString().trim() || "personal"
          events.push({
            id: `event_${eventId++}`,
            title: event.title || "",
            date: date,
            allDay: this.parseAllDayFlag(event.all_day),
            start: event.time || "",
            end: this.parseEndTime(event),
            cal: calendarId,
            color: event.color || "#3b82f6"
          })
        })
      })

      // Keep UI in sync with file even when file has zero events.
      this.events = events
      NexusUserState.set(STORAGE_KEY, this.events)

      // Stamp the remote timestamp we loaded from so the poller has a baseline.
      if (data.updated_at) this.remoteTimestamp = data.updated_at

      const calendarsChanged = this.ensureCalendarsForEvents(events)
      if (calendarsChanged) {
        this.persistCalendars()
      }

      return true
    } catch (error) {
      console.error("Error loading calendar events from file:", error)
      return false
    }
  }

  parseAllDayFlag(value) {
    if (value === true) return true
    if (typeof value === "string") return value.trim().toLowerCase() === "true"
    return false
  }

  parseEndTime(event) {
    const explicitEnd = (event.end || event.end_time || "").toString().trim()
    if (explicitEnd) return explicitEnd

    // Backward compatibility: old files only stored start time.
    const start = (event.time || "").toString().trim()
    if (!start) return ""

    const startMinutes = this.timeToMinutes(start)
    return this.minutesToTime(Math.min(MINUTES_PER_DAY - 1, startMinutes + 30))
  }

  ensureCalendarsForEvents(events) {
    const known = new Set(this.calendars.map((c) => c.id))
    let changed = false

    events.forEach((event) => {
      const id = (event.cal || "").toString().trim()
      if (!id || known.has(id)) return

      this.calendars.push({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
        color: event.color || EVENT_COLORS[0],
        checked: true
      })
      known.add(id)
      changed = true
    })

    return changed
  }

  currentFrameId() {
    return this.element.closest("turbo-frame")?.id || "calendar-pane"
  }

  getCsrfToken() {
    const token = document.querySelector('meta[name="csrf-token"]')
    return token ? token.getAttribute("content") : ""
  }

  readView() {
    const saved = String(readSyncedStringOrMigrate(STORAGE_VIEW_KEY) || "month")
    return ["month", "week", "day"].includes(saved) ? saved : "month"
  }

  persistView() {
    NexusUserState.set(STORAGE_VIEW_KEY, this.currentView)
  }

  readViewDate() {
    const saved = readSyncedStringOrMigrate(STORAGE_VIEW_DATE_KEY)
    const parsed = this.parseYmd(saved)
    return parsed || null
  }

  persistViewDate() {
    NexusUserState.set(STORAGE_VIEW_DATE_KEY, this.fmt(this.viewDate))
  }

  renderAll() {
    this.renderCalendarList()
    this.renderCalendarSelect()
    this.renderMini()
    this.renderBody()
    this.renderViewButtons()
  }

  renderCalendarList() {
    this.calendarListTarget.innerHTML = this.calendars.map((cal) => `
      <button type="button" class="calendar-app__cal-item ${cal.checked ? "is-checked" : ""}" data-action="calendar-app#toggleCalendar" data-cal-id="${cal.id}">
        <span class="calendar-app__cal-dot" style="background:${cal.color}"></span>
        <span class="calendar-app__cal-name">${this.escape(cal.name)}</span>
        <span class="calendar-app__cal-check" style="${cal.checked ? `background:${cal.color}` : ""}">${cal.checked ? "✓" : ""}</span>
      </button>
    `).join("")
  }

  renderCalendarSelect() {
    this.eventCalendarSelectTarget.innerHTML = this.calendars
      .map((cal) => `<option value="${cal.id}">${this.escape(cal.name)}</option>`)
      .join("")
  }

  renderMini() {
    const y = this.miniDate.getFullYear()
    const m = this.miniDate.getMonth()
    this.miniTitleTarget.textContent = `${MONTHS[m].slice(0, 3)} ${y}`
    const first = new Date(y, m, 1).getDay()
    const days = new Date(y, m + 1, 0).getDate()
    const prevDays = new Date(y, m, 0).getDate()

    let html = DAYS.map((d) => `<div class="calendar-app__mini-dow">${d[0]}</div>`).join("")
    for (let i = 0; i < first; i++) html += `<div class="calendar-app__mini-day">${prevDays - first + 1 + i}</div>`
    for (let d = 1; d <= days; d++) {
      const date = new Date(y, m, d)
      const classes = ["calendar-app__mini-day", "is-current"]
      if (this.sameDay(date, this.today)) classes.push("is-today")
      if (this.sameDay(date, this.selectedDate)) classes.push("is-selected")
      html += `<button type="button" class="${classes.join(" ")}" data-action="calendar-app#selectMiniDate" data-y="${y}" data-m="${m}" data-d="${d}">${d}</button>`
    }
    const remain = 42 - first - days
    for (let d = 1; d <= remain; d++) html += `<div class="calendar-app__mini-day">${d}</div>`
    this.miniGridTarget.innerHTML = html
  }

  renderBody() {
    this.bodyTarget.classList.toggle("calendar-app__body--time", this.currentView === "week" || this.currentView === "day")
    if (this.currentView === "week") {
      this.renderWeek()
      return
    }
    if (this.currentView === "day") {
      this.renderDay()
      return
    }
    this.renderMonth()
  }

  filteredEvents() {
    const q = this.searchQuery.trim().toLowerCase()
    const checked = new Set(this.calendars.filter((c) => c.checked).map((c) => c.id))
    const base = this.events.filter((e) => checked.has(e.cal))
    if (!q) return base
    return base.filter((e) => e.title.toLowerCase().includes(q))
  }

  renderMonth() {
    const y = this.viewDate.getFullYear()
    const m = this.viewDate.getMonth()
    this.mainTitleTarget.textContent = `${MONTHS[m]} ${y}`
    const first = new Date(y, m, 1).getDay()
    const days = new Date(y, m + 1, 0).getDate()
    const prevDays = new Date(y, m, 0).getDate()
    const cells = []
    const events = this.filteredEvents()

    for (let i = 0; i < 42; i++) {
      let dateObj
      let day
      let current = true
      if (i < first) {
        day = prevDays - first + 1 + i
        dateObj = new Date(y, m - 1, day)
        current = false
      } else if (i >= first + days) {
        day = i - first - days + 1
        dateObj = new Date(y, m + 1, day)
        current = false
      } else {
        day = i - first + 1
        dateObj = new Date(y, m, day)
      }
      const dateKey = this.fmt(dateObj)
      const dayEvents = events.filter((e) => e.date === dateKey)
        .sort((a, b) => (a.start || "").localeCompare(b.start || ""))
        .slice(0, 3)
      const timeCardMarker = this.renderTimeCardMarker(dateKey, "month")
      const classes = ["calendar-app__month-cell"]
      if (!current) classes.push("is-other")
      if (this.sameDay(dateObj, this.today)) classes.push("is-today")
      if (this.sameDay(dateObj, this.selectedDate)) classes.push("is-selected")
      if (timeCardMarker) classes.push("has-time-card")
      cells.push(`
        <div class="${classes.join(" ")}" data-action="click->calendar-app#pickDate" data-date="${dateKey}">
          ${timeCardMarker}
          <span class="calendar-app__month-day">${day}</span>
          <span class="calendar-app__month-events">
            ${dayEvents.map((e) => `<button type="button" class="calendar-app__month-event" data-action="pointerdown->calendar-app#startEventDrag click->calendar-app#editEvent" data-event-id="${e.id}" style="background:${e.color}" title="${this.escape(e.title)}">${this.escape(e.title)}</button>`).join("")}
          </span>
        </div>
      `)
    }

    this.bodyTarget.innerHTML = `
      <div class="calendar-app__month-view">
        <div class="calendar-app__month-header">${DAYS.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="calendar-app__month-grid">${cells.join("")}</div>
      </div>
    `
  }

  renderWeek() {
    const start = this.startOfWeek(this.viewDate)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    this.mainTitleTarget.textContent = `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()} - ${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}`

    const events = this.filteredEvents()
    const timeGutter = `
      <section class="calendar-app__time-gutter">
        <header></header>
        <div class="calendar-app__time-gutter-track">
          ${Array.from({ length: 24 }).map((_, hour) => {
            const topPct = (hour / 24) * 100
            return `<span class="calendar-app__time-gutter-label" style="top:${topPct}%">${this.prettyTime(`${String(hour).padStart(2, "0")}:00`)}</span>`
          }).join("")}
        </div>
      </section>
    `

    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const key = this.fmt(d)
      const timeCardMarker = this.renderTimeCardMarker(key, "week-header")
      const dayEvents = events.filter((e) => e.date === key)
      const timedEvents = dayEvents.filter((e) => !e.allDay)
      const allDayEvents = dayEvents.filter((e) => e.allDay)
      return `
        <section class="calendar-app__week-day-time">
          <header data-action="click->calendar-app#openWeekHeaderDay" data-date="${key}"><span class="calendar-app__time-header-row"><span>${DAYS[d.getDay()]} ${d.getDate()}</span>${timeCardMarker}</span></header>
          <div class="calendar-app__week-track" data-date-key="${key}">
            <div class="calendar-app__hour-grid"></div>
            ${allDayEvents.map((e) => `<button type="button" class="calendar-app__week-event calendar-app__week-event--all-day" data-action="pointerdown->calendar-app#startEventDrag click->calendar-app#editEvent" data-event-id="${e.id}" style="background:${e.color}" title="${this.escape(e.title)}">${this.escape(e.title)}</button>`).join("")}
            ${timedEvents.map((e) => {
              const startMin = this.timeToMinutes(e.start)
              const endMin = this.timeToMinutes(e.end)
              const top = Math.max(0, Math.min(MINUTES_PER_DAY - 1, startMin))
              let duration = Math.max(20, endMin - startMin)
              if (!Number.isFinite(duration) || duration <= 0) duration = 30
              if (top + duration > MINUTES_PER_DAY) duration = MINUTES_PER_DAY - top
              const topPct = (top / MINUTES_PER_DAY) * 100
              const heightPct = (duration / MINUTES_PER_DAY) * 100
              return `<button type="button" class="calendar-app__week-event calendar-app__week-event--timed" data-action="pointerdown->calendar-app#startEventDrag click->calendar-app#editEvent" data-event-id="${e.id}" style="top:${topPct}%;height:${heightPct}%;background:${e.color}" title="${this.escape(e.title)}">${this.escape(e.title)}<small>${this.prettyTime(e.start)} - ${this.prettyTime(e.end)}</small></button>`
            }).join("")}
          </div>
        </section>
      `
    })
    this.bodyTarget.innerHTML = `
      <div class="calendar-app__time-layout calendar-app__time-layout--inside-left">
        <div class="calendar-app__time-scroll">
          <div class="calendar-app__week-grid-time">${timeGutter}${days.join("")}</div>
        </div>
      </div>
    `
  }

  renderDay() {
    const dateKey = this.fmt(this.viewDate)
    this.mainTitleTarget.textContent = `${DAYS[this.viewDate.getDay()]}, ${MONTHS[this.viewDate.getMonth()]} ${this.viewDate.getDate()}`
    const events = this.filteredEvents().filter((e) => e.date === dateKey)
    const timedEvents = events.filter((e) => !e.allDay)
    const allDayEvents = events.filter((e) => e.allDay)
    const timeCardMarker = this.renderTimeCardMarker(dateKey, "day-header")
    const timeGutter = `
      <section class="calendar-app__time-gutter">
        <header></header>
        <div class="calendar-app__time-gutter-track">
          ${Array.from({ length: 24 }).map((_, hour) => {
            const topPct = (hour / 24) * 100
            return `<span class="calendar-app__time-gutter-label" style="top:${topPct}%">${this.prettyTime(`${String(hour).padStart(2, "0")}:00`)}</span>`
          }).join("")}
        </div>
      </section>
    `

    this.bodyTarget.innerHTML = `
      <div class="calendar-app__time-layout calendar-app__time-layout--inside-left">
        <div class="calendar-app__time-scroll">
          <div class="calendar-app__week-grid-time calendar-app__week-grid-time--day">
            ${timeGutter}
            <section class="calendar-app__day-time">
              <header><span class="calendar-app__time-header-row"><span>${DAYS[this.viewDate.getDay()]} ${this.viewDate.getDate()}</span>${timeCardMarker}</span></header>
              <div class="calendar-app__day-track" data-date-key="${dateKey}">
                <div class="calendar-app__hour-grid"></div>
                ${allDayEvents.map((e) => `<button type="button" class="calendar-app__day-event calendar-app__day-event--all-day" data-action="pointerdown->calendar-app#startEventDrag click->calendar-app#editEvent" data-event-id="${e.id}" style="background:${e.color}">${this.escape(e.title)}<small>All day</small></button>`).join("")}
                ${timedEvents.map((e) => {
                  const startMin = this.timeToMinutes(e.start)
                  const endMin = this.timeToMinutes(e.end)
                  const top = Math.max(0, Math.min(MINUTES_PER_DAY - 1, startMin))
                  let duration = Math.max(20, endMin - startMin)
                  if (!Number.isFinite(duration) || duration <= 0) duration = 30
                  if (top + duration > MINUTES_PER_DAY) duration = MINUTES_PER_DAY - top
                  const topPct = (top / MINUTES_PER_DAY) * 100
                  const heightPct = (duration / MINUTES_PER_DAY) * 100
                  return `<button type="button" class="calendar-app__day-event calendar-app__day-event--timed" data-action="pointerdown->calendar-app#startEventDrag click->calendar-app#editEvent" data-event-id="${e.id}" style="top:${topPct}%;height:${heightPct}%;background:${e.color}">
                    <strong>${this.escape(e.title)}</strong>
                    <small>${this.prettyTime(e.start)} - ${this.prettyTime(e.end)}</small>
                  </button>`
                }).join("")}
                ${events.length === 0 ? `<p class="calendar-app__empty calendar-app__empty--time">No events for this date.</p>` : ""}
              </div>
            </section>
          </div>
        </div>
      </div>
    `
  }

  renderViewButtons() {
    this.element.querySelectorAll(".calendar-app__view-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.view === this.currentView)
    })
  }

  pickDate(event) {
    const date = this.parseYmd(event.currentTarget.dataset.date)
    if (!date) return
    const isSameSelection = this.selectedDate && this.sameDay(date, this.selectedDate)
    this.selectedDate = isSameSelection ? null : date
    this.viewDate = new Date(date)
    this.miniDate = new Date(date.getFullYear(), date.getMonth(), 1)
    this.persistViewDate()
    this.renderAll()
  }

  selectMiniDate(event) {
    const y = Number(event.currentTarget.dataset.y)
    const m = Number(event.currentTarget.dataset.m)
    const d = Number(event.currentTarget.dataset.d)
    const picked = new Date(y, m, d)
    const isSameSelection = this.selectedDate && this.sameDay(picked, this.selectedDate)
    this.selectedDate = isSameSelection ? null : picked
    this.viewDate = new Date(y, m, d)
    this.miniDate = new Date(y, m, 1)
    this.persistViewDate()
    this.renderAll()
  }

  miniPrev() {
    this.miniDate = new Date(this.miniDate.getFullYear(), this.miniDate.getMonth() - 1, 1)
    this.renderMini()
  }

  miniNext() {
    this.miniDate = new Date(this.miniDate.getFullYear(), this.miniDate.getMonth() + 1, 1)
    this.renderMini()
  }

  goPrev() {
    if (this.currentView === "month") this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() - 1, 1)
    else if (this.currentView === "week") this.viewDate = new Date(this.viewDate.getTime() - (7 * 86400000))
    else this.viewDate = new Date(this.viewDate.getTime() - 86400000)
    this.selectedDate = new Date(this.viewDate)
    this.persistViewDate()
    this.renderAll()
  }

  goNext() {
    if (this.currentView === "month") this.viewDate = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + 1, 1)
    else if (this.currentView === "week") this.viewDate = new Date(this.viewDate.getTime() + (7 * 86400000))
    else this.viewDate = new Date(this.viewDate.getTime() + 86400000)
    this.selectedDate = new Date(this.viewDate)
    this.persistViewDate()
    this.renderAll()
  }

  goToday() {
    this.viewDate = new Date(this.today)
    this.selectedDate = new Date(this.today)
    this.miniDate = new Date(this.today.getFullYear(), this.today.getMonth(), 1)
    this.persistViewDate()
    this.renderAll()
  }

  setMonthView() {
    this.currentView = "month"
    this.persistView()
    this.renderAll()
  }

  setWeekView() {
    this.currentView = "week"
    if (!this.selectedDate) {
      this.viewDate = new Date(this.today)
      this.persistViewDate()
    }
    this.persistView()
    this.renderAll()
  }

  setDayView() {
    this.currentView = "day"
    if (!this.selectedDate) {
      this.viewDate = new Date(this.today)
      this.persistViewDate()
    }
    this.persistView()
    this.renderAll()
  }

  openWeekHeaderDay(event) {
    const date = this.parseYmd(event.currentTarget.dataset.date)
    if (!date) return
    this.selectedDate = new Date(date)
    this.viewDate = new Date(date)
    this.miniDate = new Date(date.getFullYear(), date.getMonth(), 1)
    this.currentView = "day"
    this.persistViewDate()
    this.persistView()
    this.renderAll()
  }

  handleSearch() {
    this.searchQuery = this.hasSearchInputTarget ? (this.searchInputTarget.value || "") : ""
    this.renderBody()
  }

  async loadTimeCardFilesByDate() {
    try {
      const response = await fetch(TIME_CARD_FILES_BY_DATE_URL, { headers: { Accept: "application/json" } })
      if (!response.ok) return false
      const payload = await response.json()
      this.timeCardFilesByDate = payload && typeof payload.files_by_date === "object" ? payload.files_by_date : {}
      return true
    } catch (_error) {
      this.timeCardFilesByDate = {}
      return false
    }
  }

  renderTimeCardMarker(dateKey, context) {
    const entry = this.timeCardFilesByDate?.[dateKey]
    if (!entry?.document_id) return ""

    const label = this.escape(entry.title || "Time Card")
    const contextClass = context ? ` calendar-app__time-card-marker--${context}` : ""
    return `<button type="button" class="calendar-app__time-card-marker${contextClass}" data-action="click->calendar-app#openTimeCardFromMarker" data-date="${dateKey}" data-document-id="${entry.document_id}" data-document-title="${this.escapeAttr(entry.title || "Time Card")}" title="Open Time Card: ${label}">${TIME_CARD_MARKER_ICON}</button>`
  }

  openTimeCardFromMarker(event) {
    event.preventDefault()
    event.stopPropagation()

    const button = event.currentTarget
    const documentId = String(button?.dataset?.documentId || "").trim()
    if (!documentId) return
    const documentTitle = String(button?.dataset?.documentTitle || "").trim()

    window.dispatchEvent(new CustomEvent("app-window:open", {
      detail: {
        appKey: "time-card",
        documentId,
        documentTitle
      }
    }))
  }

  handleTimeHover() {}
  clearTimeHover() {}

  toggleCalendar(event) {
    const id = event.currentTarget.dataset.calId
    const cal = this.calendars.find((c) => c.id === id)
    if (!cal) return
    cal.checked = !cal.checked
    this.persistCalendars()
    this.renderAll()
  }

  openNewEventModal() {
    this.editingEventId = null
    this.modalTitleTarget.textContent = "New event"
    this.deleteButtonTarget.classList.add("hidden")
    this.eventTitleInputTarget.value = ""
    this.eventDateInputTarget.value = this.fmt(this.selectedDate)
    this.allDaySelectTarget.value = "yes"
    this.startTimeInputTarget.value = "09:00"
    this.endTimeInputTarget.value = "10:00"
    this.eventCalendarSelectTarget.value = this.calendars[0]?.id || "personal"
    this.pickColor(EVENT_COLORS[0])
    this.renderColorPicker()
    this.toggleTimeFields()
    this.modalTarget.classList.remove("hidden")
    this.eventTitleInputTarget.focus()
  }

  handleChromeNewEvent(event) {
    const requestedFrameId = String(event.detail?.frameId || "")
    if (requestedFrameId && requestedFrameId !== this.currentFrameId()) return
    this.openNewEventModal()
  }

  editEvent(event) {
    if (Date.now() < this.suppressEditUntil) return
    event.preventDefault()
    event.stopPropagation()
    const ev = this.events.find((item) => item.id === event.currentTarget.dataset.eventId)
    if (!ev) return
    this.openEditEvent(ev)
  }

  openEditEvent(ev) {
    this.editingEventId = ev.id
    this.modalTitleTarget.textContent = "Edit event"
    this.deleteButtonTarget.classList.remove("hidden")
    this.eventTitleInputTarget.value = ev.title
    this.eventDateInputTarget.value = ev.date
    this.allDaySelectTarget.value = ev.allDay ? "yes" : "no"
    this.startTimeInputTarget.value = ev.start || "09:00"
    this.endTimeInputTarget.value = ev.end || "10:00"
    this.eventCalendarSelectTarget.value = ev.cal || (this.calendars[0]?.id || "personal")
    this.pickColor(ev.color || EVENT_COLORS[0])
    this.renderColorPicker()
    this.toggleTimeFields()
    this.modalTarget.classList.remove("hidden")
    this.eventTitleInputTarget.focus()
  }

  startEventDrag(event) {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const eventId = target.dataset.eventId
    if (!eventId) return
    const ev = this.events.find((item) => item.id === eventId)
    if (!ev) return

    event.preventDefault()
    event.stopPropagation()

    const rect = target.getBoundingClientRect()
    const proxy = target.cloneNode(true)
    proxy.classList.add("calendar-app__drag-proxy")
    proxy.style.width = `${Math.max(120, rect.width)}px`
    proxy.style.height = `${Math.max(24, rect.height)}px`
    proxy.style.left = `${rect.left}px`
    proxy.style.top = `${rect.top}px`
    document.body.appendChild(proxy)

    const startMinutes = this.timeToMinutes(ev.start)
    const endMinutes = this.timeToMinutes(ev.end)
    const duration = Math.max(15, endMinutes - startMinutes)
    let grabOffsetMinutes = 0
    if (!ev.allDay) {
      const startTrack = target.closest(".calendar-app__week-track, .calendar-app__day-track")
      if (startTrack instanceof HTMLElement) {
        const trackRect = startTrack.getBoundingClientRect()
        const safeHeight = Math.max(1, trackRect.height)
        const pointerMinutes = ((Math.max(0, Math.min(safeHeight, event.clientY - trackRect.top))) / safeHeight) * MINUTES_PER_DAY
        grabOffsetMinutes = Math.max(0, Math.min(duration, pointerMinutes - startMinutes))
      }
    }

    target.classList.add("calendar-app__event-origin-ghost")
    this.activeDrag = {
      id: eventId,
      event: { ...ev },
      originEl: target,
      proxyEl: proxy,
      moved: false,
      isTimed: !ev.allDay,
      duration,
      grabOffsetMinutes,
      startX: event.clientX,
      startY: event.clientY,
      preview: null
    }

    window.addEventListener("pointermove", this.boundDragMove)
    window.addEventListener("pointerup", this.boundDragEnd)
    window.addEventListener("pointercancel", this.boundDragEnd)
  }

  handleEventDragMove(event) {
    if (!this.activeDrag) return
    const drag = this.activeDrag
    const dx = Math.abs(event.clientX - drag.startX)
    const dy = Math.abs(event.clientY - drag.startY)
    if (dx + dy > 3) drag.moved = true
    if (!drag.moved) return
    this.updateDragPreview(event.clientX, event.clientY)
  }

  handleEventDragEnd(event) {
    if (!this.activeDrag) return
    const drag = this.activeDrag
    this.cleanupEventDragArtifacts()

    if (!drag.moved) {
      this.openEditEvent(drag.event)
      return
    }

    const preview = drag.preview
    if (!preview) return

    const updated = { ...drag.event, date: preview.dateKey }
    if (drag.isTimed && preview.mode === "time") {
      updated.start = this.minutesToTime(preview.startMinutes)
      updated.end = this.minutesToTime(preview.endMinutes)
    }

    this.events = this.events.map((item) => (item.id === updated.id ? updated : item))
    this.persistEvents()
    this.renderAll()
    this.suppressEditUntil = Date.now() + 250
  }

  cleanupEventDragArtifacts() {
    const drag = this.activeDrag
    this.activeDrag = null
    window.removeEventListener("pointermove", this.boundDragMove)
    window.removeEventListener("pointerup", this.boundDragEnd)
    window.removeEventListener("pointercancel", this.boundDragEnd)
    if (!drag) return
    if (drag.originEl && drag.originEl.isConnected) drag.originEl.classList.remove("calendar-app__event-origin-ghost")
    if (drag.proxyEl && drag.proxyEl.isConnected) drag.proxyEl.remove()
  }

  updateDragPreview(clientX, clientY) {
    if (!this.activeDrag?.proxyEl) return
    const drag = this.activeDrag
    const dropTarget = document.elementFromPoint(clientX, clientY)
    const track = dropTarget?.closest?.(".calendar-app__week-track, .calendar-app__day-track")
    if (track instanceof HTMLElement) {
      const dateKey = track.dataset.dateKey
      if (!dateKey) return
      const rect = track.getBoundingClientRect()
      const safeHeight = Math.max(1, rect.height)
      const y = Math.max(0, Math.min(safeHeight, clientY - rect.top))
      const rawMinutes = (y / safeHeight) * MINUTES_PER_DAY
      const anchoredMinutes = rawMinutes - (drag.grabOffsetMinutes || 0)
      const snappedStart = this.snapMinutes(anchoredMinutes, 15)
      const duration = Math.max(15, drag.duration || 30)
      const startMinutes = drag.isTimed ? Math.max(0, Math.min(MINUTES_PER_DAY - 15, snappedStart)) : 0
      const endMinutes = drag.isTimed ? Math.min(MINUTES_PER_DAY, startMinutes + duration) : 0

      drag.preview = { mode: "time", dateKey, startMinutes, endMinutes }
      this.positionDragProxy(drag, track, rect, startMinutes, duration, clientX, clientY)
      this.updateDragProxyTimeLabel(drag, startMinutes, endMinutes)
      return
    }

    const monthCell = dropTarget?.closest?.(".calendar-app__month-cell")
    if (!(monthCell instanceof HTMLElement)) return
    const dateKey = monthCell.dataset.date
    if (!dateKey) return
    const rect = monthCell.getBoundingClientRect()
    drag.preview = { mode: "month", dateKey, startMinutes: 0, endMinutes: 0 }
    this.positionDragProxyInMonthCell(drag, rect)
    this.updateDragProxyTimeLabel(drag, null, null)
  }

  positionDragProxy(drag, track, rect, startMinutes, duration, clientX, clientY) {
    if (!drag.proxyEl) return
    if (!drag.isTimed) {
      drag.proxyEl.style.width = `${Math.max(120, rect.width - 8)}px`
      drag.proxyEl.style.height = `${Math.max(24, rect.height * 0.16)}px`
      drag.proxyEl.style.left = `${rect.left + 4}px`
      drag.proxyEl.style.top = `${rect.top + 4}px`
      return
    }

    const topPct = startMinutes / MINUTES_PER_DAY
    const heightPct = Math.max(15, duration) / MINUTES_PER_DAY
    const topPx = rect.top + (topPct * rect.height)
    const heightPx = Math.max(24, rect.height * heightPct)
    drag.proxyEl.style.width = `${Math.max(120, rect.width - 8)}px`
    drag.proxyEl.style.height = `${heightPx}px`
    drag.proxyEl.style.left = `${rect.left + 4}px`
    drag.proxyEl.style.top = `${Math.min(rect.bottom - heightPx, Math.max(rect.top, topPx))}px`
  }

  positionDragProxyInMonthCell(drag, rect) {
    if (!drag.proxyEl) return
    drag.proxyEl.style.width = `${Math.max(110, rect.width - 8)}px`
    drag.proxyEl.style.height = "22px"
    drag.proxyEl.style.left = `${rect.left + 4}px`
    drag.proxyEl.style.top = `${rect.top + 24}px`
  }

  updateDragProxyTimeLabel(drag, startMinutes, endMinutes) {
    if (!drag.proxyEl || !drag.isTimed) return
    const small = drag.proxyEl.querySelector("small")
    if (!small) return
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      small.textContent = `${this.prettyTime(drag.event.start)} - ${this.prettyTime(drag.event.end)}`
      return
    }
    const label = `${this.prettyMinutes(startMinutes)} - ${this.prettyMinutes(endMinutes)}`
    if (small) small.textContent = label
  }

  closeModal() {
    this.modalTarget.classList.add("hidden")
  }

  clickModalBackdrop(event) {
    if (event.target === this.modalTarget) this.closeModal()
  }

  clickModalCard(event) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest("input, select, textarea, button, option")) return

    this.focusModalCard()
    const selection = window.getSelection?.()
    if (selection && selection.rangeCount > 0) selection.removeAllRanges()
  }

  handleModalCardPointerDown(event) {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest("input, select, textarea, button, option")) return

    // Prevent label-click default behavior from forwarding focus to nested controls
    // when clicking "blank" spacing inside form rows.
    event.preventDefault()
    this.focusModalCard()
  }

  handleGlobalKeydown(event) {
    if (event.key !== "Escape") return
    if (this.modalTarget.classList.contains("hidden")) return

    const active = document.activeElement
    if (active instanceof HTMLInputElement && active.type === "date") {
      active.blur()
      event.preventDefault()
      return
    }

    this.blurActiveModalField()
  }

  blurActiveModalField() {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (!this.modalTarget.contains(active)) return
    active.blur()
  }

  focusModalCard() {
    this.blurActiveModalField()
    const card = this.modalTarget?.querySelector(".calendar-app__modal-card")
    if (card instanceof HTMLElement) card.focus({ preventScroll: true })
  }

  toggleTimeFields() {
    const allDay = this.allDaySelectTarget.value === "yes"
    this.timeFieldsTarget.classList.toggle("hidden", allDay)
  }

  saveEvent() {
    const title = this.eventTitleInputTarget.value.trim()
    if (!title) {
      this.eventTitleInputTarget.focus()
      return
    }
    const allDay = this.allDaySelectTarget.value === "yes"
    const payload = {
      id: this.editingEventId || `event_${Date.now()}`,
      title,
      date: this.eventDateInputTarget.value || this.fmt(this.selectedDate),
      allDay,
      start: allDay ? "" : this.startTimeInputTarget.value,
      end: allDay ? "" : this.endTimeInputTarget.value,
      cal: this.eventCalendarSelectTarget.value || "personal",
      color: this.pickedColor || EVENT_COLORS[0]
    }

    if (this.editingEventId) {
      this.events = this.events.map((e) => (e.id === this.editingEventId ? { ...e, ...payload, color: e.color || payload.color } : e))
    } else {
      this.events.push(payload)
    }

    this.persistEvents()
    this.closeModal()
    this.renderAll()
  }

  renderColorPicker() {
    this.colorPickerTarget.innerHTML = EVENT_COLORS.map((color) => `
      <button type="button" class="calendar-app__color-dot ${this.pickedColor === color ? "is-selected" : ""}" data-action="calendar-app#pickColorFromButton" data-color="${color}" style="background:${color}" aria-label="Pick color"></button>
    `).join("")
  }

  pickColor(color) {
    this.pickedColor = color
  }

  pickColorFromButton(event) {
    this.pickColor(event.currentTarget.dataset.color)
    this.renderColorPicker()
  }

  sampleEvents() {
    const y = this.today.getFullYear()
    const m = this.today.getMonth()
    return [
      { id: "sample-1", title: "Team standup", date: this.fmt(new Date(y, m, this.today.getDate())), allDay: false, start: "09:00", end: "09:30", cal: "work", color: "#10b981" },
      { id: "sample-2", title: "Lunch with Sarah", date: this.fmt(new Date(y, m, this.today.getDate())), allDay: false, start: "12:00", end: "13:00", cal: "personal", color: "#3b82f6" },
      { id: "sample-3", title: "Project review", date: this.fmt(new Date(y, m, this.today.getDate() + 1)), allDay: false, start: "14:00", end: "15:30", cal: "work", color: "#10b981" },
      { id: "sample-4", title: "Birthday party", date: this.fmt(new Date(y, m, this.today.getDate() + 3)), allDay: true, start: "", end: "", cal: "family", color: "#f59e0b" }
    ]
  }

  deleteEditingEvent() {
    if (!this.editingEventId) return
    this.events = this.events.filter((e) => e.id !== this.editingEventId)
    this.persistEvents()
    this.closeModal()
    this.renderAll()
  }

  startOfWeek(date) {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay())
    return d
  }

  sameDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false
    return this.fmt(a) === this.fmt(b)
  }

  fmt(d) {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
  }

  parseYmd(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""))
    if (!m) return null
    const y = Number(m[1])
    const mon = Number(m[2]) - 1
    const d = Number(m[3])
    if (!Number.isInteger(y) || !Number.isInteger(mon) || !Number.isInteger(d)) return null
    return new Date(y, mon, d)
  }

  currentFrameId() {
    return this.element.closest("turbo-frame")?.id || "calendar-pane"
  }

  renderTimeRail() { return "" }
  updateTimeRail() {}

  timeToMinutes(value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""))
    if (!m) return 0
    const h = Number(m[1])
    const min = Number(m[2])
    if (!Number.isFinite(h) || !Number.isFinite(min)) return 0
    return Math.max(0, Math.min(MINUTES_PER_DAY - 1, (h * 60) + min))
  }

  prettyTime(value) {
    const minutes = this.timeToMinutes(value)
    return this.prettyMinutes(minutes)
  }

  prettyMinutes(minutes) {
    const h24 = Math.floor(minutes / 60)
    const min = minutes % 60
    const ampm = h24 < 12 ? "AM" : "PM"
    const h12 = h24 % 12 || 12
    return `${h12}:${String(min).padStart(2, "0")} ${ampm}`
  }

  snapMinutes(value, step = 15) {
    const stepped = Math.round(Number(value || 0) / step) * step
    return Math.max(0, Math.min(MINUTES_PER_DAY - step, stepped))
  }

  minutesToTime(minutes) {
    const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.floor(minutes)))
    const h = Math.floor(clamped / 60)
    const m = clamped % 60
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  escape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  }

  escapeAttr(value) {
    return this.escape(value).replace(/"/g, "&quot;")
  }
}
