# frozen_string_literal: true

# One persistent draft document per app type under the workspace Embedded folder.
class EmbeddedDraftDocument
  APP_CONFIG = {
    "tasks" => { title: "Task Draft", content_type: "task_list" },
    "calendar" => { title: "Calendar", content_type: "calendar_events" },
    "quartz" => { title: "Quartz Draft", content_type: "note" }
  }.freeze

  class << self
    def fetch_or_create(user:, app_key:)
      config = APP_CONFIG[app_key.to_s]
      return nil unless config

      embedded = embedded_folder_for(user)
      return nil unless embedded

      existing = canonical_draft_for_embedded(embedded, config)
      if existing
        ensure_synced_to_disk!(existing)
        return existing
      end

      created = embedded.with_lock do
        canonical_draft_for_embedded(embedded, config) || create_draft!(embedded, app_key.to_s, config)
      end
      ensure_synced_to_disk!(created)
      created
    rescue StandardError
      nil
    end

    def clear_draft!(user:, app_key:)
      config = APP_CONFIG[app_key.to_s]
      return false unless config

      embedded = embedded_folder_for(user)
      return false unless embedded

      draft = canonical_draft_for_embedded(embedded, config)
      return false unless draft

      # Reset draft to empty state without destroying it so it's available for next session.
      case app_key.to_s
      when "tasks"
        draft.tasks = []
        draft.content = nil
      else
        draft.tasks = []
        draft.content = ""
      end

      if draft.save
        ensure_synced_to_disk!(draft)
        true
      else
        false
      end
    rescue StandardError => e
      Rails.logger.error("[EmbeddedDraftDocument] clear_draft! failed: #{e.class}: #{e.message}")
      false
    end

    def draft_document?(doc)
      return false unless doc&.file?

      config = APP_CONFIG.values.find do |item|
        doc.title.to_s.casecmp?(item[:title]) && doc.content_type.to_s == item[:content_type]
      end
      return false unless config

      doc.parent&.folder? && doc.parent.title.to_s.casecmp?("Embedded")
    end

    private

    def embedded_folder_for(user)
      root = FinderListedFolders.workspace_root_for(user)
      return nil unless root

      existing = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
      return existing if existing

      adopted = adopt_legacy_embedded_folder!(root)
      return adopted if adopted

      root.with_lock do
        root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") } ||
          root.children.create!(embedded_folder_attributes)
      end
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
      root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
    end

    def canonical_draft_for_embedded(embedded, config)
      embedded.children.files
        .where("LOWER(title) = ?", config[:title].downcase)
        .where(content_type: config[:content_type])
        .order(:id)
        .first
    end

    def adopt_legacy_embedded_folder!(root)
      legacy = Document.folders.where(parent_id: nil, storage_path: "Embedded").order(:id).find do |folder|
        folder.id != root.id && folder.title.to_s.strip.casecmp?("Embedded")
      end
      return nil unless legacy

      legacy.update!(parent: root, title: "Embedded")
      legacy
    rescue ActiveRecord::RecordInvalid
      nil
    end

    def create_draft!(embedded, app_key, config)
      attrs = {
        parent: embedded,
        is_folder: false,
        title: config[:title],
        content_type: config[:content_type],
        reset_mode: "none",
        reset_days: [],
        last_reset_at: nil
      }

      case app_key
      when "tasks"
        attrs[:tasks] = []
        attrs[:content] = nil
      else
        attrs[:tasks] = []
        attrs[:content] = ""
      end

      storage_path = preferred_draft_storage_path(embedded, config)
      attrs[:storage_path] = storage_path if storage_path.present?

      Document.create!(attrs)
    end

    def embedded_folder_attributes
      attrs = { is_folder: true, title: "Embedded" }
      embedded_path = DocumentStorageSyncLite.storage_root.join("Embedded")
      attrs[:storage_path] = "Embedded" if embedded_path.directory?
      attrs
    end

    def ensure_synced_to_disk!(doc)
      return unless doc&.persisted?

      DocumentStorageSyncLite.new(doc).update
    rescue StandardError
      nil
    end

    def preferred_draft_storage_path(embedded, config)
      relative_dir = embedded.storage_path.to_s
      return nil if relative_dir.blank?

      extension = draft_extension_for(config[:content_type])
      relative_path = File.join(relative_dir, "#{config[:title]}#{extension}")
      absolute_path = DocumentStorageSyncLite.storage_root.join(relative_path)
      absolute_path.file? ? relative_path : nil
    end

    def draft_extension_for(content_type)
      case content_type.to_s
      when "note"
        ".rtf"
      else
        ".txt"
      end
    end
  end
end
