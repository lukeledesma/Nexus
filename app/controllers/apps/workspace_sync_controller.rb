# frozen_string_literal: true

module Apps
  # Pushes in-memory workspace state to storage/workspace (Embedded mirror + Finder documents).
  class WorkspaceSyncController < ApplicationController
    def flush_disk
      username = current_user&.username.to_s.strip
      if username.present?
        ItemStorageSyncLite.sync_all!(username: username)
      else
        ItemStorageSyncLite.sync_all!
      end

      root = FinderListedFolders.finder_folder_for(current_user)
      if root
        stack = [root]
        while (node = stack.pop)
          node.children.files.find_each do |doc|
            next if doc.storage_path.blank?

            DocumentStorageSyncLite.new(doc).update
          rescue StandardError => e
            Rails.logger.error("[WorkspaceSync] document #{doc.id}: #{e.class}: #{e.message}")
          end
          node.children.folders.find_each { |child| stack << child }
        end
      end

      render json: { ok: true }
    end
  end
end
