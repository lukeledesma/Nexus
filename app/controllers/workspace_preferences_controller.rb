# frozen_string_literal: true

class WorkspacePreferencesController < ApplicationController
  def show
    result = preferences_manager.payload
    render json: result.payload
  end

  def update
    wallpaper_updated = false

    if params[:apply_theme_gradient].present?
      return render json: { error: "Gradient wallpaper is no longer supported." }, status: :unprocessable_entity
    end

    if params[:theme].present?
      result = preferences_manager.apply_theme(params[:theme])
      return render json: result.payload, status: :unprocessable_entity unless result.success?
    end

    wallpaper_image_doc_id = WorkspacePreferences::Manager.wallpaper_apply_image_document_id_param(params[:apply_wallpaper_image])
    if wallpaper_image_doc_id.present?
      result = preferences_manager.apply_wallpaper_image(wallpaper_image_doc_id)
      return render json: result.payload, status: :unprocessable_entity unless result.success?

      wallpaper_updated = true
    end

    preferences_manager.persist!
    payload = preferences_manager.payload.payload

    if wallpaper_updated
      UserSyncChannel.broadcast_wallpaper_change(
        user: current_user,
        wallpaper_background_kind: payload["wallpaper_background_kind"],
        wallpaper_image_document_id: payload["wallpaper_image_document_id"]
      )
    end

    render json: payload
  end

  private

  def preferences_manager
    @preferences_manager ||= WorkspacePreferences::Manager.new(user: current_user)
  end
end
