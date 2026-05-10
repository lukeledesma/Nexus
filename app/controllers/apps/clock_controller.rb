# frozen_string_literal: true

module Apps
  class ClockController < BaseController
    def show
      render layout: false if turbo_frame_request?
    end
  end
end
