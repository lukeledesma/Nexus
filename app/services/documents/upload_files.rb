# frozen_string_literal: true

require "marcel"

module Documents
  class UploadFiles
    TEXT_LIKE_EXTENSIONS = %w[.txt .nexus .rtf].freeze
    ALCHEMY_SOURCE_SUFFIXES = %w[.xml .json .xml.tar .xml.tar.gz .tgz].freeze

    FILE_KIND_LABELS = {
      ".png" => "PNG",
      ".mp3" => "MP3",
      ".wav" => "WAV"
    }.freeze

    def self.call(user:, folder:, files:)
      new(user: user, folder: folder, files: files).call
    end

    def initialize(user:, folder:, files:)
      @user = user
      @folder = folder
      @files = files
      @policy = ::DocumentPolicy.new(user: user, document: folder)
    end

    def call
      return Support::OperationResult.new(status: :unprocessable_entity, error: "Upload into a folder only.") unless @folder&.folder?

      iimage_folder = EmbeddedIimageFolder.document_for(@user)
      return Support::OperationResult.new(status: :forbidden, error: "Can only upload into allowed folders.") unless @policy.can_upload_to_folder?(iimage_folder_id: iimage_folder&.id)

      list = normalize_uploaded_file_list(@files)
      return Support::OperationResult.new(status: :unprocessable_entity, error: "No files received.") if list.empty?

      in_iimage = iimage_folder && @folder.id == iimage_folder.id
      in_alchemy = folder_section_key == "alchemy"
      created_ids = []
      errors = []

      list.each do |uploaded|
        ext = File.extname(uploaded.original_filename.to_s).downcase
        doc, error_message = if in_iimage
          if allowed_wallpaper_upload?(uploaded, ext)
            build_uploaded_asset_document(uploaded, ext)
          else
            [ nil, "#{uploaded.original_filename}: Only JPEG and PNG images are allowed here." ]
          end
        elsif in_alchemy
          build_uploaded_alchemy_document(uploaded)
        elsif alchemy_source_upload?(uploaded.original_filename)
          imported_doc, imported_error = build_uploaded_alchemy_document(uploaded)
          imported_doc ? [ imported_doc, nil ] : build_uploaded_text_document(uploaded, fallback_error: imported_error)
        elsif text_like_finder_upload_extension?(ext)
          build_uploaded_text_document(uploaded)
        else
          build_uploaded_asset_document(uploaded, ext)
        end

        if error_message && doc.nil?
          errors << error_message
          next
        end

        persist = doc ? DocumentPersistence.persist(doc, operation: :create) : nil
        if persist&.success?
          created_ids << doc.id
          Documents::GenerateThumbnail.call(doc) if doc.content_type.to_s == "asset"
        else
          errors << "#{uploaded.original_filename}: #{error_message || doc&.errors&.full_messages&.to_sentence || "Could not upload."}"
        end
      end

      if created_ids.any?
        files_payload = Document.where(id: created_ids).order(:id).map do |d|
          ext = File.extname(d.storage_path.to_s).downcase
          {
            id: d.id,
            name: d.title.to_s,
            ext: ext,
            kind_label: FILE_KIND_LABELS.fetch(ext, "JPEG")
          }
        end

        Support::OperationResult.new(status: :ok, payload: { ids: created_ids, files: files_payload, errors: errors })
      elsif errors.any?
        Support::OperationResult.new(status: :unprocessable_entity, error: errors.join(" "))
      else
        Support::OperationResult.new(status: :unprocessable_entity, error: "Could not upload files.")
      end
    end

    private

    def normalize_uploaded_file_list(raw)
      return [] if raw.blank?

      arr = raw.is_a?(Array) ? raw.compact : [ raw ]
      arr.select { |f| f.respond_to?(:tempfile) && f.respond_to?(:read) }
    end

    def allowed_wallpaper_upload?(uploaded, ext)
      return false unless Document::WALLPAPER_IMAGE_EXTENSIONS.include?(ext)

      mime = Marcel::MimeType.for(Pathname.new(uploaded.tempfile.path))
      %w[image/jpeg image/png].include?(mime)
    rescue StandardError
      false
    end

    def text_like_finder_upload_extension?(ext)
      TEXT_LIKE_EXTENSIONS.include?(ext)
    end

    def alchemy_source_upload?(filename)
      lower = filename.to_s.downcase
      ALCHEMY_SOURCE_SUFFIXES.any? { |suffix| lower.end_with?(suffix) }
    end

    def folder_section_key
      Apps::FinderController.origin_section_key_from_storage_path(@folder.storage_path)
    end

    def upload_filename_stem(uploaded, fallback: "Untitled", filename: nil)
      original = filename.presence || uploaded.original_filename.to_s
      ext = File.extname(original)
      stem = File.basename(original, ext)
      stem = stem.gsub(/[^\p{L}\p{N}\s._-]/u, "_").strip
      stem.presence || fallback
    end

    def build_uploaded_asset_document(uploaded, ext)
      bytes = uploaded.read
      uploaded.rewind if uploaded.respond_to?(:rewind)

      doc = Document.new(
        is_folder: false,
        parent: @folder,
        title: upload_filename_stem(uploaded, fallback: "Asset"),
        content_type: "asset",
        pending_disk_extension: ext.presence,
        pending_asset_bytes: bytes
      )
      [ doc, nil ]
    rescue StandardError
      [ nil, "Could not read file bytes." ]
    end

    def build_uploaded_text_document(uploaded, fallback_error: nil)
      parsed = DocumentDiskLoader.send(:parse_nexus_file, uploaded.tempfile.path)
      doc = Document.new(
        is_folder: false,
        parent: @folder,
        title: upload_filename_stem(uploaded),
        content_type: parsed[:content_type].presence || "note",
        content: parsed[:content],
        tasks: parsed[:tasks] || [],
        reset_mode: parsed[:reset_mode].presence || "none",
        reset_days: parsed[:reset_days] || [],
        last_reset_at: parsed[:last_reset_at]
      )
      [ doc, nil ]
    rescue StandardError
      [ nil, fallback_error.presence || "Could not import text file." ]
    end

    def build_uploaded_alchemy_document(uploaded)
      resolved = Alchemy::UploadSourceResolver.call(uploaded)
      return [ nil, "#{uploaded.original_filename}: #{resolved.error || 'Could not extract XML.'}" ] unless resolved.success?

      doc = Document.new(
        is_folder: false,
        parent: @folder,
        title: upload_filename_stem(uploaded, fallback: "PLC Tag List", filename: resolved.source_filename),
        content_type: "alchemy_tag_list",
        content: resolved.xml_content.to_s
      )
      [ doc, nil ]
    rescue StandardError
      [ nil, "#{uploaded.original_filename}: Could not import XML." ]
    end
  end
end
