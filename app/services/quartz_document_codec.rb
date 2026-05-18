# frozen_string_literal: true

# QuartzDocumentCodec — serializes/deserializes Quartz documents.
#
# On-disk format:
#
#   # NEXUS_FILE v1
#   # kind: quartz
#   # title: My Document
#   # created_at: ...
#   # updated_at: ...
#
#   #timecard
#   10:00-12:00 Client A
#   - Meeting notes
#
#   #timer
#   25m - 09:30 AM
#   22:48 - 09:55 AM
#
#   #tasklist
#   ☐ Buy groceries
#   ☑ Do laundry
#
#   #notes
#   Anything freeform here.
#
# The body is entirely owned by the JS controller — this codec just wraps it
# in the standard NEXUS_FILE header and unwraps it on load. There is no
# structured state beyond the raw text body; all mode state (timer anchors,
# task completion, time ranges) is encoded inline in the text itself.
#
class QuartzDocumentCodec
  VALID_TRIGGERS = %w[#timecard #timer #tasklist #math].freeze
  TRIGGER_RE = /^\s*(#[a-z][a-z0-9_-]*)/i

  def self.load(content)
    new.load(content)
  end

  def self.dump(body, title: "Quartz")
    new.dump(body, title: title)
  end

  def self.validate_body(body)
    new.send(:validate_body, body)
  end

  def load(content)
    normalized = normalize(content.to_s)
    body = extract_body(normalized)
    { "body" => body, "validation" => validate_body(body) }
  end

  def dump(body, title: "Quartz")
    [
      NexusFileFormat::FIRST_LINE,
      "# kind: #{NexusFileFormat::KIND_QUARTZ}",
      "# title: #{title}",
      "",
      body.to_s
    ].join("\n")
  end

  private

  def normalize(raw)
    raw.gsub(/\r\n?/, "\n")
  end

  def extract_body(raw)
    lines = raw.split("\n", -1)
    return "" unless lines.first.to_s.strip == NexusFileFormat::FIRST_LINE

    # Skip header lines (# key: value) until blank separator line
    body_start = lines.length
    lines.each_with_index do |line, i|
      next if i.zero? # NEXUS_FILE v1 line
      stripped = line.strip
      if stripped.start_with?("# ")
        next # metadata line
      elsif stripped.empty?
        body_start = i + 1
        break
      else
        body_start = i
        break
      end
    end

    lines[body_start..]&.join("\n").to_s
  end

  def validate_body(body)
    seen = {}
    invalid_triggers = []

    normalize(body.to_s).split("\n", -1).each_with_index do |line, idx|
      m = TRIGGER_RE.match(line)
      next unless m

      trigger = m[1].to_s.downcase
      next unless VALID_TRIGGERS.include?(trigger)

      if seen.key?(trigger)
        invalid_triggers << {
          "trigger" => trigger,
          "line" => idx + 1,
          "reason" => "duplicate_trigger",
          "first_seen_line" => seen[trigger]
        }
      else
        seen[trigger] = idx + 1
      end
    end

    {
      "valid" => invalid_triggers.empty?,
      "invalid_triggers" => invalid_triggers
    }
  end
end
