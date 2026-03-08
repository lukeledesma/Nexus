/**
 * Shared organizer animation timing values.
 * Use these constants for all organizer row/list transitions.
 */
export const ANIM = {
  DURATION: 150,
  EASING: "ease",
  TOTAL: 180
}

/**
 * Measure an element's natural content height.
 *
 * When to use:
 * - Before expand/appear transitions that need a fixed target height.
 *
 * Expected DOM structure:
 * - Any block element whose visible content height should be measured.
 *
 * @param {HTMLElement | null | undefined} element
 * @returns {number} Element scrollHeight, or 0 when element is missing.
 */
export function measureHeight(element) {
  if (!element) return 0
  return element.scrollHeight
}

/**
 * Collapse a row/panel by applying the shared collapsing behavior.
 *
 * When to use:
 * - Removing organizer rows (files/folders) with smooth close animation.
 *
 * Expected DOM structure:
 * - Element should support the "collapsing" class in CSS.
 *
 * @param {HTMLElement | null | undefined} element
 * @returns {Promise<void>} Resolves when transition/animation completes (or fallback timeout).
 */
export function animateCollapse(element) {
  return new Promise((resolve) => {
    if (!element || !element.isConnected) {
      resolve()
      return
    }

    const currentHeight = element.offsetHeight
    element.style.height = `${currentHeight}px`
    element.style.overflow = "hidden"
    // Force style flush so the transition starts from rendered height.
    void element.offsetHeight
    element.classList.add("collapsing")

    const finalize = () => {
      element.removeEventListener("transitionend", onDone)
      element.removeEventListener("animationend", onDone)
      clearTimeout(timeoutId)
      resolve()
    }

    const onDone = () => finalize()
    const timeoutId = setTimeout(finalize, ANIM.TOTAL)
    element.addEventListener("transitionend", onDone, { once: true })
    element.addEventListener("animationend", onDone, { once: true })
  })
}

/**
 * Expand an element from height 0 to its natural measured height.
 *
 * When to use:
 * - Opening folder content containers or sections that should not snap open.
 *
 * Expected DOM structure:
 * - Block element that can be height-animated.
 *
 * @param {HTMLElement | null | undefined} element
 * @returns {Promise<void>} Resolves after expansion finishes and inline styles are cleaned.
 */
export function animateExpand(element) {
  return new Promise((resolve) => {
    if (!element || !element.isConnected) {
      resolve()
      return
    }

    const naturalHeight = measureHeight(element)
    element.style.height = "0px"
    element.style.overflow = "hidden"
    element.getBoundingClientRect()

    element.style.transition = `height ${ANIM.DURATION}ms ${ANIM.EASING}`
    element.style.height = `${naturalHeight}px`

    const finalize = () => {
      element.removeEventListener("transitionend", onDone)
      clearTimeout(timeoutId)
      element.style.height = ""
      element.style.overflow = ""
      element.style.transition = ""
      resolve()
    }

    const onDone = (event) => {
      if (event.propertyName && event.propertyName !== "height") return
      finalize()
    }

    const timeoutId = setTimeout(finalize, ANIM.TOTAL)
    element.addEventListener("transitionend", onDone, { once: true })
  })
}

/**
 * Animate a row/element appearing with height and opacity.
 *
 * When to use:
 * - New file row insertion.
 * - Empty-state row insertion after last-file delete.
 *
 * Expected DOM structure:
 * - Block element where height/opacity animation is appropriate.
 *
 * @param {HTMLElement | null | undefined} element
 * @returns {Promise<void>} Resolves after appear transition finishes and inline styles are cleaned.
 */
export function animateAppear(element) {
  return new Promise((resolve) => {
    if (!element || !element.isConnected) {
      resolve()
      return
    }

    const naturalHeight = measureHeight(element)
    element.style.height = "0px"
    element.style.opacity = "0"
    element.style.overflow = "hidden"
    element.style.paddingTop = "0px"
    element.style.paddingBottom = "0px"
    element.getBoundingClientRect()

    element.style.transition = `all ${ANIM.DURATION}ms ${ANIM.EASING}`
    element.style.height = `${naturalHeight}px`
    element.style.opacity = "1"
    element.style.paddingTop = ""
    element.style.paddingBottom = ""

    const finalize = () => {
      element.removeEventListener("transitionend", onDone)
      clearTimeout(timeoutId)
      element.style.height = ""
      element.style.overflow = ""
      element.style.transition = ""
      resolve()
    }

    const onDone = (event) => {
      if (event.propertyName && event.propertyName !== "height") return
      finalize()
    }

    const timeoutId = setTimeout(finalize, ANIM.TOTAL)
    element.addEventListener("transitionend", onDone, { once: true })
  })
}

