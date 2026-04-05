# frozen_string_literal: true

namespace :ui do
  desc "Validate the Nexus UI contract for OS and app windows"
  task contract: :environment do
    root = Rails.root

    required_css_tokens = {
      "app/assets/stylesheets/application.css" => [
        "--os-window-padding:",
        ".os-window-header",
        ".os-window-title",
        ".os-window-subtitle",
        ".os-window-body-start",
        ".os-window-grid",
        ".os-window-card"
      ]
    }

    required_view_classes = {
      "app/views/layouts/application.html.erb" => [
        "os-window-header",
        "os-window-title",
        "os-window-controls",
        "os-window-body-start"
      ],
      "app/views/organizer/_sidebar.html.erb" => [
        "os-window-header",
        "os-window-title",
        "os-window-controls",
        "os-window-body-start",
        "os-window-grid",
        "os-window-card",
        "os-window-card-content",
        "os-window-card-label",
        "os-window-card-value"
      ],
      "app/views/apps/singular/task_list.html.erb" => [
        "os-window-header",
        "os-window-title",
        "os-window-body-start"
      ],
      "app/views/apps/singular/sticky_notes.html.erb" => [
        "os-window-body-start"
      ]
    }

    forbidden_patterns = {
      "app/views/**/*.erb" => [
        /organizer-tool-card/,
        /organizer-tool-label/,
        /organizer-tool-value/
      ]
    }

    failures = []

    required_css_tokens.each do |relative_path, required_tokens|
      content = root.join(relative_path).read
      required_tokens.each do |token|
        failures << "Missing token '#{token}' in #{relative_path}" unless content.include?(token)
      end
    end

    required_view_classes.each do |relative_path, required_tokens|
      content = root.join(relative_path).read
      required_tokens.each do |token|
        failures << "Missing class '#{token}' in #{relative_path}" unless content.include?(token)
      end
    end

    forbidden_patterns.each do |glob, patterns|
      Dir[root.join(glob)].sort.each do |path|
        relative_path = Pathname.new(path).relative_path_from(root).to_s
        content = File.read(path)

        patterns.each do |pattern|
          next unless content.match?(pattern)

          failures << "Forbidden legacy class '#{pattern.source}' found in #{relative_path}"
        end
      end
    end

    if failures.empty?
      puts "UI contract check passed"
    else
      puts "UI contract check failed:"
      failures.each { |failure| puts "- #{failure}" }
      abort
    end
  end
end