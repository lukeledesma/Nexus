module ApplicationHelper
  include NexusUiHelper

  # Same folder list as Finder sidebar (user folders under Finder, excluding Desktop/Documents).
  def finder_sidebar_folders
    return [] unless current_user

    FinderListedFolders.user_folders(current_user).to_a
  end

  # Single source for launcher grid tiles: order, labels, icons, and click handlers.
  # Add rows here to grow the grid; CSS keeps 2 columns with wrap.
  def launcher_grid_entries
    [
      { window_key: "singular-note", pin_key: "singular-note", label: "NOTEPAD", icon: :notepad },
      { window_key: "singular-task-list", pin_key: "singular-task-list", label: "TASKS", icon: :task_checklist },
      { window_key: "singular-sticky-notes", pin_key: "singular-sticky-notes", label: "STICKY NOTES", icon: :sticky_note },
      { window_key: "finder", pin_key: "finder", label: "FINDER", icon: :folder },
      { window_key: "settings", pin_key: "settings", label: "SETTINGS", icon: :settings },
      { window_key: "theme-studio", pin_key: "theme-studio", label: "THEME STUDIO", icon: :tune }
    ].freeze
  end

  # Finder / title bar: show names without .txt/.nexus (on-disk type is implicit).
  def finder_document_display_title(title)
    s = title.to_s.strip
    return "Untitled" if s.blank?

    s.sub(/\.(txt|nexus)\z/i, "").strip.presence || "Untitled"
  end

  def finder_file_icon_for_content_type(content_type)
    case content_type.to_s
    when "note" then :notepad
    when "task_list" then :task_checklist
    when "stickynotes" then :sticky_note
    else :file_document
    end
  end

  def slug_to_title(slug)
    return "New Folder" if slug.blank?

    cleaned = slug.to_s.tr("_", "-").gsub(/-+/, "-").sub(/\A-/, "").sub(/-\z/, "")
    parts = cleaned.split("-")
    return "New Folder" if parts.empty?

    if parts.last.to_s.match?(/\A\d+\z/)
      number = parts.pop
      base = parts.map(&:capitalize).join(" ")
      base = "Folder" if base.blank?
      "#{base} #{number}"
    else
      parts.map(&:capitalize).join(" ")
    end
  end

  def title_to_slug(title)
    normalized = title.to_s.strip.parameterize
    normalized.presence || "new-folder"
  end
end
