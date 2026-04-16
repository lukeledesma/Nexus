# frozen_string_literal: true

require "set"

module Apps
  class FinderController < BaseController
    FINDER_WORKSPACE_FOLDER_TITLE = "Finder"
    # Matches app windows that handle `app-window:open` with a document (see finder_browser_controller.js).
    LINKED_FILE_CONTENT_TYPES = %w[note task_list asset].freeze

    class << self
      # Workspace Finder folder document (child of user root), or nil if there is no workspace root.
      def workspace_finder_root_folder(user)
        root = FinderListedFolders.workspace_root_for(user)
        return nil unless root

        existing = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(FINDER_WORKSPACE_FOLDER_TITLE) }
        return existing if existing

        root.children.create!(is_folder: true, title: FINDER_WORKSPACE_FOLDER_TITLE)
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
        root = FinderListedFolders.workspace_root_for(user)
        return nil unless root

        root.children.folders.find { |d| d.title.to_s.strip.casecmp?(FINDER_WORKSPACE_FOLDER_TITLE) }
      end

      # True if +doc+ is +finder_root+ or nested under it (walk ancestors).
      def document_in_finder_subtree?(finder_root, doc)
        return false unless finder_root && doc

        p = doc
        while p
          return true if p.id == finder_root.id
          p = p.parent
        end
        false
      end
    end

    def show
      @finder_read_only = params[:mode].to_s == "save_as"

      @root_folder = finder_folder_for(current_user)
      @finder_empty_message = nil
      @tree_nodes = []
      @browse_folder = nil
      unless @root_folder
        @finder_empty_message =
          "Your workspace folder could not be found. Set a username so Nexus can create your workspace, then open Finder again."
        render layout: finder_embed_layout?
        return
      end

      @browse_folder = resolve_browse_folder(@root_folder, params[:browse_id])
      allowed_folder_ids = finder_folder_ids_in_subtree(@root_folder)
      extra_expanded = Set.new(parse_expanded_folder_ids_param) & allowed_folder_ids
      @expanded_folder_ids = expanded_folder_ids_on_path(@root_folder, @browse_folder) | extra_expanded
      @tree_nodes = build_tree_nodes(@root_folder)

      @singular_save_icon =
        if @finder_read_only
          ct = SingularSaveToDocument::FRAME_MAP[params[:frame_id].to_s]&.[](:content_type)
          ct ? helpers.finder_file_icon_for_content_type(ct).to_s : "file_document"
        end

      @open_in_app_content_types =
        if @finder_read_only
          ct = SingularSaveToDocument::FRAME_MAP[params[:frame_id].to_s]&.[](:content_type)
          ct.present? ? [ct.to_s] : []
        else
          %w[task_list asset]
        end

      render layout: finder_embed_layout?
    end

    private

    def finder_embed_layout?
      params[:embed].to_s == "iframe" ? "finder_embed" : false
    end

    def expanded_folder_ids_on_path(root_folder, browse_folder)
      ids = Set.new
      return ids unless browse_folder

      doc = browse_folder
      while doc && doc.id != root_folder.id
        ids.add(doc.id)
        doc = doc.parent
      end
      ids
    end

    def parse_expanded_folder_ids_param
      raw = params[:expanded_ids]
      return [] if raw.blank?

      parts =
        if raw.is_a?(Array)
          raw.flat_map { |x| x.to_s.split(",") }
        else
          raw.to_s.split(",")
        end
      parts.filter_map { |s| Integer(s, 10) }
    end

    def finder_folder_ids_in_subtree(root_folder)
      Set.new(descendant_documents_for_finder_tree(root_folder).select(&:folder?).map(&:id))
    end

    def finder_folder_for(user)
      self.class.workspace_finder_root_folder(user)
    end

    def resolve_browse_folder(root_folder, browse_id)
      return root_folder if browse_id.blank?

      doc = Document.find_by(id: browse_id)
      return root_folder unless doc&.folder?
      return root_folder unless self.class.document_in_finder_subtree?(root_folder, doc)

      doc
    end

    def build_tree_nodes(root_folder)
      rows = descendant_documents_for_finder_tree(root_folder)
      build_tree_nodes_from_rows(root_folder, rows)
    end

    def descendant_documents_for_finder_tree(root_folder)
      sql = <<~SQL.squish
        WITH RECURSIVE subtree AS (
          SELECT documents.*
          FROM documents
          WHERE parent_id = ?
          UNION ALL
          SELECT d.*
          FROM documents d
          INNER JOIN subtree t ON d.parent_id = t.id
        )
        SELECT * FROM subtree
      SQL
      Document.find_by_sql(Document.sanitize_sql_array([sql, root_folder.id]))
    end

    def build_tree_nodes_from_rows(root_folder, rows)
      children_by_parent = Hash.new { |h, k| h[k] = [] }
      rows.each { |d| children_by_parent[d.parent_id] << d }
      children_by_parent.each_value do |list|
        list.sort_by! { |d| [d.folder? ? 0 : 1, d.title.to_s.downcase] }
      end
      direct = children_by_parent[root_folder.id] || []
      direct.map { |d| tree_node_from_doc(d, children_by_parent) }
    end

    def tree_node_from_doc(doc, children_by_parent)
      if doc.folder?
        kids = children_by_parent[doc.id] || []
        sf, fi = kids.partition(&:folder?)
        {
          kind: :folder,
          id: doc.id,
          title: doc.title.to_s,
          writable: !doc.protected_workspace_structure?,
          children: sf.map { |c| tree_node_from_doc(c, children_by_parent) } + fi.map { |f| tree_node_for_file(f) }
        }
      else
        tree_node_for_file(doc)
      end
    end

    def tree_node_for_file(doc)
      raw_title = doc.title.to_s
      ext =
        if doc.storage_path.present?
          File.extname(doc.storage_path.to_s).downcase
        else
          File.extname(raw_title).downcase
        end
      {
        kind: :file,
        id: doc.id,
        title: helpers.finder_document_display_title(doc.title),
        storage_name: doc.title.to_s,
        content_type: doc.content_type.to_s,
        source_extension: ext,
        writable: !doc.protected_workspace_structure?,
        has_linked_app: LINKED_FILE_CONTENT_TYPES.include?(doc.content_type.to_s)
      }
    end
  end
end
