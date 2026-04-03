# frozen_string_literal: true

# Keep workspace root present; per-user workspace files are provisioned lazily
# by controllers/services when a user session is active.
FileUtils.mkdir_p(Rails.root.join("storage", "workspace"))
