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

          Tempfile.create(["alchemy-inline", ".xml"]) do |tmp|
            tmp.binmode
            tmp.write(xml_content.to_s)
            tmp.flush
            parse_records(tmp.path)
          end
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
              COLUMNS[:data_type] => DataTypeMapper.map_datatype(datatype, encode),
              COLUMNS[:address_start] => addrstart,
              COLUMNS[:data_length] => dlength,
              COLUMNS[:scaling] => ScalingMapper.expr_to_ui(expr),
              COLUMNS[:read_write] => ReadWriteMapper.subscribe_to_ui(subscribe),
              COLUMNS[:verify] => DEFAULT_VERIFY,
              "_raw_datatype" => datatype,
              "_raw_encode" => encode,
              "_raw_funccode" => funccode,
              "_raw_verify" => verify_raw
            }
          end

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
          key_counts = Hash.new(0)

          records.each do |row|
            address = row[COLUMNS[:address_start]].to_s.strip
            next if address.empty?

            data_type = row[COLUMNS[:data_type]].to_s.strip
            register_kind = data_type == "BOOL" ? "coil" : "holding"
            key = "#{register_kind}:#{address}"
            key_counts[key] += 1
          end

          records.each do |row|
            address = row[COLUMNS[:address_start]].to_s.strip
            data_type = row[COLUMNS[:data_type]].to_s.strip
            register_kind = data_type == "BOOL" ? "coil" : "holding"
            key = "#{register_kind}:#{address}"
            row["_address_conflict"] = address.present? && key_counts[key] > 1
          end
        end
      end
    end
  end
end
