# frozen_string_literal: true

# Shared Nexus OS UI markers — keep in sync with:
# - `app/javascript/lib/nexus_ui.js` (NEXUS_CLICKABLE_ROW_MAIN_CLASS)
# - `.nexus-clickable-row__main` in app/assets/stylesheets/application.css
module NexusUiHelper
  # Main column of whole-row clickable list rows (Tasks, Finder files, Settings saved themes).
  NEXUS_CLICKABLE_ROW_MAIN = "nexus-clickable-row__main"

  def nexus_clickable_row_main_class
    NEXUS_CLICKABLE_ROW_MAIN
  end
end
