# frozen_string_literal: true

module Support
  class OperationResult
    attr_reader :status, :payload, :error

    def initialize(status:, payload: nil, error: nil)
      @status = status.to_sym
      @payload = payload
      @error = error
    end

    def success?
      status == :ok
    end
  end
end
