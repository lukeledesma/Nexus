const ANIM_TOTAL_MS = 180

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
    const timeoutId = setTimeout(finalize, ANIM_TOTAL_MS)
    element.addEventListener("transitionend", onDone, { once: true })
    element.addEventListener("animationend", onDone, { once: true })
  })
}
