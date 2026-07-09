# frozen_string_literal: true

require "fileutils"
require "json"
require "rubygems/package"
require "tempfile"
require "zlib"
require "cgi"

module Alchemy
  class UploadSourceResolver
    SOURCE_JSON_START = "__ALCHEMY_SOURCE_JSON_START__"
    SOURCE_JSON_END = "__ALCHEMY_SOURCE_JSON_END__"
    SOURCE_XML_START = "__ALCHEMY_SOURCE_XML_START__"
    SOURCE_XML_END = "__ALCHEMY_SOURCE_XML_END__"

    Result = Struct.new(:success?, :xml_content, :source_filename, :error, keyword_init: true)

    class << self
      def call(uploaded)
        return Result.new(success?: false, error: "No file received.") unless uploaded&.respond_to?(:tempfile)

        original = uploaded.original_filename.to_s
        ext = original.downcase

        if ext.end_with?(".xml")
          content = File.read(uploaded.tempfile.path)
          return Result.new(success?: true, xml_content: content, source_filename: original)
        end

        if ext.end_with?(".json")
          return parse_moxa_json(uploaded.tempfile.path, original)
        end

        if ext.end_with?(".xml.tar")
          return read_first_xml_from_tar(uploaded.tempfile.path, original)
        end

        if ext.end_with?(".xml.tar.gz") || ext.end_with?(".tgz")
          return read_first_xml_from_targz(uploaded.tempfile.path, original)
        end

        Result.new(success?: false, error: "Unsupported file type.")
      rescue StandardError => e
        Result.new(success?: false, error: e.message)
      end

      private

      def parse_moxa_json(path, original)
        json = File.read(path)
        payload = JSON.parse(json)
        rows = extract_moxa_rows(payload, source_path: path)
        return Result.new(success?: false, error: "JSON file does not contain any Moxa tags.") if rows.empty?

        xml_content = build_xml_from_moxa_rows(rows)
        bundled = build_moxa_source_bundle(json_content: json, xml_content: xml_content)
        Result.new(success?: true, xml_content: bundled, source_filename: original)
      rescue JSON::ParserError
        Result.new(success?: false, error: "Invalid JSON file.")
      end

      def build_moxa_source_bundle(json_content:, xml_content:)
        [
          SOURCE_JSON_START,
          json_content.to_s,
          SOURCE_JSON_END,
          SOURCE_XML_START,
          xml_content.to_s,
          SOURCE_XML_END
        ].join("\n")
      end

      def extract_moxa_rows(payload, source_path: nil)
        if moxa_profile_payload?(payload)
          return extract_moxa_profile_rows(payload)
        end

        template_index = load_template_tag_index(source_path)
        extract_ignition_reference_rows(payload, template_index: template_index)
      end

      def moxa_profile_payload?(payload)
        profiles = payload.is_a?(Array) ? payload : [ payload ]
        profiles.any? do |profile|
          profile.is_a?(Hash) && profile["tagList"].is_a?(Array)
        end
      end

      def extract_moxa_profile_rows(payload)
        profiles = payload.is_a?(Array) ? payload : [ payload ]
        rows = []

        profiles.each_with_index do |profile, idx|
          next unless profile.is_a?(Hash)

          group_name = profile["name"].to_s.strip
          group_name = "Group #{idx + 1}" if group_name.empty?
          tag_list = profile["tagList"]
          next unless tag_list.is_a?(Array)

          tag_list.each do |tag|
            next unless tag.is_a?(Hash)

            name = tag["name"].to_s.strip
            next if name.empty?

            rows << {
              tag_group: group_name,
              tag_name: name,
              moxa_tag_name: name,
              source_format: "moxa",
              address: tag["address"],
              function: tag["function"].to_s,
              data_type: tag["dataType"].to_s,
              access: tag["access"].to_s,
              size: tag["size"],
              quantity: tag["quantity"],
              auto_scaling: tag["autoScaling"],
              enable_auto_scaling: tag["enableAutoScaling"],
              enable_byte_order: tag["enableByteOrder"],
              byte_order: tag["byteOrder"]
            }
          end
        end

        rows
      end

      def extract_ignition_reference_rows(payload, template_index:)
        nodes = payload.is_a?(Array) ? payload : [ payload ]
        rows = []

        nodes.each_with_index do |node, idx|
          next unless node.is_a?(Hash)

          root_name = node["name"].to_s.strip
          current_group = root_name.presence || "Group #{idx + 1}"
          rows.concat(extract_reference_rows_from_node(node, current_group: current_group, template_index: template_index))
        end

        rows
      end

      def extract_reference_rows_from_node(node, current_group:, template_index:)
        return [] unless node.is_a?(Hash)

        rows = []
        node_name = node["name"].to_s.strip
        tag_type = node["tagType"].to_s
        next_group = if tag_type.casecmp("Folder").zero? && node_name.present?
          node_name
        else
          current_group
        end

        if reference_atomic_tag?(node)
          row = build_row_from_reference_tag(node, current_group: current_group, template_index: template_index)
          rows << row if row
        end

        children = node["tags"]
        if children.is_a?(Array)
          children.each do |child|
            rows.concat(extract_reference_rows_from_node(child, current_group: next_group, template_index: template_index))
          end
        end

        rows
      end

      def reference_atomic_tag?(node)
        return false unless node["tagType"].to_s.casecmp("AtomicTag").zero?
        return false unless node["valueSource"].to_s.casecmp("reference").zero?

        node["sourceTagPath"].to_s.strip.present?
      end

      def build_row_from_reference_tag(tag, current_group:, template_index:)
        source_path = tag["sourceTagPath"].to_s.strip
        raw_name = moxa_tag_name_from_source_path(source_path)
        return nil if raw_name.blank?

        template = template_index[raw_name.downcase] || {}
        access = infer_access_from_moxa_tag_name(raw_name)
        function = template["function"].presence || infer_function_from_reference(tag, access)
        data_type = template["dataType"].presence || infer_data_type_from_reference(tag)
        quantity = template["quantity"].presence || infer_quantity_from_data_type(data_type)
        size = template["size"].presence || infer_size_from_data_type(data_type)

        {
          tag_group: current_group.to_s.presence || "Group 1",
          tag_name: tag["name"].to_s.strip.presence || raw_name,
          moxa_tag_name: raw_name,
          source_format: "ignition",
          address: template["address"].presence || infer_address_from_moxa_tag_name(raw_name, data_type: data_type, function: function),
          function: function.to_s,
          data_type: data_type.to_s,
          access: access.to_s,
          size: size,
          quantity: quantity,
          auto_scaling: {},
          enable_auto_scaling: false,
          enable_byte_order: template["enableByteOrder"],
          byte_order: template["byteOrder"]
        }
      end

      def moxa_tag_name_from_source_path(source_path)
        return "" if source_path.blank?

        path = source_path.to_s
        value_match = path.match(%r{/([^/]+)/value\z})
        return value_match[1].to_s.strip if value_match

        path.split("/").last.to_s.strip
      end

      def infer_access_from_moxa_tag_name(raw_name)
        raw_name.to_s.end_with?("_FB") ? "ro" : "rw"
      end

      def infer_function_from_reference(tag, access)
        ignition_dtype = tag["dataType"].to_s.strip.downcase
        if ["boolean", "bool"].include?(ignition_dtype)
          return access.to_s == "ro" ? "read-coils" : "write-single-coil"
        end

        access.to_s == "ro" ? "read-holding-registers" : "write-single-register"
      end

      def infer_data_type_from_reference(tag)
        ignition_dtype = tag["dataType"].to_s.strip.downcase
        mapping = {
          "boolean" => "boolean",
          "bool" => "boolean",
          "int2" => "int16",
          "int4" => "int32",
          "float4" => "float32"
        }

        mapping.fetch(ignition_dtype, "unknown")
      end

      def infer_quantity_from_data_type(data_type)
        dtype = data_type.to_s.strip.downcase
        return 1 if ["boolean", "bool", "int16", "uint16", "short", "ushort", "int2", "uint2"].include?(dtype)

        1
      end

      def infer_size_from_data_type(data_type)
        dtype = data_type.to_s.strip.downcase
        return 1 if ["boolean", "bool", "int16", "uint16", "short", "ushort", "int2", "uint2", "byte", "uint8"].include?(dtype)
        return 2 if ["int32", "uint32", "dint", "udint", "float32", "float", "real", "int4", "uint4", "float4"].include?(dtype)

        1
      end

      def infer_address_from_moxa_tag_name(raw_name, data_type: nil, function: nil)
        name = raw_name.to_s.strip
        return 0 if name.empty?

        suffix_trimmed = name.sub(/_FB\z/i, "")
        numeric_parts = suffix_trimmed.scan(/\d+/).map(&:to_i)
        return 0 if numeric_parts.length < 2

        # Format: N11_<word>_<bit> is a packed coil offset (word * 16 + bit).
        if numeric_parts.length >= 3 && coil_like_reference?(data_type, function)
          return (numeric_parts[1] * 16) + numeric_parts[2]
        end

        numeric_parts[1]
      end

      def load_template_tag_index(source_path)
        dir = source_path.present? ? File.dirname(source_path.to_s) : nil
        candidates = [
          (File.join(dir, "templates.json") if dir.present?),
          (File.join(dir, "template.json") if dir.present?),
          Rails.root.join("config", "alchemy_templates", "Carefree_AB_Generic", "templates.json").to_s,
          Rails.root.join("config", "alchemy_templates", "Carefree_AB_Generic.json").to_s
        ].compact.uniq

        candidates.each do |candidate|
          next unless File.exist?(candidate)

          payload = JSON.parse(File.read(candidate))
          return template_tag_index_from_payload(payload)
        rescue StandardError
          next
        end

        {}
      end

      def coil_like_reference?(data_type, function)
        dtype = data_type.to_s.strip.downcase
        return true if ["boolean", "bool"].include?(dtype)

        function.to_s.downcase.include?("coil")
      end

      def template_tag_index_from_payload(payload)
        profiles = payload.is_a?(Array) ? payload : [ payload ]
        index = {}

        profiles.each do |profile|
          next unless profile.is_a?(Hash)

          tag_list = profile["tagList"]
          next unless tag_list.is_a?(Array)

          tag_list.each do |tag|
            next unless tag.is_a?(Hash)

            name = tag["name"].to_s.strip
            next if name.empty?

            index[name.downcase] = tag
          end
        end

        index
      end

      def build_xml_from_moxa_rows(rows)
        body = +""
        body << %(<?xml version="1.0" encoding="UTF-8"?>\n)
        body << "<XML>\n"

        rows.each do |row|
          tag_name = sanitize_xml_tag_name(row[:tag_name])
          datatype, encode, funccode = infer_codes(row)
          address = numeric_or_default(row[:address], default: 0)
          data_length = numeric_or_default(row[:quantity], default: infer_data_length(row[:size]))
          scaling_expr = scaling_expr_from_moxa(row[:auto_scaling], row[:enable_auto_scaling])
          subscribe = subscribe_from_access(row[:access])
          node_id = row[:tag_group].to_s
          source_format = row[:source_format].to_s.presence || "moxa"

          body << "  <#{tag_name}>\n"
          body << "    <FUNCCODE>\"#{funccode}\"</FUNCCODE>\n"
          body << "    <ADDRSTART>\"#{address}\"</ADDRSTART>\n"
          body << "    <DATATYPE>\"#{datatype}\"</DATATYPE>\n"
          body << "    <ENCODE>\"#{encode}\"</ENCODE>\n"
          body << "    <EXPR>\"#{scaling_expr}\"</EXPR>\n"
          body << "    <NODEID>\"#{escape_xml_text(node_id)}\"</NODEID>\n"
          body << "    <SUBSCRIBE>\"#{subscribe}\"</SUBSCRIBE>\n"
          body << "    <DATALENGTH>\"#{data_length}\"</DATALENGTH>\n"
          body << "    <VERIFY>\"7\"</VERIFY>\n"
          body << "    <SOURCEFORMAT>\"#{escape_xml_text(source_format)}\"</SOURCEFORMAT>\n"
          body << "    <MOXAFUNCTION>\"#{escape_xml_text(row[:function].to_s)}\"</MOXAFUNCTION>\n"
          body << "    <MOXADATATYPE>\"#{escape_xml_text(row[:data_type].to_s)}\"</MOXADATATYPE>\n"
          body << "    <MOXAQUANTITY>\"#{numeric_or_default(row[:quantity], default: infer_data_length(row[:size]))}\"</MOXAQUANTITY>\n"
          body << "    <MOXATAGNAME>\"#{escape_xml_text(row[:moxa_tag_name].to_s.presence || row[:tag_name].to_s)}\"</MOXATAGNAME>\n"
          body << "  </#{tag_name}>\n"
        end

        body << "</XML>\n"
        body
      end

      def infer_codes(row)
        function = row[:function].to_s.downcase
        dtype = row[:data_type].to_s.downcase
        scaled = moxa_scaled?(row)
        swapped = moxa_byte_swapped?(row)

        bool_function = function.include?("coil")
        bool_dtype = dtype == "boolean" || dtype == "bool"
        if bool_function || bool_dtype
          return [ "107", "107", "03" ] if function.include?("holding")
          return [ "107", "255", "01" ]
        end

        if ["int16", "int2", "short", "int"].include?(dtype)
          return scaled ? [ "0", "102", "03" ] : [ "0", "255", "03" ]
        end

        if ["uint16", "uint2", "ushort", "word", "byte", "uint8"].include?(dtype)
          return scaled ? [ "1", "102", "03" ] : [ "1", "255", "03" ]
        end

        if ["int32", "int4", "dint"].include?(dtype)
          return [ "7", "32", "03" ] if scaled && swapped
          return [ "4", "32", "03" ] if scaled
          return [ "7", "4", "03" ] if swapped
          return [ "4", "255", "03" ]
        end

        if ["uint32", "uint4", "udint", "dword"].include?(dtype)
          return [ "17", "32", "03" ] if scaled && swapped
          return [ "8", "32", "03" ] if scaled
          return [ "17", "8", "03" ] if swapped
          return [ "8", "255", "03" ]
        end

        if ["float32", "float4", "float", "real"].include?(dtype)
          return [ "35", "32", "03" ] if swapped
          return [ "32", "255", "03" ]
        end

        # Excel PLC Tag List has no direct 64-bit rows. Use closest supported 32-bit family.
        if ["int64", "long"].include?(dtype)
          return [ "7", "32", "03" ] if scaled && swapped
          return [ "4", "32", "03" ] if scaled
          return [ "7", "4", "03" ] if swapped
          return [ "4", "255", "03" ]
        end

        if ["uint64", "ulong"].include?(dtype)
          return [ "17", "32", "03" ] if scaled && swapped
          return [ "8", "32", "03" ] if scaled
          return [ "17", "8", "03" ] if swapped
          return [ "8", "255", "03" ]
        end

        if ["float64", "double"].include?(dtype)
          return [ "35", "32", "03" ] if swapped
          return [ "32", "255", "03" ]
        end

        return [ "999", "255", "03" ] if ["string"].include?(dtype)

        [ "999", "255", "03" ]
      end

      def moxa_scaled?(row)
        row[:enable_auto_scaling] == true || row[:enable_auto_scaling].to_s == "true"
      end

      def moxa_byte_swapped?(row)
        enabled = row[:enable_byte_order] == true || row[:enable_byte_order].to_s == "true"
        return false unless enabled

        order = row[:byte_order].to_s.strip.upcase
        return false if order.empty?

        !["ABCD"].include?(order)
      end

      def infer_data_length(size)
        n = numeric_or_default(size, default: 1)
        n.positive? ? n : 1
      end

      def numeric_or_default(value, default:)
        Integer(value)
      rescue ArgumentError, TypeError
        default
      end

      def scaling_expr_from_moxa(auto_scaling, enable_auto_scaling)
        enabled = enable_auto_scaling == true || enable_auto_scaling.to_s == "true"
        return "1" unless enabled
        return "1" unless auto_scaling.is_a?(Hash)

        source_max = Float(auto_scaling["sourceMax"])
        source_min = Float(auto_scaling["sourceMin"])
        target_max = Float(auto_scaling["targetMax"])
        target_min = Float(auto_scaling["targetMin"])

        source_span = source_max - source_min
        target_span = target_max - target_min
        return "1" if source_span <= 0.0 || target_span <= 0.0

        # Alchemy XML stores expression as reciprocal of UI scaling.
        scaling = source_span / target_span
        expr = 1.0 / scaling
        format("%.6f", expr).sub(/0+\z/, "").sub(/\.\z/, "")
      rescue ArgumentError, TypeError, ZeroDivisionError
        "1"
      end

      def subscribe_from_access(access)
        a = access.to_s.downcase.strip
        a == "ro" ? "off" : "on"
      end

      def sanitize_xml_tag_name(name)
        cleaned = name.to_s.strip.gsub(/\s+/, "_")
        cleaned = cleaned.gsub(/[^A-Za-z0-9_\-.]/, "_")
        cleaned = "Tag" if cleaned.empty?
        cleaned = "T_#{cleaned}" unless cleaned.match?(/\A[A-Za-z_]/)
        cleaned
      end

      def escape_xml_text(text)
        CGI.escapeHTML(text.to_s)
      end

      def read_first_xml_from_targz(gzip_path, fallback_name)
        Tempfile.create(["alchemy-upload", ".tar"]) do |tmp_tar|
          Zlib::GzipReader.open(gzip_path) do |gz|
            tmp_tar.binmode
            IO.copy_stream(gz, tmp_tar)
            tmp_tar.flush
          end

          read_first_xml_from_tar(tmp_tar.path, fallback_name)
        end
      end

      def read_first_xml_from_tar(tar_path, fallback_name)
        tar_file = File.open(tar_path, "rb")
        begin
          Gem::Package::TarReader.new(tar_file) do |tar|
            tar.each do |entry|
              next unless entry.file?
              next unless File.extname(entry.full_name).casecmp?(".xml")

              xml_name = File.basename(entry.full_name).presence || fallback_name
              xml_content = entry.read
              return Result.new(success?: true, xml_content: xml_content, source_filename: xml_name)
            end
          end
        ensure
          tar_file.close
        end

        Result.new(success?: false, error: "Could not find XML inside archive.")
      end
    end
  end
end
