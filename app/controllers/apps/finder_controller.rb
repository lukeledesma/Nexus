# frozen_string_literal: true

require "set"

module Apps
  class FinderController < BaseController
    skip_before_action :sync_from_disk
    FINDER_LAST_SECTION_STATE_KEY = "finder.last_section"

    DEFAULT_SECTION_KEY = "documents"
    TASKS_SECTION_TITLE = "Tasks"
    FAVORITES_SECTION_TITLE = "Favorites"
    QUARTZ_SECTION_TITLE = "Quartz"
    TRASH_SECTION_TITLE = "Trash"
    FINDER_SECTION_DEFINITIONS = [
      { key: "documents", title: TASKS_SECTION_TITLE, icon: "task_checklist" },
      { key: "quartz", title: QUARTZ_SECTION_TITLE, icon: "sticky_note", icon_svg: true, icon_partial: "quartz_icon" },
      { key: "images", title: "Images", icon: "wallpaper" },
      { key: "audio", title: "Audio", icon: "graphic_eq" },
      { key: "alchemy", title: "Alchemy", icon: "apps", icon_svg: true, icon_partial: "alchemy_icon" },
      { key: "favorites", title: FAVORITES_SECTION_TITLE, icon: "star_rounded" },
      { key: "trash", title: TRASH_SECTION_TITLE, icon: "delete" }
    ].freeze
    READ_ONLY_FRAME_CONFIG = {
      "tasks-pane" => { section_key: "documents", content_type: "task_list", allow_save: true },
      "quartz-pane" => {
        section_key: "quartz",
        content_type: "note",
        allow_save: true
      },
      "audio-pane" => { section_key: "audio", content_type: "asset", allow_save: false },
      "images-pane" => { section_key: "images", content_type: "asset", allow_save: false },
      "alchemy-pane" => { section_key: "alchemy", content_type: "alchemy_tag_list", allow_save: true }
    }.freeze
    # Matches file kinds with an opener app (see finder_browser_controller.js).
    LINKED_FILE_CONTENT_TYPES = %w[note task_list asset alchemy_tag_list].freeze

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
          .reject { |d| ["favorites", "trash"].include?(d[:key]) }
          .find { |d| d[:title].casecmp?(section_title) }&.fetch(:key, nil)
      end

      def workspace_root_folder(user)
        FinderListedFolders.workspace_root_for(user)
      end

      def workspace_section_roots(user)
        roots = FinderWorkspaceInitializer.section_roots_for(user)
        return roots if roots.present?

        FinderWorkspaceInitializer.ensure_for_user!(user)
      end

      # Legacy alias retained for older callers; Finder now defaults to Documents.
      def workspace_finder_root_folder(user)
        workspace_section_root(user, DEFAULT_SECTION_KEY)
      end

      def workspace_section_root(user, section_key)
        workspace_section_roots(user)[normalized_section_key(section_key)]
      end

      def workspace_trash_root(user)
        FinderWorkspaceInitializer.ensure_for_user!(user)
        root = workspace_root_folder(user)
        return nil unless root

        finder = root.children.folders.find { |d| d.title.to_s.strip.casecmp?("Finder") }
        finder ||= root.children.create!(is_folder: true, title: "Finder")

        folder = finder.children.folders.find { |d| d.title.to_s.strip.casecmp?(TRASH_SECTION_TITLE) } ||
          finder.children.create!(is_folder: true, title: TRASH_SECTION_TITLE)
        ensure_folder_storage_path!(finder, folder)
        folder
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
        root = workspace_root_folder(user)
        finder = root&.children&.folders&.find { |d| d.title.to_s.strip.casecmp?("Finder") }
        folder = finder&.children&.folders&.find { |d| d.title.to_s.strip.casecmp?(TRASH_SECTION_TITLE) }
        ensure_folder_storage_path!(finder, folder) if finder && folder
        folder
      end

      def ensure_folder_storage_path!(finder_root, folder)
        return unless finder_root&.folder? && folder&.folder?
        return if folder.storage_path.to_s.strip.present?

        parent_path = finder_root.storage_path.to_s.strip
        return if parent_path.blank?

        relative = File.join(parent_path, folder.title.to_s)
        FileUtils.mkdir_p(DocumentStorageSyncLite.storage_root.join(relative))
        folder.update_column(:storage_path, relative)
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
    end

    def show
      FinderWorkspaceInitializer.ensure_for_user!(current_user)

      @finder_read_only = params[:mode].to_s == "save_as"
      @finder_single_section_mode = false
      frame_id = params[:frame_id].to_s
      read_only_config = READ_ONLY_FRAME_CONFIG[frame_id]
      if read_only_config.nil?
        read_only_config = READ_ONLY_FRAME_CONFIG["tasks-pane"] if frame_id.start_with?("task-spawn-")
        read_only_config = READ_ONLY_FRAME_CONFIG["quartz-pane"] if frame_id.start_with?("quartz-spawn-")
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
            self.class.normalized_section_key(params[:section].presence || last_finder_section_key)
        end

      persist_last_finder_section_key(@section_key) unless @finder_single_section_mode

      @finder_sections = self.class.workspace_section_definitions.map do |definition|
        definition.merge(folder: section_roots[definition[:key]])
      end

      workspace_root = self.class.workspace_root_folder(current_user)
      @root_folder =
        if @section_key == "favorites"
          workspace_root
        elsif @section_key == "trash"
          self.class.workspace_trash_root(current_user)
        else
          section_roots[@section_key]
        end
      @finder_section_label = self.class.finder_section_label(@section_key)
      @finder_empty_message = nil
      @tree_nodes = []
      @browse_folder = nil
      @finder_search_mode = !@finder_read_only && params[:search_mode].to_s == "1"
      @finder_search_query = @finder_search_mode ? params[:q].to_s.strip : ""
      @finder_search_active = @finder_search_mode
      @finder_search_seed_rows = []

      unless @root_folder
        @finder_empty_message =
          "Your workspace folders could not be found. Set a username so Nexus can create your workspace, then open Finder again."
        render layout: finder_embed_layout?
        return
      end

      if @finder_search_mode
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @finder_search_seed_rows = build_global_search_rows(section_roots)
        @tree_nodes = []
      elsif @section_key == "favorites"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_favorites_tree_nodes(@root_folder)
      elsif @section_key == "trash"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_trash_tree_nodes(@root_folder)
      else
        @browse_folder = resolve_browse_folder(@root_folder, params[:browse_id])
        allowed_folder_ids = finder_folder_ids_in_subtree(@root_folder)
        extra_expanded = Set.new(parse_expanded_folder_ids_param) & allowed_folder_ids
        @expanded_folder_ids = expanded_folder_ids_on_path(@root_folder, @browse_folder) | extra_expanded
        @tree_nodes = build_tree_nodes(@root_folder)
      end

      @linked_app_save_icon =
        if @finder_read_only
          if frame_id == "quartz-pane"
            "quartz_svg"
          elsif frame_id == "alchemy-pane"
            "alchemy_svg"
          elsif read_only_content_type
            helpers.finder_file_icon_for_content_type(read_only_content_type, section_key: @section_key).to_s
          else
            "file_document"
          end
        end

      @open_in_app_content_types =
        if @finder_read_only
          read_only_content_type.present? ? [ read_only_content_type.to_s ] : []
        else
          %w[note task_list asset alchemy_tag_list]
        end

      render layout: finder_embed_layout?
    end

    private

    def finder_embed_layout?
      params[:embed].to_s == "iframe" ? "finder_embed" : false
    end

    def last_finder_section_key
      state = current_user.user_app_states.find_by(key: FINDER_LAST_SECTION_STATE_KEY)
      value = state&.data
      if value.is_a?(Hash)
        self.class.normalized_section_key(value["section_key"] || value[:section_key])
      else
        self.class.normalized_section_key(value)
      end
    rescue StandardError
      DEFAULT_SECTION_KEY
    end

    def persist_last_finder_section_key(section_key)
      UserAppState.put(
        user: current_user,
        key: FINDER_LAST_SECTION_STATE_KEY,
        value: { section_key: self.class.normalized_section_key(section_key) }
      )
    rescue StandardError
      nil
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
      nodes = []
      if favorites_column_available?
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

        docs = Document.find_by_sql(Document.sanitize_sql_array([ sql, workspace_root.id ]))
        nodes = docs.map { |doc| tree_node_for_favorite(doc) }
      end
      nodes
    end

    def build_global_search_rows(section_roots)
      nodes = []
      section_roots.each do |key, root|
        next if root.blank?
        next if [ "favorites", "trash" ].include?(key.to_s)

        descendant_documents_for_finder_tree(root).each do |doc|
          next unless doc.file?

          nodes << tree_node_for_file(doc)
        end
      end
      nodes.sort_by { |row| row[:title].to_s.downcase }
    end

    def finder_search_row_payload(doc, origin_section_key:)
      tree_node_for_file(doc)
    end

    def build_trash_tree_nodes(trash_root)
      return [] unless trash_root

      descendant_documents_for_finder_tree(trash_root)
        .select(&:file?)
        .sort_by { |doc| doc.title.to_s.downcase }
        .map { |doc| tree_node_for_trash(doc) }
    end

    def tree_node_for_favorite(doc)
      origin_key = self.class.origin_section_key_from_storage_path(doc.storage_path)
      tree_node_for_file(doc).merge(
        is_favorited: true,
        origin_section_key: origin_key
      )
    end

    def tree_node_for_trash(doc)
      tree_node_for_file(doc).merge(
        in_trash: true,
        is_favorited: false,
        origin_section_key: nil
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
      Document.find_by_sql(Document.sanitize_sql_array([ sql, root_folder.id ]))
    end

    def build_tree_nodes_from_rows(root_folder, rows)
      children_by_parent = Hash.new { |h, k| h[k] = [] }
      rows.each { |d| children_by_parent[d.parent_id] << d }
      children_by_parent.each_value do |list|
        list.sort_by! { |d| [ d.folder? ? 0 : 1, d.title.to_s.downcase ] }
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
          is_favorited: favorited_flag_for(doc)
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
        when "alchemy_tag_list"
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
        is_favorited: favorited_flag_for(doc),
        # Always include thumbnail_url for image assets — no disk stat() on every render.
        # The thumbnail action returns 404 if the file doesn't exist; the img onerror
        # handler in the template falls back to the file icon gracefully.
        thumbnail_url: file_kind == "image" ? helpers.thumbnail_document_path(doc.id) : nil
      }
    end

    def favorited_flag_for(doc)
      return doc.is_favorited? if doc.respond_to?(:is_favorited?)

      false
    end

    def favorites_column_available?
      Document.column_names.include?("is_favorited")
    rescue StandardError
      false
    end
  end
end
