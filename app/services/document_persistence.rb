# frozen_string_literal: true

class DocumentPersistence
  class Error < StandardError
    attr_reader :code
    def initialize(message, code:)
      @code = code
      super(message)
    end
  end
  DiskSyncError = Class.new(Error)

  Result = Struct.new(:success?, :document, :error, :code, keyword_init: true)

  def self.persist(document, operation: nil)
    new(document: document, operation: operation).persist
  end

  def self.destroy(document)
    new(document: document, operation: :destroy).destroy
  end

  def initialize(document:, operation: nil)
    @document = document
    @operation = operation&.to_sym
  end

  def persist
    ActiveRecord::Base.transaction do
      with_disk_sync_suppressed do
        @document.save!
      end
      sync_to_disk!
    end

    Result.new(success?: true, document: @document)
  rescue ActiveRecord::RecordInvalid
    Result.new(
      success?: false,
      document: @document,
      error: @document.errors.full_messages.to_sentence,
      code: :validation_failed
    )
  rescue DiskSyncError => e
    Result.new(success?: false, document: @document, error: e.message, code: e.code)
  rescue StandardError => e
    Rails.logger.error("[DocumentPersistence] failed: #{e.class}: #{e.message}")
    Result.new(success?: false, document: @document, error: "Could not save document.", code: :persistence_failed)
  end

  def destroy
    ActiveRecord::Base.transaction do
      with_disk_sync_suppressed do
        @document.destroy!
      end
      sync_destroy_on_disk!
    end

    Result.new(success?: true, document: @document)
  rescue ActiveRecord::RecordNotDestroyed
    Result.new(
      success?: false,
      document: @document,
      error: @document.errors.full_messages.to_sentence.presence || "Could not delete document.",
      code: :destroy_failed
    )
  rescue DiskSyncError => e
    Result.new(success?: false, document: @document, error: e.message, code: e.code)
  rescue StandardError => e
    Rails.logger.error("[DocumentPersistence] destroy failed: #{e.class}: #{e.message}")
    Result.new(success?: false, document: @document, error: "Could not delete document.", code: :persistence_failed)
  end

  private

  def sync_to_disk!
    return if defined?(DocumentDiskLoader) && DocumentDiskLoader.syncing?

    sync = DocumentStorageSyncLite.new(@document)
    operation = resolve_operation

    case operation
    when :create
      sync.create
    when :update
      sync.update
    else
      sync.update
    end
  rescue SystemCallError, IOError => e
    raise DiskSyncError.new("Could not sync document to disk.", code: :disk_sync_failed), cause: e
  end

  def sync_destroy_on_disk!
    return if defined?(DocumentDiskLoader) && DocumentDiskLoader.syncing?

    DocumentStorageSyncLite.new(@document).destroy
  rescue SystemCallError, IOError => e
    raise DiskSyncError.new("Could not sync document deletion to disk.", code: :disk_sync_failed), cause: e
  end

  def resolve_operation
    return @operation if @operation.in?(%i[create update])
    return :create if @document.previous_changes.key?("id")

    :update
  end

  def with_disk_sync_suppressed
    previous = Current.suppress_document_disk_sync
    Current.suppress_document_disk_sync = true
    yield
  ensure
    Current.suppress_document_disk_sync = previous
  end
end
