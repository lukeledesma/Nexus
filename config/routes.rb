Rails.application.routes.draw do
  get "/login", to: "sessions#new"
  post "/login", to: "sessions#create"
  delete "/logout", to: "sessions#destroy"

  namespace :apps do
    get "finder", to: "finder#show"
    get "notes", to: "notes#show"
    get "time_card", to: "time_card#show"
    get "calendar", to: "calendar#show"
    get "images", to: "images#show"
    get "audio", to: "audio#show"
    get "wallpaper_iimage/files", to: "wallpaper_iimage#files"
    get "user", to: "user#show"
    patch "user/username", to: "user#update_username", as: :user_username
    patch "user/password", to: "user#update_password", as: :user_password
    get "tasks", to: "tasks#show"
    post "tasks/save_file", to: "tasks#save_file"
    get "tasks/draft_file", to: "tasks#draft_file"
    post "calendar/save_events", to: "calendar#save_events"
    get "calendar/draft_file", to: "calendar#draft_file"
    get "calendar/last_saved", to: "calendar#last_saved"
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
  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

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
      patch :rename
      patch :toggle_favorite
      get :file_list
      get :asset_file
    end
  end
end
