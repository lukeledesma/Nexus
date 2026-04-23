# frozen_string_literal: true

require "set"

module Apps
  class FinderController < BaseController
    DEFAULT_SECTION_KEY = "documents"
    LEGACY_DOCUMENTS_SECTION_TITLE = "Documents"
    TASKS_SECTION_TITLE = "Tasks"
    TIME_CARD_SECTION_TITLE = "Time Card"
    NOTES_SECTION_TITLE = "Notes"
    FAVORITES_SECTION_TITLE = "Favorites"
    FINDER_SECTION_DEFINITIONS = [
      { key: "documents", title: TASKS_SECTION_TITLE, icon: "task_checklist" },
      { key: "notes", title: NOTES_SECTION_TITLE, icon: "edit_note" },
      { key: "time_card", title: TIME_CARD_SECTION_TITLE, icon: "overview" },
      { key: "images", title: "Images", icon: "wallpaper" },
      { key: "audio", title: "Audio", icon: "graphic_eq" },
      { key: "favorites", title: FAVORITES_SECTION_TITLE, icon: "star_rounded" }
    ].freeze
    READ_ONLY_FRAME_CONFIG = {
      "tasks-pane" => { section_key: "documents", content_type: "task_list", allow_save: true },
      "notes-pane" => {
        section_key: "notes",
        content_type: "note",
        allow_save: true
      },
      "time-card-pane" => {
        section_key: "time_card",
        content_type: "note",
        allow_save: true
      },
      "audio-pane" => { section_key: "audio", content_type: "asset", allow_save: false },
      "images-pane" => { section_key: "images", content_type: "asset", allow_save: false }
    }.freeze
    LEGACY_FINDER_WORKSPACE_FOLDER_TITLE = "Finder"
    # Matches file kinds with an opener app (see finder_browser_controller.js).
    LINKED_FILE_CONTENT_TYPES = %w[note task_list asset].freeze

    class << self
      def workspace_section_definitions
        FINDER_SECTION_DEFINITIONS
      end

      def normalized_section_key(raw)
        key = raw.to_s.strip.downcase
        return DEFAULT_SECTION_KEY if key.blank?

        workspace_section_definitions.find { |item| item[:key] == key }&.fetch(:key, DEFAULT_SECTION_KEY) || DEFAULT_SECTION_KEY
      end

      def finder_section_label(section_key)
        key = normalized_section_key(section_key)
        workspace_section_definitions.find { |item| item[:key] == key }&.fetch(:title, TASKS_SECTION_TITLE) || TASKS_SECTION_TITLE
      end

      # Derives the originating section key from a document's storage_path.
      # Path format: "Username/Finder/SectionTitle/..."
      # Returns nil when the path doesn't match or the section is unknown.
      def origin_section_key_from_storage_path(storage_path)
        parts = storage_path.to_s.split("/")
        section_title = parts[2] # index 0=user, 1=Finder, 2=section title
        return nil if section_title.blank?

        workspace_section_definitions
          .reject { |d| d[:key] == "favorites" }
          .find { |d| d[:title].casecmp?(section_title) }&.fetch(:key, nil)
      end

      def workspace_root_folder(user)
        FinderListedFolders.workspace_root_for(user)
      end

      def workspace_section_roots(user)
        root = workspace_root_folder(user)
        return {} unless root

        finder_root = workspace_finder_container!(root)
        return {} unless finder_root

        migrate_documents_section_to_tasks!(finder_root)

        workspace_section_definitions.each_with_object({}) do |definition, out|
          if definition[:key] == "favorites"
            out[definition[:key]] = nil
            next
          end

          title = definition[:title]
          existing = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(title) }
          out[definition[:key]] = existing || finder_root.children.create!(is_folder: true, title: title)
        end
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
        root = workspace_root_folder(user)
        finder_root = workspace_finder_container!(root)
        return {} unless root
        return {} unless finder_root

        workspace_section_definitions.each_with_object({}) do |definition, out|
          if definition[:key] == "favorites"
            out[definition[:key]] = nil
            next
          end

          folder = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(definition[:title]) }
          out[definition[:key]] = folder if folder
        end
      ensure
        finder_root ||= workspace_finder_container!(root)
        roots = workspace_section_definitions.each_with_object({}) do |definition, out|
          if definition[:key] == "favorites"
            out[definition[:key]] = nil
            next
          end

          out[definition[:key]] ||= finder_root&.children&.folders&.find { |d| d.title.to_s.strip.casecmp?(definition[:title]) }
        end
        migrate_legacy_notes_folder_from_tasks!(roots["documents"], roots["notes"])
        migrate_legacy_favorites_folder!(finder_root, roots["documents"])
      end

      # Legacy alias retained for older callers; Finder now defaults to Documents.
      def workspace_finder_root_folder(user)
        workspace_section_root(user, DEFAULT_SECTION_KEY)
      end

      def workspace_section_root(user, section_key)
        workspace_section_roots(user)[normalized_section_key(section_key)]
      end

      def workspace_designated_folder(user, section_key, folder_title)
        root = workspace_section_root(user, section_key)
        return nil unless root

        existing = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(folder_title.to_s.strip) }
        existing || root.children.create!(is_folder: true, title: folder_title)
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
        root = workspace_section_root(user, section_key)
        root&.children&.folders&.find { |d| d.title.to_s.strip.casecmp?(folder_title.to_s.strip) }
      end

      def finder_section_key_for_document(user, doc)
        return nil unless doc

        workspace_section_roots(user).each do |key, root|
          return key if document_in_finder_subtree?(root, doc)
        end
        nil
      end

      def finder_section_root_for_document(user, doc)
        key = finder_section_key_for_document(user, doc)
        return nil unless key

        workspace_section_root(user, key)
      end

      def document_in_any_finder_section?(user, doc)
        finder_section_key_for_document(user, doc).present?
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

      private

      def workspace_finder_container!(root)
        return nil unless root

        finder_root = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(LEGACY_FINDER_WORKSPACE_FOLDER_TITLE) }
        finder_root ||= root.children.create!(is_folder: true, title: LEGACY_FINDER_WORKSPACE_FOLDER_TITLE)

        section_titles = workspace_section_definitions.reject { |definition| definition[:key] == "favorites" }.map { |definition| definition[:title] } + [LEGACY_DOCUMENTS_SECTION_TITLE]
        root.children.folders.each do |folder|
          next if folder.id == finder_root.id
          title = folder.title.to_s.strip
          next if title.casecmp?("Embedded")
          next unless section_titles.any? { |candidate| title.casecmp?(candidate) }

          folder.update!(parent: finder_root)
        end

        finder_root
      rescue StandardError
        nil
      end

      # One-time migration: the legacy "Documents" section root is now named "Tasks".
      # Update the existing folder record so storage sync renames disk paths under storage/workspace/<user>/.
      def migrate_documents_section_to_tasks!(root)
        documents_folder = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(LEGACY_DOCUMENTS_SECTION_TITLE) }
        return unless documents_folder

        tasks_folder = root.children.folders.find { |d| d.title.to_s.strip.casecmp?(TASKS_SECTION_TITLE) }
        return if tasks_folder && tasks_folder.id == documents_folder.id

        if tasks_folder
          Document.transaction do
            documents_folder.children.find_each { |child| child.update!(parent: tasks_folder) }
            documents_folder.destroy!
          end
          return
        end

        documents_folder.update!(title: TASKS_SECTION_TITLE)
      rescue StandardError
        nil
      end

      # One-time migration: old Notes folder nested under Tasks becomes top-level Notes section.
      def migrate_legacy_notes_folder_from_tasks!(tasks_root, notes_root)
        return unless tasks_root&.folder? && notes_root&.folder?

        legacy_notes = tasks_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(NOTES_SECTION_TITLE) }
        return unless legacy_notes

        Document.transaction do
          legacy_notes.children.find_each { |child| child.update!(parent: notes_root) }
          legacy_notes.destroy!
        end
      rescue StandardError
        nil
      end

      # One-time migration: legacy physical "Favorites" folder is deprecated.
      # Keep content accessible by moving children into Tasks and rely on `is_favorited` for the virtual Favorites section.
      def migrate_legacy_favorites_folder!(finder_root, tasks_root)
        return unless finder_root&.folder?

        legacy_favorites = finder_root.children.folders.find { |d| d.title.to_s.strip.casecmp?(FAVORITES_SECTION_TITLE) }
        return unless legacy_favorites

        Document.transaction do
          mark_files_favorited_in_subtree!(legacy_favorites)

          target_parent = tasks_root&.folder? ? tasks_root : finder_root
          legacy_favorites.children.find_each { |child| child.update!(parent: target_parent) }
          legacy_favorites.destroy!
        end
      rescue StandardError
        nil
      end

      def mark_files_favorited_in_subtree!(root)
        stack = [root]
        visited = Set.new

        until stack.empty?
          node = stack.pop
          next unless node
          next if visited.include?(node.id)

          visited.add(node.id)
          node.children.find_each do |child|
            if child.folder?
              stack << child
            else
              child.update!(is_favorited: true)
            end
          end
        end
      end
    end

    def show
      @finder_read_only = params[:mode].to_s == "save_as"
      @finder_single_section_mode = false
      frame_id = params[:frame_id].to_s
      read_only_config = READ_ONLY_FRAME_CONFIG[frame_id]
      if read_only_config.nil?
        read_only_config = READ_ONLY_FRAME_CONFIG["tasks-pane"] if frame_id.start_with?("task-spawn-")
        read_only_config = READ_ONLY_FRAME_CONFIG["notes-pane"] if frame_id.start_with?("note-spawn-")
        read_only_config = READ_ONLY_FRAME_CONFIG["time-card-pane"] if frame_id.start_with?("time-card-spawn-")
        read_only_config = READ_ONLY_FRAME_CONFIG["images-pane"] if frame_id.start_with?("image-spawn-")
      end
      read_only_content_type = read_only_config&.[](:content_type)
      @finder_read_only_can_save = @finder_read_only && read_only_config&.[](:allow_save)
      @finder_single_section_mode = @finder_read_only && read_only_config.present?

      section_roots = self.class.workspace_section_roots(current_user)
      browse_doc = params[:browse_id].present? ? Document.find_by(id: params[:browse_id]) : nil

      @section_key =
        if @finder_single_section_mode
          self.class.normalized_section_key(read_only_config[:section_key])
        else
          self.class.finder_section_key_for_document(current_user, browse_doc) ||
            self.class.normalized_section_key(params[:section])
        end
      @finder_sections = self.class.workspace_section_definitions.map do |definition|
        definition.merge(folder: section_roots[definition[:key]])
      end

      workspace_root = self.class.workspace_root_folder(current_user)
      @root_folder = @section_key == "favorites" ? workspace_root : section_roots[@section_key]
      @finder_section_label = self.class.finder_section_label(@section_key)
      @finder_empty_message = nil
      @tree_nodes = []
      @browse_folder = nil

      unless @root_folder
        @finder_empty_message =
          "Your workspace folders could not be found. Set a username so Nexus can create your workspace, then open Finder again."
        render layout: finder_embed_layout?
        return
      end

      if @section_key == "favorites"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_favorites_tree_nodes(@root_folder)
      else
        @browse_folder = resolve_browse_folder(@root_folder, params[:browse_id])
        allowed_folder_ids = finder_folder_ids_in_subtree(@root_folder)
        extra_expanded = Set.new(parse_expanded_folder_ids_param) & allowed_folder_ids
        @expanded_folder_ids = expanded_folder_ids_on_path(@root_folder, @browse_folder) | extra_expanded
        @tree_nodes = build_tree_nodes(@root_folder)
      end

      @linked_app_save_icon =
        if @finder_read_only
          if read_only_content_type
            helpers.finder_file_icon_for_content_type(read_only_content_type, section_key: @section_key).to_s
          else
            "file_document"
          end
        end

      @open_in_app_content_types =
        if @finder_read_only
          read_only_content_type.present? ? [read_only_content_type.to_s] : []
        else
          %w[note task_list asset]
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
      self.class.workspace_section_root(user, @section_key)
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

    def build_favorites_tree_nodes(workspace_root)
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
        SELECT *
        FROM subtree
        WHERE is_favorited = TRUE AND is_folder = FALSE
        ORDER BY LOWER(title) ASC
      SQL

      docs = Document.find_by_sql(Document.sanitize_sql_array([sql, workspace_root.id]))
      docs.map { |doc| tree_node_for_favorite(doc) }
    end

    def tree_node_for_favorite(doc)
      origin_key = self.class.origin_section_key_from_storage_path(doc.storage_path)
      tree_node_for_file(doc).merge(
        is_favorited: true,
        origin_section_key: origin_key
      )
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
          children: sf.map { |c| tree_node_from_doc(c, children_by_parent) } + fi.map { |f| tree_node_for_file(f) },
          is_favorited: doc.is_favorited?
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
      file_kind = helpers.finder_asset_file_kind_from_extension(ext)
      has_linked_app =
        case doc.content_type.to_s
        when "note"
          true
        when "task_list"
          true
        when "asset"
          file_kind.in?(%w[image audio])
        else
          false
        end
      {
        kind: :file,
        id: doc.id,
        title: helpers.finder_document_display_title(doc.title),
        storage_name: doc.title.to_s,
        content_type: doc.content_type.to_s,
        file_kind: file_kind,
        source_extension: ext,
        writable: !doc.protected_workspace_structure?,
        has_linked_app: has_linked_app,
        is_favorited: doc.is_favorited?
      }
    end
  end
end

