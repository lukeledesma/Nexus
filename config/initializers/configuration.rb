# frozen_string_literal: true

# Centralized configuration management
module AppConfig
  class << self
    def legacy_documents_section_title
      ENV.fetch("LEGACY_DOCUMENTS_SECTION_TITLE", "Documents")
    end

    def legacy_finder_workspace_folder_title
      ENV.fetch("LEGACY_FINDER_WORKSPACE_FOLDER_TITLE", "Finder")
    end
  end
end