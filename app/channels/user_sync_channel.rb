# frozen_string_literal: true

# Broadcasts real-time state changes to all sessions belonging to the same user.
#
# Each user gets their own stream: "user_sync:<user_id>"
# Messages have the shape:
#   { type: "state_changed", key: "...", value: <json>, updated_at: "iso8601" }
#   { type: "calendar_changed", updated_at: "iso8601" }
#
# The JS subscriber in nexus_user_state.js listens and applies changes in-place
# so no page refresh is needed when another device makes a change.
class UserSyncChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_user
  end

  def unsubscribed; end

  # Convenience broadcast helpers called by controllers/services.
  def self.broadcast_state_change(user:, key:, value:)
    broadcast_to(user, {
      type: "state_changed",
      key: key,
      value: value,
      updated_at: Time.current.iso8601
    })
  end

  def self.broadcast_calendar_change(user:, updated_at:)
    broadcast_to(user, {
      type: "calendar_changed",
      updated_at: updated_at
    })
  end

  def self.broadcast_task_list_change(user:, document_id:, tasks:, updated_at:)
    broadcast_to(user, {
      type: "task_list_changed",
      document_id: document_id,
      tasks: tasks,
      updated_at: updated_at
    })
  end

  def self.broadcast_document_change(user:, document_id:, content_type:, content: nil, tasks: nil, updated_at:)
    broadcast_to(user, {
      type: "document_changed",
      document_id: document_id,
      content_type: content_type,
      content: content,
      tasks: tasks,
      updated_at: updated_at
    })
  end

  def self.broadcast_finder_change(user:, section_key: nil)
    broadcast_to(user, {
      type: "finder_changed",
      section_key: section_key,
      updated_at: Time.current.iso8601
    })
  end

  # Backwards-compatible API used across controllers/services.
  # Maps older workspace "kind" dispatches to current specific broadcasts.
  def self.broadcast_workspace_change(user:, kind:, section_key: nil, updated_at: Time.current.iso8601)
    case kind.to_s
    when "finder"
      broadcast_finder_change(user: user, section_key: section_key)
    when "calendar"
      broadcast_calendar_change(user: user, updated_at: updated_at)
    else
      broadcast_finder_change(user: user, section_key: section_key)
    end
  end

  def self.broadcast_wallpaper_change(user:, wallpaper_background_kind:, wallpaper_image_document_id:)
    broadcast_to(user, {
      type: "wallpaper_changed",
      wallpaper_background_kind: wallpaper_background_kind,
      wallpaper_image_document_id: wallpaper_image_document_id,
      updated_at: Time.current.iso8601
    })
  end
end