/**
 * FLIP animate an element from old vertical position to its new position.
 *
 * When to use:
 * - Rename reorder transitions for folders/files after sorted list refresh.
 *
 * Expected DOM structure:
 * - newElement is the post-refresh row element now in the DOM.
 * - oldRect is the pre-refresh DOMRect from the previous row position.
 *
 * @param {DOMRect | { top: number } | null | undefined} oldRect
 * @param {HTMLElement | null | undefined} newElement
 * @returns {Promise<void>} Resolves when transform transition completes.
 */
export function animateFlip(oldRect, newElement) {
  return new Promise((resolve) => {
    if (!oldRect || !newElement || !newElement.isConnected) {
      resolve()
      return
    }

    const newRect = newElement.getBoundingClientRect()
    const deltaY = oldRect.top - newRect.top
    if (Math.abs(deltaY) < 1) {
      resolve()
      return
    }

    newElement.style.transition = "none"
    newElement.style.transform = `translateY(${deltaY}px)`
    newElement.getBoundingClientRect()

    const finalize = () => {
      newElement.removeEventListener("transitionend", onDone)
      clearTimeout(timeoutId)
      newElement.style.transition = ""
      newElement.style.transform = ""
      resolve()
    }

    const onDone = (event) => {
      if (event.propertyName && event.propertyName !== "transform") return
      finalize()
    }

    const timeoutId = setTimeout(finalize, ANIM.TOTAL)
    newElement.addEventListener("transitionend", onDone, { once: true })
    requestAnimationFrame(() => {
      newElement.style.transition = `transform ${ANIM.DURATION}ms ${ANIM.EASING}`
      newElement.style.transform = "translateY(0)"
    })
  })
}

/**
 * Run full folder delete animation sequence.
 *
 * Sequence:
 * - If folder is expanded and has files, close file list first.
 * - Remove file list container.
 * - Collapse folder row.
 * - Remove folder row from DOM.
 *
 * When to use:
 * - Folder delete actions where files should not individually snap away.
 *
 * Expected DOM structure:
 * - folderRow: folder row element (e.g. li[data-folder-row='true']).
 * - fileList: descendant .plc-file-list element within folder dropdown.
 *
 * @param {HTMLElement | null | undefined} folderRow
 * @param {HTMLElement | null | undefined} fileList
 * @returns {Promise<void>} Resolves when folderRow is removed or sequence completes.
 */
export async function animateFolderDeleteSequence(folderRow, fileList) {
  if (!folderRow || !folderRow.isConnected) return

  const dropdown = fileList?.closest(".folder-dropdown") || null
  const hasFiles = !!fileList && fileList.querySelectorAll(".plc-file-row[data-doc-kind='file']").length > 0
  const expanded = folderRow.dataset.expanded === "true"

  if (dropdown && hasFiles && expanded) {
    const button = folderRow.querySelector(".folder-toggle")
    folderRow.classList.remove("folder-row--expanded", "folder-expanded")
    folderRow.classList.add("folder-collapsed")
    folderRow.dataset.expanded = "false"
    if (button) button.setAttribute("aria-expanded", "false")

    const startHeight = dropdown.scrollHeight
    dropdown.style.maxHeight = `${startHeight}px`
    dropdown.style.overflow = "hidden"
    dropdown.style.transition = `max-height ${ANIM.DURATION}ms ${ANIM.EASING}, opacity ${ANIM.DURATION}ms ${ANIM.EASING}`
    dropdown.getBoundingClientRect()
    dropdown.classList.remove("is-open")
    dropdown.style.maxHeight = "0px"

    await new Promise((resolve) => {
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

      const timeoutId = setTimeout(finalize, ANIM.TOTAL)
      dropdown.addEventListener("transitionend", onDone, { once: true })
    })
  }

  if (dropdown && dropdown.isConnected) dropdown.remove()

  await animateCollapse(folderRow)
  if (folderRow.isConnected) folderRow.remove()
}
