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
          text = content.to_s
          return text unless text.include?(SOURCE_XML_START) && text.include?(SOURCE_XML_END)

          start_at = text.index(SOURCE_XML_START)
          end_at = text.index(SOURCE_XML_END)
          return text if start_at.nil? || end_at.nil? || end_at <= start_at

          body_start = start_at + SOURCE_XML_START.length
          text[body_start...end_at].to_s.strip
        end

        def extract_raw_content(content)
          text = content.to_s
          return text unless text.include?(SOURCE_JSON_START) && text.include?(SOURCE_JSON_END)

          start_at = text.index(SOURCE_JSON_START)
          end_at = text.index(SOURCE_JSON_END)
          return text if start_at.nil? || end_at.nil? || end_at <= start_at

          body_start = start_at + SOURCE_JSON_START.length
          text[body_start...end_at].to_s.strip
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
            source_format = get_child_text(child, "SOURCEFORMAT").delete('"').downcase
            moxa_function = get_child_text(child, "MOXAFUNCTION").delete('"')
            moxa_data_type = get_child_text(child, "MOXADATATYPE").delete('"')
            moxa_quantity = get_child_text(child, "MOXAQUANTITY").delete('"')
            moxa_tag_name = get_child_text(child, "MOXATAGNAME").delete('"')

            records << {
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

        def annotate_duplicate_addresses!(records)
          grouped = Hash.new { |h, k| h[k] = [] }

          records.each do |row|
            address = row[COLUMNS[:address_start]].to_s.strip
            next if address.empty?

            data_type = row[COLUMNS[:data_type]].to_s.strip
            register_kind = data_type == "BOOL" ? "coil" : "holding"
            key = "#{register_kind}:#{address}"
            grouped[key] << row
          end

          records.each do |row|
            row["_address_conflict"] = false
            row["_address_pair"] = false
          end

          grouped.each_value do |rows|
            next if rows.size <= 1

            moxa_rows = rows.select { |r| r["_source_format"].to_s.downcase == "moxa" }
            if moxa_rows.size == rows.size
              matched_pair_ids = Set.new
              by_name = moxa_rows.index_by { |r| r[COLUMNS[:tag_name]].to_s }

              moxa_rows.each do |row|
                name = row[COLUMNS[:tag_name]].to_s
                next if name.empty?

                if name.end_with?("_FB")
                  base = name.delete_suffix("_FB")
                  partner = by_name[base]
                  if partner
                    matched_pair_ids << row.object_id
                    matched_pair_ids << partner.object_id
                  end
                else
                  partner = by_name["#{name}_FB"]
                  if partner
                    matched_pair_ids << row.object_id
                    matched_pair_ids << partner.object_id
                  end
                end
              end

              moxa_rows.each do |row|
                row["_address_pair"] = matched_pair_ids.include?(row.object_id)
              end
              remaining = moxa_rows.reject { |row| matched_pair_ids.include?(row.object_id) }
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
            value = row["_source_format"].to_s.strip.downcase
            value.presence
          end.uniq

          if explicit.size == 1
            records.each { |row| row["_source_format"] = explicit.first }
            return
          end

          if explicit.include?("moxa")
            records.each do |row|
              value = row["_source_format"].to_s.strip.downcase
              row["_source_format"] = value.presence || "moxa"
            end
            return
          end

          if explicit.include?("uticor")
            records.each do |row|
              value = row["_source_format"].to_s.strip.downcase
              row["_source_format"] = value.presence || "uticor"
            end
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

            data_type = row[COLUMNS[:data_type]].to_s.strip
            register_kind = data_type == "BOOL" ? "coil" : "holding"
            grouped["#{register_kind}:#{address}"] << row[COLUMNS[:tag_name]].to_s
          end

          has_moxa_signature = records.any? do |row|
            row["_raw_datatype"].to_s.strip == "999" || row["_raw_funccode"].to_s.strip == "05"
          end

          pair_groups = grouped.values.count do |names|
            next false if names.size < 2

            set = names.to_set
            names.any? do |name|
              next false if name.blank?

              if name.end_with?("_FB")
                set.include?(name.delete_suffix("_FB"))
              else
                set.include?("#{name}_FB")
              end
            end
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

          key = [raw_dt, raw_enc]
          mapping = {
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
          }

          mapping.fetch(key, "unknown")
        end
      end
    end
  end
end
