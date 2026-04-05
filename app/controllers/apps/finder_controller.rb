# frozen_string_literal: true

module Apps
  class FinderController < BaseController
    def show
      load_browser_data
      render layout: false if turbo_frame_request?
    end

    def folders_json
      folders = FinderListedFolders.user_folders(current_user)
      render json: { folders: folders.map { |f| { id: f.id, title: f.title } } }
    end

    def folder_files
      return render json: { error: "folder_id required" }, status: :bad_request if params[:folder_id].blank?

      folder_id = params[:folder_id].to_i
      folders = FinderListedFolders.user_folders(current_user).to_a
      folder = folders.find { |f| f.id == folder_id }
      unless folder
        return render json: { error: "Folder not found" }, status: :not_found
      end

      files = folder.children.files.order(Arel.sql("LOWER(title) ASC"))
      render json: {
        files: files.map do |f|
          {
            id: f.id,
            display_title: helpers.finder_document_display_title(f.title),
            content_type: f.content_type,
            icon_html: helpers.material_symbol_icon(
              helpers.finder_file_icon_for_content_type(f.content_type),
              size: :xs
            ).to_s
          }
        end
      }
    end

    def create_folder
      parent = FinderListedFolders.finder_folder_for(current_user)
      unless parent
        return render json: { error: "Workspace not ready." }, status: :unprocessable_entity
      end

      folder = Document.new(is_folder: true, parent: parent, title: next_folder_name)

      unless folder.save
        if request.xhr? || request.format.json?
          render json: { error: "Could not create folder." }, status: :unprocessable_entity
          return
        end

        redirect_to apps_finder_path(frame_params), alert: "Could not create folder."
        return
      end

      redirect_path = apps_finder_path(frame_params.merge(folder_id: folder.id, rename_folder_id: folder.id))

      if request.xhr? || request.format.json?
        render json: {
          ok: true,
          folder_id: folder.id,
          name: folder.title,
          redirect_url: redirect_path
        }
        return
      end

      redirect_to redirect_path
    end

    private

    def load_browser_data
      @folders = FinderListedFolders.user_folders(current_user).to_a
      @selected_folder = if params[:folder_id].present?
        @folders.find { |folder| folder.id == params[:folder_id].to_i }
      end
      @selected_folder ||= @folders.first
      @files = @selected_folder ? @selected_folder.children.files.order(Arel.sql("LOWER(title) ASC")) : []
    end

    def next_folder_name
      parent = FinderListedFolders.finder_folder_for(current_user)
      names = parent ? parent.children.folders.pluck(:title).map(&:to_s) : []
      base = "Untitled Folder"
      return base unless names.include?(base)

      nums = names
        .map { |name| name[/^#{Regexp.escape(base)} (\d+)$/, 1]&.to_i }
        .compact
        .select { |num| num >= 2 }
        .uniq
        .sort

      expected = 2
      nums.each do |num|
        return "#{base} #{expected}" if num != expected

        expected += 1
      end

      "#{base} #{expected}"
    end

    def frame_params
      frame_id = params[:frame_id].to_s.strip
      return {} if frame_id.blank?

      { frame_id: frame_id }
    end
  end
end
