# frozen_string_literal: true

require "rexml/document"
require "set"

module Alchemy
  module TagXml
    module DataTypeMapper
      TYPE_MAP = {
        [ "107", "255" ] => "BOOL",
        [ "107", "107" ] => "BOOL (Bit of INT)",
        [ "0", "255" ] => "INT",
        [ "1", "255" ] => "UINT",
        [ "0", "102" ] => "INT (Scaled)",
        [ "1", "102" ] => "UINT (Scaled)",
        [ "4", "32" ] => "DINT (Scaled)",
        [ "7", "32" ] => "DINT (Scaled, w/Byte Swap)",
        [ "8", "32" ] => "UDINT (Scaled)",
        [ "17", "32" ] => "UDINT (Scaled, w/Byte Swap)",
        [ "4", "255" ] => "DINT",
        [ "7", "4" ] => "DINT (w/Byte Swap)",
        [ "8", "255" ] => "UDINT",
        [ "17", "8" ] => "UDINT (w/Byte Swap)",
        [ "32", "255" ] => "REAL",
        [ "35", "32" ] => "REAL (w/Byte Swap)"
      }.freeze

      UTICOR_CODE_LABELS = {
        "0" => "Signed",
        "1" => "Unsigned",
        "4" => "32 Bit signed, Big-endian (AB CD)",
        "5" => "32 Bit signed, Little-endian (DC BA)",
        "6" => "32 Bit signed, Big-endian byte swap (BA DC)",
        "7" => "32 Bit signed, Little-endian byte swap (CD AB)",
        "8" => "32 Bit Unsigned, Big-endian (AB CD)",
        "9" => "32 Bit Unsigned, Little-endian (DC BA)",
        "16" => "32 Bit Unsigned, Big-endian byte swap (BA DC)",
        "17" => "32 Bit Unsigned, Little-endian byte swap (CD AB)",
        "32" => "32 Bit Float, Big-endian (AB CD)",
        "33" => "32 Bit Float, Little-endian (DC BA)",
        "34" => "32 Bit Float, Big-endian byte swap (BA DC)",
        "35" => "32 Bit Float, Little-endian byte swap (CD AB)",
        "100" => "Raw",
        "101" => "Integer",
        "102" => "Float SP (AB CD) (Legacy)",
        "103" => "Dummy",
        "104" => "Float (CD AB) (Legacy)",
        "105" => "String",
        "106" => "HEX",
        "107" => "Boolean",
        "114" => "Double",
        "255" => "Ignore",
        "0032" => "32 Bit Float, Big-endian (AB CD)",
        "0035" => "32 Bit Float, Little-endian byte swap (CD AB)"
      }.freeze

      module_function

      def map_datatype(datatype, encode)
        dt = datatype.to_s.strip.delete('"')
        enc = encode.to_s.strip.delete('"')
        TYPE_MAP.fetch([ dt, enc ], "Unique")
      end

      def normalize_code(code)
        s = code.to_s.strip.sub(/\A0+/, "")
        s.empty? ? "0" : s
      end

      def uticor_label(code)
        c = code.to_s.strip.delete('"')
        return "" if c.empty?

        UTICOR_CODE_LABELS[c] || "Code #{c}"
      end
    end

    module ScalingMapper
      DEFAULT = "1"

      module_function

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

      def subscribe_to_ui(subscribe_text)
        subscribe_text.to_s.strip.delete('"').downcase == "on" ? "Read+Write" : DEFAULT
      end
    end

    class Parser
      SOURCE_JSON_START = "__ALCHEMY_SOURCE_JSON_START__"
      SOURCE_JSON_END = "__ALCHEMY_SOURCE_JSON_END__"
      SOURCE_XML_START = "__ALCHEMY_SOURCE_XML_START__"
      SOURCE_XML_END = "__ALCHEMY_SOURCE_XML_END__"

      COLUMNS = {
        tag_group: "Tag Group",
        tag_name: "Tag Name",
        data_type: "Data Type",
        address_start: "Address Start",
        data_length: "Data Length",
        scaling: "Scaling",
        read_write: "Read/Write",
        verify: "Verify"
      }.freeze

      DEFAULT_DATA_LENGTH = "1"
      DEFAULT_VERIFY = "7 (Changed)"
      MOXA_SOURCE_FORMATS = %w[moxa ignition].freeze
      RAW_MOXA_DATATYPE_MAP = {
        ["0", "255"] => "int16",
        ["1", "255"] => "uint16",
        ["0", "102"] => "int16",
        ["1", "102"] => "uint16",
        ["4", "255"] => "int32",
        ["7", "4"] => "int32",
        ["4", "32"] => "int32",
        ["7", "32"] => "int32",
        ["8", "255"] => "uint32",
        ["17", "8"] => "uint32",
        ["8", "32"] => "uint32",
        ["17", "32"] => "uint32",
        ["32", "255"] => "float32",
        ["35", "32"] => "float32",
        ["0032", "255"] => "float32",
        ["0035", "32"] => "float32",
        ["999", "255"] => "int64"
      }.freeze

      class << self
        def parse_records_from_content(xml_content)
          return [] if xml_content.to_s.strip.empty?

          parsed_xml = extract_xml_content(xml_content)
          return [] if parsed_xml.to_s.strip.empty?

          Tempfile.create(["alchemy-inline", ".xml"]) do |tmp|
            tmp.binmode
            tmp.write(parsed_xml.to_s)
            tmp.flush
            parse_records(tmp.path)
          end
        end

        def extract_xml_content(content)
          extract_segment(content, start_marker: SOURCE_XML_START, end_marker: SOURCE_XML_END)
        end

        def extract_raw_content(content)
          extract_segment(content, start_marker: SOURCE_JSON_START, end_marker: SOURCE_JSON_END)
        end

        def parse_records(xml_path)
          root = load_root(xml_path)
          return [] if root.nil?

          xml_node = root.elements["XML"] || root
          records = []

          xml_node.elements.each do |child|
            next if child.name.to_s.start_with?("Preload_")
            records << build_record_from_child(child)
          end

          infer_missing_source_formats!(records)
          backfill_missing_moxa_metadata!(records)

          annotate_duplicate_addresses!(records)

          records
        end

        private

        def load_root(xml_path)
          content = File.read(xml_path, encoding: "utf-8", mode: "r")
          content = content.encode("UTF-8", invalid: :replace, undef: :replace)
          content = content.sub(/\<\?xml[^>]*\bversion\s*=\s*"[^"]+"[^>]*\?\>/i, '<?xml version="1.0" encoding="UTF-8"?>')
          content = content.gsub(/\<\s*"\s*([^">]+?)\s*"\s*\>/) { "<#{Regexp.last_match(1).strip.gsub(/\s+/, "_")}>" }
          content = content.gsub(/\<\/\s*"\s*([^">]+?)\s*"\s*\>/) { "</#{Regexp.last_match(1).strip.gsub(/\s+/, "_")}>" }
          doc = REXML::Document.new(content)
          doc.root
        rescue REXML::ParseException
          nil
        end

        def get_child_text(node, tag_name)
          child = node.elements[tag_name]
          child&.text ? child.text.strip : ""
        end

        def child_text(node, tag_name)
          get_child_text(node, tag_name).delete('"')
        end

        def build_record_from_child(child)
          funccode = child_text(child, "FUNCCODE")
          addrstart = child_text(child, "ADDRSTART")
          datatype = child_text(child, "DATATYPE")
          encode = child_text(child, "ENCODE")
          expr = child_text(child, "EXPR")
          nodeid = child_text(child, "NODEID")
          subscribe = child_text(child, "SUBSCRIBE")
          dlength = child_text(child, "DATALENGTH").presence || DEFAULT_DATA_LENGTH
          verify_raw = child_text(child, "VERIFY").presence || "7"
          source_format = child_text(child, "SOURCEFORMAT").downcase
          moxa_function = child_text(child, "MOXAFUNCTION")
          moxa_data_type = child_text(child, "MOXADATATYPE")
          moxa_quantity = child_text(child, "MOXAQUANTITY")
          moxa_tag_name = child_text(child, "MOXATAGNAME")

          {
            COLUMNS[:tag_group] => nodeid,
            COLUMNS[:tag_name] => child.name.to_s,
            COLUMNS[:data_type] => DataTypeMapper.map_datatype(datatype, encode),
            COLUMNS[:address_start] => addrstart,
            COLUMNS[:data_length] => dlength,
            COLUMNS[:scaling] => ScalingMapper.expr_to_ui(expr),
            COLUMNS[:read_write] => ReadWriteMapper.subscribe_to_ui(subscribe),
            COLUMNS[:verify] => DEFAULT_VERIFY,
            "_raw_datatype" => datatype,
            "_raw_encode" => encode,
            "_raw_funccode" => funccode,
            "_raw_verify" => verify_raw,
            "_source_format" => source_format,
            "_moxa_function" => moxa_function,
            "_moxa_data_type" => moxa_data_type,
            "_moxa_quantity" => moxa_quantity,
            "_moxa_tag_name" => moxa_tag_name
          }
        end

        def extract_segment(content, start_marker:, end_marker:)
          text = content.to_s
          return text unless text.include?(start_marker) && text.include?(end_marker)

          start_at = text.index(start_marker)
          end_at = text.index(end_marker)
          return text if start_at.nil? || end_at.nil? || end_at <= start_at

          body_start = start_at + start_marker.length
          text[body_start...end_at].to_s.strip
        end

        def annotate_duplicate_addresses!(records)
          grouped = Hash.new { |h, k| h[k] = [] }

          records.each do |row|
            address = row[COLUMNS[:address_start]].to_s.strip
            next if address.empty?

            register_kind = register_kind_for_row_data_type(row[COLUMNS[:data_type]])
            key = register_key(register_kind, address)
            grouped[key] << row
          end

          reset_address_flags!(records)

          grouped.each_value do |rows|
            next if rows.size <= 1

            moxa_like_rows = rows.select { |r| moxa_like_source_format?(r["_source_format"]) }

            if moxa_like_rows.size == rows.size
              matched_pair_ids = Set.new
              by_pair_key = Hash.new { |h, k| h[k] = [] }
              moxa_like_rows.each do |row|
                key = pair_key_for_row(row)
                next if key.blank?

                by_pair_key[key] << row
              end

              moxa_like_rows.each do |row|
                key = pair_key_for_row(row)
                next if key.blank?

                if key.end_with?("_fb")
                  base = key.delete_suffix("_fb")
                  partners = by_pair_key[base]
                  if partners.present?
                    matched_pair_ids << row.object_id
                    partners.each { |partner| matched_pair_ids << partner.object_id }
                  end
                else
                  partners = by_pair_key["#{key}_fb"]
                  if partners.present?
                    matched_pair_ids << row.object_id
                    partners.each { |partner| matched_pair_ids << partner.object_id }
                  end
                end
              end

              moxa_like_rows.each do |row|
                row["_address_pair"] = matched_pair_ids.include?(row.object_id)
              end
              remaining = moxa_like_rows.reject { |row| matched_pair_ids.include?(row.object_id) }
              if remaining.size > 1
                remaining.each { |row| row["_address_conflict"] = true }
              end
            else
              rows.each { |row| row["_address_conflict"] = true }
            end
          end
        end

        def infer_missing_source_formats!(records)
          return if records.empty?

          explicit = records.filter_map do |row|
            normalized_source_format(row).presence
          end.uniq

          if explicit.size == 1
            records.each { |row| row["_source_format"] = explicit.first }
            return
          end

          if explicit.include?("moxa")
            apply_source_format_default!(records, "moxa")
            return
          end

          if explicit.include?("uticor")
            apply_source_format_default!(records, "uticor")
            return
          end

          inferred = legacy_moxa_format?(records) ? "moxa" : "uticor"
          records.each { |row| row["_source_format"] = inferred }
        end

        def legacy_moxa_format?(records)
          return true if records.any? { |row| row["_moxa_data_type"].to_s.strip.present? || row["_moxa_quantity"].to_s.strip.present? }

          grouped = Hash.new { |h, k| h[k] = [] }
          records.each do |row|
            address = row[COLUMNS[:address_start]].to_s.strip
            next if address.empty?

            register_kind = register_kind_for_row_data_type(row[COLUMNS[:data_type]])
            grouped[register_key(register_kind, address)] << row[COLUMNS[:tag_name]].to_s
          end

          has_moxa_signature = records.any? do |row|
            row["_raw_datatype"].to_s.strip == "999" || row["_raw_funccode"].to_s.strip == "05"
          end

          pair_groups = grouped.values.count do |names|
            next false if names.size < 2

            paired_names_present?(names)
          end

          has_moxa_signature || pair_groups >= 1
        end

        def backfill_missing_moxa_metadata!(records)
          records.each do |row|
            next unless row["_source_format"].to_s.downcase == "moxa"

            if row["_moxa_quantity"].to_s.strip.empty?
              row["_moxa_quantity"] = row[COLUMNS[:data_length]].to_s.presence || DEFAULT_DATA_LENGTH
            end

            next unless row["_moxa_data_type"].to_s.strip.empty?

            raw_dt = row["_raw_datatype"].to_s.strip
            raw_enc = row["_raw_encode"].to_s.strip
            raw_fc = row["_raw_funccode"].to_s.strip
            inferred = infer_moxa_datatype_from_raw(raw_dt: raw_dt, raw_enc: raw_enc, raw_fc: raw_fc)

            row["_moxa_data_type"] = inferred
          end
        end

        def infer_moxa_datatype_from_raw(raw_dt:, raw_enc:, raw_fc:)
          return "boolean" if raw_fc == "01" || raw_dt == "107"

          RAW_MOXA_DATATYPE_MAP.fetch([raw_dt, raw_enc], "unknown")
        end

        def pair_key_for_row(row)
          source_name = row["_moxa_tag_name"].to_s.presence || row[COLUMNS[:tag_name]].to_s
          source_name.strip.downcase
        end

        def moxa_like_source_format?(source_format)
          MOXA_SOURCE_FORMATS.include?(source_format.to_s.downcase)
        end

        def register_kind_for_row_data_type(data_type)
          data_type.to_s.strip == "BOOL" ? "coil" : "holding"
        end

        def reset_address_flags!(records)
          records.each do |row|
            row["_address_conflict"] = false
            row["_address_pair"] = false
          end
        end

        def register_key(register_kind, address)
          "#{register_kind}:#{address}"
        end

        def apply_source_format_default!(records, default_format)
          records.each do |row|
            row["_source_format"] = normalized_source_format(row).presence || default_format
          end
        end

        def paired_names_present?(names)
          set = names.to_set
          names.any? do |name|
            next false if name.blank?

            partner_name = name.end_with?("_FB") ? name.delete_suffix("_FB") : "#{name}_FB"
            set.include?(partner_name)
          end
        end

        def normalized_source_format(row)
          row["_source_format"].to_s.strip.downcase
        end
      end
    end
  end
end
