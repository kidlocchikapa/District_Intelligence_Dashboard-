const db = require("../db");

const schemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS user_department_permissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      department VARCHAR(50) NOT NULL CHECK (
        department IN ('education', 'health', 'social_welfare', 'disaster')
      ),
      can_read BOOLEAN NOT NULL DEFAULT TRUE,
      can_write BOOLEAN NOT NULL DEFAULT FALSE,
      can_recompute BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, department)
    )
  `,
  "CREATE INDEX IF NOT EXISTS idx_user_department_permissions_user_id ON user_department_permissions(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_user_department_permissions_department ON user_department_permissions(department)",
  `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'user_department_permissions'
      ) THEN
        ALTER TABLE user_department_permissions
        DROP CONSTRAINT IF EXISTS user_department_permissions_department_check;

        ALTER TABLE user_department_permissions
        ADD CONSTRAINT user_department_permissions_department_check
        CHECK (department IN (
          'education',
          'health',
          'social_welfare',
          'welfare',
          'disaster'
        ));
      END IF;

      IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'users'
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'users_role_check'
            AND conrelid = 'users'::regclass
        ) THEN
          ALTER TABLE users DROP CONSTRAINT users_role_check;
        END IF;

        ALTER TABLE users
        ADD CONSTRAINT users_role_check
        CHECK (role IN (
          'super_admin', 
          'admin', 
          'education_admin', 
          'health_admin', 
          'disaster_admin', 
          'welfare_admin',
          'department_admin', 
          'analyst', 
          'user'
        ));
      END IF;
    END $$;
  `,
];

let ensurePromise = null;

async function ensureRbacSchema() {
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

module.exports = ensureRbacSchema;
