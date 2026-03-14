# frozen_string_literal: true

class Document < ApplicationRecord
  DEFAULT_FOLDER_TITLE = "New Folder"
  DEFAULT_NOTE_TITLE = "Untitled Note"
  DEFAULT_TASK_LIST_TITLE = "Untitled Task List"
  CONTENT_TYPES = %w[note task_list].freeze

  belongs_to :parent, class_name: "Document", optional: true
  has_many :children, class_name: "Document", foreign_key: :parent_id, dependent: :destroy

  scope :folders, -> { where(is_folder: true) }
  scope :files, -> { where(is_folder: false) }

  validate :parent_must_be_folder
  validate :title_cannot_start_with_dot
  validate :folders_cannot_have_content
  validate :files_must_have_valid_content_type
  before_validation :normalize_defaults
  after_create :sync_create_to_disk
  after_update :sync_update_to_disk
  after_destroy :sync_destroy_on_disk

  def folder?
    !!self[:is_folder]
  end

  def file?
    !folder?
  end

  def new_untitled_placeholder?
    false
  end

  def sync_create_to_disk
    return unless persisted?
    return if defined?(DocumentDiskLoader) && DocumentDiskLoader.syncing?

    DocumentStorageSyncLite.new(self).create
  end

  def sync_update_to_disk
    return unless persisted?
    return if defined?(DocumentDiskLoader) && DocumentDiskLoader.syncing?

    DocumentStorageSyncLite.new(self).update
  end

  def sync_destroy_on_disk
    return if defined?(DocumentDiskLoader) && DocumentDiskLoader.syncing?

    DocumentStorageSyncLite.new(self).destroy
  end

  private

  def normalize_defaults
    if folder?
      self.title = (title.presence || DEFAULT_FOLDER_TITLE).to_s.strip
      self.content = nil
      self.tasks = []
      self.content_type = "note"
      self.reset_mode = "none"
      self.reset_days = []
    else
      self.content_type = content_type.to_s.presence || "note"
      default_title = (content_type == "task_list" ? DEFAULT_TASK_LIST_TITLE : DEFAULT_NOTE_TITLE)
      self.title = (title.presence || default_title).to_s.strip
      self.tasks = normalize_tasks(tasks)
      self.reset_days = normalize_reset_days(reset_days)
      self.reset_mode = reset_days.present? ? "custom" : "none" if reset_mode.blank? || reset_mode == "custom"

      if content_type == "note"
        self.content = content.to_s if content.present?
        self.tasks = []
      elsif content_type == "task_list"
        self.content = nil if content.blank?
      end
    end
  end

  def normalize_tasks(raw_tasks)
    Array(raw_tasks).map do |task|
      next unless task.respond_to?(:to_h)

      value = task.to_h
      subtasks = Array(value["subtasks"]).filter_map do |subtask|
        next unless subtask.respond_to?(:to_h)

        subtask_value = subtask.to_h
        {
          "text" => subtask_value["text"].to_s,
          "checked" => ActiveModel::Type::Boolean.new.cast(subtask_value["checked"])
        }
      end

      checked = ActiveModel::Type::Boolean.new.cast(value["checked"])
      checked = subtasks.present? ? subtasks.all? { |subtask| subtask["checked"] } : checked

      {
        "text" => value["text"].to_s,
        "checked" => checked,
        "subtasks" => subtasks
      }
    end.compact
  end

  def normalize_reset_days(raw_days)
    Array(raw_days).filter_map do |value|
      day = value.to_i
      day if day.between?(0, 6)
    end.uniq.sort
  end

  def parent_must_be_folder
    return if parent_id.blank?
    return if parent&.folder?

    errors.add(:parent_id, "must reference a folder")
  end

  def title_cannot_start_with_dot
    value = title.to_s.strip
    return if value.blank?
    return unless value.start_with?(".")

    errors.add(:title, "cannot start with a period")
  end

  def folders_cannot_have_content
    return unless folder?
    return if content.blank?

    errors.add(:content, "must be blank for folders")
  end

  def files_must_have_valid_content_type
    return if folder?
    return if CONTENT_TYPES.include?(content_type.to_s)

    errors.add(:content_type, "must be note or task_list")
  end
end
