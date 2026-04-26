# frozen_string_literal: true

class Current < ActiveSupport::CurrentAttributes
  attribute :user, :suppress_document_disk_sync, :suppress_workspace_user_sync
end
