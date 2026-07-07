# frozen_string_literal: true

module Documents
  class CreateFile
    def self.call(parent:, content_type:)
      new(parent: parent, content_type: content_type).call
    end

    def initialize(parent:, content_type:)
      @parent = parent
      @content_type = normalize_content_type(content_type)
    end

    def call
      return Support::OperationResult.new(status: :forbidden, error: "Items can only be created inside folders.") unless @parent&.folder?

      item = Document.new(
        is_folder: false,
        parent: @parent,
        title: next_item_title,
        content_type: @content_type,
        content: nil,
        tasks: [],
        reset_mode: "none",
        reset_days: []
      )

      persist = DocumentPersistence.persist(item, operation: :create)
      if persist.success?
        Support::OperationResult.new(status: :ok, payload: { folder_id: @parent.id, file_id: item.id })
      else
        Support::OperationResult.new(status: :unprocessable_entity, error: "Could not create item.")
      end
    end

    private

    def normalize_content_type(raw)
      value = raw.to_s
      return value if Document::CONTENT_TYPES.include?(value)

      "task_list"
    end

    def next_item_title
      base =
        case @content_type
        when "task_list" then "Untitled Task List"
        when "alchemy_tag_list" then "Untitled PLC Tag List"
        else "Untitled Note"
        end
      names = @parent.children.files.where(content_type: @content_type).pluck(:title).map(&:to_s)
      return base unless names.include?(base)

      suffixes = names
        .map { |name| name[/^#{Regexp.escape(base)} (\d+)$/, 1]&.to_i }
        .compact
        .select { |num| num >= 2 }
        .uniq
        .sort

      expected = 2
      suffixes.each do |num|
        return "#{base} #{expected}" if num != expected

        expected += 1
      end

      "#{base} #{expected}"
    end
  end
end
