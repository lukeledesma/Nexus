# frozen_string_literal: true

namespace :nexus do
  desc "Generate missing thumbnails for all image asset documents"
  task backfill_thumbnails: :environment do
    image_docs = Document.where(is_folder: false, content_type: "asset").select do |doc|
      ext = File.extname(doc.storage_path.to_s).downcase
      Document::IMAGE_EXTENSIONS.include?(ext) && ext != ".svg"
    end

    total   = image_docs.size
    success = 0
    skipped = 0
    failed  = 0

    puts "Found #{total} image document(s) to check."

    image_docs.each do |doc|
      thumb_path = doc.thumbnail_disk_path
      if thumb_path&.file?
        skipped += 1
        next
      end

      result = Documents::GenerateThumbnail.call(doc)
      if result
        success += 1
        print "."
      else
        failed += 1
        print "F"
      end
    end

    puts ""
    puts "Done. Generated: #{success}, Already existed: #{skipped}, Failed: #{failed}"
  end
end
