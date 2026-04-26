# frozen_string_literal: true

# Permission checks depend on DocumentPolicy at request time in production.
# Load it explicitly so these service paths do not rely on implicit autoload behavior.
require Rails.root.join("app/policies/document_policy")