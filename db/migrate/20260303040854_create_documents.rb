class CreateDocuments < ActiveRecord::Migration[8.1]
  def change
    create_table :documents do |t|
      t.string :metadata_ip
      t.string :metadata_protocol
      t.string :metadata_filename
      t.json :records

      t.timestamps
    end
  end
end
