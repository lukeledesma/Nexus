# frozen_string_literal: true

module Documents
  class RestoreFromTrash
    Result = Struct.new(:success?, :payload, :error, keyword_init: true)

    STATE_KEY = Documents::TrashDocument::STATE_KEY

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
      return failure("Only files can be restored.") unless @document&.file?

      workspace_root = FinderListedFolders.workspace_root_for(@user)
      return failure("Trash folder is unavailable.") unless workspace_root

      trash_parent = @document.parent
      return failure("This item is not in Trash.") unless trash_parent&.folder?
      return failure("This item is not in Trash.") unless trash_parent.title.to_s.casecmp?(Apps::FinderController::TRASH_SECTION_TITLE)

      parent = restore_parent_for(@document.id)
      parent ||= Apps::FinderController.workspace_section_root(@user, "documents")
      return failure("No valid restore destination found.") unless parent&.folder?

      @document.parent = parent
      result = DocumentPersistence.persist(@document, operation: :update)
      return failure(result.error.presence || "Could not restore item.") unless result.success?

      clear_origin!(@document.id)
      success(id: @document.id, parent_id: parent.id)
    end

    private

    def origins_hash
      record = UserAppState.find_by(user_id: @user.id, key: STATE_KEY)
      data = record&.data
      return {} unless data.is_a?(Hash)

      data.deep_dup
    end

    def restore_parent_for(document_id)
      map = origins_hash
      payload = map[document_id.to_s]
      parent_id = payload.is_a?(Hash) ? payload["parent_id"] : nil
      return nil if parent_id.blank?

      candidate = Document.find_by(id: parent_id)
      return nil unless candidate&.folder?
      return nil unless Apps::FinderController.document_in_any_finder_section?(@user, candidate)
      return nil if candidate.title.to_s.casecmp?(Apps::FinderController::TRASH_SECTION_TITLE)

      candidate
    end

    def clear_origin!(document_id)
      map = origins_hash
      map.delete(document_id.to_s)
      UserAppState.put(user: @user, key: STATE_KEY, value: map.presence)
    end

    def success(payload)
      Result.new(success?: true, payload: payload)
    end

    def failure(error)
      Result.new(success?: false, payload: {}, error: error)
    end
  end
end
