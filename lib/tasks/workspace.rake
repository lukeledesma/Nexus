# frozen_string_literal: true

namespace :workspace do
  desc "Destroy all Finder note documents backed by .txt files (DB rows + disk). Irreversible. Usage: CONFIRM=yes bin/rails workspace:purge_legacy_note_txt_files"
  task purge_legacy_note_txt_files: :environment do
    unless ENV["CONFIRM"].to_s == "yes"
      warn "Refusing to run: this permanently deletes note documents whose storage_path ends with .txt"
      warn "Run: CONFIRM=yes bin/rails workspace:purge_legacy_note_txt_files"
      exit 1
    end

    scope = Document.files.where(content_type: "note").where("storage_path LIKE ?", "%.txt")
    n = scope.count
    scope.find_each(&:destroy)
    puts "Destroyed #{n} note document(s) and removed their .txt files from workspace storage."
  end
end
