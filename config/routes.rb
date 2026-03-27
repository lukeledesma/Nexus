Rails.application.routes.draw do
  get "/login", to: "sessions#new"
  post "/login", to: "sessions#create"
  delete "/logout", to: "sessions#destroy"

  namespace :apps do
    resources :folders, only: %i[show create update destroy]
    resources :notes, only: %i[show create update destroy]
    resources :task_lists, only: %i[show create update destroy]
    get "calculator", to: "calculator#show"
    get "settings", to: "settings#show"
    get "conversion_chart", to: "conversion_chart#show"
    get "singular_note", to: "singular#note"
    get "singular_task_list", to: "singular#task_list"
    get "all_notes",  to: "notes#index"
    get "all_tasks",  to: "task_lists#index"
  end

  resources :folders, only: %i[create update destroy], controller: "apps/folders"

  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check
  get "db_health", to: "db_health#show"

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
