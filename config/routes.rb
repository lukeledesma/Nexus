Rails.application.routes.draw do
  get "/login", to: "sessions#new"
  post "/login", to: "sessions#create"
  delete "/logout", to: "sessions#destroy"

  namespace :apps do
    resources :folders, only: %i[show create update destroy]
    resources :task_lists, only: %i[show create update destroy]
    get "finder", to: "finder#show"
    get "finder/folders", to: "finder#folders_json"
    get "finder/folder_files", to: "finder#folder_files"
    post "finder/create_folder", to: "finder#create_folder"
    get "calculator", to: "calculator#show"
    get "settings", to: "settings#show"
    get "user", to: "user#show"
    patch "user/username", to: "user#update_username", as: :user_username
    patch "user/password", to: "user#update_password", as: :user_password
    get "theme_studio", to: "theme_builder#show"
    get "theme_builder", to: "theme_builder#show"
    get "singular_note", to: "singular#note"
    patch "singular_note", to: "singular#update_note"
    get "singular_task_list", to: "singular#task_list"
    get "singular_sticky_notes", to: "singular#sticky_notes"
    patch "singular_sticky_notes", to: "singular#update_sticky_notes"
    post "singular/save_file", to: "singular#save_file"
    get "all_tasks",  to: "task_lists#index"
  end

  resources :folders, only: %i[create update destroy], controller: "apps/folders"

  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check
  get    "workspace_preferences", to: "workspace_preferences#show"
  patch  "workspace_preferences", to: "workspace_preferences#update"
  # Render dynamic PWA files from app/views/pwa/* (remember to link manifest in application.html.erb)
  # get "manifest" => "rails/pwa#manifest", as: :pwa_manifest
  # get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker

  root "documents#index"
  post "/documents/create_root_folder", to: "documents#create_root_folder"
  resources :documents do
    collection do
      get :organizer_fragment
    end

    member do
      post :create_file
      patch :rename
      get :file_list
    end
  end
end
