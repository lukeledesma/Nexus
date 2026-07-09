require "test_helper"
require "json"

module Alchemy
  class UploadSourceResolverTest < ActiveSupport::TestCase
    UploadedStub = Struct.new(:tempfile, :original_filename)

    test "imports ignition reference tags using templates lookup and pairs _FB rows by raw moxa tag name" do
      Dir.mktmpdir do |dir|
        ignition_path = File.join(dir, "well2.json")
        templates_path = File.join(dir, "templates.json")

        File.write(templates_path, JSON.generate([
          {
            "name" => "Well 2 Template",
            "tagList" => [
              {
                "name" => "N11_56",
                "function" => "write-single-register",
                "dataType" => "int32",
                "access" => "wo",
                "address" => 56,
                "quantity" => 1,
                "size" => 2,
                "enableAutoScaling" => false,
                "enableByteOrder" => false
              },
              {
                "name" => "N11_56_FB",
                "function" => "read-holding-registers",
                "dataType" => "int32",
                "access" => "ro",
                "address" => 56,
                "quantity" => 1,
                "size" => 2,
                "enableAutoScaling" => false,
                "enableByteOrder" => false
              }
            ]
          }
        ]))

        ignition_payload = {
          "name" => "Well 2",
          "tagType" => "Folder",
          "tags" => [
            {
              "name" => "CMD_Lead_Start_Pump_SP_FB",
              "valueSource" => "reference",
              "dataType" => "Int4",
              "sourceTagPath" => "[MQTT Engine]Edge Nodes/Cascade/Well 2/PLC/N11_56_FB/value",
              "tagType" => "AtomicTag"
            },
            {
              "name" => "CMD_Lead_Start_Pump_Setpoint",
              "valueSource" => "reference",
              "dataType" => "Int4",
              "sourceTagPath" => "[MQTT Engine]Edge Nodes/Cascade/Well 2/PLC/N11_56/value",
              "tagType" => "AtomicTag"
            },
            {
              "name" => "Pump HOA Auto Alarm",
              "tagType" => "UdtInstance"
            }
          ]
        }

        File.write(ignition_path, JSON.generate(ignition_payload))

        File.open(ignition_path, "rb") do |file|
          uploaded = UploadedStub.new(file, "well2.json")
          result = UploadSourceResolver.call(uploaded)

          assert result.success?, result.error

          rows = Alchemy::TagXml::Parser.parse_records_from_content(result.xml_content)
          assert_equal 2, rows.size

          feedback_row = rows.find { |row| row["Tag Name"] == "CMD_Lead_Start_Pump_SP_FB" }
          command_row = rows.find { |row| row["Tag Name"] == "CMD_Lead_Start_Pump_Setpoint" }

          assert feedback_row
          assert command_row

          assert_equal "Well 2", feedback_row["Tag Group"]
          assert_equal "56", feedback_row["Address Start"]
          assert_equal "56", command_row["Address Start"]

          assert_equal "DINT", feedback_row["Data Type"]
          assert_equal "DINT", command_row["Data Type"]

          assert_equal "Read Only", feedback_row["Read/Write"]
          assert_equal "Read+Write", command_row["Read/Write"]

          assert_equal "1", feedback_row["Scaling"]

          assert_equal "N11_56_FB", feedback_row["_moxa_tag_name"]
          assert_equal "N11_56", command_row["_moxa_tag_name"]
          assert_equal "ignition", feedback_row["_source_format"]
          assert_equal "ignition", command_row["_source_format"]

          assert_equal true, feedback_row["_address_pair"]
          assert_equal true, command_row["_address_pair"]
          assert_equal false, feedback_row["_address_conflict"]
          assert_equal false, command_row["_address_conflict"]
        end
      end
    end

    test "imports ignition reference tags without template by inferring address datatype and read only from _FB" do
      Dir.mktmpdir do |dir|
        ignition_path = File.join(dir, "well2-no-template.json")

        ignition_payload = {
          "name" => "Well 2",
          "tagType" => "Folder",
          "tags" => [
            {
              "name" => "CMD_Runtime_From_Well_3_High_FB",
              "valueSource" => "reference",
              "dataType" => "Int4",
              "sourceTagPath" => "[MQTT Engine]Edge Nodes/Cascade/Well 2/PLC/N11_66_FB/value",
              "tagType" => "AtomicTag"
            }
          ]
        }

        File.write(ignition_path, JSON.generate(ignition_payload))

        File.open(ignition_path, "rb") do |file|
          uploaded = UploadedStub.new(file, "well2-no-template.json")
          result = UploadSourceResolver.call(uploaded)

          assert result.success?, result.error

          rows = Alchemy::TagXml::Parser.parse_records_from_content(result.xml_content)
          assert_equal 1, rows.size

          row = rows.first
          assert_equal "Well 2", row["Tag Group"]
          assert_equal "CMD_Runtime_From_Well_3_High_FB", row["Tag Name"]
          assert_equal "DINT", row["Data Type"]
          assert_equal "66", row["Address Start"]
          assert_equal "Read Only", row["Read/Write"]
          assert_equal "N11_66_FB", row["_moxa_tag_name"]
          assert_equal "ignition", row["_source_format"]
        end
      end
    end

    test "infers packed boolean bit address from n word bit format without template" do
      Dir.mktmpdir do |dir|
        ignition_path = File.join(dir, "well2-bool-no-template.json")

        ignition_payload = {
          "name" => "Well 2",
          "tagType" => "Folder",
          "tags" => [
            {
              "name" => "Alarm_Low_Level",
              "valueSource" => "reference",
              "dataType" => "Boolean",
              "sourceTagPath" => "[MQTT Engine]Edge Nodes/Cascade/Well 2/PLC/N11_2_3/value",
              "tagType" => "AtomicTag"
            }
          ]
        }

        File.write(ignition_path, JSON.generate(ignition_payload))

        File.open(ignition_path, "rb") do |file|
          uploaded = UploadedStub.new(file, "well2-bool-no-template.json")
          result = UploadSourceResolver.call(uploaded)

          assert result.success?, result.error

          rows = Alchemy::TagXml::Parser.parse_records_from_content(result.xml_content)
          assert_equal 1, rows.size

          row = rows.first
          assert_equal "Alarm_Low_Level", row["Tag Name"]
          assert_equal "35", row["Address Start"]
          assert_equal "BOOL", row["Data Type"]
          assert_equal "Read+Write", row["Read/Write"]
          assert_equal "N11_2_3", row["_moxa_tag_name"]
          assert_equal "ignition", row["_source_format"]
        end
      end
    end
  end
end
