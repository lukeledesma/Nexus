# frozen_string_literal: true

require "digest"
require "json"
require "net/http"
require "uri"

class OllamaChat
  class Error < StandardError; end

  DEFAULT_HOST = "http://127.0.0.1:11434"
  READ_TIMEOUT = 60
  OPEN_TIMEOUT = 5
  DEFAULT_SYSTEM = "Keep answers short and direct unless the user asks for more detail."

  # When OLLAMA_MODEL is unset, first installed match wins (small / common names first).
  PREFERRED_MODELS = %w[
    llama3.2:1b llama3.2:3b llama3.2 llama3.1 llama3
    phi3 phi3:mini gemma2:2b gemma2 qwen2.5:3b qwen2.5 mistral tinyllama
  ].freeze

  def self.call(messages:)
    new.call(messages:)
  end

  def call(messages:)
    perform_chat(messages)
  rescue Error => e
    raise e unless retry_after_model_missing?(e)

    Rails.cache.delete(resolved_model_cache_key)
    perform_chat(messages)
  end

  private

  def perform_chat(messages)
    raise Error, "No messages" if messages.blank?

    base = base_url.to_s.sub(%r{/+\z}, "")
    uri = URI.parse("#{base}/api/chat")
    normalized = normalize_messages(messages)
    with_system = [ { role: "system", content: system_prompt } ] + normalized
    chosen = model_name
    payload = {
      model: chosen,
      messages: with_system,
      stream: false,
      options: inference_options
    }

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.read_timeout = READ_TIMEOUT
    http.open_timeout = OPEN_TIMEOUT

    req = Net::HTTP::Post.new(uri.request_uri)
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(payload)

    res = http.request(req)
    unless res.is_a?(Net::HTTPSuccess)
      raise Error, format_http_error(res, chosen)
    end

    data = JSON.parse(res.body)
    content = data.dig("message", "content")
    raise Error, "Unexpected Ollama response" if content.nil?

    content.to_s
  rescue JSON::ParserError => e
    raise Error, "Invalid JSON from Ollama: #{e.message}"
  rescue SocketError, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, Net::OpenTimeout, Net::ReadTimeout => e
    raise Error, "Cannot reach Ollama at #{base_url} (#{e.class})"
  end

  def retry_after_model_missing?(error)
    return false if explicit_ollama_model?

    msg = error.message
    msg.match?(/not found/i) && msg.match?(/model/i)
  end

  def explicit_ollama_model?
    ENV["OLLAMA_MODEL"].to_s.strip.present?
  end

  def base_url
    ENV.fetch("OLLAMA_HOST", DEFAULT_HOST)
  end

  def resolved_model_cache_key
    "ollama/resolved_model/v2/#{Digest::SHA256.hexdigest(base_url)[0, 16]}"
  end

  def model_name
    explicit = ENV["OLLAMA_MODEL"].to_s.strip
    return explicit if explicit.present?

    Rails.cache.fetch(resolved_model_cache_key, expires_in: 10.minutes) do
      names = fetch_tag_names
      raise Error, "Cannot reach Ollama at #{base_url} to list models." if names.nil?

      pick = pick_preferred_model(names)
      if pick.blank?
        raise Error, "No models installed. Run `ollama pull llama3.2` (or any model), then retry."
      end

      pick
    end
  end

  def fetch_tag_names
    base = base_url.to_s.sub(%r{/+\z}, "")
    uri = URI.parse("#{base}/api/tags")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == "https"
    http.read_timeout = READ_TIMEOUT
    http.open_timeout = OPEN_TIMEOUT
    res = http.request(Net::HTTP::Get.new(uri.request_uri))
    return nil unless res.is_a?(Net::HTTPSuccess)

    data = JSON.parse(res.body)
    (data["models"] || []).filter_map { |m| m["name"] }
  rescue JSON::ParserError, SocketError, Errno::ECONNREFUSED, Errno::EHOSTUNREACH, Net::OpenTimeout, Net::ReadTimeout
    nil
  end

  def pick_preferred_model(names)
    return nil if names.blank?

    PREFERRED_MODELS.each do |pref|
      hit = names.find { |n| model_name_matches?(n, pref) }
      return hit if hit
    end

    names.first
  end

  def model_name_matches?(installed, preferred)
    return true if installed == preferred
    return true if installed.start_with?("#{preferred}:")

    base = installed.split(":", 2).first
    base == preferred
  end

  def system_prompt
    ENV.fetch("OLLAMA_SYSTEM_PROMPT", DEFAULT_SYSTEM)
  end

  def inference_options
    {
      num_predict: env_int("OLLAMA_NUM_PREDICT", 220, min: 32, max: 512),
      num_ctx: env_int("OLLAMA_NUM_CTX", 2048, min: 512, max: 8192)
    }
  end

  def env_int(key, default, min:, max:)
    v = ENV.fetch(key, default.to_s).to_i
    v = default if v <= 0
    v.clamp(min, max)
  end

  def format_http_error(res, model)
    raw = res.body.to_s
    detail =
      begin
        JSON.parse(raw)["error"]
      rescue JSON::ParserError, TypeError
        nil
      end
    detail = detail.presence || raw[0, 400].presence || res.message
    msg = "Ollama HTTP #{res.code}: #{detail}"
    if detail.to_s.include?("not found") && detail.to_s.match?(/model/i)
      hint =
        if explicit_ollama_model?
          " — check OLLAMA_MODEL matches `ollama list`, or run `ollama pull #{model}`."
        else
          " — run `ollama list` / `ollama pull <name>`, or set OLLAMA_MODEL explicitly."
        end
      msg += hint
    end
    msg
  end

  def normalize_messages(messages)
    Array(messages).map do |m|
      h = m.stringify_keys
      role = h["role"].to_s
      content = h["content"].to_s
      raise Error, "Invalid message (role/content)" if role.blank? || content.blank?
      unless %w[user assistant system].include?(role)
        raise Error, "Invalid role: #{role}"
      end

      { role:, content: }
    end
  end
end
