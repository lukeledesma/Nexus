# frozen_string_literal: true

class DocumentPolicy
  attr_reader :user, :document

  def initialize(user:, document:)
    @user = user
    @document = document
  end

  def file?
    document&.file?
  end

  def folder?
    document&.folder?
  end

  def user_workspace_root?
    document&.user_workspace_root?
  end

  def protected_workspace_structure?
    document&.protected_workspace_structure?
  end

  def in_finder_section?
    return false unless user && document

    Apps::FinderController.document_in_any_finder_section?(user, document)
  end

  def in_embedded_subtree?
    return false unless user && document

    root = FinderListedFolders.workspace_root_for(user)
    return false unless root

    embedded = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("embedded") }
    return false unless embedded

    Apps::FinderController.document_in_finder_subtree?(embedded, document)
  rescue StandardError
    false
  end

  def can_view?
    file? && (in_finder_section? || in_embedded_subtree?)
  end

  def can_open_in_app?(content_type:, section_key: nil, allow_embedded: true)
    return false unless can_view?
    return false if content_type.present? && document.content_type.to_s != content_type.to_s

    if section_key.present?
      root = Apps::FinderController.workspace_section_root(user, section_key)
      in_section = root && Apps::FinderController.document_in_finder_subtree?(root, document)
      return true if in_section
      return allow_embedded && in_embedded_subtree?
    end

    true
  end

  def can_save_into_folder?
    folder? && in_finder_section?
  end

  def can_move_folder?
    folder? && !user_workspace_root? && !protected_workspace_structure? && in_finder_section?
  end

  def can_move_file?
    file? && in_finder_section?
  end

  def can_upload_to_folder?(iimage_folder_id: nil)
    return false unless folder?
    return false if protected_workspace_structure?

    in_finder_section? || (iimage_folder_id.present? && document.id == iimage_folder_id)
  end

  def can_rename?
    !user_workspace_root? && !protected_workspace_structure?
  end

  def can_delete?
    !user_workspace_root? && !protected_workspace_structure?
  end

  def can_toggle_favorite?(favorites_available:)
    favorites_available && file? && !user_workspace_root?
  end
end
