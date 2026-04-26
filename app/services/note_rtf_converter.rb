# frozen_string_literal: true

require "nokogiri"
require "cgi"

# Converts between Quill-style HTML (Document#content) and RTF files
# so macOS TextEdit opens saved notes as rich text.
class NoteRtfConverter
  class << self
    def html_to_rtf(html)
      HtmlToRtf.convert(html)
    end

    def rtf_to_html(rtf)
      RtfToHtml.convert(rtf)
    end
  end

  module HtmlToRtf
    module_function

    def convert(html)
      fragment = Nokogiri::HTML.fragment(html.to_s)
      ctx = Context.new
      raw = fragment.children.map { |n| convert_node(n, ctx) }.join
      body =
        if raw.blank?
          "\\pard\\ql\\fs24\\par"
        elsif raw.start_with?("\\pard")
          raw
        else
          "\\pard\\ql\\fs24 #{raw}\\par "
        end
      fonttbl = "{\\fonttbl{\\f0\\fswiss Helvetica;}{\\f1\\fnil Menlo;}}"
      colortbl = ctx.colortbl_rtf
      "{\\rtf1\\ansi\\deff0#{fonttbl}#{colortbl}\\viewkind4\\uc1\n#{body}\n}"
    end

    def convert_node(node, ctx)
      case node
      when Nokogiri::XML::Text
        rtf_escape(node.text)
      when Nokogiri::XML::Comment
        ""
      when Nokogiri::XML::Element
        convert_element(node, ctx)
      else
        ""
      end
    end

    def convert_element(el, ctx)
      name = el.name.downcase
      case name
      when "p"
        para_prefix(el) + el.children.map { |c| convert_node(c, ctx) }.join + "\\par "
      when "div"
        el.children.map { |c| convert_node(c, ctx) }.join
      when "br"
        "\\line "
      when "strong", "b"
        "{\\b " + el.children.map { |c| convert_node(c, ctx) }.join + "\\b0}"
      when "em", "i"
        "{\\i " + el.children.map { |c| convert_node(c, ctx) }.join + "\\i0}"
      when "u"
        "{\\ul " + el.children.map { |c| convert_node(c, ctx) }.join + "\\ulnone}"
      when "s", "strike", "del"
        "{\\strike " + el.children.map { |c| convert_node(c, ctx) }.join + "\\strike0}"
      when "h1"
        "\\pard\\ql\\fs48\\b " + el.children.map { |c| convert_node(c, ctx) }.join + "\\b0\\fs24\\par "
      when "h2"
        "\\pard\\ql\\fs40\\b " + el.children.map { |c| convert_node(c, ctx) }.join + "\\b0\\fs24\\par "
      when "h3"
        "\\pard\\ql\\fs32\\b " + el.children.map { |c| convert_node(c, ctx) }.join + "\\b0\\fs24\\par "
      when "blockquote"
        "\\pard\\ql\\li720\\i " + el.children.map { |c| convert_node(c, ctx) }.join + "\\i0\\par "
      when "pre"
        "\\pard\\ql\\f1\\fs22 " + rtf_escape(el.text) + "\\f0\\fs24\\par "
      when "ol"
        el.children.select { |c| c.element? && c.name.downcase == "li" }.each_with_index.map do |li, idx|
          "\\pard\\ql\\fi-360\\li720 #{idx + 1}. " + li_inner_skip_ui(li, ctx) + "\\par "
        end.join
      when "ul"
        el.children.select { |c| c.element? && c.name.downcase == "li" }.map do |li|
          "\\pard\\ql\\fi-360\\li720 \\u8226\\'3f " + li_inner_skip_ui(li, ctx) + "\\par "
        end.join
      when "li"
        "\\pard\\ql\\fi-360\\li720 " + li_inner_skip_ui(el, ctx) + "\\par "
      when "span"
        span_rtf(el, ctx)
      else
        el.children.map { |c| convert_node(c, ctx) }.join
      end
    end

    def li_inner_skip_ui(li, ctx)
      li.children.reject { |c| c.element? && c["class"].to_s.include?("ql-ui") }.map { |c| convert_node(c, ctx) }.join
    end

    def para_prefix(el)
      align =
        case el["class"].to_s
        when /ql-align-center/ then "\\qc "
        when /ql-align-right/ then "\\qr "
        when /ql-align-justify/ then "\\qj "
        else "\\ql "
        end
      "\\pard#{align}\\fs24 "
    end

    def span_rtf(el, ctx)
      style = el["style"].to_s
      fg = extract_rgb(style, /color:\s*rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/)
      inner = el.children.map { |c| convert_node(c, ctx) }.join
      return inner if fg.nil?

      "{\\cf#{ctx.color_index(fg)} " + inner + "\\cf0 "
    end

    def extract_rgb(style, rx)
      m = style.match(rx)
      return nil unless m

      [m[1].to_i, m[2].to_i, m[3].to_i]
    end

    def rtf_escape(str)
      str.to_s.gsub(/[\\{}]/) { |c| "\\#{c}" }.gsub("\n", "\\line ").gsub("\r", "")
    end

    class Context
      def initialize
        @colors = []
      end

      def color_index(rgb)
        i = @colors.index(rgb)
        if i.nil?
          @colors << rgb
          i = @colors.length - 1
        end
        i + 1
      end

      def colortbl_rtf
        return "" if @colors.empty?

        parts = @colors.map do |(r, g, b)|
          "\\red#{r.clamp(0, 255)}\\green#{g.clamp(0, 255)}\\blue#{b.clamp(0, 255)};"
        end
        "{\\colortbl;\\red0\\green0\\blue0;#{parts.join}}"
      end
    end
  end

  module RtfToHtml
    module_function

    def convert(source)
      s = source.to_s
      return wrap_plain(s) unless s.lstrip.start_with?("{\\rtf")

      Parser.new(s).parse
    end

    def wrap_plain(s)
      "<p>#{CGI.escapeHTML(s.to_s).gsub(/\r\n|\r|\n/, '<br>')}</p>"
    end

    class Parser
      def initialize(str)
        @s = str.gsub("\r\n", "\n")
        @n = @s.length
        @i = 0
        @frag = +""
        @bold = 0
        @italic = 0
        @underline = 0
        @strike = 0
      end

      def parse
        start = @s.index("{\\rtf")
        return NoteRtfConverter::RtfToHtml.wrap_plain(@s) unless start

        @frag = +"<p>"
        @i = start + 1 # after opening "{"
        depth = 1
        while @i < @n && depth.positive?
          c = @s[@i]
          if depth == 1 && c == "}"
            depth -= 1
            @i += 1
            break
          end

          case c
          when "{"
            if skippable_braced_header?
              skip_balanced_group
            else
              depth += 1
              @i += 1
            end
          when "}"
            depth -= 1
            @i += 1
          when "\\"
            read_control
          when "\n", "\r", "\t"
            @i += 1
          else
            read_text
          end
        end

        close_inline_styles
        inner = @frag.strip
        return NoteRtfConverter::RtfToHtml.wrap_plain(@s) if inner.blank? || inner == "<p>"

        inner << "</p>" unless inner.end_with?("</p>")
        inner.gsub(/(<p>\s*<\/p>)+\z/, "").to_s
      end

      def skippable_braced_header?
        return false unless @s[@i] == "{"
        return true if @s[@i + 1] == "\\" && @s[@i + 2] == "*"

        j = @i + 1
        return false unless j < @n && @s[j] == "\\"

        j += 1
        a = j
        a += 1 while a < @n && @s[a] =~ /[a-zA-Z]/
        w = @s[j...a]
        %w[fonttbl colortbl stylesheet info pict].include?(w)
      end

      def skip_balanced_group
        return unless @s[@i] == "{"

        d = 1
        @i += 1
        while @i < @n && d.positive?
          case @s[@i]
          when "{"
            d += 1
            @i += 1
          when "}"
            d -= 1
            @i += 1
          when "\\"
            @i = skip_escape_sequence(@i)
          else
            @i += 1
          end
        end
      end

      def skip_escape_sequence(i)
        j = i + 1
        return j + 1 if j < @n && "\\{}".include?(@s[j])

        if j < @n && @s[j] == "'" && j + 2 < @n
          return j + 3
        end

        if j < @n && @s[j] == "u" && j + 1 < @n && @s[j + 1] =~ /[-\d]/
          k = j + 1
          k += 1 while k < @n && @s[k] =~ /[-\d]/
          k += 1 while k < @n && @s[k] =~ /\s/
          k += 1 if k < @n # replacement byte optional
          return k
        end

        k = j
        k += 1 while k < @n && @s[k] =~ /[a-zA-Z]/
        k += 1 while k < @n && @s[k] =~ /[-\d]/
        k += 1 if k < @n && @s[k] == " "
        k
      end

      def read_control
        @i += 1
        return @i += 1 if @i < @n && "\\{}".include?(@s[@i])

        if @i < @n && @s[@i] == "'" && @i + 2 < @n
          hex = @s[@i + 1, 2]
          @i += 3
          emit_byte(hex.to_i(16))
          return
        end

        if @i < @n && @s[@i] == "u" && @i + 1 < @n && @s[@i + 1] =~ /[-\d]/
          j = @i + 1
          j += 1 while j < @n && @s[j] =~ /[-\d]/
          num = @s[@i + 1...j].to_i
          j += 1 while j < @n && @s[j] =~ /\s/
          j += 1 if j < @n # skip fallback char
          code = num.negative? ? 65_536 + num : num
          @i = j
          emit_unicode(code)
          return
        end

        start = @i
        @i += 1 while @i < @n && @s[@i] =~ /[a-zA-Z]/
        word = @s[start...@i]
        arg_start = @i
        @i += 1 while @i < @n && @s[@i] =~ /[-\d]/
        arg = @s[arg_start...@i]
        @i += 1 if @i < @n && @s[@i] == " "

        apply_control(word, arg)
      end

      def apply_control(word, arg)
        case word
        when "par"
          close_inline_styles
          @frag << "</p><p>"
        when "line"
          @frag << "<br>"
        when "pard"
          close_inline_styles
        when "b"
          toggle_style(:bold, arg)
        when "i"
          toggle_style(:italic, arg)
        when "ul"
          if arg == "none" || arg == "0"
            toggle_style(:underline, "0")
          else
            toggle_style(:underline, "1")
          end
        when "ulnone"
          toggle_style(:underline, "0")
        when "strike"
          toggle_style(:strike, arg)
        when "ql", "qc", "qr", "qj", "fs", "f", "cf", "highlight", "cbpat", "chcbpat"
          # layout / font / color — ignored for HTML
        when "emdash"
          @frag << "—"
        when "endash"
          @frag << "–"
        when "tab"
          @frag << " "
        else
          # ignore
        end
      end

      def toggle_style(kind, arg)
        on = arg.empty? || (arg != "0" && arg != "false")
        case kind
        when :bold
          if on
            @frag << "<strong>" if @bold.zero?
            @bold += 1
          elsif @bold.positive?
            @bold -= 1
            @frag << "</strong>" if @bold.zero?
          end
        when :italic
          if on
            @frag << "<em>" if @italic.zero?
            @italic += 1
          elsif @italic.positive?
            @italic -= 1
            @frag << "</em>" if @italic.zero?
          end
        when :underline
          if on
            @frag << "<u>" if @underline.zero?
            @underline += 1
          elsif @underline.positive?
            @underline -= 1
            @frag << "</u>" if @underline.zero?
          end
        when :strike
          if on
            @frag << "<s>" if @strike.zero?
            @strike += 1
          elsif @strike.positive?
            @strike -= 1
            @frag << "</s>" if @strike.zero?
          end
        end
      end

      def close_inline_styles
        @frag << "</strong>" * @bold
        @frag << "</em>" * @italic
        @frag << "</u>" * @underline
        @frag << "</s>" * @strike
        @bold = @italic = @underline = @strike = 0
      end

      def emit_byte(b)
        ch = b.chr("ASCII-8BIT").encode("UTF-8", invalid: :replace, undef: :replace)
        @frag << CGI.escapeHTML(ch)
      end

      def emit_unicode(code)
        @frag << CGI.escapeHTML([code].pack("U"))
      rescue StandardError
        @frag << "?"
      end

      def read_text
        start = @i
        while @i < @n
          c = @s[@i]
          break if "{}\\".include?(c)

          @i += 1
        end
        chunk = @s[start...@i]
        return if chunk.empty?

        @frag << CGI.escapeHTML(chunk.gsub(/\n+/, "<br>"))
      end
    end
  end
end
