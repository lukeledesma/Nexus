# frozen_string_literal: true

module Documents
  class TrashDocument
    Result = Struct.new(:success?, :payload, :error, keyword_init: true)

    STATE_KEY = "finder.trash.origins"

    class << self
      def call(user:, document:)
        new(user: user, document: document).call
      end
    end

    def initialize(user:, document:)
      @user = user
      @document = document
    end

    def call
      return failure("Only files can be moved to Trash.") unless @document&.file?

      trash_root = Apps::FinderController.workspace_trash_root(@user)
      return failure("Trash folder is unavailable.") unless trash_root
      return failure("This item is already in Trash.") if @document.parent_id == trash_root.id

      original_parent_id = @document.parent_id
      @document.parent = trash_root
      @document.is_favorited = false if @document.respond_to?(:is_favorited=)

      result = DocumentPersistence.persist(@document, operation: :update)
      return failure(result.error.presence || "Could not move item to Trash.") unless result.success?

      save_origin!(@document.id, original_parent_id)
      success(id: @document.id, parent_id: trash_root.id)
    end

    private

    def origins_hash
      record = UserAppState.find_by(user_id: @user.id, key: STATE_KEY)
      data = record&.data
      return {} unless data.is_a?(Hash)

      data.deep_dup
    end

    def save_origin!(document_id, parent_id)
      map = origins_hash
      map[document_id.to_s] = {
        "parent_id" => parent_id,
        "deleted_at" => Time.current.iso8601
      }
      UserAppState.put(user: @user, key: STATE_KEY, value: map)
    end

    def success(payload)
      Result.new(success?: true, payload: payload)
    end

    def failure(error)
      Result.new(success?: false, payload: {}, error: error)
    end
  end
end
