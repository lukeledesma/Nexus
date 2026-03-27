# frozen_string_literal: true

module Apps
  class TaskListsController < BaseController
    # GET /apps/all_tasks
    def index
      @task_lists = Item.task_lists.includes(:folder).ordered
    end

    # GET /apps/task_lists/:id
    def show
      @task_list = Item.task_lists.find(params[:id])
      @tasks_for_view = normalize_tasks(@task_list.tasks)
    end

    # POST /apps/task_lists
    def create
      @task_list = Item.new(task_list_params.merge(item_type: "task_list", tasks: []))

      if @task_list.save
        respond_to do |format|
          format.json { render json: { id: @task_list.id, item_type: @task_list.item_type, updated_at: @task_list.updated_at&.utc&.iso8601, url: apps_task_list_path(@task_list) } }
          format.html { redirect_to apps_task_list_path(@task_list) }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @task_list.errors.full_messages }, status: :unprocessable_entity }
          format.html { redirect_to root_path, alert: @task_list.errors.full_messages.to_sentence }
        end
      end
    end

    # PATCH /apps/task_lists/:id
    def update
      @task_list = Item.task_lists.find(params[:id])

      # Only rebuild tasks array when explicitly submitted — prevents a bare
      # name-only rename (e.g. from fetch PATCH) from wiping existing tasks.
      attrs = task_list_params

      if params.dig(:item, :tasks_payload).present?
        attrs = attrs.merge(tasks: parse_tasks_payload)
      elsif !params.dig(:item, :tasks).nil?
        attrs = attrs.merge(tasks: build_tasks_from_params)
      end

      if @task_list.update(attrs)
        respond_to do |format|
          format.json { render json: { ok: true, id: @task_list.id, item_type: @task_list.item_type, name: @task_list.name, updated_at: @task_list.updated_at&.utc&.iso8601 } }
          format.html { redirect_to apps_task_list_path(@task_list), notice: "Saved" }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @task_list.errors.full_messages }, status: :unprocessable_entity }
          format.html { render :show, status: :unprocessable_entity }
        end
      end
    end

    # DELETE /apps/task_lists/:id
    def destroy
      @task_list = Item.task_lists.find(params[:id])
      folder_id = @task_list.folder_id
      @task_list.destroy

      respond_to do |format|
        format.json { head :no_content }
        format.html { redirect_to apps_folder_path(folder_id) }
      end
    end

    private

    def task_list_params
      params.require(:item).permit(:folder_id, :name)
    end

    # Builds a plain array of task strings from submitted form params.
    # The form submits item[tasks][] as an array of task name strings.
    def build_tasks_from_params
      raw = params.dig(:item, :tasks)
      return [] unless raw.is_a?(Array)

      raw.map(&:strip).reject(&:empty?)
    end

    def parse_tasks_payload
      raw = params.dig(:item, :tasks_payload).to_s
      parsed = JSON.parse(raw)
      return [] unless parsed.is_a?(Array)

      parsed.filter_map do |task|
        next unless task.is_a?(Hash)

        text = task["text"].to_s.strip
        next if text.empty?

        note = task["note"].to_s

        subtasks = Array(task["subtasks"]).filter_map do |subtask|
          next unless subtask.is_a?(Hash)

          subtask_text = subtask["text"].to_s.strip
          next if subtask_text.empty?

          {
            "text" => subtask_text,
            "checked" => ActiveModel::Type::Boolean.new.cast(subtask["checked"]),
            "note" => subtask["note"].to_s
          }
        end

        checked = ActiveModel::Type::Boolean.new.cast(task["checked"])
        checked = subtasks.present? ? subtasks.all? { |subtask| subtask["checked"] } : checked

        {
          "text" => text,
          "checked" => checked,
          "note" => note,
          "subtasks" => subtasks
        }
      end
    rescue JSON::ParserError
      []
    end

    def normalize_tasks(value)
      Array(value).filter_map do |task|
        if task.is_a?(String)
          text = task.to_s.strip
          next if text.empty?

          { "text" => text, "checked" => false, "note" => "", "subtasks" => [] }
        elsif task.respond_to?(:to_h)
          hash = task.to_h
          text = hash["text"].to_s.strip
          next if text.empty?

          note = hash["note"].to_s

          subtasks = Array(hash["subtasks"]).filter_map do |subtask|
            next unless subtask.respond_to?(:to_h)

            subtask_hash = subtask.to_h
            subtask_text = subtask_hash["text"].to_s.strip
            next if subtask_text.empty?

            {
              "text" => subtask_text,
              "checked" => ActiveModel::Type::Boolean.new.cast(subtask_hash["checked"]),
              "note" => subtask_hash["note"].to_s
            }
          end

          checked = ActiveModel::Type::Boolean.new.cast(hash["checked"])
          checked = subtasks.present? ? subtasks.all? { |subtask| subtask["checked"] } : checked

          {
            "text" => text,
            "checked" => checked,
            "note" => note,
            "subtasks" => subtasks
          }
        end
      end
    end
  end
end
