module ApplicationHelper
	def slug_to_title(slug)
		return "New Folder" if slug.blank?

		cleaned = slug.to_s.tr("_", "-").gsub(/-+/, "-").sub(/\A-/, "").sub(/-\z/, "")
		parts = cleaned.split("-")
		return "New Folder" if parts.empty?

		if parts.last.to_s.match?(/\A\d+\z/)
			number = parts.pop
			base = parts.map(&:capitalize).join(" ")
			base = "Folder" if base.blank?
			"#{base} #{number}"
		else
			parts.map(&:capitalize).join(" ")
		end
	end

	def title_to_slug(title)
		normalized = title.to_s.strip.parameterize
		normalized.presence || "new-folder"
	end
end
