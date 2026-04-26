# frozen_string_literal: true

# Documents the user may open from the workspace into linked apps (files under Finder 2).
class WorkspaceDocumentAccess
  def self.openable_document_for(user, document_id, content_type:, section_key: nil, allow_embedded: true)
    result = Apps::OpenLinkedDocument.call(
      user: user,
      document_id: document_id,
      content_type: content_type,
      section_key: section_key,
      allow_embedded: allow_embedded
    )
    return nil unless result.success?

    result.payload.fetch(:document)
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
