Rails.application.routes.draw do
  mount ActionCable.server => "/cable"

  get "/login", to: "sessions#new"
  post "/login", to: "sessions#create"
  delete "/logout", to: "sessions#destroy"

  namespace :apps do
    get "finder", to: "finder#show"
    post "finder/toggle_pin", to: "finder#toggle_pin"
    get "alchemy", to: "alchemy#show"
    post "alchemy/save_file", to: "alchemy#save_file"
    get "calendar", to: "calendar#show"
    get "images", to: "images#show"
    get "audio", to: "audio#show"
    get "wallpaper_image/files", to: "wallpaper_image#files"
    get "user", to: "user#show"
    patch "user/username", to: "user#update_username", as: :user_username
    patch "user/password", to: "user#update_password", as: :user_password
    get "tasks", to: "tasks#show"
    post "tasks/save_file", to: "tasks#save_file"
    get "tasks/draft_file", to: "tasks#draft_file"
    post "calendar/save_events", to: "calendar#save_events"
    get "calendar/draft_file", to: "calendar#draft_file"
    get "calendar/last_saved", to: "calendar#last_saved"
    get "quartz", to: "quartz#show"
  end

  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check
  get    "workspace_preferences", to: "workspace_preferences#show"
  patch  "workspace_preferences", to: "workspace_preferences#update"

  get    "user_app_states",       to: "user_app_states#index"
  patch  "user_app_states/:key",  to: "user_app_states#update", constraints: { key: %r{[^/]+} }
  delete "user_app_states/:key",  to: "user_app_states#destroy", constraints: { key: %r{[^/]+} }

  root "documents#index"
  post "/documents/create_root_folder", to: "documents#create_root_folder"
  resources :documents do
    collection do
      get :organizer_fragment
      get :panel_search
    end

    member do
      post :create_file
      post :create_subfolder
      post :move_folder
      post :move_file
      post :upload_images
      patch :restore_from_trash
      delete :permanent_delete
      patch :rename
      patch :toggle_favorite
      get :file_list
      get :asset_file
      get :thumbnail
    end
  end
end
