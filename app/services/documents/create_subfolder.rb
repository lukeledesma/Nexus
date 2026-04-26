# frozen_string_literal: true

module Documents
  class CreateSubfolder
    def self.call(parent:, title:)
      new(parent: parent, title: title).call
    end

    def initialize(parent:, title:)
      @parent = parent
      @title = title.to_s.strip
    end

    def call
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Parent must be a folder") unless @parent&.folder?
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Folder name is required.") if @title.blank?
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Name cannot start with a period") if @title.start_with?(".")

      child = Document.new(is_folder: true, parent: @parent, title: @title)
      persist = DocumentPersistence.persist(child, operation: :create)

      if persist.success?
        Support::OperationResult.new(status: :ok, payload: { id: child.id, title: child.title })
      else
        Support::OperationResult.new(status: :unprocessable_entity, error: child.errors.full_messages.to_sentence.presence || persist.error)
      end
    end
  end
end
