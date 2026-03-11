require "test_helper"

class DocumentTest < ActiveSupport::TestCase
  test "metadata filename cannot start with period" do
    doc = Document.new(is_folder: false, metadata_filename: ".hidden.xml", records: [])

    assert_not doc.valid?
    assert_includes doc.errors[:metadata_filename], "cannot start with a period"
  end
end
