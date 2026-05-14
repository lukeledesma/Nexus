# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_05_14_220000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "documents", force: :cascade do |t|
    t.text "content"
    t.string "content_type", default: "note", null: false
    t.datetime "created_at", null: false
    t.boolean "is_favorited", default: false, null: false
    t.boolean "is_folder", default: false, null: false
    t.datetime "last_reset_at"
    t.integer "parent_id"
    t.integer "reset_days", default: [], null: false, array: true
    t.string "reset_mode", default: "none", null: false
    t.string "storage_path"
    t.jsonb "tasks", default: [], null: false
    t.string "title"
    t.datetime "updated_at", null: false
    t.index ["content_type"], name: "index_documents_on_content_type"
    t.index ["is_favorited"], name: "index_documents_on_is_favorited_true", where: "(is_favorited = true)"
    t.index ["is_folder"], name: "index_documents_on_is_folder"
    t.index ["parent_id", "is_folder"], name: "index_documents_on_parent_id_and_is_folder"
    t.index ["parent_id"], name: "index_documents_on_parent_id"
  end

  create_table "user_app_states", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.jsonb "data", default: {}, null: false
    t.string "key", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["key"], name: "index_user_app_states_on_key"
    t.index ["user_id", "key"], name: "index_user_app_states_on_user_id_and_key", unique: true
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.string "password_digest", null: false
    t.datetime "updated_at", null: false
    t.string "username"
    t.index "lower((username)::text)", name: "index_users_on_lower_username", unique: true, where: "(username IS NOT NULL)"
    t.index ["email"], name: "index_users_on_email", unique: true
  end

  add_foreign_key "user_app_states", "users"
end
