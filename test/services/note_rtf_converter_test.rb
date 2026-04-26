# frozen_string_literal: true

# Standalone minitest: avoids loading broken legacy `documents` fixtures from test_helper.
require_relative "../../config/environment"
require "minitest/autorun"

class NoteRtfConverterTest < Minitest::Test
  def test_html_to_rtf_starts_with_rtf_header
    rtf = NoteRtfConverter.html_to_rtf("<p>Hello</p>")
    assert rtf.start_with?("{\\rtf1")
  end

  def test_round_trip_preserves_bold_and_italic
    html = "<p>Hi <strong>bold</strong> and <em>it</em></p>"
    back = NoteRtfConverter.rtf_to_html(NoteRtfConverter.html_to_rtf(html))
    assert_includes back, "<strong>bold</strong>"
    assert_includes back, "<em>it</em>"
  end

  def test_non_rtf_falls_back_to_escaped_paragraph
    html = NoteRtfConverter.rtf_to_html("plain line")
    assert_includes html, "plain line"
    assert_includes html, "<p>"
  end
end
