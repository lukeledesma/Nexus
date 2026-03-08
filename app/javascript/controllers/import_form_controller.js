import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = []

  chooseFile() {
    const input = this.element.querySelector('input[type="file"]')
    if (input) input.click()
  }

  async submit(event) {
    if (event) event.preventDefault()

    const input = this.element.querySelector('input[type="file"]')
    if (!input || !input.files.length) return

    const formData = new FormData(this.element)
    const response = await fetch(this.element.action, {
      method: (this.element.method || "POST").toUpperCase(),
      headers: {
        "X-CSRF-Token": this.csrfToken(),
        "Accept": "text/html",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin",
      body: formData
    })

    if (!response.ok) {
      window.location.reload()
      return
    }

    const html = await response.text()
    const organizerHost = document.querySelector("#organizer-wrapper[data-controller~='recent-docs']")
    const recentDocs = organizerHost
      ? this.application.getControllerForElementAndIdentifier(organizerHost, "recent-docs")
      : null

    if (!recentDocs) {
      window.location.reload()
      return
    }

    recentDocs.refreshOrganizer(html)
    const createdFileRow = organizerHost.querySelector(".file-row--created")
    if (createdFileRow && typeof recentDocs.scrollNewItemIntoView === "function") {
      recentDocs.scrollNewItemIntoView(createdFileRow)
    }
  }

  csrfToken() {
    return document.querySelector("meta[name='csrf-token']")?.content || ""
  }
}
