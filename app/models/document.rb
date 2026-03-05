# frozen_string_literal: true

class Document < ApplicationRecord
  DEFAULT_IP = "0.0.0.0"
  DEFAULT_PROTOCOL = "TCP"
  DEFAULT_FILENAME = "export.xml"

  validate :records_must_be_array
  before_validation :set_default_metadata, on: :create

  def metadata
    {
      ip: metadata_ip.presence || DEFAULT_IP,
      protocol: metadata_protocol.presence || DEFAULT_PROTOCOL,
      filename: metadata_filename.presence || DEFAULT_FILENAME
    }
  end

  def metadata=(h)
    self.metadata_ip = h[:ip] || h["ip"]
    self.metadata_protocol = h[:protocol] || h["protocol"]
    self.metadata_filename = h[:filename] || h["filename"]
  end

  def records_with_string_keys
    return [] if records.blank?
    records.map { |r| r.transform_keys(&:to_s) }
  end

  private

  def set_default_metadata
    self.metadata_ip ||= DEFAULT_IP
    self.metadata_protocol ||= DEFAULT_PROTOCOL
    self.metadata_filename ||= DEFAULT_FILENAME
  end

  def records_must_be_array
    return if records.is_a?(Array)
    errors.add(:records, "must be an array")
  end
end
