# frozen_string_literal: true

require "fileutils"
require "rubygems/package"
require "tempfile"
require "zlib"

module Alchemy
  class UploadSourceResolver
    Result = Struct.new(:success?, :xml_content, :source_filename, :error, keyword_init: true)

    class << self
      def call(uploaded)
        return Result.new(success?: false, error: "No file received.") unless uploaded&.respond_to?(:tempfile)

        original = uploaded.original_filename.to_s
        ext = original.downcase

        if ext.end_with?(".xml")
          content = File.read(uploaded.tempfile.path)
          return Result.new(success?: true, xml_content: content, source_filename: original)
        end

        if ext.end_with?(".xml.tar")
          return read_first_xml_from_tar(uploaded.tempfile.path, original)
        end

        if ext.end_with?(".xml.tar.gz") || ext.end_with?(".tgz")
          return read_first_xml_from_targz(uploaded.tempfile.path, original)
        end

        Result.new(success?: false, error: "Unsupported file type.")
      rescue StandardError => e
        Result.new(success?: false, error: e.message)
      end

      private

      def read_first_xml_from_targz(gzip_path, fallback_name)
        Tempfile.create(["alchemy-upload", ".tar"]) do |tmp_tar|
          Zlib::GzipReader.open(gzip_path) do |gz|
            tmp_tar.binmode
            IO.copy_stream(gz, tmp_tar)
            tmp_tar.flush
          end

          read_first_xml_from_tar(tmp_tar.path, fallback_name)
        end
      end

      def read_first_xml_from_tar(tar_path, fallback_name)
        tar_file = File.open(tar_path, "rb")
        begin
          Gem::Package::TarReader.new(tar_file) do |tar|
            tar.each do |entry|
              next unless entry.file?
              next unless File.extname(entry.full_name).casecmp?(".xml")

              xml_name = File.basename(entry.full_name).presence || fallback_name
              xml_content = entry.read
              return Result.new(success?: true, xml_content: xml_content, source_filename: xml_name)
            end
          end
        ensure
          tar_file.close
        end

        Result.new(success?: false, error: "Could not find XML inside archive.")
      end
    end
  end
end
