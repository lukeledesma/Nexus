# frozen_string_literal: true

require "rexml/document"

# Uticor/Modbus XML tag import and export. Parses XML (skips Preload_*), builds editable records,
# and re-exports with preloads rebuilt from current tags.
module TagXml
  module DataTypeMapper
    TYPE_MAP = {
      ["107", "255"] => "BOOL",
      ["107", "107"] => "BOOL",
      ["0", "255"] => "INT",
      ["1", "255"] => "UINT",
      ["0", "102"] => "INT (Scaled)",
      ["1", "102"] => "UINT (Scaled)",
      ["4", "32"] => "DINT (Scaled)",
      ["7", "32"] => "DINT (Scaled, w/Byte Swap)",
      ["8", "32"] => "UDINT (Scaled)",
      ["17", "32"] => "UDINT (Scaled, w/Byte Swap)",
      ["4", "255"] => "DINT",
      ["7", "4"] => "DINT (w/Byte Swap)",
      ["8", "255"] => "UDINT",
      ["17", "8"] => "UDINT (w/Byte Swap)",
      ["104", "32"] => "REAL",
      ["0032", "255"] => "REAL",
      ["0035", "32"] => "REAL (w/Byte Swap)"
    }.freeze

    EXPORT_CODES = {
      "BOOL" => ["107", "255"],
      "INT" => ["0", "255"],
      "UINT" => ["1", "255"],
      "INT (Scaled)" => ["0", "102"],
      "UINT (Scaled)" => ["1", "102"],
      "DINT" => ["4", "255"],
      "DINT (w/Byte Swap)" => ["7", "4"],
      "DINT (Scaled)" => ["4", "32"],
      "DINT (Scaled, w/Byte Swap)" => ["7", "32"],
      "UDINT" => ["8", "255"],
      "UDINT (w/Byte Swap)" => ["17", "8"],
      "UDINT (Scaled)" => ["8", "32"],
      "UDINT (Scaled, w/Byte Swap)" => ["17", "32"],
      "REAL" => ["0032", "255"],
      "REAL (w/Byte Swap)" => ["0035", "32"]
    }.freeze

    module_function

    def map_datatype(datatype, encode, funccode)
      dt = (datatype || "").to_s.strip.delete('"')
      enc = (encode || "").to_s.strip.delete('"')
      fc = (funccode || "").to_s.strip.delete('"')
      return "BOOL" if fc == "01"
      key = [dt, enc]
      return TYPE_MAP[key] if TYPE_MAP.key?(key)
      return "REAL (w/Byte Swap)" if ["0032", "35"].include?(dt) && enc != "255"
      return "REAL" if ["0032", "35"].include?(dt)
      return "DINT (w/Byte Swap)" if dt == "7" && !["255", "4"].include?(enc)
      return "DINT" if dt == "7"
      return "UDINT" if dt == "8"
      return "UDINT (w/Byte Swap)" if dt == "17"
      return "INT" if dt == "0"
      return "UINT" if dt == "1"
      "Unknown"
    end

    def get_export_codes(dtype)
      normalized = dtype.to_s.strip
      EXPORT_CODES[normalized] || ["0", "255"]
    end

    def get_function_code(dtype)
      dtype.to_s.strip == "BOOL" ? '"01"' : '"03"'
    end
  end

  module ScalingMapper
    DEFAULT = "1"
    module_function

    def ui_to_expr(ui_value)
      v = Float((ui_value || DEFAULT).to_s.strip.delete('"'))
      return '"1.0"' if v.zero?
      inv = 1.0 / v
      text = format("%.3f", inv).sub(/0+$/, "").chomp(".")
      text = "#{text}.0" if text.match?(/\A\d+\z/)
      "\"#{text}\""
    rescue ArgumentError, TypeError
      '"1.0"'
    end

    def expr_to_ui(expr_text)
      return DEFAULT if expr_text.blank?
      e = expr_text.to_s.strip.delete('"')
      val = Float(e)
      return "100" if val == 0.01
      return "10" if val == 0.1
      return "1" if val == 1.0
      inv = val != 0 ? (1.0 / val).round(3) : 1
      inv.to_s
    rescue ArgumentError, TypeError
      DEFAULT
    end
  end

  module ReadWriteMapper
    DEFAULT = "Read Only"
    module_function

    def ui_to_subscribe(rw_value)
      (rw_value || "").to_s.strip.downcase == "read+write" ? '"on"' : '"off"'
    end

    def subscribe_to_ui(subscribe_text)
      (subscribe_text || "").to_s.strip.delete('"').downcase == "on" ? "Read+Write" : DEFAULT
    end
  end

  class PreloadCalculator
    class << self
      def calculate_sections(records, func_code)
        addresses = []
        seen = Set.new
        records.each do |record|
          dtype = (record["Data Type"] || "").to_s.strip
          fc = dtype == "BOOL" ? "01" : "03"
          next unless fc == func_code
          addr_txt = (record["Address Start"] || "").to_s.strip.delete('"')
          next if addr_txt.blank?
          addr = Integer(addr_txt)
          next if seen.include?(addr)
          addresses << addr
          seen.add(addr)
        rescue ArgumentError
          next
        end
        return [] if addresses.empty?
        addresses.sort!
        pad = func_code == "01" ? 1 : 2
        clusters = []
        cluster_start = cluster_end = addresses[0]
        addresses[1..].each do |addr|
          if addr <= cluster_end + 1
            cluster_end = addr
          else
            clusters << [cluster_start, cluster_end + pad]
            cluster_start = cluster_end = addr
          end
        end
        clusters << [cluster_start, cluster_end + pad]
        chunk_end = {}
        clusters.each do |c_start, c_end|
          c_end = c_start if c_end < c_start
          start_chunk = (c_start / 100) * 100
          end_chunk = (c_end / 100) * 100
          chunk = start_chunk
          while chunk <= end_chunk
            this_end = (chunk < end_chunk) ? (chunk + 99) : c_end
            chunk_end[chunk] = this_end if chunk_end[chunk].nil? || this_end > chunk_end[chunk]
            chunk += 100
          end
        end
        chunk_end.keys.sort.map { |chunk| [chunk, chunk_end[chunk] - chunk + 1] }
      end
    end
  end

  class Parser
    COLUMNS = {
      tag_group: "Tag Group", tag_name: "Tag Name", data_type: "Data Type",
      address_start: "Address Start", data_length: "Data Length", scaling: "Scaling",
      read_write: "Read/Write", verify: "Verify"
    }.freeze
    DEFAULT_DATA_LENGTH = "1"
    DEFAULT_VERIFY = "7 (Changed)"

    class << self
      def load_root(xml_path)
        content = File.read(xml_path, encoding: "utf-8", mode: "r")
        content = content.encode("UTF-8", invalid: :replace, undef: :replace)
        content = content.sub(/\<\?xml[^>]*\bversion\s*=\s*"[^"]+"[^>]*\?\>/i, '<?xml version="1.0" encoding="UTF-8"?>')
        content = content.gsub(/\<\s*"\s*([^">]+?)\s*"\s*\>/) { "<#{Regexp.last_match(1).strip.gsub(/\s+/, "_")}>" }
        content = content.gsub(/\<\/\s*"\s*([^">]+?)\s*"\s*\>/) { "</#{Regexp.last_match(1).strip.gsub(/\s+/, "_")}>" }
        doc = REXML::Document.new(content)
        doc.root
      rescue REXML::ParseException
        doc = REXML::Document.new(content)
        doc.root
      end

      def get_child_text(node, tag_name)
        child = node.elements[tag_name]
        child&.text ? child.text.strip : ""
      end

      def parse_records(xml_path)
        root = load_root(xml_path)
        return [] if root.nil?
        xml_node = root.elements["XML"] || root
        records = []
        xml_node.elements.each do |child|
          next if child.name.to_s.start_with?("Preload_")
          funccode = get_child_text(child, "FUNCCODE").delete('"')
          addrstart = get_child_text(child, "ADDRSTART").delete('"')
          datatype = get_child_text(child, "DATATYPE").delete('"')
          encode = get_child_text(child, "ENCODE").delete('"')
          expr = get_child_text(child, "EXPR").delete('"')
          nodeid = get_child_text(child, "NODEID").delete('"')
          subscribe = get_child_text(child, "SUBSCRIBE").delete('"')
          dlength = get_child_text(child, "DATALENGTH").delete('"').presence || DEFAULT_DATA_LENGTH
          verify_raw = get_child_text(child, "VERIFY").delete('"').presence || "7"
          records << {
            COLUMNS[:tag_group] => nodeid,
            COLUMNS[:tag_name] => child.name.to_s,
            COLUMNS[:data_type] => DataTypeMapper.map_datatype(datatype, encode, funccode),
            COLUMNS[:address_start] => addrstart,
            COLUMNS[:data_length] => dlength,
            COLUMNS[:scaling] => ScalingMapper.expr_to_ui(expr),
            COLUMNS[:read_write] => ReadWriteMapper.subscribe_to_ui(subscribe),
            COLUMNS[:verify] => DEFAULT_VERIFY
          }.tap do |r|
            r["_raw_datatype"] = datatype.presence
            r["_raw_encode"] = encode.presence
            r["_raw_verify"] = verify_raw
          end
        end
        records
      end
    end
  end

  class Exporter
    DEFAULT_DATA_LENGTH = "1"
    DEFAULT_SCALING = "1"
    DEFAULT_READ_WRITE = "Read Only"

    class << self
      # Build XML by string concatenation only (no REXML in export path — avoids FrozenError)
      def export_xml(records, metadata)
        return "" if records.blank?
        meta = {
          ip: metadata[:ip] || "0.0.0.0",
          protocol: metadata[:protocol] || "TCP",
          filename: metadata[:filename] || "export.xml"
        }
        words_sections = PreloadCalculator.calculate_sections(records, "03")
        bits_sections = PreloadCalculator.calculate_sections(records, "01")
        find_section = lambda do |addr, func_code|
          sections = func_code == "03" ? words_sections : bits_sections
          prefix = func_code == "03" ? "Preload_Words" : "Preload_Bits"
          sections.each do |start, len|
            end_addr = start + len - 1
            return "#{prefix}_#{start}_#{end_addr}" if addr >= start && addr <= end_addr
          end
          ""
        end

        out = String.new
        out << "<?xml version=\"1.11\" encoding=\"UTF-8\"?>\n"
        out << "<GLOBAL>\n  <XML>\n"

        words_sections.each do |start, length|
          out << block_xml("Preload_Words_#{start}_#{start + length - 1}", preload_fields("Preload_Words", start, length, meta))
        end
        bits_sections.each do |start, length|
          out << block_xml("Preload_Bits_#{start}_#{start + length - 1}", preload_fields("Preload_Bits", start, length, meta))
        end

        records.each do |record|
          tag_name = endpoint_tag_name(record)
          fields = endpoint_fields(record, meta)
          dtype = (record["Data Type"] || "INT").to_s.strip
          func_code = (dtype == "BOOL") ? "01" : "03"
          addr = (record["Address Start"] || "").to_s.strip.delete('"').presence || "0"
          preload_name = ""
          begin
            addr_i = Integer(addr)
            preload_name = find_section.call(addr_i, func_code)
          rescue ArgumentError
            # keep preload_name ""
          end
          fields = fields.map { |n, v| n == "PRELOAD" ? [n, "\"#{preload_name}\""] : [n, v] }
          out << block_xml(tag_name, fields)
        end

        out << "  </XML>\n</GLOBAL>\n"
        out
      end

      def endpoint_tag_name(record)
        tag_name = (record["Tag Name"] || "Tag").to_s
        tag_name = tag_name.sub(/\A[★☆] /, "").strip
        tag_name = tag_name.sub(/\s*\([^)]+\)\z/, "").strip if tag_name.include?(" (") && tag_name.end_with?(")")
        tag_name.tr(" ", "_").presence || "Tag"
      end

      def endpoint_fields(record, meta)
        dtype = (record["Data Type"] || "INT").to_s.strip
        dt_code = record["_raw_datatype"].to_s.strip.presence
        enc_code = record["_raw_encode"].to_s.strip.presence
        dt_code, enc_code = DataTypeMapper.get_export_codes(dtype) unless dt_code && enc_code
        verify_code = record["_raw_verify"].to_s.strip.presence || "7"
        funccode = DataTypeMapper.get_function_code(dtype)
        addr = (record["Address Start"] || "").to_s.strip.delete('"').presence || "0"
        dlength = (record["Data Length"] || DEFAULT_DATA_LENGTH).to_s.strip.delete('"')
        dlength = DEFAULT_DATA_LENGTH unless dlength.match?(/\A\d+\z/)
        nodeid = (record["Tag Group"] || "Default").to_s
        expr = ScalingMapper.ui_to_expr(record["Scaling"] || DEFAULT_SCALING)
        subscribe = ReadWriteMapper.ui_to_subscribe(record["Read/Write"] || DEFAULT_READ_WRITE)
        [
          ["TYPE", "\"#{meta[:protocol] || 'TCP'}\""], ["DEVICEID", '"1"'], ["FUNCCODE", funccode],
          ["ADDRSTART", "\"#{addr}\""], ["DATALENGTH", "\"#{dlength}\""], ["ALIAS", '"none"'],
          ["NODEID", "\"#{nodeid}\""], ["SERIAL", '"remote"'], ["IP", "\"#{meta[:ip] || '0.0.0.0'}\""],
          ["PORT", '"502"'], ["OID", '"none"'], ["CMMSTR_R", '"public"'], ["CMMSTR_W", '"public"'],
          ["TRIGGER", '"none"'], ["PRELOAD", '""'], ["VERIFY", "\"#{verify_code}\""], ["THRESHOLD", '"0"'],
          ["DATATYPE", "\"#{dt_code}\""], ["ENCODE", "\"#{enc_code}\""], ["EXPR", expr],
          ["SUBSCRIBE", subscribe], ["POLL", '"on"']
        ]
      end

      def preload_fields(tag_prefix, start, length, meta)
        func_code = tag_prefix == "Preload_Words" ? '"03"' : '"01"'
        [
          ["TYPE", "\"#{meta[:protocol] || 'TCP'}\""], ["DEVICEID", '"1"'], ["FUNCCODE", func_code],
          ["ADDRSTART", "\"#{start}\""], ["DATALENGTH", "\"#{length}\""], ["ALIAS", '"none"'],
          ["NODEID", '"Preload"'], ["SERIAL", '"remote"'], ["IP", "\"#{meta[:ip] || '0.0.0.0'}\""],
          ["PORT", '"502"'], ["OID", '"none"'], ["CMMSTR_R", '"public"'], ["CMMSTR_W", '"public"'],
          ["TRIGGER", '"none"'], ["PRELOAD", '"none"'], ["VERIFY", '"254"'], ["THRESHOLD", '"0"'],
          ["DATATYPE", '"103"'], ["ENCODE", '"255"'], ["EXPR", '"1.0"'], ["SUBSCRIBE", '"off"'], ["POLL", '"on"']
        ]
      end

      def block_xml(tag_name, fields)
        buf = String.new
        t = tag_name.to_s.dup
        buf << "    <\""
        buf << t
        buf << "\">\n"
        fields.each do |name, value|
          n = name.to_s.dup
          buf << "      <"
          buf << n
          buf << " type=\"STRING\">"
          buf << text_esc(value)
          buf << "</"
          buf << n
          buf << ">\n"
        end
        buf << "    </\""
        buf << t
        buf << "\">\n"
        buf
      end

      def text_esc(s)
        v = s.to_s
        # Never modify input (may be frozen); build new string from gsub result
        out = String.new
        out << v.gsub("&", "&amp;").gsub("<", "&lt;").gsub(">", "&gt;")
        out
      end
    end
  end
end
