# frozen_string_literal: true

require "fileutils"
require Rails.root.join("app/services/tag_xml.rb").to_s

# Writes editable file documents to disk as XML once they have meaningful content.
# Folder documents and empty files do not create XML payloads.
module DocumentStorageSync
  class NameConflictError < StandardError; end

  module_function

  STORAGE_ROOT = Rails.root.join("storage", "tag_lists").freeze
  EMPTY_XML = <<~XML.freeze
    <?xml version="1.11" encoding="UTF-8"?>
    <GLOBAL>
      <XML>
      </XML>
    </GLOBAL>
  XML

  def sync!(document)
    return unless document&.persisted?

    if document.folder?
      ensure_folder_exists!(document)
      return
    end

    records = document.records_with_string_keys
    if records.blank?
      purge!(document)
      return
    end

    xml = TagXml::Exporter.export_xml(records, document.metadata)
    return if xml.blank?

    rel_path = build_relative_path(document)
    old_path = document.storage_path.to_s
    if old_path.present? && old_path != rel_path
      old_abs = STORAGE_ROOT.join(old_path)
      new_abs = STORAGE_ROOT.join(rel_path)
      if File.exist?(old_abs) && !File.exist?(new_abs)
        FileUtils.mkdir_p(new_abs.dirname)
        FileUtils.mv(old_abs, new_abs)
      end
    end

    abs_path = STORAGE_ROOT.join(rel_path)
    FileUtils.mkdir_p(abs_path.dirname)
    File.write(abs_path, xml)

    if document.storage_path != rel_path
      document.update_column(:storage_path, rel_path)
    end
  end

  # Materialize a new file document as a valid zero-row XML scaffold.
  def write_scaffold!(document)
    return unless document&.persisted?
    return if document.folder?

    rel_path = build_relative_path(document)
    abs_path = STORAGE_ROOT.join(rel_path)
    FileUtils.mkdir_p(abs_path.dirname)
    File.write(abs_path, EMPTY_XML)

    if document.storage_path != rel_path
      document.update_column(:storage_path, rel_path)
    end
  end

  def purge!(document)
    return unless document&.persisted?

    rel = document.storage_path.to_s
    return if rel.blank?

    abs = STORAGE_ROOT.join(rel)
    File.delete(abs) if File.exist?(abs)
    document.update_column(:storage_path, nil)
  end

  # Remove an entire folder tree from local storage when a folder document is deleted.
  def purge_folder!(folder)
    return unless folder&.persisted?

    slug = folder.storage_path.to_s.presence || slugify(folder.metadata_filename.presence || "new-folder")
    dir = STORAGE_ROOT.join(slug)
    FileUtils.rm_rf(dir) if Dir.exist?(dir)
  end

  def ensure_folder_exists!(folder)
    return unless folder&.persisted?

    name = folder_name(folder)
    return if name.blank?

    dir = STORAGE_ROOT.join(name)
    FileUtils.mkdir_p(dir)
    if folder.storage_path != name
      folder.update_column(:storage_path, name)
    end
  end

  def rename_document!(document, raw_name)
    name = raw_name.to_s.strip
    raise ArgumentError, "Name cannot be blank" if name.blank?
    raise ArgumentError, "Name cannot start with a period" if name.start_with?(".")
    name = ensure_xml_extension(name) unless document.folder?

    if document.folder?
      rename_folder!(document, name)
    else
      rename_file!(document, name)
    end
  end

  def rename_folder!(folder, new_name)
    old_name = folder_name(folder)
    old_dir = STORAGE_ROOT.join(old_name)
    new_dir = STORAGE_ROOT.join(new_name)
    if folder_name_conflict?(folder, old_name, new_name)
      raise NameConflictError, "A folder/file with this name already exists."
    end

    if old_name != new_name && Dir.exist?(new_dir) && !same_path_case_only?(old_dir, new_dir)
      raise NameConflictError, "A folder/file with this name already exists."
    end

    if old_name != new_name
      if Dir.exist?(old_dir)
        unless same_path_case_only?(old_dir, new_dir)
          FileUtils.mv(old_dir, new_dir)
        end
      else
        FileUtils.mkdir_p(new_dir)
      end
    end

    old_prefix = old_name.present? ? "#{old_name}/" : ""
    new_prefix = "#{new_name}/"
    folder.children.files.find_each do |child|
      rel = child.storage_path.to_s
      next if rel.blank?
      next unless old_prefix.present? && rel.start_with?(old_prefix)

      child.update_column(:storage_path, rel.sub(old_prefix, new_prefix))
    end

    folder.update_columns(metadata_filename: new_name, storage_path: new_name)
    folder.reload
  end

  def rename_file!(file_doc, new_name)
    old_rel = file_doc.storage_path.to_s
    target_rel = join_folder_and_name(folder_for_file(file_doc), new_name)
    if file_name_conflict?(file_doc, old_rel, new_name)
      raise NameConflictError, "A folder/file with this name already exists."
    end

    old_abs = STORAGE_ROOT.join(old_rel)
    target_abs = STORAGE_ROOT.join(target_rel)
    if old_rel != target_rel && File.exist?(target_abs) && !same_path_case_only?(old_abs, target_abs)
      raise NameConflictError, "A folder/file with this name already exists."
    end

    if old_rel.present? && old_rel != target_rel
      new_abs = target_abs
      if File.exist?(old_abs)
        FileUtils.mkdir_p(new_abs.dirname)
        if same_path_case_only?(old_abs, new_abs)
          # Case-only rename on case-insensitive filesystems maps to same inode/path.
          # Persist metadata/storage path casing without forcing a failing move.
        else
          FileUtils.mv(old_abs, new_abs)
        end
      end
    end

    file_doc.update_columns(metadata_filename: new_name, storage_path: target_rel)
    file_doc.reload
  end

  def next_untitled_filename(folder_name = nil)
    used = existing_filenames(folder_name)
    next_available_filename(used, "untitled", ".xml")
  end

  def resolve_import_filename(original_name, folder_name = nil)
    desired = File.basename(original_name.to_s.strip)
    desired = "import.xml" if desired.blank?

    ext = File.extname(desired)
    ext = ".xml" if ext.blank?
    base = desired.sub(/#{Regexp.escape(ext)}\z/, "")
    base = "import" if base.blank?
    used = existing_filenames(folder_name)
    next_available_filename(used, base, ext)
  end

  def ensure_xml_extension(name)
    value = name.to_s.strip
    return "untitled.xml" if value.blank?
    return value if value.downcase.end_with?(".xml")

    "#{value}.xml"
  end

  # Matches Finder-style naming by filling the lowest missing numeric suffix.
  # Example: if "base.ext", "base 2.ext", "base 4.ext" exist, returns "base 3.ext".
  def next_available_filename(existing_names, base, ext)
    base_name = base.to_s
    extension = ext.to_s
    candidate = "#{base_name}#{extension}"
    return candidate unless existing_names.include?(candidate)

    suffix_re = /^#{Regexp.escape(base_name)} (\d+)#{Regexp.escape(extension)}$/
    nums = existing_names
      .map { |name| name[suffix_re, 1]&.to_i }
      .compact
      .select { |num| num >= 2 }
      .uniq
      .sort

    expected = 2
    nums.each do |num|
      return "#{base_name} #{expected}#{extension}" if num != expected

      expected += 1
    end

    "#{base_name} #{expected}#{extension}"
  end

  def build_relative_path(document)
    name = document.metadata_filename.to_s.strip
    name = "untitled.xml" if name.blank?
    join_folder_and_name(folder_for_file(document), name)
  end

  def slugify(text)
    cleaned = text.to_s.strip.downcase.gsub(/[^a-z0-9]+/, "-").gsub(/\A-+|-+\z/, "")
    cleaned.presence || "untitled"
  end

  def folder_name(folder)
    folder.storage_path.to_s.presence || folder.metadata_filename.to_s.strip
  end

  def folder_for_file(document)
    return nil unless document.parent&.folder?

    folder_name(document.parent)
  end

  def join_folder_and_name(folder_name, file_name)
    folder_name.present? ? File.join(folder_name, file_name) : file_name
  end

  def existing_filenames(folder_name = nil)
    dir = folder_name.present? ? STORAGE_ROOT.join(folder_name) : STORAGE_ROOT
    return [] unless Dir.exist?(dir)

    Dir.children(dir).select { |name| File.file?(dir.join(name)) }
  end

  def folder_name_conflict?(folder, old_name, new_name)
    candidate = new_name.to_s.strip.downcase
    return false if candidate.blank?

    conflicts = Document.folders
      .where.not(id: folder.id)
      .where("LOWER(COALESCE(storage_path, metadata_filename)) = ?", candidate)
      .to_a

    conflicts.any? do |other|
      other_name = folder_name(other)
      !same_path_case_only?(other_name, old_name)
    end
  end

  def file_name_conflict?(file_doc, old_rel, new_name)
    candidate = new_name.to_s.strip.downcase
    return false if candidate.blank?

    scope = Document.files.where.not(id: file_doc.id)
    scope = file_doc.parent_id.present? ? scope.where(parent_id: file_doc.parent_id) : scope.where(parent_id: nil)

    conflicts = scope.where("LOWER(metadata_filename) = ?", candidate).to_a
    conflicts.any? do |other|
      other_rel = other.storage_path.to_s
      !same_path_case_only?(other_rel, old_rel)
    end
  end

  def same_path_case_only?(left, right)
    left.to_s.casecmp(right.to_s).zero?
  end

  def prune_empty_directories(start_dir)
    dir = start_dir
    root = STORAGE_ROOT.to_s
    while dir.to_s.start_with?(root)
      break if dir.to_s == root
      break unless Dir.exist?(dir)
      break unless Dir.children(dir).empty?

      Dir.rmdir(dir)
      dir = dir.parent
    end
  end
end
