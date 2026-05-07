require "test_helper"

class TimeCardDocumentCodecTest < ActiveSupport::TestCase
  test "loads legacy frontmatter format" do
    raw = [
      "---",
      "app: time_card",
      'start_time: "22:30"',
      'end_time: "23:00"',
      "running: false",
      'clock_in_at_ms: ""',
      'clock_out_at_ms: ""',
      "---",
      "",
      "h1: work summary"
    ].join("\n")

    parsed = TimeCardDocumentCodec.load(raw)

    assert_equal 22 * 60 + 30, parsed["clockInMinutes"]
    assert_equal 23 * 60, parsed["clockOutMinutes"]
    assert_equal false, parsed["running"]
    assert_equal "h1: work summary", parsed["notesText"].strip
  end

  test "loads html wrapped legacy frontmatter" do
    raw = "<p>---<br>app: time_card<br>start_time: &quot;22:30&quot;<br>end_time: &quot;23:00&quot;<br>running: false<br>clock_in_at_ms: &quot;&quot;<br>clock_out_at_ms: &quot;&quot;<br>---<br><br></p>"

    parsed = TimeCardDocumentCodec.load(raw)

    assert_equal 22 * 60 + 30, parsed["clockInMinutes"]
    assert_equal 23 * 60, parsed["clockOutMinutes"]
    assert_equal false, parsed["running"]
    assert_equal "", parsed["notesText"].strip
  end

  test "dumps unified nexus format and round trips" do
    encoded = TimeCardDocumentCodec.dump(
      {
        clockInMinutes: 22 * 60 + 30,
        clockOutMinutes: 23 * 60,
        running: false,
        notesText: "h1: test"
      }
    )

    assert_includes encoded, "# NEXUS_FILE v1"
    assert_includes encoded, "# kind: time_card"
    assert_includes encoded, "# start_time: 22:30"
    assert_includes encoded, "# end_time: 23:00"

    parsed = TimeCardDocumentCodec.load(encoded)
    assert_equal 22 * 60 + 30, parsed["clockInMinutes"]
    assert_equal 23 * 60, parsed["clockOutMinutes"]
    assert_equal false, parsed["running"]
    assert_equal "h1: test", parsed["notesText"]
  end

  test "strips two or more trailing newlines from notes body" do
    raw = [
      "# NEXUS_FILE v1",
      "# kind: time_card",
      "# title: Time Card",
      "# created_at: null",
      "# updated_at: null",
      "# start_time:",
      "# end_time:",
      "# running: false",
      "# clock_in_at_ms:",
      "# clock_out_at_ms:",
      "",
      "hello\n\r\n\r"
    ].join("\n")

    parsed = TimeCardDocumentCodec.load(raw)
    assert_equal "hello", parsed["notesText"]
  end
end
