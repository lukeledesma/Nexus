# frozen_string_literal: true

module MaterialIconsHelper
  SIZE_CLASSES = {
    xs: "material-icon--xs",
    sm: "material-icon--sm",
    md: "material-icon--md",
    lg: "material-icon--lg"
  }.freeze

  # Renders a Material Symbol from app/assets/icons/material-symbol-{slug}-24.svg (fill currentColor).
  # +name+ may be a string or symbol; underscores become hyphens (e.g. :circle_outline → circle-outline).
  def material_symbol_icon(name, size: :md, html_class: nil)
    slug = name.to_s.tr("_", "-")
    path = Rails.root.join("app/assets/icons/material-symbol-#{slug}-24.svg")
    unless path.file?
      raise ArgumentError, "Missing material icon: material-symbol-#{slug}-24.svg" if Rails.env.development? || Rails.env.test?

      return "".html_safe
    end

    svg = File.read(path)
    size_key = size.to_sym
    size_class = SIZE_CLASSES[size_key] || SIZE_CLASSES[:md]
    classes = ["material-icon", size_class, html_class].compact.join(" ")
    svg.sub(/\A<svg\s/, "<svg class=\"#{ERB::Util.html_escape(classes)}\" ").html_safe
  end
end
