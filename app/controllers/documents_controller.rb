# frozen_string_literal: true

require Rails.root.join("app/services/tag_xml.rb").to_s

class DocumentsController < ApplicationController
  RECORD_KEYS = ["Tag Group", "Tag Name", "Data Type", "Address Start", "Data Length", "Scaling", "Read/Write", "Verify"].freeze

  # Canonical order for Data Type (register / type precedence)
  DATA_TYPE_ORDER = [
    "BOOL", "INT", "UINT", "INT (Scaled)", "UINT (Scaled)",
    "DINT", "DINT (w/Byte Swap)", "DINT (Scaled)", "DINT (Scaled, w/Byte Swap)",
    "UDINT", "UDINT (w/Byte Swap)", "UDINT (Scaled)", "UDINT (Scaled, w/Byte Swap)",
    "REAL", "REAL (w/Byte Swap)", "Unknown"
  ].freeze

  before_action :set_document, only: %i[show edit update export destroy]

  def index
    @documents = Document.order(created_at: :desc).limit(50)
  end

  def new
    redirect_to root_path
  end

  def create
    if params[:blank].present?
      @document = Document.new(records: [], metadata_ip: Document::DEFAULT_IP, metadata_protocol: Document::DEFAULT_PROTOCOL, metadata_filename: "")
      if @document.save
        flash[:edit_status] = "New document created"
        redirect_to edit_document_path(@document)
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

    records = TagXml::Parser.parse_records(file.tempfile.path)
    meta = extract_metadata_from_file(file)

    @document = Document.new(
      records: records,
      metadata_ip: meta[:ip],
      metadata_protocol: meta[:protocol],
      metadata_filename: meta[:filename] || file.original_filename
    )

    if @document.save
      flash[:edit_status] = "Imported"
      redirect_to @document, notice: "Imported #{records.size} tag(s)."
    else
      flash[:alert] = "Failed to parse XML."
      redirect_to root_path
    end
  rescue StandardError => e
    flash[:alert] = "Error importing XML: #{e.message}"
    redirect_to root_path
  end

  def show
    # Same view as edit - editable table
    render :edit
  end

  def edit
    recs = @document.records_with_string_keys
    raw_sort = params[:sort].to_s.presence
    # Data Type and Address Start share one sort: type then address (low to high)
    @sort_column = (raw_sort == "Address Start") ? "Data Type" : raw_sort
    @sort_direction = (params[:direction].to_s == "asc") ? "asc" : nil

    if @sort_column.present? && @sort_direction == "asc"
      @sorted_records = recs.sort do |a, b|
        va = a[@sort_column].to_s.strip
        vb = b[@sort_column].to_s.strip

        cmp = case @sort_column
        when "Data Type"
          # Group by Data Type (canonical order), then by Address Start low to high: BOOL 1, BOOL 2, BOOL 3, INT 1, INT 2
          ia = DATA_TYPE_ORDER.index(va) || DATA_TYPE_ORDER.size
          ib = DATA_TYPE_ORDER.index(vb) || DATA_TYPE_ORDER.size
          if ia != ib
            ia <=> ib
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

  RAW_PRESERVE_KEYS = %w[_raw_datatype _raw_encode _raw_verify].freeze

  def update
    raw = params[:records]
    records = []
    # params[:records] is ActionController::Parameters (not Hash), so use hash-like check
    hash_like = raw.respond_to?(:select) && raw.respond_to?(:keys) && raw.respond_to?(:[])

    if hash_like
      numeric_keys = raw.keys.select { |k| k.to_s.match?(/\A\d+\z/) }.sort_by { |k| k.to_s.to_i }
      numeric_pairs = numeric_keys.map { |k| [k, raw[k]] }
      existing = @document.records_with_string_keys
      records = numeric_pairs.map do |_, h|
        next {} unless h.respond_to?(:permit)
        permitted = h.permit(RECORD_KEYS).to_h.transform_keys(&:to_s)
        key = [permitted["Tag Name"], permitted["Address Start"], permitted["Data Type"]]
        old = existing.find { |r| [r["Tag Name"], r["Address Start"], r["Data Type"]] == key }
        (old || {}).slice(*RAW_PRESERVE_KEYS).merge(permitted)
      end.reject { |r| r.except(*RAW_PRESERVE_KEYS).values.all?(&:blank?) }
      @document.records = records
    end

    if params[:metadata_ip].present?
      @document.metadata_ip = params[:metadata_ip]
      @document.metadata_protocol = params[:metadata_protocol] if params[:metadata_protocol].present?
      @document.metadata_filename = params[:metadata_filename] if params[:metadata_filename].present?
    end

    if @document.save
      response.headers["X-Records-Saved"] = records.size.to_s
      head :no_content
    else
      render :edit, status: :unprocessable_entity
    end
  end

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
    redirect_to root_path, notice: "Document deleted."
  end

  private

  def set_document
    @document = Document.find(params[:id])
  end

  def extract_metadata_from_file(file)
    root = TagXml::Parser.load_root(file.tempfile.path)
    xml_node = root.elements["XML"] || root
    ip = Document::DEFAULT_IP
    protocol = Document::DEFAULT_PROTOCOL
    xml_node.elements.each do |child|
      next if child.name.to_s.start_with?("Preload_")
      ip = TagXml::Parser.get_child_text(child, "IP").strip.delete('"').presence || Document::DEFAULT_IP
      protocol = TagXml::Parser.get_child_text(child, "TYPE").strip.delete('"').presence || Document::DEFAULT_PROTOCOL
      break
    end
    { ip: ip, protocol: protocol, filename: file.original_filename }
  rescue StandardError
    { ip: Document::DEFAULT_IP, protocol: Document::DEFAULT_PROTOCOL, filename: file.original_filename }
  end
end
