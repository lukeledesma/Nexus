# frozen_string_literal: true

# One persistent draft document per app type under the workspace Embedded folder.
class EmbeddedDraftDocument
  APP_CONFIG = {
    "tasks" => { title: "Task Draft", content_type: "task_list" },
    "notes" => { title: "Note Draft", content_type: "note" },
    "time-card" => { title: "Time Card Draft", content_type: "note" }
  }.freeze

  class << self
    def fetch_or_create(user:, app_key:)
      config = APP_CONFIG[app_key.to_s]
      return nil unless config

      root = FinderListedFolders.workspace_root_for(user)
      return nil unless root

      embedded = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
      return nil unless embedded

      existing = embedded.children.files.where("LOWER(title) = ?", config[:title].downcase).first
      if existing
        ensure_synced_to_disk!(existing)
        return existing
      end

      created = create_draft!(embedded, app_key.to_s, config)
      ensure_synced_to_disk!(created)
      created
    rescue StandardError
      nil
    end

    def clear_draft!(user:, app_key:)
      config = APP_CONFIG[app_key.to_s]
      return false unless config

      root = FinderListedFolders.workspace_root_for(user)
      return false unless root

      embedded = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
      return false unless embedded

      draft = embedded.children.files.where("LOWER(title) = ?", config[:title].downcase).first
      return false unless draft

      # Reset draft to empty state without destroying it so it's available for next session.
      case app_key.to_s
      when "tasks"
        draft.tasks = []
        draft.content = nil
      when "time-card"
        draft.tasks = []
        draft.content = TimeCardDocumentCodec.dump(
          {
            clockInMinutes: nil,
            clockInAtMs: nil,
            clockOutAtMs: nil,
            clockOutMinutes: nil,
            running: false,
            notesText: ""
          }
        )
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

    private

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
      when "time-card"
        attrs[:tasks] = []
        attrs[:content] = TimeCardDocumentCodec.dump(
          {
            clockInMinutes: nil,
            clockInAtMs: nil,
            clockOutAtMs: nil,
            clockOutMinutes: nil,
            running: false,
            notesText: ""
          }
        )
      else
        attrs[:tasks] = []
        attrs[:content] = ""
      end

      Document.create!(attrs)
    end

    def ensure_synced_to_disk!(doc)
      return unless doc&.persisted?

      DocumentStorageSyncLite.new(doc).update
    rescue StandardError
      nil
    end
  end
end
