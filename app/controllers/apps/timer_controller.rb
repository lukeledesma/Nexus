# frozen_string_literal: true

require "json"
require "time"

module Apps
  class TimerController < BaseController
    STORAGE_ROOT = Rails.root.join("storage", "workspace").freeze
    DEFAULT_SECONDS = 0
    ALLOWED_MODES = %w[timer stopwatch].freeze

    def show
      @timer_state = read_state
    end

    def state
      render json: read_state
    end

    def update_state
      current = read_state
      incoming = normalize_state_payload(params)
      merged = current.merge(incoming)
      write_state(merged)
      render json: { ok: true }
    end

    private

    def timer_file
      username = current_user&.username.to_s.strip
      base_dir = username.present? ? STORAGE_ROOT.join(username, "Embedded") : STORAGE_ROOT.join("Embedded")
      base_dir.join("Timer.txt")
    end

    def normalize_state_payload(raw)
      mode = raw[:mode].to_s
      mode = "timer" unless ALLOWED_MODES.include?(mode)

      stopwatch_seconds = Integer(raw[:stopwatch_seconds]) if raw[:stopwatch_seconds].present?
      stopwatch_seconds ||= 0
      stopwatch_seconds = 0 if stopwatch_seconds&.negative?

      timer_seconds = Integer(raw[:timer_seconds]) if raw[:timer_seconds].present?
      timer_seconds ||= 0
      timer_seconds = 0 if timer_seconds&.negative?

      {
        "mode" => mode,
        "running" => ActiveModel::Type::Boolean.new.cast(raw[:running]),
        "stopwatch_seconds" => stopwatch_seconds,
        "timer_seconds" => timer_seconds,
        "updated_at" => Time.current.utc.iso8601
      }
    rescue ArgumentError, TypeError
      read_state
    end

    def parse_iso_time(value)
      return Time.current.utc.iso8601 if value.blank?

      Time.iso8601(value.to_s).utc.iso8601
    rescue ArgumentError
      Time.current.utc.iso8601
    end

    def read_state
      ensure_timer_file
      raw = File.read(timer_file)
      parse_workspace_timer_text(raw)
    rescue StandardError => e
      Rails.logger.error("Timer state parse error: #{e.message}")
      default_state
    end

    def write_state(state)
      FileUtils.mkdir_p(timer_file.dirname)
      content = format_workspace_timer_text(state)
      
      # Atomic write: write to temp file, then rename
      temp_file = Pathname.new("#{timer_file}.tmp")
      File.write(temp_file, content)
      File.rename(temp_file, timer_file)
    rescue StandardError => e
      Rails.logger.error("Timer state write error: #{e.message}")
      # Clean up temp file if it exists
      File.delete(temp_file) if temp_file&.exist?
      raise
    end

    def ensure_timer_file
      return if File.exist?(timer_file)

      write_state(default_state)
    end

    def default_state
      now = Time.current.utc.iso8601
      {
        "mode" => "timer",
        "running" => false,
        "stopwatch_seconds" => 0,
        "timer_seconds" => DEFAULT_SECONDS,
        "updated_at" => now
      }
    end

    def parse_workspace_timer_text(raw)
      stripped = raw.to_s.strip
      return parse_legacy_json_timer_text(stripped) if stripped.start_with?("{")

      data = {}

      stripped.each_line do |line|
        value = line.to_s.strip
        next if value.blank?

        if value.start_with?("#")
          match = value.match(/^#\s*([^:]+):\s*(.+)$/)
          next unless match

          key = match[1].to_s.strip.downcase.gsub(/\s+/, "_")
          data[key] = match[2].to_s.strip
          next
        end

        match = value.match(/^([a-z_]+):\s*(.+)$/i)
        next unless match

        data[match[1].to_s.strip.downcase] = match[2].to_s.strip
      end

      # Extract mode defensively - preserve what's in the file
      mode = data["active_mode"].to_s.strip
      mode = "timer" unless ALLOWED_MODES.include?(mode)

      # Safe integer parsing - fail gracefully for each field
      stopwatch_seconds = 0
      begin
        stopwatch_seconds = Integer(data["stopwatch_seconds"])
        stopwatch_seconds = 0 if stopwatch_seconds.negative?
      rescue StandardError
        stopwatch_seconds = 0
      end

      timer_seconds = 0
      begin
        timer_seconds = Integer(data["timer_seconds"])
        timer_seconds = 0 if timer_seconds.negative?
      rescue StandardError
        timer_seconds = 0
      end

      running = false
      begin
        running = ActiveModel::Type::Boolean.new.cast(data["running"])
      rescue StandardError
        running = false
      end

      {
        "mode" => mode,
        "running" => running,
        "stopwatch_seconds" => stopwatch_seconds,
        "timer_seconds" => timer_seconds,
        "updated_at" => parse_iso_time(data["updated_at"])
      }
    rescue StandardError
      default_state
    end

    def parse_legacy_json_timer_text(raw)
      parsed = JSON.parse(raw)
      mode = parsed["mode"].to_s
      mode = "timer" unless ALLOWED_MODES.include?(mode)

      seconds = Integer(parsed["seconds"])
      seconds = 0 if seconds.negative?

      {
        "mode" => mode,
        "running" => ActiveModel::Type::Boolean.new.cast(parsed["running"]),
        "stopwatch_seconds" => mode == "stopwatch" ? seconds : 0,
        "timer_seconds" => mode == "timer" ? seconds : DEFAULT_SECONDS,
        "updated_at" => parse_iso_time(parsed["updated_at"])
      }
    rescue JSON::ParserError, ArgumentError, TypeError
      default_state
    end

    def format_workspace_timer_text(state)
      <<~TEXT
        # NEXUS_TIMER
        # name: Timer
        # updated_at: #{state["updated_at"]}
        # active_mode: #{state["mode"]}
        # running: #{state["running"]}

        stopwatch_seconds: #{state["stopwatch_seconds"]}
        timer_seconds: #{state["timer_seconds"]}
      TEXT
    end
  end
end
