module ApplicationHelper
  # Single source for launcher grid tiles: order, labels, icons, and click handlers.
  # Add rows here to grow the grid; CSS keeps 2 columns with wrap.
  def launcher_grid_entries
    [
      { window_key: "singular-note", pin_key: "singular-note", label: "NOTEPAD", icon: :notepad, handler: :app },
      { window_key: "singular-task-list", pin_key: "singular-task-list", label: "TASKS", icon: :task_checklist, handler: :app },
      { window_key: "singular-whiteboard", pin_key: "singular-whiteboard", label: "STICKY NOTES", icon: :sticky_note, handler: :app },
      { window_key: "singular-excalidraw", pin_key: "singular-excalidraw", label: "SKETCHPAD", icon: :design_services, handler: :app },
      { window_key: "conversion-chart", pin_key: "conversion-chart", label: "SAE/METRIC", handler: :conversion },
      { window_key: "timer", pin_key: "timer", label: "TIMER", icon: :timer, handler: :app },
      { window_key: "finder", pin_key: "finder", label: "FINDER", icon: :folder, handler: :app },
      { window_key: "settings", pin_key: "settings", label: "SETTINGS", icon: :settings, handler: :app },
      { window_key: "theme-studio", pin_key: "theme-studio", label: "THEME STUDIO", icon: :tune, handler: :app }
    ].freeze
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
