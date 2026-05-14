# frozen_string_literal: true

# Broadcasts real-time state changes to all sessions belonging to the same user.
#
# Each user gets their own stream: "user_sync:<user_id>"
#
# Three message types:
#
#   state_changed     — a NexusUserState key was updated on another device
#     { type: "state_changed", key: "...", value: <json>, updated_at: "iso8601" }
#
#   document_changed  — document content was saved (notes, tasks, calendar, assets)
#     { type: "document_changed", document_id: <int>, content_type: "...",
#       content: "...", tasks: [...], updated_at: "iso8601" }
#
#   workspace_changed — workspace structure or appearance changed (finder tree, wallpaper)
#     { type: "workspace_changed", kind: "finder"|"wallpaper", updated_at: "iso8601", ...kind_payload }
#
# The JS subscriber in nexus_sync_channel.js listens and applies changes in-place
# so no page refresh is needed when another device makes a change.
class UserSyncChannel < ApplicationCable::Channel
  def subscribed
    stream_for current_user
  end

  def unsubscribed; end

  # --- State ---

  def self.broadcast_state_change(user:, key:, value:)
    broadcast_to(user, {
      type: "state_changed",
      key: key,
      value: value,
      updated_at: Time.current.iso8601
    })
  end

  # --- Document content ---

  # Covers notes, task lists, calendar events, and any future document content type.
  # `content` and `tasks` are optional — pass whichever the content_type uses.
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

  # --- Workspace structure / appearance ---

  # kind: "finder"    — finder tree changed; optional section_key narrows the affected section
  # kind: "wallpaper" — wallpaper/theme changed; pass wallpaper_background_kind and wallpaper_image_document_id
  def self.broadcast_workspace_change(user:, kind:, **payload)
    broadcast_to(user, {
      type: "workspace_changed",
      kind: kind,
      updated_at: Time.current.iso8601,
      **payload
    })
  end
end
