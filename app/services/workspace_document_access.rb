# frozen_string_literal: true

# Documents the user may open from Finder into singular apps (files in sidebar folders under Finder).
class WorkspaceDocumentAccess
  def self.openable_document_for(user, document_id, content_type:)
    doc = Document.find_by(id: document_id.to_i)
    return nil unless doc&.file?
    return nil unless doc.parent_id
    return nil unless FinderListedFolders.user_folders(user).exists?(doc.parent_id)
    return nil if content_type.present? && doc.content_type.to_s != content_type.to_s

    doc
  end
end
