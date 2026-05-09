# frozen_string_literal: true

# Per-user JSON key/value store for client-driven app state that needs to follow
# the user across devices (calendar events, draft window registries, app prefs).
#
# Keys are namespaced strings such as "calendar.events", "windows.notes". The
# `data` jsonb column stores arbitrary JSON (objects, arrays, scalars). Reads
# and writes are always scoped to a user; the controller enforces this.
class UserAppState < ApplicationRecord
  belongs_to :user

  KEY_FORMAT = /\A[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}\z/
  MAX_PAYLOAD_BYTES = 1.megabyte

  validates :key, presence: true, format: { with: KEY_FORMAT },
                  uniqueness: { scope: :user_id, case_sensitive: true }
  validate :payload_within_size_limit

  # Upsert helper that returns the persisted record. `value` may be any JSON-
  # serializable structure; nil deletes the row.
  def self.put(user:, key:, value:)
    if value.nil?
      where(user_id: user.id, key: key).delete_all
      return nil
    end

    record = find_or_initialize_by(user_id: user.id, key: key)
    record.data = value
    record.save!
    record
  end

  private

  def payload_within_size_limit
    return if data.nil?

    bytes = data.to_json.bytesize
    return if bytes <= MAX_PAYLOAD_BYTES

    errors.add(:data, "is too large (#{bytes} bytes; limit #{MAX_PAYLOAD_BYTES})")
  end
end
