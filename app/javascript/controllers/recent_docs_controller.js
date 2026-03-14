import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["doc", "folderDropdown", "itemCreatorBackdrop"]

  connect() {
    this.itemCreatorContext = null
    this.boundKeydown = this.handleKeydown.bind(this)
    this.element.addEventListener("keydown", this.boundKeydown, true)
    this.syncExpandedFolders()
    this.setupFileListObservers()
    this.handleCreatedFolderPostRefresh()
    this.handleCreatedFilePostRefresh()
  }

  disconnect() {
    this.element.removeEventListener("keydown", this.boundKeydown, true)
    if (this.fileListObservers) {
      this.fileListObservers.forEach((observer) => observer.disconnect())
      this.fileListObservers = []
    }
  }

  toggleFolder(e) {
    if (e.currentTarget?.dataset?.type !== "folder") return

    const interactive = e.target.closest("button, a, input, textarea, select, label, [data-no-toggle='true']")
    if (interactive) return

    const row = e.currentTarget.closest("[data-folder-row='true']")
    if (!row) return
    if (row.dataset.deleting === "true") return
    const open = row.dataset.expanded !== "true"
    if (open) this.collapseOtherFolders(row)
    this.setFolderExpanded(row, open, true)
  }

  handleKeydown(e) {
    if (e.key === "Escape" && this.hasItemCreatorBackdropTarget && !this.itemCreatorBackdropTarget.classList.contains("hidden")) {
      e.preventDefault()
      this.closeItemCreator()
      return
    }

    if (e.key !== "Delete" && e.key !== "Backspace") return
    const tag = (e.target?.tagName || "").toLowerCase()
    if (["input", "textarea", "select", "button"].includes(tag)) return

    const row = e.target.closest("[data-recent-docs-target='doc']")
    if (!row) return
    const url = row.dataset.deleteUrl
    if (!url) return
    e.preventDefault()
    const kind = row.dataset.docKind || (row.dataset.folderRow === "true" ? "folder" : "file")
    this.requestDelete(row, url, kind)
  }

  openItemCreator(e) {
    e.preventDefault()
    e.stopPropagation()
    if (!this.hasItemCreatorBackdropTarget) return

    const button = e.currentTarget
    this.itemCreatorContext = {
      createUrl: button.dataset.createUrl,
      folderId: button.dataset.folderId
    }

    if (!this.itemCreatorContext.createUrl || !this.itemCreatorContext.folderId) return
    this.itemCreatorBackdropTarget.classList.remove("hidden")
    this.itemCreatorBackdropTarget.setAttribute("aria-hidden", "false")
  }

  closeItemCreator() {
    if (!this.hasItemCreatorBackdropTarget) return
    this.itemCreatorContext = null
    this.itemCreatorBackdropTarget.classList.add("hidden")
    this.itemCreatorBackdropTarget.setAttribute("aria-hidden", "true")
  }

  clickItemCreatorBackdrop(e) {
    if (!this.hasItemCreatorBackdropTarget) return
    if (e.target !== this.itemCreatorBackdropTarget) return
    this.closeItemCreator()
  }

  createNoteItem(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    this.createItemFromModal("note")
  }

  createTaskListItem(e) {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    this.createItemFromModal("task_list")
  }

  async createItemFromModal(contentType) {
    const context = this.itemCreatorContext
    if (!context?.createUrl || !context?.folderId) return

    const csrf = document.querySelector("meta[name='csrf-token']")
    const body = new FormData()
    body.append("content_type", contentType)

    try {
      const createRes = await fetch(context.createUrl, {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrf?.content || "",
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin",
        body
      })
      if (!createRes.ok) throw new Error("Create failed")

      const listRes = await fetch(`/documents/${context.folderId}/file_list`, {
        headers: { "Accept": "text/html", "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin"
      })
      if (!listRes.ok) throw new Error("Refresh failed")

      const html = await listRes.text()
      this.updateFileList(context.folderId, html)
      this.closeItemCreator()
    } catch (_error) {
      window.location.reload()
    }
  }

  deleteByButton(e) {
    e.preventDefault()
    e.stopPropagation()
    const button = e.currentTarget
    const row = button.closest("tr.file-row") || button.closest("[data-recent-docs-target='doc']")
    const url = button.dataset.deleteUrl || row?.dataset.deleteUrl
    const kind = button.dataset.docKind || row?.dataset.docKind || "file"
    if (!row || !url) return
    this.requestDelete(row, url, kind)
  }

  async createFile(e) {
    e.preventDefault()
    e.stopPropagation()

    const button = e.currentTarget
    const form = button.closest("form")
    const row = button.closest("[data-folder-row='true']")
    const folderId = row?.dataset?.folderId
    if (!form || !row || !folderId) return

    button.disabled = true
    const csrf = document.querySelector("meta[name='csrf-token']")
    const headers = {
      "X-CSRF-Token": csrf?.content || "",
      "Accept": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    }

    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: new FormData(form)
      })
      if (!res.ok) throw new Error("Create failed")

      const listRes = await fetch(`/documents/${folderId}/file_list`, {
        headers: { "Accept": "text/html", "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin"
      })
      if (!listRes.ok) throw new Error("Refresh failed")

      const html = await listRes.text()
      this.updateFileList(folderId, html)
    } catch (_error) {
      window.location.reload()
    } finally {
      button.disabled = false
    }
  }

  requestDelete(row, url, kind) {
    const isFolder = kind === "folder"
    const message = isFolder ? "Delete this folder and all contained items? This cannot be undone." : "Delete this item? This cannot be undone."
    if (!window.confirm(message)) return
    const csrf = document.querySelector("meta[name='csrf-token']")
    const headers = { "X-CSRF-Token": csrf?.content || "", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }
    fetch(url, { method: "DELETE", headers, credentials: "same-origin" }).then((res) => {
      if (res.ok) {
        this.startDeleteAnimation(row)
      } else {
        window.location.reload()
      }
    }).catch(() => window.location.reload())
  }

  startDeleteAnimation(row) {
    const parentFileList = row.dataset.docKind === "file" ? row.closest(".plc-file-list") : null

    if (row.dataset.folderRow === "true" || row.dataset.docKind === "folder") {
      this.animateFolderDeleteSequence(row)
      return
    }

    if (row.classList?.contains("plc-file-row")) {
      this.animateCollapse(row).then(() => {
        if (row.isConnected) row.remove()
        if (parentFileList) {
          const remaining = parentFileList.querySelectorAll(".plc-file-row[data-doc-kind='file']")
          if (remaining.length === 0) this.animateEmptyStateAppear(parentFileList)
        }
      })
      return
    }

    if (row.tagName === "TR") {
      row.classList.add("file-row--deleting")
      setTimeout(() => {
        if (row.isConnected) row.remove()
        if (parentFileList) this.syncFolderEmptyState(parentFileList)
      }, 220)
      return
    }

    const finalizeRemoval = () => {
      if (!row.isConnected) return
      row.remove()
      if (parentFileList) this.syncFolderEmptyState(parentFileList)
      if (this.element.querySelectorAll("[data-recent-docs-target='doc']").length === 0) {
        const wrapper = document.createElement("div")
        wrapper.className = "recent-docs__content"
        while (this.element.firstChild) wrapper.appendChild(this.element.firstChild)
        this.element.appendChild(wrapper)
        wrapper.classList.add("recent-docs__content--fade-out")
        const showEmpty = () => {
          wrapper.removeEventListener("animationend", showEmpty)
          const parent = this.element.parentNode
          const p = document.createElement("p")
          p.className = "empty-state empty-state--fade-in"
          p.innerHTML = "No folders or items yet. Create a folder to get started."
          parent.replaceChild(p, this.element)
        }
        wrapper.addEventListener("animationend", showEmpty, { once: true })
      }
    }

    row.classList.remove("doc-row--just-imported", "doc-row--just-imported-delayed", "doc-row--existing-top-flash")
    row.classList.remove("doc-row--deleting")
    // Restart animation reliably in edge cases where class was already applied.
    void row.offsetWidth
    row.classList.add("doc-row--deleting")

    const timeoutId = setTimeout(finalizeRemoval, 900)
    const onDone = (e) => {
      if (e.animationName !== "doc-row-delete-poof") return
      clearTimeout(timeoutId)
      row.removeEventListener("animationend", onDone)
      finalizeRemoval()
    }
    row.addEventListener("animationend", onDone, { once: true })
  }

  async animateFolderDeleteSequence(row) {
    row.dataset.deleting = "true"

    const dropdown = row.querySelector(".folder-dropdown")
    const fileList = dropdown?.querySelector(".plc-file-list")
    const hasFiles = !!fileList && fileList.querySelectorAll(".plc-file-row[data-doc-kind='file']").length > 0

    if (dropdown && hasFiles && row.dataset.expanded === "true") {
      await this.animateFolderCloseForDelete(row, dropdown)
    }

    if (dropdown && dropdown.isConnected) dropdown.remove()
    this.animateRowDeleteRemoval(row)
  }

  animateFolderCloseForDelete(row, dropdown) {
    return new Promise((resolve) => {
      if (!dropdown || !dropdown.isConnected) {
        resolve()
        return
      }

      const button = row.querySelector(".folder-toggle")
      const folderRow = this.folderRowElement(row)
      if (folderRow) {
        folderRow.classList.remove("folder-row--expanded", "folder-expanded")
        folderRow.classList.add("folder-collapsed")
      }
      row.dataset.expanded = "false"
      if (button) button.setAttribute("aria-expanded", "false")

      const startHeight = dropdown.scrollHeight
      dropdown.style.maxHeight = `${startHeight}px`
      dropdown.style.overflow = "hidden"
      dropdown.style.transition = "max-height 150ms ease, opacity 150ms ease"
      dropdown.getBoundingClientRect()
      dropdown.classList.remove("is-open")
      dropdown.style.maxHeight = "0px"

      const finalize = () => {
        dropdown.removeEventListener("transitionend", onDone)
        clearTimeout(timeoutId)
        dropdown.style.overflow = ""
        dropdown.style.transition = ""
        resolve()
      }

      const onDone = (event) => {
        if (event.propertyName && event.propertyName !== "max-height") return
        finalize()
      }

      const timeoutId = setTimeout(finalize, 220)
      dropdown.addEventListener("transitionend", onDone, { once: true })
    })
  }

  animateRowDeleteRemoval(row) {
    const finalizeRemoval = () => {
      if (!row.isConnected) return
      row.remove()
      this.maybeRenderGlobalEmptyState()
    }

    row.classList.remove("doc-row--just-imported", "doc-row--just-imported-delayed", "doc-row--existing-top-flash")
    row.classList.remove("doc-row--deleting")
    void row.offsetWidth
    row.classList.add("doc-row--deleting")

    const timeoutId = setTimeout(finalizeRemoval, 900)
    const onDone = (e) => {
      if (e.animationName !== "doc-row-delete-poof") return
      clearTimeout(timeoutId)
      row.removeEventListener("animationend", onDone)
      finalizeRemoval()
    }
    row.addEventListener("animationend", onDone, { once: true })
  }

  maybeRenderGlobalEmptyState() {
    if (this.element.querySelectorAll("[data-recent-docs-target='doc']").length !== 0) return

    const wrapper = document.createElement("div")
    wrapper.className = "recent-docs__content"
    while (this.element.firstChild) wrapper.appendChild(this.element.firstChild)
    this.element.appendChild(wrapper)
    wrapper.classList.add("recent-docs__content--fade-out")
    const showEmpty = () => {
      wrapper.removeEventListener("animationend", showEmpty)
      const parent = this.element.parentNode
      const p = document.createElement("p")
      p.className = "empty-state empty-state--fade-in"
      p.innerHTML = "No folders or items yet. Create a folder to get started."
      parent.replaceChild(p, this.element)
    }
    wrapper.addEventListener("animationend", showEmpty, { once: true })
  }

  animateCollapse(element) {
    return new Promise((resolve) => {
      if (!element || !element.isConnected) {
        resolve()
        return
      }

      const currentHeight = element.offsetHeight
      element.style.height = `${currentHeight}px`
      element.style.overflow = "hidden"
      // Force style flush so transition starts from the current rendered height.
      void element.offsetHeight
      element.classList.add("collapsing")

      const finalize = () => {
        element.removeEventListener("transitionend", onDone)
        element.removeEventListener("animationend", onDone)
        clearTimeout(timeoutId)
        resolve()
      }

      const onDone = () => finalize()
      const timeoutId = setTimeout(finalize, 220)
      element.addEventListener("transitionend", onDone, { once: true })
      element.addEventListener("animationend", onDone, { once: true })
    })
  }

  syncExpandedFolders() {
    let hasExpanded = false
    this.element.querySelectorAll("[data-folder-row='true']").forEach((row) => {
      const wantsOpen = row.dataset.expanded === "true"
      const open = wantsOpen && !hasExpanded
      if (open) hasExpanded = true
      this.setFolderExpanded(row, open, false)
    })
  }

  collapseOtherFolders(activeRow) {
    this.element.querySelectorAll("[data-folder-row='true']").forEach((row) => {
      if (row === activeRow) return
      this.setFolderExpanded(row, false, true)
    })
  }

  setFolderExpanded(row, open, animate = true) {
    const dropdown = row.querySelector(".folder-dropdown")
    const button = row.querySelector(".folder-toggle")
    const folderRow = this.folderRowElement(row)
    if (!dropdown || !button || !folderRow) return

    if (open) this.openDropdown(dropdown, animate)
    else this.closeDropdown(dropdown, animate)

    folderRow.classList.toggle("folder-row--expanded", open)
    folderRow.classList.toggle("folder-expanded", open)
    folderRow.classList.toggle("folder-collapsed", !open)
    row.dataset.expanded = open ? "true" : "false"
    button.setAttribute("aria-expanded", open ? "true" : "false")
  }

  folderRowElement(row) {
    return row?.querySelector("[data-folder-toggle-row='true']") || null
  }

  openDropdown(dropdown, animate = true) {
    dropdown.classList.add("is-open")
    if (!animate) {
      dropdown.style.maxHeight = "none"
      return
    }

    dropdown.style.maxHeight = "0px"
    requestAnimationFrame(() => {
      dropdown.style.maxHeight = `${dropdown.scrollHeight}px`
    })
    const onDone = () => {
      dropdown.style.maxHeight = "none"
      dropdown.removeEventListener("transitionend", onDone)
    }
    dropdown.addEventListener("transitionend", onDone)
  }

  closeDropdown(dropdown, animate = true) {
    if (!dropdown.classList.contains("is-open") && !animate) {
      dropdown.style.maxHeight = "0px"
      return
    }

    if (!animate) {
      dropdown.classList.remove("is-open")
      dropdown.style.maxHeight = "0px"
      return
    }

    const startHeight = dropdown.scrollHeight
    dropdown.style.maxHeight = `${startHeight}px`
    requestAnimationFrame(() => {
      dropdown.classList.remove("is-open")
      dropdown.style.maxHeight = "0px"
    })
  }

  setupFileListObservers() {
    this.fileListObservers = []
    this.element.querySelectorAll(".plc-file-list").forEach((fileList) => {
      this.syncFolderEmptyState(fileList)
      const observer = new MutationObserver(() => {
        this.syncFolderEmptyState(fileList)
      })
      observer.observe(fileList, { childList: true, subtree: false })
      this.fileListObservers.push(observer)
    })
  }

  resetFileListObservers() {
    if (this.fileListObservers) {
      this.fileListObservers.forEach((observer) => observer.disconnect())
    }
    this.setupFileListObservers()
  }

  updateFileList(folderId, html, options = {}) {
    const row = this.element.querySelector(`[data-folder-row='true'][data-folder-id='${folderId}']`)
    const oldList = row?.querySelector(".plc-file-list")
    if (!row || !oldList) return false

    const template = document.createElement("template")
    template.innerHTML = html.trim()
    const newList = template.content.firstElementChild
    if (!newList || !newList.classList.contains("plc-file-list")) return false

    oldList.replaceWith(newList)
    this.syncFolderEmptyState(newList)
    this.resetFileListObservers()
    this.setFolderExpanded(row, true, false)
    return { ok: true, fileList: newList }
  }

  updateOrganizer(html) {
    return this.refreshOrganizer(html)
  }

  refreshOrganizer(html) {
    const content = this.element.querySelector("#organizer-content")
    if (!content) return null

    content.innerHTML = html
    this.resetFileListObservers()
    this.syncExpandedFolders()
    this.handleCreatedFolderPostRefresh()
    this.handleCreatedFilePostRefresh()
    return content
  }

  handleCreatedFolderPostRefresh() {
    const createdRow = this.element.querySelector(".folder-row--created")
    if (!createdRow) return

    this.highlightNewFolder(createdRow)
  }

  handleCreatedFilePostRefresh() {
    const createdFileRow = this.element.querySelector(".file-row--created")
    if (!createdFileRow) return

    this.scrollNewItemIntoView(createdFileRow)
  }

  highlightNewFolder(folderRow) {
    const row = typeof folderRow === "string"
      ? this.findFolderRowByName(folderRow)
      : folderRow
    if (!row) return

    row.classList.add("folder-row--created")
  }

  scrollNewItemIntoView(row) {
    if (!row || typeof row.scrollIntoView !== "function") return

    row.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  findFolderRowByName(name) {
    const normalized = String(name || "").trim().toLowerCase()
    if (!normalized) return null

    const rows = this.element.querySelectorAll("[data-folder-row='true']")
    return Array.from(rows).find((row) => {
      const label = row.querySelector(".folder-toggle .doc-name")
      return (label?.textContent || "").trim().toLowerCase() === normalized
    }) || null
  }

  reopenFolderByName(name) {
    const normalized = String(name || "").trim().toLowerCase()
    if (!normalized) return false

    const rows = this.element.querySelectorAll("[data-folder-row='true']")
    const match = Array.from(rows).find((row) => {
      const label = row.querySelector(".folder-toggle .doc-name")
      return (label?.textContent || "").trim().toLowerCase() === normalized
    })
    if (!match) return false

    this.collapseOtherFolders(match)
    this.setFolderExpanded(match, true, false)
    return true
  }

  revealFolderByName(name) {
    const normalized = String(name || "").trim().toLowerCase()
    if (!normalized) return false

    const rows = this.element.querySelectorAll("[data-folder-row='true']")
    const match = Array.from(rows).find((row) => {
      const label = row.querySelector(".folder-toggle .doc-name")
      return (label?.textContent || "").trim().toLowerCase() === normalized
    })
    if (!match) return false

    if (typeof match.scrollIntoView === "function") {
      match.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
    return true
  }

  getExpandedFolderName() {
    const expanded = this.element.querySelector("[data-folder-row='true'][data-expanded='true']")
    const label = expanded?.querySelector(".folder-toggle .doc-name")
    return (label?.textContent || "").trim()
  }

  fileRowKey(fileRow) {
    return fileRow?.dataset?.deleteUrl || null
  }

  animateNewFileRows(fileList, existingKeys) {
    fileList.querySelectorAll(".plc-file-row[data-doc-kind='file']").forEach((fileRow) => {
      const key = this.fileRowKey(fileRow)
      if (!key || existingKeys.has(key)) return

      const naturalHeight = fileRow.scrollHeight
      fileRow.style.height = "0px"
      fileRow.style.opacity = "0"
      fileRow.style.paddingTop = "0px"
      fileRow.style.paddingBottom = "0px"
      fileRow.style.overflow = "hidden"
      fileRow.getBoundingClientRect()

      fileRow.style.transition = "all 150ms ease"
      fileRow.style.height = `${naturalHeight}px`
      fileRow.style.opacity = "1"
      fileRow.style.paddingTop = ""
      fileRow.style.paddingBottom = ""

      const finalize = () => {
        fileRow.removeEventListener("transitionend", onDone)
        clearTimeout(timeoutId)
        fileRow.style.height = ""
        fileRow.style.overflow = ""
        fileRow.style.transition = ""
      }

      const onDone = (event) => {
        if (event.propertyName && event.propertyName !== "height") return
        finalize()
      }

      const timeoutId = setTimeout(finalize, 220)
      fileRow.addEventListener("transitionend", onDone, { once: true })
    })
  }

  animateEmptyStateAppear(fileList) {
    if (!fileList) return
    const existing = fileList.querySelector(".plc-empty-row")
    if (existing) return

    const emptyRow = document.createElement("div")
    emptyRow.className = "organizer-row plc-empty-row"

    const left = document.createElement("div")
    left.className = "row-left"
    const text = document.createElement("div")
    text.className = "no-tag-lists"
    text.textContent = "No items in this folder"
    left.appendChild(text)

    const right = document.createElement("div")
    right.className = "row-right"

    emptyRow.appendChild(left)
    emptyRow.appendChild(right)
    fileList.appendChild(emptyRow)

    const naturalHeight = emptyRow.scrollHeight
    emptyRow.style.height = "0px"
    emptyRow.style.opacity = "0"
    emptyRow.style.overflow = "hidden"
    emptyRow.style.paddingTop = "0px"
    emptyRow.style.paddingBottom = "0px"
    emptyRow.getBoundingClientRect()

    emptyRow.style.transition = "all 150ms ease"
    emptyRow.style.height = `${naturalHeight}px`
    emptyRow.style.opacity = "1"
    emptyRow.style.paddingTop = ""
    emptyRow.style.paddingBottom = ""

    const finalize = () => {
      emptyRow.removeEventListener("transitionend", onDone)
      clearTimeout(timeoutId)
      emptyRow.style.height = ""
      emptyRow.style.overflow = ""
      emptyRow.style.transition = ""
    }

    const onDone = (event) => {
      if (event.propertyName && event.propertyName !== "height") return
      finalize()
    }

    const timeoutId = setTimeout(finalize, 220)
    emptyRow.addEventListener("transitionend", onDone, { once: true })
  }

  syncFolderEmptyState(fileList) {
    if (!fileList) return
    const fileRows = fileList.querySelectorAll(".plc-file-row[data-doc-kind='file']")
    const emptyRow = fileList.querySelector(".plc-empty-row")

    if (fileRows.length === 0) {
      if (emptyRow) return
      const row = document.createElement("div")
      row.className = "organizer-row plc-empty-row"

      const left = document.createElement("div")
      left.className = "row-left"
      const text = document.createElement("div")
      text.className = "no-tag-lists"
      text.textContent = "No items in this folder"
      left.appendChild(text)

      const right = document.createElement("div")
      right.className = "row-right"

      row.appendChild(left)
      row.appendChild(right)
      fileList.appendChild(row)
      return
    }

    if (emptyRow) emptyRow.remove()
  }
}
