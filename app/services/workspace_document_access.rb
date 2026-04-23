# frozen_string_literal: true

# Documents the user may open from the workspace into linked apps (files under Finder 2).
class WorkspaceDocumentAccess
  def self.openable_document_for(user, document_id, content_type:)
    doc = Document.find_by(id: document_id.to_i)
    return nil unless doc&.file?

    in_finder_sections = Apps::FinderController.document_in_any_finder_section?(user, doc)
    in_embedded = document_in_embedded_subtree?(user, doc)
    return nil unless in_finder_sections || in_embedded
    return nil if content_type.present? && doc.content_type.to_s != content_type.to_s

    doc
  end

  def self.document_in_embedded_subtree?(user, doc)
    root = FinderListedFolders.workspace_root_for(user)
    return false unless root && doc

    embedded = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
    return false unless embedded

    Apps::FinderController.document_in_finder_subtree?(embedded, doc)
  rescue StandardError
    false
  end
end
