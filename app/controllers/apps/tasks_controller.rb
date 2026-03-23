# frozen_string_literal: true

module Apps
  class TasksController < BaseController
    def index
      @task_lists = Document.files.where(content_type: "task_list").order(Arel.sql("LOWER(title) ASC"))
    end
  end
end
