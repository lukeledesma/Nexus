require "test_helper"

class DocumentTest < ActiveSupport::TestCase
  test "title cannot start with period" do
    doc = Document.new(is_folder: false, title: ".hidden")

    assert_not doc.valid?
    assert_includes doc.errors[:title], "cannot start with a period"
  end
end
