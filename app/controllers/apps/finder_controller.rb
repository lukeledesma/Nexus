# frozen_string_literal: true

require "set"

module Apps
  class FinderController < BaseController
    skip_before_action :sync_from_disk
    FINDER_LAST_SECTION_STATE_KEY = "finder.last_section"

    DEFAULT_SECTION_KEY = "storage"
    STORAGE_SECTION_TITLE = "Storage"
    DESKTOP_SECTION_TITLE = "Desktop"
    DOCUMENTS_SECTION_TITLE = "Documents"
    PICTURES_SECTION_TITLE = "Pictures"
    MUSIC_SECTION_TITLE = "Music"
    FAVORITES_SECTION_TITLE = "Favorites"
    TRASH_SECTION_TITLE = "Trash"
    TASKS_SECTION_TITLE = "Tasks"
    QUARTZ_SECTION_TITLE = "Quartz"
    IMAGES_SECTION_TITLE = "Images"
    AUDIO_SECTION_TITLE = "Audio"
    ALCHEMY_SECTION_TITLE = "Alchemy"
    LEGACY_SECTION_KEY_ALIASES = {
      "storage" => "storage",
      "desktop" => "storage",
      "documents" => "storage",
      "pictures" => "storage",
      "music" => "storage",
      "tasks" => "storage",
      "quartz" => "storage",
      "images" => "storage",
      "audio" => "storage",
      "alchemy" => "storage"
    }.freeze
    LEGACY_SECTION_TITLE_ALIASES = {
      STORAGE_SECTION_TITLE.downcase => "storage",
      DESKTOP_SECTION_TITLE.downcase => "storage",
      DOCUMENTS_SECTION_TITLE.downcase => "storage",
      PICTURES_SECTION_TITLE.downcase => "storage",
      MUSIC_SECTION_TITLE.downcase => "storage",
      TASKS_SECTION_TITLE.downcase => "storage",
      QUARTZ_SECTION_TITLE.downcase => "storage",
      IMAGES_SECTION_TITLE.downcase => "storage",
      AUDIO_SECTION_TITLE.downcase => "storage",
      ALCHEMY_SECTION_TITLE.downcase => "storage"
    }.freeze
    FINDER_SECTION_DEFINITIONS = [
      { key: "storage", title: STORAGE_SECTION_TITLE, icon_svg: true, icon_partial: "hard_drive_icon" },
      { key: "favorites", title: FAVORITES_SECTION_TITLE, icon: "star_rounded" },
      { key: "trash", title: TRASH_SECTION_TITLE, icon: "delete" }
    ].freeze
    READ_ONLY_FRAME_CONFIG = {
      "tasks-pane" => { section_key: "storage", content_type: "task_list", allow_save: true },
      "quartz-pane" => {
        section_key: "storage",
        content_type: "note",
        allow_save: true
      },
      "audio-pane" => { section_key: "storage", content_type: "asset", allow_save: false },
      "images-pane" => { section_key: "storage", content_type: "asset", allow_save: false },
      "alchemy-pane" => { section_key: "storage", content_type: "alchemy_tag_list", allow_save: true }
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

        # Allow pinned folder keys to pass through without normalization
        return key if key.start_with?("pinned_")

        key = LEGACY_SECTION_KEY_ALIASES.fetch(key, key)
        workspace_section_definitions.find { |item| item[:key] == key }&.fetch(:key, DEFAULT_SECTION_KEY) || DEFAULT_SECTION_KEY
      end

      def finder_section_label(section_key)
        key = normalized_section_key(section_key)
        workspace_section_definitions.find { |item| item[:key] == key }&.fetch(:title, STORAGE_SECTION_TITLE) || STORAGE_SECTION_TITLE
      end

      # Derives the originating section key from a document's storage_path.
      # Path formats:
      # - "Finder/SectionTitle/..." (current)
      # - "Username/Finder/SectionTitle/..." (legacy)
      # Returns nil when the path doesn't match or the section is unknown.
      def origin_section_key_from_storage_path(storage_path)
        parts = storage_path.to_s.split("/").reject(&:blank?)
        return nil if parts.empty?

        first = parts[0].to_s.strip
        second = parts[1].to_s.strip
        third = parts[2].to_s.strip

        return "trash" if first.casecmp?(TRASH_SECTION_TITLE)
        return nil if first.casecmp?("Embedded")
        return "storage" if LEGACY_SECTION_TITLE_ALIASES.key?(first.downcase)

        if FinderListedFolders.finder_title_match?(first, STORAGE_SECTION_TITLE)
          return "trash" if second.casecmp?(TRASH_SECTION_TITLE)
          return nil if second.casecmp?("Embedded")
          return "storage" if second.blank? || LEGACY_SECTION_TITLE_ALIASES.key?(second.downcase)
        end

        if FinderListedFolders.finder_title_match?(second, STORAGE_SECTION_TITLE)
          return "trash" if third.casecmp?(TRASH_SECTION_TITLE)
          return nil if third.casecmp?("Embedded")
          return "storage" if third.blank? || LEGACY_SECTION_TITLE_ALIASES.key?(third.downcase)
        end

        nil
      end

      def workspace_root_folder(user)
        FinderListedFolders.workspace_root_for(user)
      end

      def workspace_section_roots(user)
        roots = FinderWorkspaceInitializer.section_roots_for(user)
        meaningful_roots = roots.except("favorites")
        return roots if meaningful_roots.present?

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
        finder_root = workspace_root_folder(user)
        return nil unless finder_root

        folder = finder_root.children.folders.find { |d| /\A#{Regexp.escape(TRASH_SECTION_TITLE)}(?:\s+\d+)?\z/i.match?(d.title.to_s.strip) } ||
          finder_root.children.create!(is_folder: true, title: TRASH_SECTION_TITLE)
        ensure_folder_storage_path!(finder_root, folder)
        folder
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
        finder_root = workspace_root_folder(user)
        folder = finder_root&.children&.folders&.find { |d| /\A#{Regexp.escape(TRASH_SECTION_TITLE)}(?:\s+\d+)?\z/i.match?(d.title.to_s.strip) }
        ensure_folder_storage_path!(finder_root, folder) if finder_root && folder
        folder
      end

      def ensure_folder_storage_path!(finder_root, folder)
        return unless finder_root&.folder? && folder&.folder?
        return if folder.storage_path.to_s.strip.present?

        parent_path = finder_root.storage_path.to_s.strip
        relative = parent_path.present? ? File.join(parent_path, folder.title.to_s) : folder.title.to_s
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

      def finder_section_key_for_document(user, doc, section_roots: nil)
        return nil unless doc

        trash_root = section_roots&.[]("trash") || workspace_trash_root(user)
        return "trash" if document_in_finder_subtree?(trash_root, doc)
        return nil if DocumentPolicy.new(user: user, document: doc).in_embedded_subtree?

        root = section_roots&.[]("storage") || workspace_section_root(user, "storage")
        return "storage" if document_in_finder_subtree?(root, doc)

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
      section_roots = FinderWorkspaceInitializer.ensure_for_user!(current_user)
      section_roots = self.class.workspace_section_roots(current_user) if section_roots.blank?

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
      @open_in_app_content_types =
        if @finder_read_only
          read_only_content_type.present? ? [ read_only_content_type.to_s ] : []
        else
          %w[note task_list asset alchemy_tag_list]
        end

      browse_doc = params[:browse_id].present? ? Document.find_by(id: params[:browse_id]) : nil
      @trash_root = section_roots["trash"]

      @section_key =
        if @finder_single_section_mode
          self.class.normalized_section_key(read_only_config[:section_key])
        else
          self.class.finder_section_key_for_document(current_user, browse_doc, section_roots: section_roots) ||
            self.class.normalized_section_key(params[:section].presence || last_finder_section_key)
        end

      persist_last_finder_section_key(@section_key) unless @finder_single_section_mode

      # Build base sections
      base_sections = self.class.workspace_section_definitions.map do |definition|
        definition.merge(folder: section_roots[definition[:key]])
      end

      # Get all pinned folders (recursively) and insert them as sidebar items between Storage and Favorites
      storage_root = section_roots["storage"]
      pinned_folders = storage_root ? gather_pinned_descendants(storage_root) : []
      
      @finder_sections = []
      base_sections.each do |section|
        @finder_sections << section
        # Insert pinned folders after Storage section
        if section[:key] == "storage" && pinned_folders.any?
          pinned_folders.each do |folder|
            @finder_sections << {
              key: "pinned_#{folder.id}",
              title: folder.title,
              icon: "folder",
              folder: folder,
              is_pinned_folder: true
            }
          end
        end
      end

      workspace_root = self.class.workspace_root_folder(current_user)
      @root_folder =
        if @section_key == "favorites"
          workspace_root
        elsif @section_key.to_s.start_with?("pinned_")
          # Extract folder ID from section key and use that folder as root
          folder_id = @section_key.to_s.sub("pinned_", "").to_i
          Document.find_by(id: folder_id)
        elsif @section_key == "trash"
          @trash_root || self.class.workspace_trash_root(current_user)
        else
          section_roots[@section_key]
        end
      @finder_section_label = self.class.finder_section_label(@section_key)
      @finder_empty_message = nil
      @tree_nodes = []
      @browse_folder = nil
      @finder_picker_search_mode = @finder_read_only && read_only_config.present?
      @finder_search_mode = @finder_picker_search_mode || (!@finder_read_only && params[:search_mode].to_s == "1")
      @finder_search_query = @finder_search_mode ? params[:q].to_s.strip : ""
      @finder_search_active = @finder_search_mode
      @finder_search_seed_rows = []

      unless @root_folder
        @finder_empty_message =
          "Your workspace folders could not be found. Reopen Finder to rebuild the workspace layout."
        render layout: finder_embed_layout?
        return
      end

      if @finder_search_mode
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @finder_search_seed_rows =
          if @finder_picker_search_mode
            build_picker_search_rows(@root_folder, @open_in_app_content_types)
          else
            build_global_search_rows(section_roots)
          end
        @tree_nodes = []
      elsif @section_key == "favorites"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_favorites_tree_nodes(@root_folder)
      elsif @section_key == "pinned"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_pinned_tree_nodes(@root_folder)
      elsif @section_key == "trash"
        @browse_folder = @root_folder
        @expanded_folder_ids = Set.new
        @tree_nodes = build_trash_tree_nodes(@root_folder)
      else
        @browse_folder = resolve_browse_folder(@root_folder, params[:browse_id])
        visible_rows = visible_descendant_documents_for_tree(@root_folder)
        allowed_folder_ids = finder_folder_ids_in_subtree(@root_folder, visible_rows)
        extra_expanded = Set.new(parse_expanded_folder_ids_param) & allowed_folder_ids
        @expanded_folder_ids = expanded_folder_ids_on_path(@root_folder, @browse_folder) | extra_expanded
        @tree_nodes = build_tree_nodes_from_rows(@root_folder, visible_rows)
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

      render layout: finder_embed_layout?
    end

    def toggle_pin
      document_id = params[:document_id]
      unless document_id
        return render json: { error: "Document ID required" }, status: :bad_request
      end

      document = Document.find_by(id: document_id)
      unless document
        return render json: { error: "Document not found" }, status: :not_found
      end

      begin
        document.update!(is_pinned: !document.is_pinned)
        render json: { success: true, is_pinned: document.is_pinned }
      rescue StandardError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end
    end

    private

    # Recursively gather all pinned folders from a given parent (used for sidebar generation)
    def gather_pinned_descendants(parent)
      result = []
      parent.children.where(is_folder: true).each do |child|
        result << child if child.is_pinned
        result.concat(gather_pinned_descendants(child))
      end
      result.sort_by { |f| f.title.to_s.downcase }
    end

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

    def finder_folder_ids_in_subtree(root_folder, rows = nil)
      source_rows = rows || visible_descendant_documents_for_tree(root_folder)
      Set.new(source_rows.select(&:folder?).map(&:id))
    end

    def finder_folder_for(user)
      self.class.workspace_section_root(user, @section_key)
    end

    def resolve_browse_folder(root_folder, browse_id)
      return root_folder if browse_id.blank?

      doc = Document.find_by(id: browse_id)
      return root_folder unless doc&.folder?
      return root_folder unless self.class.document_in_finder_subtree?(root_folder, doc)
      return root_folder if hidden_root_subtree_document?(root_folder, doc)

      doc
    end

    def build_tree_nodes(root_folder)
      rows = visible_descendant_documents_for_tree(root_folder)
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

    def build_pinned_tree_nodes(storage_root)
      nodes = []
      # Find all pinned folders at the top level of storage
      pinned_folders = storage_root.children.folders.where(is_pinned: true).order(:title)
      nodes = pinned_folders.map { |doc| tree_node_for_folder(doc) }
      nodes
    end



    def build_global_search_rows(section_roots)
      nodes = []
      section_roots
        .except("favorites", "trash")
        .values
        .compact
        .uniq(&:id)
        .each do |root|
        visible_descendant_documents_for_tree(root).each do |doc|
          next unless doc.file?

          nodes << tree_node_for_file(doc)
        end
      end
      nodes.sort_by { |row| row[:title].to_s.downcase }
    end

    def build_picker_search_rows(root_folder, allowed_content_types)
      allowed = Array(allowed_content_types).map(&:to_s).to_set
      return [] if root_folder.blank? || allowed.empty?

      visible_descendant_documents_for_tree(root_folder)
        .select(&:file?)
        .select { |doc| allowed.include?(doc.content_type.to_s) }
        .sort_by { |doc| doc.title.to_s.downcase }
        .map { |doc| tree_node_for_file(doc) }
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

    def visible_descendant_documents_for_tree(root_folder)
      rows = descendant_documents_for_finder_tree(root_folder)
      hidden_root_ids = hidden_root_folder_ids_for_tree(root_folder)
      return rows if hidden_root_ids.empty?

      hidden_ids = Set.new(hidden_root_ids)
      loop do
        before = hidden_ids.size
        rows.each do |doc|
          hidden_ids.add(doc.id) if hidden_ids.include?(doc.parent_id)
        end
        break if hidden_ids.size == before
      end

      rows.reject { |doc| hidden_ids.include?(doc.id) }
    end

    def hidden_root_folder_ids_for_tree(root_folder)
      ids = []
      trash_root = @trash_root || self.class.workspace_trash_root(current_user)
      ids << trash_root.id if trash_root&.parent_id == root_folder.id
      embedded_root = root_folder.children.folders.find { |doc| doc.title.to_s.strip.casecmp?("Embedded") }
      ids << embedded_root.id if embedded_root
      ids.compact
    end

    def hidden_root_subtree_document?(root_folder, doc)
      hidden_root_folder_ids_for_tree(root_folder).any? do |hidden_id|
        hidden_root = Document.find_by(id: hidden_id)
        self.class.document_in_finder_subtree?(hidden_root, doc)
      end
    end

    def build_tree_nodes_from_rows(root_folder, rows)
      children_by_parent = Hash.new { |h, k| h[k] = [] }
      rows.each { |d| children_by_parent[d.parent_id] << d }
      children_by_parent.each_value do |list|
        list.sort_by! { |d| [ d.folder? ? 0 : 1, d.title.to_s.downcase ] }
      end
      direct = children_by_parent[root_folder.id] || []
      direct.map { |d| tree_node_from_doc(d, children_by_parent, root_folder.id) }
    end

    def tree_node_from_doc(doc, children_by_parent, root_folder_id = nil)
      if doc.folder?
        kids = children_by_parent[doc.id] || []
        sf, fi = kids.partition(&:folder?)
        {
          kind: :folder,
          id: doc.id,
          title: doc.title.to_s,
          writable: !doc.protected_workspace_structure?,
          children: sf.map { |c| tree_node_from_doc(c, children_by_parent, root_folder_id) } + fi.map { |f| tree_node_for_file(f) },
          is_favorited: favorited_flag_for(doc),
          is_pinned: doc.is_pinned,
          is_top_level: root_folder_id.present? && doc.parent_id == root_folder_id
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

    def tree_node_for_folder(doc)
      # Helper method to build tree nodes for folders (used in pinned section)
      {
        kind: :folder,
        id: doc.id,
        title: helpers.finder_document_display_title(doc.title),
        storage_name: doc.title.to_s,
        writable: !doc.protected_workspace_structure?,
        is_pinned: doc.is_pinned,
        is_top_level: true,
        children: []
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
