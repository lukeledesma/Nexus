# frozen_string_literal: true

class CalendarEventDocumentCodec
  def self.load(content)
    new.load(content)
  end

  def self.dump(state)
    new.dump(state)
  end

  def load(content)
    normalized = normalize_serialized_text(content.to_s)
    parse_unified(normalized) || blank_state
  end

  def dump(state)
    events = state.to_h.stringify_keys
    
    header = NexusFileFormat.unified_header_lines(
      kind: "calendar_events",
      title: "Calendar Events"
    )
    
    lines = header.dup
    
    # Add events organized by date
    events.each do |date, events_for_date|
      next if events_for_date.blank?
      
      lines << "# #{date}"
      Array(events_for_date).each do |event|
        lines << serialize_event(event)
      end
      lines << ""
    end
    
    lines.join("\n").strip + "\n"
  end

  private

  def normalize_serialized_text(text)
    text.to_s.gsub(/\r\n?/, "\n")
  end

  def blank_state
    {}
  end

  def parse_unified(raw)
    lines = raw.to_s.split("\n", -1)
    return nil unless lines.first.to_s.strip == NexusFileFormat::FIRST_LINE
    
    # Skip header lines (NEXUS_FILE v1 and metadata)
    body_start_idx = 0
    lines.each_with_index do |line, idx|
      stripped = line.to_s.strip
      if idx == 0
        next
      elsif stripped.blank? && idx > 0
        # Found the blank line separating header from body
        body_start_idx = idx + 1
        break
      elsif !stripped.start_with?("# ")
        # Found body start (non-metadata line)
        body_start_idx = idx
        break
      end
    end
    
    body_lines = lines[body_start_idx...].join("\n")
    parse_events_from_body(body_lines)
  end

  def parse_events_from_body(body)
    events_by_date = {}
    current_date = nil
    
    body.each_line do |line|
      stripped = line.to_s.strip
      next if stripped.blank?
      
      # Date header line (e.g., "# 2026-05-09")
      if stripped.match?(/^# \d{4}-\d{2}-\d{2}$/)
        current_date = stripped.delete_prefix("# ").strip
        events_by_date[current_date] = []
        next
      end
      
      # Event line (e.g., "# [time:08:00|color:#f59e0b|...] ACS Event")
      if stripped.start_with?("# [") && stripped.include?("] ")
        next unless current_date
        
        event = parse_event_line(stripped)
        events_by_date[current_date] << event if event
      end
    end
    
    events_by_date
  end

  def parse_event_line(line)
    # Format: # [time:08:00|color:#f59e0b|calendar:personal|all_day:true] Event Title
    match = line.match(/^# \[([^\]]*)\]\s+(.+)$/)
    return nil unless match
    
    details_str = match[1]
    title = match[2]
    
    event = { "title" => title }
    
    # Parse details
    details_str.split("|").each do |detail|
      detail = detail.strip
      next if detail.blank?
      
      if detail.start_with?("time:")
        event["time"] = detail.delete_prefix("time:").strip
      elsif detail.start_with?("end:")
        event["end"] = detail.delete_prefix("end:").strip
      elsif detail.start_with?("color:")
        event["color"] = detail.delete_prefix("color:").strip
      elsif detail.start_with?("calendar:")
        event["calendar"] = detail.delete_prefix("calendar:").strip
      elsif detail.start_with?("all_day:")
        event["all_day"] = detail.delete_prefix("all_day:").strip == "true"
      end
    end
    
    event
  end

  def serialize_event(event)
    # Build details string from event hash
    details = []
    
    if event["time"].present?
      details << "time:#{event['time']}"
    end
    if event["end"].present?
      details << "end:#{event['end']}"
    end
    if event["color"].present?
      details << "color:#{event['color']}"
    end
    if event["calendar"].present?
      details << "calendar:#{event['calendar']}"
    end
    if event["all_day"].present?
      details << "all_day:#{event['all_day'] ? 'true' : 'false'}"
    end
    
    details_str = details.join("|")
    title = event["title"].to_s.strip
    
    "# [#{details_str}] #{title}"
  end
end
