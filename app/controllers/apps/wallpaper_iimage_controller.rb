# frozen_string_literal: true

module Apps
  class WallpaperIimageController < BaseController
    def files
      DocumentDiskLoader.sync!

      doc = EmbeddedIimageFolder.document_for(current_user)
      unless doc
        render json: { folder_id: nil, empty: true, files: [], unavailable: true }
        return
      end

      list =
        doc.children.files.where(content_type: "asset").order(Arel.sql("LOWER(title) ASC")).to_a
      files = list.select { |f| EmbeddedIimageFolder.eligible_asset?(f) }

      boot = WorkspaceThemeBoot.payload_for(current_user.username) || {}

      render json: {
        folder_id: doc.id,
        empty: files.empty?,
        files: files.map { |f| serialize_file(f) },
        active_theme_id: boot["active_theme_id"],
        active_theme_name: boot["active_theme_name"],
        wallpaper_background_kind: boot["wallpaper_background_kind"],
        wallpaper_image_document_id: boot["wallpaper_image_document_id"],
        wallpaper_gradient_theme_id: boot["wallpaper_gradient_theme_id"],
        wallpaper_gradient_theme_name: boot["wallpaper_gradient_theme_name"]
      }
    end

    private

    def serialize_file(doc)
      ext = File.extname(doc.storage_path.to_s).downcase
      {
        id: doc.id,
        name: doc.title.to_s,
        ext: ext,
        kind_label: ext == ".png" ? "PNG" : "JPEG"
      }
    end
  end
end
