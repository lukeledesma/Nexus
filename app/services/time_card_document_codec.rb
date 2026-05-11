# frozen_string_literal: true

require "cgi"

class TimeCardDocumentCodec
  FRONTMATTER_RE = /\A---\n(?<meta>.*?)\n---\n?(?<body>.*)\z/m

  def self.load(content)
    new.load(content)
  end

  def self.dump(state)
    new.dump(state)
  end

  def load(content)
    normalized = normalize_serialized_text(content.to_s)

    parse_unified(normalized) ||
      parse_legacy_frontmatter(normalized) ||
      blank_state.merge("notesText" => normalize_notes_body(normalized))
  end

  def dump(state)
    data = state.to_h.stringify_keys
    notes = data["notesText"].to_s
    header = NexusFileFormat.unified_header_lines(
      kind: NexusFileFormat::KIND_TIME_CARD,
      title: "Time Card",
      extra: {
        "entry_date" => date_string(data["entryDate"], data["entry_date"]),
        "start_time" => time_string(data["clockInMinutes"], data["start_time"]),
        "end_time" => time_string(data["clockOutMinutes"], data["end_time"]),
        "running" => truthy?(data["running"]),
        "clock_in_at_ms" => integer_string(data["clockInAtMs"], data["clock_in_at_ms"]),
        "clock_out_at_ms" => integer_string(data["clockOutAtMs"], data["clock_out_at_ms"])
      }
    )

    (header + [ notes ]).join("\n")
  end

  private

  # Collapse phantom blank lines persisted at EOF (often from save/serialize round-trips).
  # Single trailing newline is kept for normal typing flow.
  def normalize_notes_body(notes)
    notes.to_s.gsub(/\r\n?/, "\n").sub(/\n{2,}\z/, "")
  end

  def blank_state
    {
      "entryDate" => nil,
      "clockInMinutes" => nil,
      "clockInAtMs" => nil,
      "clockOutAtMs" => nil,
      "clockOutMinutes" => nil,
      "running" => false,
      "notesText" => ""
    }
  end

  def parse_meta(raw)
    raw.to_s.each_line.with_object({}) do |line, acc|
      key, value = line.split(":", 2)
      next if key.blank?

      acc[key.to_s.strip] = unquote(value.to_s.strip)
    end
  end

  def unquote(value)
    value.to_s.sub(/\A"/, "").sub(/"\z/, "")
  end

  def parse_legacy_frontmatter(raw)
    match = FRONTMATTER_RE.match(raw)
    return nil unless match

    meta = parse_meta(match[:meta])
    return nil unless meta["app"] == "time_card"

    state_from_meta(meta, match[:body].to_s)
  end

  def parse_unified(raw)
    lines = raw.to_s.split("\n", -1)
    return nil unless lines.first.to_s.strip == NexusFileFormat::FIRST_LINE

    metadata, body = extract_unified_metadata_and_body(lines)
    return nil unless metadata["kind"].to_s == NexusFileFormat::KIND_TIME_CARD

    state_from_meta(metadata, body)
  end

  def state_from_meta(meta, notes)
    {
      "entryDate" => parse_date(meta["entry_date"]),
      "clockInMinutes" => parse_time(meta["start_time"]),
      "clockInAtMs" => parse_integer(meta["clock_in_at_ms"]),
      "clockOutAtMs" => parse_integer(meta["clock_out_at_ms"]),
      "clockOutMinutes" => parse_time(meta["end_time"]),
      "running" => parse_boolean(meta["running"]),
      "notesText" => normalize_notes_body(notes)
    }
  end

  def extract_unified_metadata_and_body(lines)
    metadata = {}
    body_start = lines.length

    lines.each_with_index do |line, index|
      stripped = line.to_s.strip
      if index.zero?
        next if stripped == NexusFileFormat::FIRST_LINE

        break
      end

      if stripped.start_with?("# ")
        key, value = stripped.delete_prefix("# ").split(":", 2)
        metadata[key.to_s.strip] = value.to_s.strip
        next
      end

      if stripped.empty?
        body_start = index + 1
        break
      end

      body_start = index
      break
    end

    body = lines[body_start..]&.join("\n").to_s
    [ metadata, body ]
  end

  def normalize_serialized_text(raw)
    return raw unless html_wrapped?(raw)

    with_breaks = raw.to_s.gsub(/<br\s*\/?\s*>/i, "\n").gsub(%r{</p>}i, "\n\n")
    stripped = ActionController::Base.helpers.strip_tags(with_breaks).to_s
    CGI.unescapeHTML(stripped)
  end

  def html_wrapped?(raw)
    raw.to_s.match?(%r{<\s*(p|br|div|span|em|strong)\b}i)
  end

  def parse_time(value)
    v = value.to_s.strip
    return nil unless v.match?(/\A\d{2}:\d{2}\z/)

    hours, minutes = v.split(":", 2).map(&:to_i)
    return nil unless hours.between?(0, 23) && minutes.between?(0, 59)

    (hours * 60) + minutes
  end

  def parse_integer(value)
    v = value.to_s.strip
    return nil unless v.match?(/\A\d+\z/)

    v.to_i
  end

  def parse_date(value)
    v = value.to_s.strip
    return nil unless v.match?(/\A\d{4}-\d{2}-\d{2}\z/)

    Date.iso8601(v).iso8601
  rescue ArgumentError
    nil
  end

  def parse_boolean(value)
    value.to_s.strip.casecmp?("true")
  end

  def time_string(minutes_value, fallback)
    return fallback.to_s.strip if fallback.present?
    return "" unless minutes_value.to_s.match?(/\A\d+\z/)

    total = minutes_value.to_i
    format("%02d:%02d", (total / 60) % 24, total % 60)
  end

  def integer_string(primary, fallback)
    value = primary.presence || fallback
    value.to_s.match?(/\A\d+\z/) ? value.to_s : ""
  end

  def date_string(primary, fallback)
    [ primary, fallback ].each do |value|
      normalized = parse_date(value)
      return normalized if normalized.present?
    end

    ""
  end

  def truthy?(value)
    value == true || value.to_s.strip.casecmp?("true")
  end
end
