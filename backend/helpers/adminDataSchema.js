const db = require("../db");

const schemaStatements = [
  "ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
  "ALTER TABLE education_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
  "ALTER TABLE health_facilities ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE welfare_beneficiaries ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
  "ALTER TABLE welfare_beneficiaries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  "ALTER TABLE disaster_zones ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
  "ALTER TABLE disaster_zones ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
  `
    CREATE TABLE IF NOT EXISTS admin_data_edits (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(100) NOT NULL,
      record_id BIGINT NOT NULL,
      action VARCHAR(50) NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id),
      before_data JSONB,
      after_data JSONB,
      changed_fields JSONB DEFAULT '[]'::jsonb,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_edu_facilities_is_active ON education_facilities(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_health_facilities_is_active ON health_facilities(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_welfare_is_active ON welfare_beneficiaries(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_disaster_zones_is_active ON disaster_zones(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_admin_data_edits_lookup ON admin_data_edits(table_name, record_id, changed_at DESC)",
];

let ensurePromise = null;

async function ensureAdminDataSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      for (const statement of schemaStatements) {
        await db.query(statement);
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  return ensurePromise;
}

module.exports = ensureAdminDataSchema;
