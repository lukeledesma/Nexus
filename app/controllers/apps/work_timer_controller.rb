# frozen_string_literal: true

module Apps
  class WorkTimerController < BaseController
    before_action :ensure_work_timer_item

    def show
      @notes_text = @work_timer_item.body.to_s
      render layout: false if turbo_frame_request?
    end

    def save_notes
      text = params[:notes_text].to_s
      if @work_timer_item.update(body: text)
        render json: { ok: true }
      else
        render json: { error: @work_timer_item.errors.full_messages.first }, status: :unprocessable_entity
      end
    end

    private

    def ensure_work_timer_item
      app_folder = Folder.find_or_create_by!(name: "App")
      @work_timer_item = Item.find_or_create_by!(
        folder_id: app_folder.id,
        item_type: "work_timer"
      ) do |item|
        item.name = "Work Timer Notes"
        item.body = ""
      end
    end
  end
end
