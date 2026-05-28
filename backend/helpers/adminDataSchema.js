const db = require("../db");

function ensureColumnStatement(tableName, columnDefinition) {
  return `ALTER TABLE IF EXISTS ${tableName} ADD COLUMN IF NOT EXISTS ${columnDefinition}`;
}

function ensureIndexStatement(indexName, tableName, expression) {
  return `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '${tableName}'
      ) THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} ${expression}';
      END IF;
    END $$;
  `;
}

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS disaster_zones (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(120),
      risk_level VARCHAR(60),
      population_at_risk INTEGER,
      geom GEOMETRY(MultiPolygon, 4326),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  ensureColumnStatement("education_facilities", "is_active BOOLEAN NOT NULL DEFAULT TRUE"),
  ensureColumnStatement("education_facilities", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
  ensureColumnStatement("health_facilities", "is_active BOOLEAN NOT NULL DEFAULT TRUE"),
  ensureColumnStatement("health_facilities", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
  ensureColumnStatement("welfare_beneficiaries", "is_active BOOLEAN NOT NULL DEFAULT TRUE"),
  ensureColumnStatement("welfare_beneficiaries", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
  ensureColumnStatement("disaster_zones", "is_active BOOLEAN NOT NULL DEFAULT TRUE"),
  ensureColumnStatement("disaster_zones", "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"),
  `
    CREATE TABLE IF NOT EXISTS admin_data_edits (
      id SERIAL PRIMARY KEY,
      table_name VARCHAR(100) NOT NULL,
      record_id BIGINT,
      action VARCHAR(50) NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id),
      before_data JSONB,
      after_data JSONB,
      changed_fields JSONB DEFAULT '[]'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'approved',
      request_payload JSONB,
      reviewed_by_user_id INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      review_notes TEXT,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `,
  "ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'approved'",
  "ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS request_payload JSONB",
  "ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS reviewed_by_user_id INTEGER REFERENCES users(id)",
  "ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP",
  "ALTER TABLE IF EXISTS admin_data_edits ADD COLUMN IF NOT EXISTS review_notes TEXT",
  ensureIndexStatement("idx_edu_facilities_is_active", "education_facilities", "(is_active)"),
  ensureIndexStatement("idx_health_facilities_is_active", "health_facilities", "(is_active)"),
  ensureIndexStatement("idx_welfare_is_active", "welfare_beneficiaries", "(is_active)"),
  ensureIndexStatement("idx_disaster_zones_is_active", "disaster_zones", "(is_active)"),
  "CREATE INDEX IF NOT EXISTS idx_admin_data_edits_lookup ON admin_data_edits(table_name, record_id, changed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_admin_data_edits_status_lookup ON admin_data_edits(status, changed_at DESC)",
  "ALTER TABLE IF EXISTS admin_data_edits ALTER COLUMN record_id DROP NOT NULL",
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
