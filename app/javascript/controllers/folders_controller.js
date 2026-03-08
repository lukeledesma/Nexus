import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  async createRootFolder(event) {
    event.preventDefault()

    const response = await fetch("/documents/create_root_folder", {
      method: "POST",
      headers: {
        "X-CSRF-Token": this.csrfToken(),
        "Accept": "text/html",
        "X-Requested-With": "XMLHttpRequest"
      },
      credentials: "same-origin"
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

    if (recentDocs) {
      recentDocs.refreshOrganizer(html)
      return
    }

    window.location.reload()
  }

  csrfToken() {
    return document.querySelector("meta[name='csrf-token']")?.content || ""
  }
}
