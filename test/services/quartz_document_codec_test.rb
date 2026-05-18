# frozen_string_literal: true

require "test_helper"

class QuartzDocumentCodecTest < ActiveSupport::TestCase
  test "load includes valid validation metadata for unique triggers" do
    body = [
      "#timecard",
      "03:05-04:00 me",
      "- 1",
      "",
      "#timer",
      "10:00 - 19:19:34",
      "10:00 - 19:29:34",
      "",
      "#tasklist",
      "☐ one"
    ].join("\n")

    content = QuartzDocumentCodec.dump(body, title: "Quartz")
    parsed = QuartzDocumentCodec.load(content)

    assert_equal body, parsed["body"]
    assert_equal true, parsed.dig("validation", "valid")
    assert_equal [], parsed.dig("validation", "invalid_triggers")
  end

  test "validate_body reports duplicate triggers by type" do
    body = [
      "#timer",
      "25m",
      "",
      "#timer",
      "15m",
      "",
      "#timecard",
      "03:05-04:00 me",
      "",
      "#timecard"
    ].join("\n")

    validation = QuartzDocumentCodec.validate_body(body)

    assert_equal false, validation["valid"]
    assert_equal 2, validation["invalid_triggers"].length

    first = validation["invalid_triggers"][0]
    second = validation["invalid_triggers"][1]

    assert_equal "#timer", first["trigger"]
    assert_equal 4, first["line"]
    assert_equal 1, first["first_seen_line"]
    assert_equal "duplicate_trigger", first["reason"]

    assert_equal "#timecard", second["trigger"]
    assert_equal 10, second["line"]
    assert_equal 7, second["first_seen_line"]
    assert_equal "duplicate_trigger", second["reason"]
  end
end
