# frozen_string_literal: true

# Ensures <workspace root>/Embedded/Wallpaper exists as a Document folder (settings wallpaper drops).
# Historically this folder was titled IImage, Image, Images, or Wallpaper; we resolve all of them, prefer the
# folder that actually holds image files, and normalize the title to "Wallpaper". We do not destroy duplicate
# folders automatically (too easy to surprise users); empty duplicates are harmless once we pick the right primary.
class EmbeddedIimageFolder
  TITLE = "Wallpaper"
  KNOWN_FOLDER_NAMES = %w[Wallpaper Image Images IImage].freeze

  class << self
    def document_for(user)
      root = FinderListedFolders.workspace_root_for(user)
      return nil unless root

      embedded = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
      return nil unless embedded

      resolve_and_normalize!(embedded)
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
      embedded = FinderListedFolders.workspace_root_for(user)&.children&.folders&.find { |d| d.title.to_s.strip.casecmp?("embedded") }
      return nil unless embedded

      resolve_and_normalize!(embedded)
    end

    def eligible_asset?(doc)
      return false unless doc&.file? && doc.content_type.to_s == "asset"

      ext = File.extname(doc.storage_path.to_s).downcase
      %w[.jpg .jpeg .png].include?(ext)
    end

    def known_folder_name?(doc)
      return false unless doc&.folder?

      KNOWN_FOLDER_NAMES.any? { |n| doc.title.to_s.strip.casecmp?(n) }
    end

    def candidate_folders(embedded)
      embedded.children.folders.select { |d| known_folder_name?(d) }
    end

    def pick_primary_folder(candidates)
      return nil if candidates.empty?
      return candidates.first if candidates.one?

      candidates.max_by do |f|
        files = f.children.files.to_a
        eligible = files.count { |c| eligible_asset?(c) }
        [eligible, files.size, -f.id]
      end
    end

    def migrate_folder_title_to_canonical!(folder)
      return unless folder
      return if folder.title.to_s.strip.casecmp?(TITLE)

      folder.update!(title: TITLE)
    end

    def resolve_and_normalize!(embedded)
      candidates = candidate_folders(embedded)
      primary = pick_primary_folder(candidates)

      if primary.blank?
        return embedded.children.create!(is_folder: true, title: TITLE)
      end

      migrate_folder_title_to_canonical!(primary)
      primary.reload
      primary
    end

    private :resolve_and_normalize!
  end
end
