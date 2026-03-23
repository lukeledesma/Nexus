import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["menu"]

  connect() {
    this.toggle = this.toggle.bind(this)
    this.handleOutsideClick = this.handleOutsideClick.bind(this)
    
    // Set initial aria-expanded
    this.updateAriaExpanded()
    
    // Add click listener to document for closing when clicking outside
    document.addEventListener("click", this.handleOutsideClick)
  }

  disconnect() {
    document.removeEventListener("click", this.handleOutsideClick)
  }

  toggle(event) {
    event.stopPropagation()
    this.menuTarget.classList.toggle("active")
    this.updateAriaExpanded()
  }

  updateAriaExpanded() {
    const isActive = this.menuTarget.classList.contains("active")
    this.element.querySelector(".auth-menu-toggle").setAttribute("aria-expanded", isActive ? "true" : "false")
  }

  handleOutsideClick = (e) => {
    if (!this.element.contains(e.target)) {
      this.menuTarget.classList.remove("active")
      this.updateAriaExpanded()
    }
  }
}

