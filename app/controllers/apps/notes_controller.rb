# frozen_string_literal: true

module Apps
  class NotesController < BaseController
    # GET /apps/all_notes
    def index
      @notes = Item.notes.includes(:folder).ordered
    end

    # GET /apps/notes/:id
    def show
      @note = Item.notes.find(params[:id])
    end

    # POST /apps/notes
    def create
      @note = Item.new(note_params.merge(item_type: "note"))

      if @note.save
        respond_to do |format|
          format.json { render json: { id: @note.id, url: apps_note_path(@note) } }
          format.html { redirect_to apps_note_path(@note) }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @note.errors.full_messages }, status: :unprocessable_entity }
          format.html { redirect_to root_path, alert: @note.errors.full_messages.to_sentence }
        end
      end
    end

    # PATCH /apps/notes/:id
    def update
      @note = Item.notes.find(params[:id])

      if @note.update(note_params)
        respond_to do |format|
          format.json { render json: { ok: true, id: @note.id, item_type: @note.item_type, name: @note.name } }
          format.html { redirect_to apps_note_path(@note), notice: "Saved" }
        end
      else
        respond_to do |format|
          format.json { render json: { errors: @note.errors.full_messages }, status: :unprocessable_entity }
          format.html { render :show, status: :unprocessable_entity }
        end
      end
    end

    # DELETE /apps/notes/:id
    def destroy
      @note = Item.notes.find(params[:id])
      folder_id = @note.folder_id
      @note.destroy

      respond_to do |format|
        format.json { head :no_content }
        format.html { redirect_to apps_folder_path(folder_id) }
      end
    end

    private

    def note_params
      params.require(:item).permit(:folder_id, :name, :body)
    end
  end
end
