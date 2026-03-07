# frozen_string_literal: true

require Rails.root.join("app/services/tag_xml.rb").to_s

class DocumentsController < ApplicationController
  # --- Constants / Rules ----------------------------------------------------
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

  before_action :set_document, only: %i[show edit update export destroy]

  # --- Home Page ------------------------------------------------------------
  def index
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    @documents = Document.order(created_at: :desc).limit(50)
    by_title = @documents.group_by { |d| d.metadata_filename.presence || "Untitled ##{d.id}" }
    @doc_disambiguator = {}
    by_title.each do |_title, docs|
      if docs.size > 1
        docs.each_with_index { |d, i| @doc_disambiguator[d.id] = docs.size - i }
      else
        @doc_disambiguator[docs[0].id] = nil
      end
    end
  end

  def new
    redirect_to root_path
  end

  # --- Import / Create ------------------------------------------------------
  def create
    if params[:blank].present?
      # Keep only one dedicated new-untitled placeholder document.
      # Existing docs that later become untitled/empty are not treated as placeholders.
      existing = Document.where(new_untitled_placeholder: true).order(updated_at: :desc).first
      if existing
        top_doc_id = Document.order(created_at: :desc).limit(1).pick(:id)
        if top_doc_id == existing.id
          flash[:reused_existing_doc_id] = existing.id
          flash[:reused_existing_was_top] = true
          redirect_to root_path
          return
        end
        old_created_order_ids = Document.order(created_at: :desc).limit(50).pluck(:id)
        old_index = old_created_order_ids.index(existing.id)
        flash[:replaced_untitled_old_index] = old_index if old_index
        existing.destroy
      end
      @document = Document.new(
        records: [],
        metadata_ip: Document::DEFAULT_IP,
        metadata_protocol: Document::DEFAULT_PROTOCOL,
        metadata_filename: "",
        new_untitled_placeholder: true
      )
      if @document.save
        @document.update_column(:metadata_filename, "Untitled ##{@document.id}")
        flash[:just_imported] = true
        redirect_to root_path
      else
        redirect_to root_path, alert: "Could not create document."
      end
      return
    end

    file = params[:xml_file]
    unless file&.respond_to?(:tempfile)
      flash[:alert] = "Please choose an XML file to import."
      return redirect_to root_path
    end

    xml_path, display_filename = resolve_import_path(file)
    unless xml_path
      flash[:alert] = "Could not find XML inside the selected file."
      return redirect_to root_path
    end

    records = TagXml::Parser.parse_records(xml_path)
    meta = extract_metadata_from_path(xml_path, display_filename)

    @document = Document.new(
      records: records,
      metadata_ip: meta[:ip],
      metadata_protocol: meta[:protocol],
      metadata_filename: meta[:filename] || display_filename
    )

    if @document.save
      flash[:just_imported] = true
      redirect_to root_path
    else
      flash[:alert] = "Failed to parse XML."
      redirect_to root_path
    end
  rescue StandardError => e
    flash[:alert] = "Error importing XML: #{e.message}"
    redirect_to root_path
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
      @document.metadata_filename = params[:metadata_filename].present? ? params[:metadata_filename] : "Untitled ##{@document.id}"
    end

    # Once actually edited, this is no longer the special new placeholder row.
    placeholder_edited = @document.new_untitled_placeholder? && @document.changed?
    @document.new_untitled_placeholder = false if placeholder_edited

    if save_document_with_quiet_sql
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

  def destroy
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
      @document.metadata_filename = value.present? ? value : "Untitled ##{@document.id}"
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

  def log_pending_changes
    logs = Array(@pending_change_logs)
    return if logs.empty?

    file_name = @document.metadata_filename.presence || "Untitled ##{@document.id}"
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
