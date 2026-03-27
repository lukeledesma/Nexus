import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["display"]

  connect() {
    this.tick()
    this.interval = setInterval(() => this.tick(), 1000)
  }

  disconnect() {
    if (this.interval) clearInterval(this.interval)
  }

  tick() {
    if (!this.hasDisplayTarget) return

    const now = new Date()
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    const weekday = weekdays[now.getDay()]
    const month = months[now.getMonth()]
    const day = now.getDate()

    let hours = now.getHours()
    const minutes = String(now.getMinutes()).padStart(2, "0")
    const seconds = String(now.getSeconds()).padStart(2, "0")
    const meridiem = hours >= 12 ? "PM" : "AM"

    hours = hours % 12
    if (hours === 0) hours = 12

    this.displayTarget.textContent = `${weekday} ${month} ${day} ${hours}:${minutes}:${seconds} ${meridiem}`
  }
}
