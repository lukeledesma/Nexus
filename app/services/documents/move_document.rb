# frozen_string_literal: true

module Documents
  class MoveDocument
    def self.call(user:, document:, parent_id:, kind:)
      new(user: user, document: document, parent_id: parent_id, kind: kind).call
    end

    def initialize(user:, document:, parent_id:, kind:)
      @user = user
      @document = document
      @parent_id = parent_id.to_i
      @kind = kind.to_sym
      @policy = ::DocumentPolicy.new(user: user, document: document)
    end

    def call
      kind_check = @kind == :folder ? @document.folder? : @document.file?
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Only #{@kind}s can be moved.") unless kind_check

      return Support::OperationResult.new(status: :forbidden, error: forbidden_message) unless allowed_by_policy?

      finder_root = Apps::FinderController.finder_section_root_for_document(@user, @document)
      return Support::OperationResult.new(status: :forbidden, error: not_in_finder_message) unless finder_root && Apps::FinderController.document_in_finder_subtree?(finder_root, @document)

      target = Document.find_by(id: @parent_id)
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Choose a folder to move into.") if @parent_id <= 0
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Invalid folder.") unless target&.folder?
      return Support::OperationResult.new(status: :forbidden, error: "Can only move into folders in Finder.") unless Apps::FinderController.document_in_finder_subtree?(finder_root, target)
      target_policy = ::DocumentPolicy.new(user: @user, document: target)
      return Support::OperationResult.new(status: :forbidden, error: "Cannot move into that folder.") if target_policy.in_trash?
      if target.protected_workspace_structure? && @kind == :folder
        return Support::OperationResult.new(status: :forbidden, error: "Cannot move into that folder.")
      end

      if @kind == :folder && (target.id == @document.id || within_tree?(@document, target))
        return Support::OperationResult.new(status: :unprocessable_entity, error: "Cannot move a folder into itself or its subfolder.")
      end

      @document.parent = target
      persist = DocumentPersistence.persist(@document, operation: :update)
      if persist.success?
        Support::OperationResult.new(status: :ok, payload: { id: @document.id, parent_id: target.id })
      else
        Support::OperationResult.new(status: :unprocessable_entity, error: @document.errors.full_messages.to_sentence.presence || "Could not move item.")
      end
    end

    private

    def allowed_by_policy?
      @kind == :folder ? @policy.can_move_folder? : @policy.can_move_file?
    end

    def forbidden_message
      @kind == :folder ? "This folder cannot be moved." : "File is not in Finder."
    end

    def not_in_finder_message
      @kind == :folder ? "Folder is not in Finder." : "File is not in Finder."
    end

    def within_tree?(folder, node)
      current = node
      while current
        return true if current.id == folder.id

        current = current.parent
      end
      false
    end
  end
end
