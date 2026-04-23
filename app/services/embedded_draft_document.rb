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
