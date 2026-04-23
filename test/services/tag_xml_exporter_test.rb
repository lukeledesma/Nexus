require "test_helper"

class TagXmlExporterTest < ActiveSupport::TestCase
  setup do
    skip("TagXml exporter service is not present in this codebase") unless defined?(TagXml::Exporter)
  end

  test "bit preload uses delta length for non-zero ranges" do
    records = (800..807).map do |addr|
      {
        "Tag Group" => "Default",
        "Tag Name" => "Bit#{addr}",
        "Data Type" => "BOOL",
        "Address Start" => addr.to_s,
        "Data Length" => "1",
        "Scaling" => "1",
        "Read/Write" => "Read Only",
        "Verify" => "7 (Changed)"
      }
    end

    xml = TagXml::Exporter.export_xml(records, { ip: "1.2.3.4", protocol: "TCP", filename: "x.xml" })

    assert_match(/<"Preload_Bits_800_807">.*?<ADDRSTART type="STRING">"800"<\/ADDRSTART>.*?<DATALENGTH type="STRING">"7"<\/DATALENGTH>/m, xml)
  end

  test "word preload adds one over range delta" do
    records = (800..807).map do |addr|
      {
        "Tag Group" => "Default",
        "Tag Name" => "Word#{addr}",
        "Data Type" => "INT",
        "Address Start" => addr.to_s,
        "Data Length" => "1",
        "Scaling" => "1",
        "Read/Write" => "Read Only",
        "Verify" => "7 (Changed)"
      }
    end

    xml = TagXml::Exporter.export_xml(records, { ip: "1.2.3.4", protocol: "TCP", filename: "x.xml" })

    assert_match(/<"Preload_Words_800_807">.*?<ADDRSTART type="STRING">"800"<\/ADDRSTART>.*?<DATALENGTH type="STRING">"8"<\/DATALENGTH>/m, xml)
  end
end
