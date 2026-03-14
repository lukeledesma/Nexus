import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["backdrop", "modal"]

  connect() {
    this.context = null
    this.boundKeydown = this.handleKeydown.bind(this)
    document.addEventListener("keydown", this.boundKeydown)
    this.close()
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundKeydown)
  }

  open(event) {
    event.preventDefault()
    event.stopPropagation()

    const button = event.currentTarget
    this.context = {
      createUrl: button.dataset.createUrl,
      folderId: button.dataset.folderId
    }

    if (!this.context.createUrl || !this.context.folderId) return
    this.backdropTarget.classList.remove("hidden")
    this.backdropTarget.setAttribute("aria-hidden", "false")
  }

  close() {
    this.context = null
    this.backdropTarget.classList.add("hidden")
    this.backdropTarget.setAttribute("aria-hidden", "true")
  }

  clickBackdrop(event) {
    if (event.target !== this.backdropTarget) return
    this.close()
  }

  handleKeydown(event) {
    if (event.key !== "Escape") return
    if (this.backdropTarget.classList.contains("hidden")) return

    event.preventDefault()
    this.close()
  }

  createNote() {
    this.createItem("note")
  }

  createTaskList() {
    this.createItem("task_list")
  }

  async createItem(contentType) {
    if (!this.context?.createUrl || !this.context?.folderId) return

    const csrf = document.querySelector("meta[name='csrf-token']")
    const body = new FormData()
    body.append("content_type", contentType)

    try {
      const response = await fetch(this.context.createUrl, {
        method: "POST",
        headers: {
          "X-CSRF-Token": csrf?.content || "",
          "Accept": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        credentials: "same-origin",
        body
      })

      if (!response.ok) throw new Error("Create failed")

      const listResponse = await fetch(`/documents/${this.context.folderId}/file_list`, {
        headers: { "Accept": "text/html", "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin"
      })
      if (!listResponse.ok) throw new Error("Refresh failed")

      const html = await listResponse.text()
      const organizer = document.querySelector("#organizer-wrapper[data-controller~='recent-docs']")
      const recentDocs = organizer
        ? this.application.getControllerForElementAndIdentifier(organizer, "recent-docs")
        : null
      if (recentDocs && typeof recentDocs.updateFileList === "function") {
        recentDocs.updateFileList(this.context.folderId, html)
      } else {
        window.location.reload()
      }

      this.close()
    } catch (_error) {
      window.location.reload()
    }
  }
}
