# frozen_string_literal: true

require "fileutils"
require Rails.root.join("app/services/tag_xml.rb").to_s

class DocumentsController < ApplicationController
  # --- Constants / Rules ----------------------------------------------------
  IMPORTED_FOLDER_NAME = "Imported"
  RECORD_KEYS = [ "Tag Group", "Tag Name", "Data Type", "Address Start", "Data Length", "Scaling", "Read/Write" ].freeze
  RAW_PRESERVE_KEYS = %w[_raw_datatype _raw_encode _raw_verify].freeze
  RECORD_UPDATE_KEYS = (RECORD_KEYS + RAW_PRESERVE_KEYS).freeze
  METADATA_UPDATE_KEYS = %w[metadata_filename metadata_ip metadata_protocol].freeze

  # Canonical order for Data Type (register / type precedence)
  DATA_TYPE_ORDER = [
    "BOOL", "BOOL (Bit of INT)", "INT", "UINT", "INT (Scaled)", "UINT (Scaled)",
    "DINT", "DINT (w/Byte Swap)", "DINT (Scaled)", "DINT (Scaled, w/Byte Swap)",
    "UDINT", "UDINT (w/Byte Swap)", "UDINT (Scaled)", "UDINT (Scaled, w/Byte Swap)",
    "REAL", "REAL (w/Byte Swap)", "Unique"
  ].freeze

  before_action :set_document, only: %i[show edit update export destroy create_file rename file_list]
  before_action :ensure_file_document!, only: %i[show edit update export]

  # --- Home Page ------------------------------------------------------------
  def index
    set_no_cache_headers
    load_organizer_data
  end

  def new
    redirect_to root_path
  end

  def organizer_fragment
    load_organizer_data
    render partial: "organizer"
  end

  def create_root_folder
    folder_name = next_folder_name
    folder = Document.new(is_folder: true, metadata_filename: folder_name, storage_path: folder_name, records: [])

    unless folder.save
      render plain: "Could not create folder.", status: :unprocessable_entity
      return
    end

    FileUtils.mkdir_p(storage_root.join(folder_name))
    flash.now[:created_folder_id] = folder.id
    flash.now[:created_folder_name] = folder_name
    load_organizer_data
    render partial: "organizer"
  end

  def file_list
    unless @document.folder?
      render plain: "Folder required", status: :unprocessable_entity
      return
    end

    load_organizer_data
    folder_name = folder_name_for(@document)
    folder_entry = @browser_folders.find { |entry| entry[:name] == folder_name }
    files = folder_entry ? folder_entry[:files] : []

    render partial: "folder_file_list", locals: { files: files }
  end

  # --- Import / Create ------------------------------------------------------
  def create
    if params[:new_folder].present?
      folder_name = next_folder_name
      folder = Document.new(is_folder: true, metadata_filename: folder_name, storage_path: folder_name, records: [])
      if folder.save
        FileUtils.mkdir_p(storage_root.join(folder_name))
        flash[:created_folder_id] = folder.id
        flash[:created_folder_name] = folder_name
        redirect_to root_path
      else
        redirect_to root_path, alert: "Could not create folder."
      end
      return
    end

    file = params[:xml_file]
    unless file&.respond_to?(:tempfile)
      if request.xhr?
        return render plain: "Please choose an XML file to import.", status: :unprocessable_entity
      end

      flash[:alert] = "Please choose an XML file to import."
      return redirect_to root_path
    end

    xml_path, display_filename = resolve_import_path(file)
    unless xml_path
      if request.xhr?
        return render plain: "Could not find XML inside the selected file.", status: :unprocessable_entity
      end

      flash[:alert] = "Could not find XML inside the selected file."
      return redirect_to root_path
    end

    records = TagXml::Parser.parse_records(xml_path)
    meta = extract_metadata_from_path(xml_path, display_filename)

    parent_folder = params[:parent_id].present? ? parent_folder_from_params : nil
    if params[:parent_id].present? && parent_folder.nil?
      if request.xhr?
        return render plain: "Selected folder was not found.", status: :unprocessable_entity
      end

      flash[:alert] = "Selected folder was not found."
      return redirect_to root_path
    end

    target_folder = parent_folder || ensure_imported_folder!
    folder_name = folder_name_for(target_folder)
    resolved_name = DocumentStorageSync.resolve_import_filename(display_filename, folder_name)
    @document = Document.new(
      records: records,
      metadata_ip: meta[:ip],
      metadata_protocol: meta[:protocol],
      metadata_filename: resolved_name,
      parent: target_folder
    )

    if @document.save
      sync_storage_for(@document)
      if request.xhr?
        flash.now[:created_file_id] = @document.id
        load_organizer_data
        render partial: "organizer"
      else
        flash[:created_file_id] = @document.id
        flash[:created_folder_name] = target_folder.metadata_filename if parent_folder.nil?
        redirect_to root_path
      end
    else
      if request.xhr?
        render plain: "Failed to parse XML.", status: :unprocessable_entity
      else
        flash[:alert] = "Failed to parse XML."
        redirect_to root_path
      end
    end
  rescue StandardError => e
    if request.xhr?
      render plain: "Error importing XML: #{e.message}", status: :unprocessable_entity
    else
      flash[:alert] = "Error importing XML: #{e.message}"
      redirect_to root_path
    end
  end

  # --- Workspace View -------------------------------------------------------
  def show
    # Same view as edit - editable table
    render :edit
  end

  def edit
    recs = @document.records_with_string_keys
    raw_sort = params[:sort].to_s.presence
    @sort_column = raw_sort
    @sort_direction = (params[:direction].to_s == "asc") ? "asc" : nil

    if @sort_column.present? && @sort_direction == "asc"
      @sorted_records = recs.sort do |a, b|
        va = a[@sort_column].to_s.strip
        vb = b[@sort_column].to_s.strip

        cmp = case @sort_column
        when "Data Type"
          # Group by Data Type (canonical order), then by Address Start low to high
          ia = DATA_TYPE_ORDER.index(va) || DATA_TYPE_ORDER.size
          ib = DATA_TYPE_ORDER.index(vb) || DATA_TYPE_ORDER.size
          if ia != ib
            ia <=> ib
          else
            addr_a = (a["Address Start"].to_s.strip =~ /\A\d+\z/) ? a["Address Start"].to_s.strip.to_i : -1
            addr_b = (b["Address Start"].to_s.strip =~ /\A\d+\z/) ? b["Address Start"].to_s.strip.to_i : -1
            addr_a <=> addr_b
          end
        when "Address Start"
          # Coils (BOOL) first, then holding registers (INT, UINT, REAL, etc.) mixed; within each group sort by address
          coil_a = (a["Data Type"].to_s.strip == "BOOL") ? 0 : 1
          coil_b = (b["Data Type"].to_s.strip == "BOOL") ? 0 : 1
          if coil_a != coil_b
            coil_a <=> coil_b
          else
            addr_a = (a["Address Start"].to_s.strip =~ /\A\d+\z/) ? a["Address Start"].to_s.strip.to_i : -1
            addr_b = (b["Address Start"].to_s.strip =~ /\A\d+\z/) ? b["Address Start"].to_s.strip.to_i : -1
            addr_a <=> addr_b
          end
        when "Data Length"
          na = Integer(va) rescue Float(va) rescue nil
          nb = Integer(vb) rescue Float(vb) rescue nil
          (na && nb) ? (na <=> nb) : (va <=> vb)
        when "Scaling"
          na = Float(va) rescue nil
          nb = Float(vb) rescue nil
          (na && nb) ? (na <=> nb) : (va <=> vb)
        else
          # Alphabetical / low-to-high
          c = va.casecmp(vb)
          c.zero? ? (va <=> vb) : c
        end

        cmp
      end
    else
      @sorted_records = recs
      @sort_direction = nil
    end
  end

  # --- Save Pipeline --------------------------------------------------------
  def update
    return if handle_delta_update

    raw = params[:records]
    records = []
    # params[:records] is ActionController::Parameters (not Hash), so use hash-like check
    hash_like = raw.respond_to?(:select) && raw.respond_to?(:keys) && raw.respond_to?(:[])

    if hash_like
      numeric_keys = raw.keys.select { |k| k.to_s.match?(/\A\d+\z/) }.sort_by { |k| k.to_s.to_i }
      numeric_pairs = numeric_keys.map { |k| [ k, raw[k] ] }
      existing = @document.records_with_string_keys
      records = numeric_pairs.each_with_index.map do |(_, h), idx|
        next {} unless h.respond_to?(:permit)
        permitted = h.permit(RECORD_KEYS + RAW_PRESERVE_KEYS).to_h.transform_keys(&:to_s)
        old = existing[idx]
        (old || {}).slice(*RAW_PRESERVE_KEYS).merge(permitted)
      end.reject { |r| r.except(*RAW_PRESERVE_KEYS).values.all?(&:blank?) }
      @document.records = records
    else
      # Form had no rows (e.g. all tags deleted) — persist empty document
      @document.records = []
    end

    if params[:metadata_ip].present?
      @document.metadata_ip = params[:metadata_ip]
      @document.metadata_protocol = params[:metadata_protocol] if params[:metadata_protocol].present?
      @document.metadata_filename = params[:metadata_filename].present? ? params[:metadata_filename] : "Untitled"
    end

    # Once actually edited, this is no longer the special new placeholder row.
    @document.new_untitled_placeholder = false if @document.new_untitled_placeholder? && @document.changed?

    if save_document_with_quiet_sql
      sync_storage_for(@document)
      response.headers["X-Records-Saved"] = records.size.to_s
      head :no_content
    else
      render :edit, status: :unprocessable_entity
    end
  end

  # --- Export / Delete ------------------------------------------------------
  def export
    xml = TagXml::Exporter.export_xml(@document.records_with_string_keys, @document.metadata)
    if xml.blank?
      redirect_to @document, alert: "No tags to export."
      return
    end

    filename = @document.metadata_filename.to_s.sub(/\A\./, "export.").presence || "export.xml"
    filename = "#{filename}.xml" unless filename.end_with?(".xml")

    send_data xml,
              type: "application/xml",
              disposition: "attachment",
              filename: filename
  end

  def create_file
    unless @document.folder?
      redirect_to root_path, alert: "Files can only be created inside folders."
      return
    end

    folder_name = folder_name_for(@document)
    filename = DocumentStorageSync.next_untitled_filename(folder_name)
    file_doc = Document.new(
      is_folder: false,
      parent: @document,
      records: [],
      metadata_ip: Document::DEFAULT_IP,
      metadata_protocol: Document::DEFAULT_PROTOCOL,
      metadata_filename: filename,
      new_untitled_placeholder: false
    )

    if file_doc.save
      DocumentStorageSync.write_scaffold!(file_doc)
      flash[:created_file_id] = file_doc.id
      redirect_to root_path
    else
      redirect_to root_path, alert: "Could not create PLC tag list."
    end
  end

  def rename
    name = params[:name].to_s
    DocumentStorageSync.rename_document!(@document, name)
    render json: { ok: true, name: @document.metadata_filename }
  rescue DocumentStorageSync::NameConflictError => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue ArgumentError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def destroy
    if @document.folder?
      @document.children.find_each { |child| purge_storage_for(child) }
      purge_folder_storage_for(@document)
    else
      purge_storage_for(@document)
    end
    @document.destroy
    if Document.count.zero?
      ActiveRecord::Base.connection.execute("ALTER SEQUENCE documents_id_seq RESTART WITH 1")
    end
    if request.xhr? || request.format.json?
      head :no_content
    else
      redirect_to root_path
    end
  end

  private

  # --- Delta Save Helpers ---------------------------------------------------
  def handle_delta_update
    raw_delta = params[:delta]
    return false unless raw_delta.respond_to?(:permit)

    delta = raw_delta.permit(:kind, :row_index, :key, :value, fields: {})
    kind = delta[:kind].to_s

    case kind
    when "record_field"
      return render_delta_error("Invalid row index") unless valid_row_index?(delta[:row_index])
      key = delta[:key].to_s
      return render_delta_error("Invalid record key") unless RECORD_UPDATE_KEYS.include?(key)

      records = @document.records_with_string_keys
      idx = delta[:row_index].to_i
      records[idx] ||= {}
      before_value = records[idx][key]
      after_value = delta[:value].to_s
      records[idx][key] = after_value
      @document.records = records
      @pending_change_logs = [ { row_index: idx, field: key, before: before_value, after: after_value } ]
    when "record_fields"
      return render_delta_error("Invalid row index") unless valid_row_index?(delta[:row_index])

      fields = delta[:fields].to_h.transform_keys(&:to_s).slice(*RECORD_UPDATE_KEYS)
      return render_delta_error("No valid record fields provided") if fields.empty?

      records = @document.records_with_string_keys
      idx = delta[:row_index].to_i
      records[idx] ||= {}
      @pending_change_logs = []
      fields.each do |field_key, after_value|
        before_value = records[idx][field_key]
        @pending_change_logs << { row_index: idx, field: field_key, before: before_value, after: after_value.to_s }
      end
      records[idx].merge!(fields)
      @document.records = records
    when "metadata_field"
      key = delta[:key].to_s
      return render_delta_error("Invalid metadata key") unless METADATA_UPDATE_KEYS.include?(key)

      before_value = @document.public_send(key)
      apply_metadata_field(key, delta[:value].to_s)
      after_value = @document.public_send(key)
      @pending_change_logs = [ { row_index: nil, field: key, before: before_value, after: after_value } ]
    else
      return render_delta_error("Invalid delta update kind")
    end

    # Any actual delta change graduates the placeholder into a normal document.
    delta_changed = Array(@pending_change_logs).any? { |entry| entry[:before].to_s != entry[:after].to_s }
    @document.new_untitled_placeholder = false if @document.new_untitled_placeholder? && delta_changed

    if save_document_with_quiet_sql
      sync_storage_for(@document)
      log_pending_changes
      head :no_content
    else
      render :edit, status: :unprocessable_entity
    end
    true
  end

  def valid_row_index?(idx)
    idx.to_s.match?(/\A\d+\z/)
  end

  def apply_metadata_field(key, value)
    case key
    when "metadata_filename"
      @document.metadata_filename = value.present? ? value : "Untitled"
    when "metadata_ip"
      @document.metadata_ip = value
    when "metadata_protocol"
      @document.metadata_protocol = value
    end
  end

  def render_delta_error(message)
    render json: { error: message }, status: :unprocessable_entity
    true
  end

  def save_document_with_quiet_sql
    logger = ActiveRecord::Base.logger
    return @document.save unless logger&.respond_to?(:silence)

    logger.silence(Logger::WARN) { @document.save }
  end

  def ensure_file_document!
    return unless @document.folder?

    redirect_to root_path, alert: "Open a PLC Tag List file to edit tags."
  end

  def parent_folder_from_params
    folder_id = params[:parent_id].presence
    return nil unless folder_id

    Document.folders.find_by(id: folder_id)
  end

  def next_folder_name
    base = "untitled folder"
    root = storage_root
    names = if Dir.exist?(root)
      Dir.children(root).select { |entry| File.directory?(root.join(entry)) }
    else
      []
    end
    return base unless names.include?(base)

    nums = names
      .map { |name| name[/^untitled folder (\d+)$/, 1]&.to_i }
      .compact
      .select { |num| num >= 2 }
      .uniq
      .sort

    expected = 2
    nums.each do |num|
      return "#{base} #{expected}" if num != expected

      expected += 1
    end

    "#{base} #{expected}"
  end

  def ensure_imported_folder!
    folder = Document.folders.find_by(storage_path: IMPORTED_FOLDER_NAME) ||
      Document.folders.find_by(metadata_filename: IMPORTED_FOLDER_NAME)

    unless folder
      folder = Document.create!(
        is_folder: true,
        metadata_filename: IMPORTED_FOLDER_NAME,
        storage_path: IMPORTED_FOLDER_NAME,
        records: []
      )
    end

    DocumentStorageSync.ensure_folder_exists!(folder)
    folder
  end

  def filesystem_folder_names
    scan_filesystem_entries[:folders]
  end

  def folder_name_for(folder)
    folder.storage_path.to_s.presence || folder.metadata_filename.to_s
  end

  def storage_root
    DocumentStorageSync::STORAGE_ROOT
  end

  def sync_storage_for(document)
    DocumentStorageSync.sync!(document)
  rescue StandardError => e
    Rails.logger.error("[DocumentStorageSync] sync failed document_id=#{document.id} error=#{e.class}: #{e.message}")
  end

  def purge_storage_for(document)
    DocumentStorageSync.purge!(document)
  rescue StandardError => e
    Rails.logger.error("[DocumentStorageSync] purge failed document_id=#{document.id} error=#{e.class}: #{e.message}")
  end

  def purge_folder_storage_for(folder)
    DocumentStorageSync.purge_folder!(folder)
  rescue StandardError => e
    Rails.logger.error("[DocumentStorageSync] purge folder failed document_id=#{folder.id} error=#{e.class}: #{e.message}")
  end

  def log_pending_changes
    logs = Array(@pending_change_logs)
    return if logs.empty?

    file_name = @document.metadata_filename.presence || "Untitled"
    logs.each do |entry|
      row_part = entry[:row_index].nil? ? "" : " row=#{entry[:row_index]}"
      Rails.logger.info(
        "[AlchemyChange] file=#{file_name.inspect}#{row_part} field=#{entry[:field].inspect} before=#{entry[:before].to_s.inspect} after=#{entry[:after].to_s.inspect}"
      )
    end
    @pending_change_logs = nil
  end

  # --- Query / Import Parsing Helpers --------------------------------------
  def set_document
    @document = Document.find(params[:id])
  end

  def set_no_cache_headers
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
  end

  def load_organizer_data
    scan = scan_filesystem_entries
    folders = finder_natural_sort(scan[:folders])
    files = scan[:files]

    Rails.logger.info("[OrganizerScan] path=#{storage_root.expand_path}")
    Rails.logger.info("[OrganizerScan] folders=#{folders.inspect}")
    Rails.logger.info("[OrganizerScan] files=#{files.inspect}")

    folder_docs_by_name = Document.folders.index_by { |folder| folder_name_for(folder) }
    file_docs_by_path = Document.files.where.not(storage_path: [ nil, "" ]).index_by(&:storage_path)

    @browser_folders = folders.map do |folder_name|
      folder_doc = folder_docs_by_name[folder_name]
      folder_files = files
        .select { |rel| File.dirname(rel) == folder_name }
        .map { |rel| file_docs_by_path[rel] }
        .compact
      folder_files = sort_documents_by_name(folder_files)

      {
        name: folder_name,
        title: folder_name,
        folder: folder_doc,
        files: folder_files
      }
    end

    @root_files = files
      .select { |rel| File.dirname(rel) == "." }
      .map { |rel| file_docs_by_path[rel] }
      .compact
    @root_files = sort_documents_by_name(@root_files)

    @has_organizer_content = @browser_folders.any? || @root_files.any?
  end

  def scan_filesystem_entries
    root = storage_root
    return { folders: [], files: [] } unless Dir.exist?(root)

    folders = []
    files = []

    Dir.children(root).each do |entry|
      abs = root.join(entry)
      if File.directory?(abs)
        folders << entry
        Dir.children(abs).each do |child|
          child_abs = abs.join(child)
          files << File.join(entry, child) if File.file?(child_abs)
        end
      elsif File.file?(abs)
        files << entry
      end
    end

    { folders: folders, files: files }
  end

  def sort_documents_by_name(documents)
    documents.sort_by do |doc|
      name = doc.metadata_filename.presence || File.basename(doc.storage_path.to_s)
      finder_natural_sort_key(name)
    end
  end

  def finder_natural_sort(names)
    names.sort_by { |name| finder_natural_sort_key(name) }
  end

  def finder_natural_sort_key(value)
    raw = value.to_s
    ext = File.extname(raw)
    stem = ext.present? ? raw.delete_suffix(ext) : raw

    stem_tokens = finder_natural_tokens(stem.downcase)
    has_numeric_suffix = stem_tokens.last.is_a?(Integer)
    suffix_number = has_numeric_suffix ? stem_tokens.last : 0
    base_name = if has_numeric_suffix
      stem_tokens[0...-1].join.rstrip
    else
      stem.downcase
    end

    [
      finder_natural_tokens(base_name),
      has_numeric_suffix ? 1 : 0,
      suffix_number,
      stem_tokens,
      ext.downcase,
      finder_natural_tokens(raw.downcase)
    ]
  end

  def finder_natural_tokens(value)
    value.to_s.scan(/\d+|\D+/).map { |chunk| chunk.match?(/\A\d+\z/) ? chunk.to_i : chunk }
  end

  def resolve_import_path(file)
    path = file.tempfile.path
    name = file.original_filename.to_s
    if name.end_with?(".tar", ".xml.tar")
      Dir.mktmpdir("alchemy_tar") do |dir|
        success = system("tar", "-xf", path, "-C", dir, out: File::NULL, err: File::NULL)
        unless success
          return [ nil, name ]
        end
        xml_path = Dir.glob(File.join(dir, "**", "*.xml")).first
        xml_path ||= Dir.glob(File.join(dir, "**", "*")).find { |f| File.file?(f) }
        next [ nil, name ] unless xml_path
        display = name.sub(/\.tar\z/i, "")
        display = File.basename(xml_path) if display.blank?
        # Copy to a temp file so we can use it after the tar dir is removed
        tmp = Tempfile.new([ "alchemy_xml", ".xml" ])
        tmp.binmode
        tmp.write(File.binread(xml_path))
        tmp.rewind
        @_import_tempfile = tmp
        [ tmp.path, display.presence || name ]
      end
    else
      [ path, name ]
    end
  end

  def extract_metadata_from_path(xml_path, original_filename)
    root = TagXml::Parser.load_root(xml_path)
    xml_node = root.elements["XML"] || root
    ip = Document::DEFAULT_IP
    protocol = Document::DEFAULT_PROTOCOL
    xml_node.elements.each do |child|
      next if child.name.to_s.start_with?("Preload_")
      ip = TagXml::Parser.get_child_text(child, "IP").strip.delete('"').presence || Document::DEFAULT_IP
      protocol = TagXml::Parser.get_child_text(child, "TYPE").strip.delete('"').presence || Document::DEFAULT_PROTOCOL
      break
    end
    { ip: ip, protocol: protocol, filename: original_filename }
  rescue StandardError
    { ip: Document::DEFAULT_IP, protocol: Document::DEFAULT_PROTOCOL, filename: original_filename }
  end
end
