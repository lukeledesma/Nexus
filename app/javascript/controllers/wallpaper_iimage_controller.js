import { Controller } from "@hotwired/stimulus"
import { finderApiHeaders, finderMultipartHeaders } from "lib/finder"
import { materialSymbolSvg } from "lib/material_symbols"
import { NEXUS_CLICKABLE_ROW_MAIN_CLASS } from "lib/nexus_ui"

const OS_IMAGE_TYPES = new Set(["image/jpeg", "image/png"])

function osImageFilesFromDataTransfer(dt) {
  const files = dt?.files
  if (!files?.length) return []
  const out = []
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const t = (f.type || "").toLowerCase()
    if (OS_IMAGE_TYPES.has(t)) {
      out.push(f)
      continue
    }
    const name = (f.name || "").toLowerCase()
    if (name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")) out.push(f)
  }
  return out
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Settings → Wallpaper: list + drop zone for wallpaper images.
 */
export default class extends Controller {
  static targets = ["surface"]

  static values = {
    folderId: Number,
    workspaceUrl: String
  }

  connect() {
    this._dropHoverEl = null
    this.wallpaperBackgroundKind = ""
    this.wallpaperImageDocumentId = 0
    this.boundDragOver = this._onDragOver.bind(this)
    this.boundDrop = this._onDrop.bind(this)
    this.boundThemeStatus = this.handleThemeStatus.bind(this)
    this.boundExternalWallpaperFilesChanged = this.handleExternalWallpaperFilesChanged.bind(this)
    window.addEventListener("workspace:theme-status", this.boundThemeStatus)
    window.addEventListener("settings:wallpaper-files-changed", this.boundExternalWallpaperFilesChanged)
    this.element.addEventListener("dragover", this.boundDragOver)
    this.element.addEventListener("drop", this.boundDrop)

    this.refresh().catch(() => {})
  }

  disconnect() {
    window.removeEventListener("workspace:theme-status", this.boundThemeStatus)
    window.removeEventListener("settings:wallpaper-files-changed", this.boundExternalWallpaperFilesChanged)
    this.clearDropHover()
    this.element.removeEventListener("dragover", this.boundDragOver)
    this.element.removeEventListener("drop", this.boundDrop)
  }

  handleThemeStatus(event) {
    const detail = event?.detail || {}
    this.assignWallpaperPickFromDetail(detail)
    this.syncPickUi()
  }

  handleExternalWallpaperFilesChanged() {
    this.refresh().catch(() => {})
  }

  assignWallpaperPickFromDetail(detail) {
    if (!detail || typeof detail !== "object") return
    if (Object.prototype.hasOwnProperty.call(detail, "wallpaper_background_kind")) {
      this.wallpaperBackgroundKind = detail.wallpaper_background_kind ? String(detail.wallpaper_background_kind) : ""
    }
    if (Object.prototype.hasOwnProperty.call(detail, "wallpaper_image_document_id")) {
      const raw = detail.wallpaper_image_document_id
      const n = raw != null ? Number.parseInt(String(raw), 10) : 0
      this.wallpaperImageDocumentId = Number.isFinite(n) && n > 0 ? n : 0
    }
  }

  assignWallpaperPickFromData(data) {
    if (!data || typeof data !== "object") return
    if (Object.prototype.hasOwnProperty.call(data, "wallpaper_background_kind")) {
      this.wallpaperBackgroundKind = data.wallpaper_background_kind ? String(data.wallpaper_background_kind) : ""
    }
    if (Object.prototype.hasOwnProperty.call(data, "wallpaper_image_document_id")) {
      const raw = data.wallpaper_image_document_id
      const n = raw != null ? Number.parseInt(String(raw), 10) : 0
      this.wallpaperImageDocumentId = Number.isFinite(n) && n > 0 ? n : 0
    }
  }

  syncPickUi() {
    this.syncImageRowsPickVisuals()
  }

  syncImageRowsPickVisuals() {
    if (!this.hasSurfaceTarget) return
    const ul = this.surfaceTarget.querySelector(".settings-iimage-file-rows")
    if (!ul) return
    ul.querySelectorAll(".settings-iimage-wallpaper-row").forEach((li) => {
      const raw = li.dataset?.documentId
      const id = raw != null ? Number.parseInt(String(raw), 10) : NaN
      const selected = this.wallpaperBackgroundKind === "image" && Number.isFinite(id) && id === this.wallpaperImageDocumentId
      li.classList.toggle("is-selected", selected)
      li.classList.toggle("is-active", selected)
    })
  }

  themeStatusDetailFromPayload(payload) {
    const p = payload || {}
    return {
      active_theme_name: p.active_theme_name,
      active_theme_id: p.active_theme_id,
      is_custom_layout: p.is_custom_layout,
      appearance: p.appearance,
      themes: p.themes,
      gradient_source_theme_id: p.gradient_source_theme_id,
      gradient_source_theme_name: p.gradient_source_theme_name,
      wallpaper_background_kind: p.wallpaper_background_kind,
      wallpaper_image_document_id: p.wallpaper_image_document_id,
      wallpaper_gradient_theme_id: p.wallpaper_gradient_theme_id,
      wallpaper_gradient_theme_name: p.wallpaper_gradient_theme_name
    }
  }

  async pickWallpaperImage(documentId) {
    if (!this.hasWorkspaceUrlValue) return
    const id = Number.parseInt(String(documentId), 10)
    if (!Number.isFinite(id) || id <= 0) return

    try {
      const res = await fetch(this.workspaceUrlValue, {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: true }),
        credentials: "same-origin",
        body: JSON.stringify({ apply_wallpaper_image: { document_id: id } })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data.error || "Could not select image.")
        return
      }
      window.dispatchEvent(new CustomEvent("workspace:theme-status", { detail: this.themeStatusDetailFromPayload(data) }))
    } catch (_e) {
      window.alert("Could not select image.")
    }
  }

  folderOk() {
    return Number.isFinite(this.folderIdValue) && this.folderIdValue > 0
  }

  async refresh() {
    try {
      const response = await fetch("/apps/wallpaper_iimage/files", { headers: { Accept: "application/json" } })
      if (!response.ok) return
      const data = await response.json()
      this.folderIdValue = data.folder_id ? Number(data.folder_id) : 0
      this.assignWallpaperPickFromData(data)
      if (this.hasSurfaceTarget) this.surfaceTarget.innerHTML = this.buildSurfaceHtml(data)
      this.syncWallpaperClasses(data)
      this.syncPickUi()
    } catch (_e) {
      /* non-blocking */
    }
  }

  syncWallpaperClasses(data) {
    const unavailable = Boolean(data.unavailable) || !data.folder_id
    this.element.classList.toggle("settings-wallpaper-iimage-unavailable", unavailable)
    if (this.hasSurfaceTarget) this.surfaceTarget.classList.toggle("is-disabled", unavailable)
  }

  async surfaceClick(event) {
    if (!this.hasSurfaceTarget) return
    const row = event.target.closest?.(".settings-iimage-file-rows .settings-iimage-wallpaper-row")
    if (!row) return

    const action = event.target.closest?.(".row-plus, .item-action-btn")
    if (!action) {
      event.preventDefault()
      const id = this.#documentIdFromRow(row)
      if (id) await this.pickWallpaperImage(id)
      return
    }
    if (action?.matches(".item-action-delete")) {
      event.preventDefault()
      event.stopPropagation()
      await this.#deleteRow(row)
      return
    }
    if (action?.matches(".item-action-btn")) {
      event.preventDefault()
      event.stopPropagation()
      await this.#commitAnyEdit(row)
      this.#startEdit(row)
    }
  }

  surfaceKeydown(event) {
    const input = event.target.closest?.(".task-edit-input")
    if (!input || !this.hasSurfaceTarget || !this.surfaceTarget.contains(input)) return

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

  #documentIdFromRow(row) {
    const raw = row?.dataset?.documentId
    const id = raw != null ? Number.parseInt(String(raw), 10) : NaN
    return Number.isFinite(id) && id > 0 ? id : null
  }

  #renameUrl(id) {
    return `/documents/${encodeURIComponent(String(id))}/rename`
  }

  #documentUrl(id) {
    return `/documents/${encodeURIComponent(String(id))}`
  }

  async #commitAnyEdit(excludeRow = null) {
    if (!this.hasSurfaceTarget) return
    const input = Array.from(this.surfaceTarget.querySelectorAll(".task-edit-input")).find((el) => {
      const r = el.closest(".settings-iimage-wallpaper-row")
      return !(excludeRow && r === excludeRow)
    })
    if (input) await this.#finishEdit(input, true)
  }

  #startEdit(row) {
    const titleEl = row.querySelector(".settings-iimage-file-title[data-role='task-text']")
    if (!titleEl) return

    const existing = row.querySelector(".task-edit-input")
    if (existing) {
      existing.focus()
      existing.select()
      return
    }

    if (this.hasSurfaceTarget) {
      this.surfaceTarget.querySelectorAll(".settings-iimage-wallpaper-row.is-editing").forEach((r) => r.classList.remove("is-editing"))
    }
    row.classList.add("is-editing")

    const currentValue = titleEl.textContent.trim()
    const input = document.createElement("input")
    input.type = "text"
    input.className = "task-edit-input"
    input.value = currentValue
    input.dataset.originalValue = currentValue
    input.placeholder = "Wallpaper name…"
    input.setAttribute("aria-label", "Wallpaper name")

    titleEl.replaceWith(input)
    input.focus()
    input.select()
    this.#bindEditBlur(input)
  }

  async #finishEdit(input, save) {
    const row = input.closest(".settings-iimage-wallpaper-row")
    if (!row) return

    const id = this.#documentIdFromRow(row)
    const originalValue = (input.dataset.originalValue || "").trim()
    let value = save ? input.value.trim() : originalValue

    if (save && value.length === 0) {
      value = originalValue
    }

    row.classList.remove("is-editing")

    const titleSpan = document.createElement("span")
    titleSpan.className = "settings-iimage-file-title"
    titleSpan.dataset.role = "task-text"

    if (!id) {
      titleSpan.textContent = value || originalValue
      input.replaceWith(titleSpan)
      return
    }

    if (value === originalValue || !save) {
      titleSpan.textContent = originalValue
      input.replaceWith(titleSpan)
      return
    }

    try {
      const res = await fetch(this.#renameUrl(id), {
        method: "PATCH",
        headers: finderApiHeaders({ jsonBody: true }),
        credentials: "same-origin",
        body: JSON.stringify({ name: value })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        window.alert(data.error || "Could not rename.")
        titleSpan.textContent = originalValue
        input.replaceWith(titleSpan)
        return
      }
      titleSpan.textContent = String(data.name ?? value)
      input.replaceWith(titleSpan)
    } catch (_e) {
      window.alert("Could not rename.")
      titleSpan.textContent = originalValue
      input.replaceWith(titleSpan)
    }
  }

  #bindEditBlur(input) {
    input.addEventListener("blur", () => this.#finishEdit(input, true), { once: true })
  }

  async #deleteRow(row) {
    const id = this.#documentIdFromRow(row)
    if (!id) return

    await this.#commitAnyEdit(row)

    const name =
      row.querySelector(".settings-iimage-file-title[data-role='task-text']")?.textContent?.trim() ||
      row.querySelector(".task-edit-input")?.value?.trim() ||
      "this wallpaper"
    if (!window.confirm(`Delete "${name}"?`)) return

    try {
      const res = await fetch(this.#documentUrl(id), {
        method: "DELETE",
        headers: finderApiHeaders(),
        credentials: "same-origin"
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        window.alert(data.error || "Could not delete.")
        return
      }
      await this.refresh()
    } catch (_e) {
      window.alert("Could not delete.")
    }
  }

  buildFileRowHtml(f) {
    const id = Number(f.id)
    const selected =
      this.wallpaperBackgroundKind === "image" && Number.isFinite(id) && id > 0 && id === this.wallpaperImageDocumentId
    const name = escapeHtml(f.name)
    const idAttr = Number.isFinite(id) && id > 0 ? ` data-document-id="${id}"` : ""
    const selectedClass = selected ? " is-active is-selected" : ""
    return `
          <li class="settings-themes-item finder-file-item organizer-row finder-file-row nexus-standard-row finder-file-row--no-leading-icon settings-iimage-wallpaper-row${selectedClass}"${idAttr}>
            <div class="organizer-row-left finder-file-row-main nexus-standard-row__main ${NEXUS_CLICKABLE_ROW_MAIN_CLASS} settings-iimage-file-line">
              <span class="finder-file-name settings-iimage-file-title" data-role="task-text">${name}</span>
            </div>
            <div class="organizer-row-right">
              <span class="item-action-btn" title="Rename" aria-label="Rename wallpaper">${materialSymbolSvg("edit", "xs")}</span>
              <span class="item-action-btn item-action-delete" title="Delete" aria-label="Delete wallpaper">${materialSymbolSvg("delete", "xs")}</span>
            </div>
          </li>`
  }

  /** Append rows from upload response so the list updates immediately (no wait for a second fetch). */
  insertUploadedFiles(newFiles) {
    if (!this.hasSurfaceTarget || !Array.isArray(newFiles) || newFiles.length === 0) return

    const ul = this.surfaceTarget.querySelector(".settings-iimage-file-rows")
    const emptyPanel = this.surfaceTarget.querySelector(
      ".settings-iimage-finder-panel:not(.settings-iimage-finder-panel--unavailable)"
    )

    if (emptyPanel) {
      emptyPanel.remove()
      const rows = newFiles.map((f) => this.buildFileRowHtml(f)).join("")
      this.surfaceTarget.insertAdjacentHTML(
        "beforeend",
        `<ul class="finder-file-list settings-themes-list settings-iimage-file-rows" aria-label="Wallpapers in Wallpaper folder">${rows}</ul>`
      )
      this.syncImageRowsPickVisuals()
      return
    }

    if (ul) {
      const fragment = newFiles.map((f) => this.buildFileRowHtml(f)).join("")
      ul.insertAdjacentHTML("beforeend", fragment)
      this.syncImageRowsPickVisuals()
    }
  }

  buildSurfaceHtml(data) {
    if (data.unavailable || !data.folder_id) {
      return `<div class="settings-iimage-finder-panel settings-iimage-finder-panel--unavailable" role="region" aria-label="Embedded workspace is not available"></div>`
    }

    if (data.empty) {
      return `<div class="settings-iimage-finder-panel" role="region" aria-label="Wallpaper folder — drop JPEG or PNG files here"></div>`
    }

    const files = Array.isArray(data.files) ? data.files : []
    const rows = files.map((f) => this.buildFileRowHtml(f)).join("")

    return `<ul class="finder-file-list settings-themes-list settings-iimage-file-rows" aria-label="Wallpapers in Wallpaper folder">${rows}</ul>`
  }

  clearDropHover() {
    if (this._dropHoverEl) {
      this._dropHoverEl.classList.remove("finder-tree__row-line--drop-target")
      this._dropHoverEl = null
    }
  }

  _onDragOver(event) {
    if (!this.folderOk()) return
    const types = event.dataTransfer?.types ? Array.from(event.dataTransfer.types) : []
    if (!types.includes("Files")) return

    const row = event.target.closest?.(".settings-iimage-droprow")
    if (!row || !this.element.contains(row)) {
      this.clearDropHover()
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    if (this._dropHoverEl !== row) {
      this.clearDropHover()
      this._dropHoverEl = row
      row.classList.add("finder-tree__row-line--drop-target")
    }
  }

  async _onDrop(event) {
    this.clearDropHover()
    if (!this.folderOk()) return

    const dt = event.dataTransfer
    const row = event.target.closest?.(".settings-iimage-droprow")
    if (!row || !this.element.contains(row)) return

    const hasDroppedFiles = dt?.files?.length > 0
    if (!hasDroppedFiles) return

    event.preventDefault()
    event.stopPropagation()

    const images = osImageFilesFromDataTransfer(dt)
    if (images.length === 0) {
      window.alert("Only JPEG and PNG images can be dropped into the Wallpaper folder.")
      return
    }

    const formData = new FormData()
    images.forEach((file) => formData.append("files[]", file))

    const response = await fetch(`/documents/${encodeURIComponent(this.folderIdValue)}/upload_images`, {
      method: "POST",
      headers: finderMultipartHeaders(),
      body: formData
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      window.alert(data.error || "Could not upload images.")
      return
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      window.alert(data.errors.join("\n"))
    }

    if (Array.isArray(data.files) && data.files.length > 0) {
      this.insertUploadedFiles(data.files)
      this.syncWallpaperClasses({ folder_id: this.folderIdValue, unavailable: false })
    } else {
      await this.refresh()
    }
  }
}
