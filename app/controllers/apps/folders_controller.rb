# frozen_string_literal: true

module Apps
  class FoldersController < BaseController
    # GET /apps/folders/:id
    def show
      @folder = Folder.find(params[:id])
      @items  = @folder.items.ordered
    end

    # POST /apps/folders
    def create
      @folder = Folder.new(folder_params)

      if @folder.save
        respond_to do |format|
          format.json { render json: { id: @folder.id, name: @folder.name } }
          format.html { redirect_to root_path }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @folder.errors.full_messages }, status: :unprocessable_entity }
          format.html { redirect_to root_path, alert: @folder.errors.full_messages.to_sentence }
        end
      end
    end

    # PATCH /apps/folders/:id
    def update
      @folder = Folder.find(params[:id])

      if @folder.update(folder_params)
        respond_to do |format|
          format.json { render json: { ok: true, name: @folder.name } }
          format.html { redirect_to root_path }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @folder.errors.full_messages }, status: :unprocessable_entity }
          format.html { redirect_to root_path, alert: @folder.errors.full_messages.to_sentence }
        end
      end
    end

    # DELETE /apps/folders/:id
    def destroy
      Folder.find(params[:id]).destroy

      respond_to do |format|
        format.json { head :no_content }
        format.html { redirect_to root_path }
      end
    end

    private

    def folder_params
      params.require(:folder).permit(:name)
    end
  end
end
