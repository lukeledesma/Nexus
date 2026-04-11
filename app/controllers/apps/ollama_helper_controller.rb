# frozen_string_literal: true

module Apps
  class OllamaHelperController < ApplicationController
    def chat
      raw = params.require(:messages)
      raise ActionController::ParameterMissing, :messages unless raw.is_a?(Array)

      list = raw.map do |entry|
        p = entry.is_a?(ActionController::Parameters) ? entry : ActionController::Parameters.new(entry)
        p.permit(:role, :content).to_h
      end

      text = OllamaChat.call(messages: list)
      render json: { ok: true, content: text }
    rescue ActionController::ParameterMissing => e
      render json: { ok: false, error: e.message }, status: :unprocessable_entity
    rescue OllamaChat::Error => e
      render json: { ok: false, error: e.message }, status: :bad_gateway
    end
  end
end
