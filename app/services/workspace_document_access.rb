# frozen_string_literal: true

# Documents the user may open from the workspace into singular apps (files under Finder 2).
class WorkspaceDocumentAccess
  def self.openable_document_for(user, document_id, content_type:)
    doc = Document.find_by(id: document_id.to_i)
    return nil unless doc&.file?

    return nil unless Apps::FinderController.document_in_any_finder_section?(user, doc)
    return nil if content_type.present? && doc.content_type.to_s != content_type.to_s

    doc
  end
end
