# frozen_string_literal: true

module Apps
  class FinderController < BaseController
    def show
      load_browser_data
      render layout: false if turbo_frame_request?
    end

    def create_folder
      folder = Document.new(is_folder: true, parent: documents_root_folder, title: next_folder_name)

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
      @folders = documents_root_folder.children.folders.includes(:children).order(Arel.sql("LOWER(title) ASC"))
      @selected_folder = if params[:folder_id].present?
        @folders.find { |folder| folder.id == params[:folder_id].to_i }
      else
        @folders.first
      end
      @files = @selected_folder ? @selected_folder.children.files.order(Arel.sql("LOWER(title) ASC")) : []
    end

    def next_folder_name
      base = "Untitled Folder"
      names = documents_root_folder.children.folders.pluck(:title).map(&:to_s)
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

    def user_root_folder
      name = current_user.username.to_s.strip
      name = current_user.email.to_s.strip if name.blank?
      folder = Document.folders.where(parent_id: nil).where("LOWER(title) = ?", name.downcase).first
      folder ||= Document.create!(is_folder: true, title: name)
      folder
    end

    def documents_root_folder
      root = user_root_folder
      folder = root.children.folders.where("LOWER(title) = ?", "documents").first
      folder ||= root.children.create!(is_folder: true, title: "Documents")
      folder
    end

    def frame_params
      frame_id = params[:frame_id].to_s.strip
      return {} if frame_id.blank?

      { frame_id: frame_id }
    end
  end
end
