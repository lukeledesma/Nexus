# frozen_string_literal: true

# JSON API exposing the current user's namespaced app-state blobs.
#
# Routes:
#   GET    /user_app_states           => { "calendar.events" => [...], ... }
#   PATCH  /user_app_states/:key      => upsert (body: { value: <json> })
#   DELETE /user_app_states/:key      => remove
class UserAppStatesController < ApplicationController
  before_action :validate_key, only: %i[update destroy]

  def index
    states = current_user.user_app_states.pluck(:key, :data).to_h
    render json: { states: states }
  end

  def update
    raw_value = params[:value]
    raw_value = raw_value.to_unsafe_h if raw_value.respond_to?(:to_unsafe_h)
    raw_value = raw_value.map { |v| v.respond_to?(:to_unsafe_h) ? v.to_unsafe_h : v } if raw_value.is_a?(Array)

    record = UserAppState.put(user: current_user, key: params[:key], value: raw_value)
    render json: { key: params[:key], data: record&.data }
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
  end

  def destroy
    UserAppState.put(user: current_user, key: params[:key], value: nil)
    head :no_content
  end

  private

  def validate_key
    return if params[:key].is_a?(String) && params[:key].match?(UserAppState::KEY_FORMAT)

    render json: { error: "invalid key" }, status: :bad_request
  end
end
