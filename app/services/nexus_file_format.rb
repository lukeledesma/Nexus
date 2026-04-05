# frozen_string_literal: true

# Unified on-disk header for workspace text files (Notepad, Tasks, Sticky Notes, Finder, future apps).
# First line is always "# NEXUS_FILE v1"; metadata lines use "# key: value" until a blank line, then body.
module NexusFileFormat
  VERSION = "1"
  FIRST_LINE = "# NEXUS_FILE v#{VERSION}".freeze

  KIND_NOTE = "note"
  KIND_TASK_LIST = "task_list"
  KIND_STICKYNOTES = "stickynotes"

  module_function

  def unified_header_lines(kind:, title:, document_id: nil, created_at: nil, updated_at: nil, extra: {})
    lines = [FIRST_LINE, "# kind: #{kind}", "# title: #{title}"]
    lines << "# id: #{document_id}" if document_id.present?
    lines << "# created_at: #{format_ts(created_at)}"
    lines << "# updated_at: #{format_ts(updated_at)}"
    extra.each do |k, v|
      lines << "# #{k}: #{v}"
    end
    lines << ""
    lines
  end

  def format_ts(value)
    return "null" if value.blank?

    value.respond_to?(:iso8601) ? value.iso8601 : value.to_s
  end
end
