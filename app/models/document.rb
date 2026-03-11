# frozen_string_literal: true

class Document < ApplicationRecord
  DEFAULT_IP = "0.0.0.0"
  DEFAULT_PROTOCOL = "TCP"
  DEFAULT_FILENAME = "export.xml"

  belongs_to :parent, class_name: "Document", optional: true
  has_many :children, class_name: "Document", foreign_key: :parent_id, dependent: :destroy

  scope :folders, -> { where(is_folder: true) }
  scope :files, -> { where(is_folder: false) }

  validate :records_must_be_array
  validate :folder_parent_must_be_blank
  validate :metadata_filename_cannot_start_with_dot
  before_validation :set_default_metadata, on: :create
  before_validation :normalize_folder_defaults

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

  def folder?
    !!self[:is_folder]
  end

  def file?
    !folder?
  end

  def new_untitled_placeholder?
    !!self[:new_untitled_placeholder]
  end

  private

  def set_default_metadata
    return if folder?

    self.metadata_ip ||= DEFAULT_IP
    self.metadata_protocol ||= DEFAULT_PROTOCOL
    self.metadata_filename ||= "Untitled"
  end

  def normalize_folder_defaults
    if folder?
      self.records = [] unless records.is_a?(Array)
      self.metadata_filename = (metadata_filename.presence || "New Folder").to_s.strip
      self.storage_path = (storage_path.presence || metadata_filename).to_s.strip
      self.metadata_ip = nil
      self.metadata_protocol = nil
      self.new_untitled_placeholder = false if has_attribute?(:new_untitled_placeholder)
    else
      self.metadata_filename = (metadata_filename.presence || "Untitled").to_s.strip
    end
  end

  def records_must_be_array
    return if records.is_a?(Array)
    errors.add(:records, "must be an array")
  end

  def folder_parent_must_be_blank
    return unless folder? && parent_id.present?

    errors.add(:parent_id, "must be blank for folders")
  end

  def metadata_filename_cannot_start_with_dot
    value = metadata_filename.to_s.strip
    return if value.blank?
    return unless value.start_with?(".")

    errors.add(:metadata_filename, "cannot start with a period")
  end
end
