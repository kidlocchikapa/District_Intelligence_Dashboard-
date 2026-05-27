const express = require("express");
const db = require("../db");
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");

const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const ensureRbacSchema = require("../helpers/rbacSchema");
const {
  validateAdminUserCreate,
  validateAdminUserUpdate,
  validateReplaceDepartmentPermissions,
} = require("../validators/rbacValidation");
const {
  buildAuthAccessProfile,
  fetchUserDepartmentPermissions,
  getAccessibleDepartmentsForUser,
  isGlobalAccessRole,
  replaceUserDepartmentPermissions,
  userHasDepartmentAccess,
} = require("../services/rbacService");
const { hashPassword } = require("../helpers/authHelpers");

const router = express.Router();
const uploadDirectory = path.resolve(__dirname, "../../uploads");
const floodRasterUploadDirectory = path.join(uploadDirectory, "flood-rasters");

fs.mkdirSync(uploadDirectory, { recursive: true });
fs.mkdirSync(floodRasterUploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

const jobs = new Map();
const recentJobIds = [];
const MAX_RECENT_JOBS = 25;
const MAX_JOB_LOGS = 500;
const DEFAULT_OVERPASS_URL =
  process.env.OVERPASS_API_URL || "https://overpass-api.de/api/interpreter";
const DEFAULT_OVERPASS_TIMEOUT = Number(process.env.OVERPASS_TIMEOUT || 180);
const DEFAULT_OVERPASS_DISTRICTS =
  process.env.OVERPASS_ROADS_DISTRICTS || "Zomba,Zomba City";
const DEFAULT_FLOOD_RASTER_PATH =
  process.env.FLOOD_RASTER_PATH ||
  path.resolve(__dirname, "../../sample_data/flood_impact_zomba.tif");
const DEFAULT_OVERPASS_QUERY =
  process.env.OVERPASS_ROADS_QUERY ||
  [
    "[out:json][timeout:25];",
    "(",
    '  way["highway"~"trunk|primary|secondary|tertiary|residential|unclassified"](-15.75,35.10,-15.05,35.80);',
    ");",
    "out geom;",
  ].join("\n");
const DEFAULT_HEALTH_COVERAGE_DISTANCE_KM = 8;

// Helper function to build ETL arguments based on task type and parameters
const presetTaskDefinitions = {
  worldpop_totals: {
    label: "Refresh district population totals",
    description: "Updates district population totals from WorldPop.",
    stages: ({ apiUrl, worldpopYear, worldpopApiKey }) => [
      {
        label: "WorldPop totals",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          districtGroup: "zomba_all",
          worldpopYear,
          worldpopDataset: "wpgppop",
          worldpopApiKey,
        }),
      },
    ],
  },
  worldpop_age_sex: {
    label: "Refresh children and school-age population",
    description:
      "Updates district age-sex population breakdowns for education planning.",
    stages: ({
      apiUrl,
      worldpopYear,
      worldpopApiKey,
      schoolAgeMin,
      schoolAgeMax,
      childClassMax,
    }) => [
      {
        label: "WorldPop age-sex",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          districtGroup: "zomba_all",
          worldpopYear,
          worldpopDataset: "wpgpas",
          worldpopApiKey,
          schoolAgeMin,
          schoolAgeMax,
          childClassMax,
        }),
      },
    ],
  },
  education_insights: {
    label: "Recalculate education insights",
    description:
      "Runs school planning, education access analyses, and access preview rasters.",
    stages: ({ apiUrl, worldpopYear, adminLevel, coverageDistanceKm }) => [
      {
        label: "Education analysis",
        args: buildEtlArgs({
          type: "analysis",
          apiUrl,
          worldpopYear,
          analysisTypes: [
            "education_summary",
            "nearest_school_distance",
            "school_service_coverage",
            "school_population_buffer",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
      {
        label: "Education access rasters",
        args: buildEtlArgs({
          type: "education_access",
          sourceType: "worldpop",
          apiUrl,
          districtGroup: "zomba_all",
          worldpopYear,
          coverageDistanceKm,
        }),
      },
    ],
  },
  health_insights: {
    label: "Recalculate health insights",
    description:
      "Runs facility summary, service coverage, population served, 2SFCA, distance analyses, and refreshes health raster previews.",
    stages: ({ worldpopYear, adminLevel, coverageDistanceKm }) => [
      {
        label: "Health analysis (District)",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "health_2sfca_access",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel: "District",
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
      {
        label: "Health analysis (TA)",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "health_2sfca_access",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel: "TA",
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
      {
        label: "Health access rasters",
        args: buildEtlArgs({
          type: "health_access",
          sourceType: "worldpop",
          districtGroup: "zomba_all",
          worldpopYear,
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
    ],
  },
  welfare_insights: {
    label: "Recalculate welfare insights",
    description:
      "Recomputes beneficiary travel access and refreshes welfare access indicators used by dashboard views.",
    stages: () => [
      {
        label: "Welfare analysis",
        args: buildEtlArgs({
          type: "routing",
          sourceType: "file",
        }),
      },
    ],
  },
  road_travel_access: {
    label: "Recalculate road travel access",
    description:
      "Runs pgRouting travel-time calculations from welfare beneficiaries to schools and health facilities.",
    stages: () => [
      {
        label: "Road travel access",
        args: buildEtlArgs({
          type: "routing",
          sourceType: "file",
        }),
      },
    ],
  },
  roads_overpass_sync: {
    label: "Sync roads from Overpass",
    description:
      "Fetches OSM road data via Overpass and clips it to the Zomba boundaries.",
    stages: ({
      overpassUrl,
      overpassQuery,
      overpassTimeout,
      roadClipDistricts,
    }) => [
      {
        label: "Overpass road sync",
        args: buildEtlArgs({
          type: "roads",
          sourceType: "overpass",
          overpassUrl,
          overpassQuery,
          overpassTimeout,
          roadClipDistricts,
        }),
      },
    ],
  },
  disaster_insights: {
    label: "Recalculate disaster insights",
    description:
      "Runs the flood exposure pipeline to refresh flood zones, risk polygons, and facility exposure outputs.",
    stages: ({ floodRasterPath, worldpopYear, analysisDate }) => [
      {
        label: "Flood exposure analysis",
        args: buildEtlArgs({
          type: "flood",
          sourceType: "file",
          filePath: floodRasterPath,
          districtGroup: "zomba_all",
          worldpopYear,
          analysisDate,
        }),
      },
    ],
  },
  planning_refresh: {
    label: "Run full planning refresh",
    description:
      "Refreshes population inputs first, then recalculates education, health, raster previews, and disaster insights.",
    stages: ({
      apiUrl,
      worldpopYear,
      worldpopApiKey,
      schoolAgeMin,
      schoolAgeMax,
      childClassMax,
      adminLevel,
      coverageDistanceKm,
      floodRasterPath,
      analysisDate,
    }) => [
      {
        label: "WorldPop totals",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgppop",
          worldpopApiKey,
        }),
      },
      {
        label: "WorldPop age-sex",
        args: buildEtlArgs({
          type: "worldpop",
          sourceType: "worldpop",
          apiUrl,
          worldpopYear,
          worldpopDataset: "wpgpas",
          worldpopApiKey,
          schoolAgeMin,
          schoolAgeMax,
          childClassMax,
        }),
      },
      {
        label: "Education analysis",
        args: buildEtlArgs({
          type: "analysis",
          apiUrl,
          worldpopYear,
          analysisTypes: [
            "education_summary",
            "nearest_school_distance",
            "school_service_coverage",
            "school_population_buffer",
          ],
          adminLevel,
          coverageDistanceKm,
        }),
      },
      {
        label: "Health analysis (District)",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "health_2sfca_access",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel: "District",
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
      {
        label: "Health analysis (TA)",
        args: buildEtlArgs({
          type: "analysis",
          worldpopYear,
          analysisTypes: [
            "health_summary",
            "health_population_served",
            "health_2sfca_access",
            "nearest_health_distance",
            "health_service_coverage",
          ],
          adminLevel: "TA",
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
      {
        label: "Health access rasters",
        args: buildEtlArgs({
          type: "health_access",
          sourceType: "worldpop",
          apiUrl,
          districtGroup: "zomba_all",
          worldpopYear,
          coverageDistanceKm: coverageDistanceKm === 5 ? 8 : coverageDistanceKm,
        }),
      },
      {
        label: "Education access rasters",
        args: buildEtlArgs({
          type: "education_access",
          sourceType: "worldpop",
          apiUrl,
          districtGroup: "zomba_all",
          worldpopYear,
          coverageDistanceKm,
        }),
      },
      {
        label: "Flood exposure analysis",
        args: buildEtlArgs({
          type: "flood",
          sourceType: "file",
          filePath: floodRasterPath,
          districtGroup: "zomba_all",
          worldpopYear,
          analysisDate,
        }),
      },
    ],
  },
};

const DATASET_DEPARTMENT_MAP = {
  education: "education",
  health: "health",
  welfare: "welfare",
  welfare_beneficiary: "welfare",
  roads: "welfare",
  disaster: "disaster",
  flood: "disaster",
};

const TASK_DEPARTMENT_MAP = {
  worldpop_age_sex: "education",
  education_insights: "education",
  health_insights: "health",
  welfare_insights: "welfare",
  road_travel_access: "welfare",
  roads_overpass_sync: "welfare",
  disaster_insights: "disaster",
};

async function ensureUsersTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'department_admin',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureSystemFileRegistryTable() {
  await ensureUsersTable();
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_file_registry (
      registry_key VARCHAR(100) PRIMARY KEY,
      file_path TEXT NOT NULL,
      original_filename TEXT,
      content_type TEXT,
      uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFloodRasterStoredFilename(originalName) {
  const parsed = path.parse(String(originalName || "flood-raster.tif"));
  const ext = parsed.ext || ".tif";
  const base = sanitizeFilenamePart(parsed.name) || "flood-raster";
  return `${Date.now()}-${base}${ext}`;
}

function persistUploadedFloodRaster(file) {
  const storedFilename = buildFloodRasterStoredFilename(file?.originalname);
  const targetPath = path.join(floodRasterUploadDirectory, storedFilename);
  fs.renameSync(path.resolve(file.path), targetPath);
  return targetPath;
}

async function registerSystemFile({
  registryKey,
  filePath,
  originalFilename,
  contentType,
  uploadedByUserId,
  metadata = {},
}) {
  await ensureSystemFileRegistryTable();
  const result = await db.query(
    `
      INSERT INTO system_file_registry (
        registry_key,
        file_path,
        original_filename,
        content_type,
        uploaded_by_user_id,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (registry_key)
      DO UPDATE SET
        file_path = EXCLUDED.file_path,
        original_filename = EXCLUDED.original_filename,
        content_type = EXCLUDED.content_type,
        uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
        metadata = EXCLUDED.metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING registry_key, file_path, original_filename, updated_at
    `,
    [
      registryKey,
      path.resolve(filePath),
      originalFilename || null,
      contentType || null,
      uploadedByUserId || null,
      JSON.stringify(metadata || {}),
    ],
  );
  return result.rows[0] || null;
}

async function resolveRegisteredSystemFile(registryKey) {
  await ensureSystemFileRegistryTable();
  const result = await db.query(
    `
      SELECT registry_key, file_path, original_filename, updated_at, metadata
      FROM system_file_registry
      WHERE registry_key = $1
      LIMIT 1
    `,
    [registryKey],
  );
  return result.rows[0] || null;
}

async function resolveFloodRasterPath(explicitPath) {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }

  const registered = await resolveRegisteredSystemFile("active_flood_raster");
  if (registered?.file_path && fs.existsSync(path.resolve(registered.file_path))) {
    return path.resolve(registered.file_path);
  }

  return path.resolve(DEFAULT_FLOOD_RASTER_PATH);
}

function getAuthUser(req) {
  return req.user?.user || req.user || {};
}

function resolveJobDepartment(job) {
  if (job?.meta?.datasetType && DATASET_DEPARTMENT_MAP[job.meta.datasetType]) {
    return DATASET_DEPARTMENT_MAP[job.meta.datasetType];
  }

  if (job?.meta?.task && TASK_DEPARTMENT_MAP[job.meta.task]) {
    return TASK_DEPARTMENT_MAP[job.meta.task];
  }

  return null;
}

async function requireDepartmentCapability(req, res, department, action) {
  const authUser = getAuthUser(req);

  if (!authUser.id) {
    res.status(401).json({
      status: "error",
      message: "Authentication is required",
    });
    return false;
  }

  const hasAccess = await userHasDepartmentAccess(
    authUser.id,
    authUser.role,
    department,
    action,
  );

  if (!hasAccess) {
    res.status(403).json({
      status: "error",
      message: `You do not have ${action} access to the ${department} department`,
    });
    return false;
  }

  return true;
}

function requireGlobalAccess(req, res) {
  const authUser = getAuthUser(req);
  if (isGlobalAccessRole(authUser.role)) {
    return true;
  }

  res.status(403).json({
    status: "error",
    message: "Global admin access is required for this action",
  });
  return false;
}

function serializeManagedUser(user, permissions = []) {
  return {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    isActive: Boolean(user.is_active),
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    access: buildAuthAccessProfile(user.role, permissions),
  };
}

async function loadManagedUser(userId) {
  const userResult = await db.query(
    `
      SELECT
        id,
        username,
        full_name,
        email,
        role,
        is_active,
        last_login_at,
        created_at,
        updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  if (!userResult.rowCount) {
    return null;
  }

  const user = userResult.rows[0];
  const permissions = await fetchUserDepartmentPermissions(userId);
  return serializeManagedUser(user, permissions);
}

/**
 * @openapi
 * /api/v1/admin/users:
 *   get:
 *     summary: List admin users
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User list
 */
router.get("/users", auth, requireRole("super_admin"), async (req, res) => {
  try {
    await ensureUsersTable();
    await ensureRbacSchema();

    const [userResult, permissionResult] = await Promise.all([
      db.query(
        `
          SELECT
            id,
            username,
            full_name,
            email,
            role,
            is_active,
            last_login_at,
            created_at,
            updated_at
          FROM users
          ORDER BY created_at DESC, id DESC
        `,
      ),
      db.query(
        `
          SELECT
            user_id,
            department,
            can_read,
            can_write,
            can_recompute,
            created_at,
            updated_at
          FROM user_department_permissions
          ORDER BY user_id, department
        `,
      ),
    ]);

    const permissionsByUserId = new Map();
    permissionResult.rows.forEach((permission) => {
      const existingPermissions =
        permissionsByUserId.get(permission.user_id) || [];
      existingPermissions.push(permission);
      permissionsByUserId.set(permission.user_id, existingPermissions);
    });

    return res.json({
      status: "success",
      data: userResult.rows.map((user) =>
        serializeManagedUser(user, permissionsByUserId.get(user.id) || []),
      ),
    });
  } catch (error) {
    console.error("List admin users error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load admin users",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin/users/{id}/permissions:
 *   get:
 *     summary: Get user permissions
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User permissions
 *       404:
 *         description: User not found
 */
router.get(
  "/users/:id/permissions",
  auth,
  requireRole("super_admin"),
  async (req, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "A valid user id is required",
      });
    }

    try {
      await ensureUsersTable();
      await ensureRbacSchema();

      const user = await loadManagedUser(userId);
      if (!user) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      return res.json({
        status: "success",
        data: user,
      });
    } catch (error) {
      console.error("Get user permissions error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to load user permissions",
      });
    }
  },
);

/**
 * @openapi
 * /api/v1/admin/users/{id}:
 *   patch:
 *     summary: Update a user
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: User updated
 */
router.patch(
  "/users/:id",
  auth,
  requireRole("super_admin"),
  async (req, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "A valid user id is required",
      });
    }

    const { error, value } = validateAdminUserUpdate(req.body);
    if (error) {
      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    try {
      await ensureUsersTable();
      await ensureRbacSchema();

      if (Object.prototype.hasOwnProperty.call(value, "email")) {
        const emailCheck = await db.query(
          "SELECT id FROM users WHERE email = $1 AND id <> $2 LIMIT 1",
          [value.email, userId],
        );

        if (emailCheck.rowCount) {
          return res.status(409).json({
            status: "error",
            message: "Email already registered",
          });
        }
      }

      if (Object.prototype.hasOwnProperty.call(value, "username")) {
        const usernameCheck = await db.query(
          "SELECT id FROM users WHERE username = $1 AND id <> $2 LIMIT 1",
          [value.username, userId],
        );

        if (usernameCheck.rowCount) {
          return res.status(409).json({
            status: "error",
            message: "Username already in use",
          });
        }
      }

      const updateFields = [];
      const params = [];

      if (Object.prototype.hasOwnProperty.call(value, "fullName")) {
        params.push(value.fullName);
        updateFields.push(`full_name = $${params.length}`);
      }

      if (Object.prototype.hasOwnProperty.call(value, "username")) {
        params.push(value.username);
        updateFields.push(`username = $${params.length}`);
      }

      if (Object.prototype.hasOwnProperty.call(value, "email")) {
        params.push(value.email);
        updateFields.push(`email = $${params.length}`);
      }

      if (Object.prototype.hasOwnProperty.call(value, "role")) {
        params.push(value.role);
        updateFields.push(`role = $${params.length}`);
      }

      if (Object.prototype.hasOwnProperty.call(value, "isActive")) {
        params.push(value.isActive);
        updateFields.push(`is_active = $${params.length}`);
      }

      params.push(userId);
      const result = await db.query(
        `
        UPDATE users
        SET ${updateFields.join(", ")}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${params.length}
        RETURNING id
      `,
        params,
      );

      if (!result.rowCount) {
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      const user = await loadManagedUser(userId);
      return res.json({
        status: "success",
        message: "User updated successfully",
        data: user,
      });
    } catch (error) {
      console.error("Update admin user error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to update user",
      });
    }
  },
);

/**
 * @openapi
 * /api/v1/admin/users/{id}/permissions:
 *   put:
 *     summary: Replace user permissions
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Permissions updated
 */
router.put(
  "/users/:id/permissions",
  auth,
  requireRole("super_admin"),
  async (req, res) => {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({
        status: "error",
        message: "A valid user id is required",
      });
    }

    const { error, value } = validateReplaceDepartmentPermissions(req.body);
    if (error) {
      return res.status(400).json({
        status: "error",
        message: error,
      });
    }

    await ensureUsersTable();
    await ensureRbacSchema();

    const client = await db.pool.connect();
    let hasOpenTransaction = false;

    try {
      await client.query("BEGIN");
      hasOpenTransaction = true;

      const userResult = await client.query(
        "SELECT id FROM users WHERE id = $1 LIMIT 1",
        [userId],
      );

      if (!userResult.rowCount) {
        await client.query("ROLLBACK");
        hasOpenTransaction = false;
        return res.status(404).json({
          status: "error",
          message: "User not found",
        });
      }

      await replaceUserDepartmentPermissions(client, userId, value.permissions);
      await client.query("COMMIT");
      hasOpenTransaction = false;

      const user = await loadManagedUser(userId);
      return res.json({
        status: "success",
        message: "Department permissions updated successfully",
        data: user,
      });
    } catch (error) {
      if (hasOpenTransaction) {
        await client.query("ROLLBACK");
      }
      console.error("Replace department permissions error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to update department permissions",
      });
    } finally {
      client.release();
    }
  },
);

/**
 * @openapi
 * /api/v1/admin/users:
 *   post:
 *     summary: Create a new user
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: User created
 *       409:
 *         description: Email already registered
 */
router.post("/users", auth, requireRole("super_admin"), async (req, res) => {
  const { error, value } = validateAdminUserCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const { fullName, email, password, role } = value;

  try {
    await ensureUsersTable();
    await ensureRbacSchema();

    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [email],
    );
    if (existingUser.rowCount > 0) {
      return res
        .status(409)
        .json({ status: "error", message: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    // Check if username column exists
    const columnCheck = await db.query(`
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'username'
    `);

    let result;
    if (columnCheck.rowCount > 0) {
      // Simplified username generation for admin-created users
      const username =
        email.split("@")[0] + "_" + Math.floor(Math.random() * 1000);
      result = await db.query(
        `INSERT INTO users (full_name, email, password_hash, role, username) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [fullName, email, passwordHash, role, username],
      );
    } else {
      result = await db.query(
        `INSERT INTO users (full_name, email, password_hash, role) 
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [fullName, email, passwordHash, role],
      );
    }

    const user = await loadManagedUser(result.rows[0].id);
    return res.status(201).json({
      status: "success",
      message: "User created successfully",
      data: user,
    });
  } catch (err) {
    console.error("Create user error:", err.message);
    return res
      .status(500)
      .json({ status: "error", message: "Unable to create user" });
  }
});

/**
 * @openapi
 * /api/v1/admin/users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deleted
 *       404:
 *         description: User not found
 */
router.delete(
  "/users/:id",
  auth,
  requireRole("super_admin"),
  async (req, res) => {
    const userId = Number(req.params.id);
    const authUser = getAuthUser(req);

    if (userId === authUser.id) {
      return res.status(400).json({
        status: "error",
        message: "You cannot delete your own account",
      });
    }

    try {
      const result = await db.query(
        "DELETE FROM users WHERE id = $1 RETURNING id",
        [userId],
      );
      if (!result.rowCount) {
        return res
          .status(404)
          .json({ status: "error", message: "User not found" });
      }

      return res.json({
        status: "success",
        message: "User deleted successfully",
      });
    } catch (err) {
      console.error("Delete user error:", err.message);
      return res
        .status(500)
        .json({ status: "error", message: "Unable to delete user" });
    }
  },
);

// Helper function to construct ETL command-line arguments based on input parameters
function buildEtlArgs({
  type,
  sourceType,
  filePath,
  apiUrl,
  apiHeaders,
  overpassUrl,
  overpassQuery,
  overpassTimeout,
  roadClipDistricts,
  gazetteerPath,
  district,
  programId,
  missingDataStrategy,
  worldpopYear,
  worldpopDataset,
  worldpopApiKey,
  schoolAgeMin,
  schoolAgeMax,
  childClassMax,
  analysisTypes,
  adminLevel,
  coverageDistanceKm,
  districtGroup,
  analysisDate,
}) {
  const args = ["--type", type, "--source-type", sourceType || "file"];

  if (filePath) {
    args.push("--file", filePath);
  }

  if (apiUrl) {
    args.push("--api-url", apiUrl);
  }

  if (overpassUrl) {
    args.push("--overpass-url", overpassUrl);
  }

  if (overpassQuery) {
    args.push("--overpass-query", overpassQuery);
  }

  if (overpassTimeout) {
    args.push("--overpass-timeout", String(overpassTimeout));
  }

  if (roadClipDistricts) {
    args.push("--road-clip-districts", roadClipDistricts);
  }

  if (gazetteerPath) {
    args.push("--gazetteer", path.resolve(gazetteerPath));
  }

  if (district) {
    args.push("--district", district);
  }

  if (districtGroup) {
    args.push("--district-group", districtGroup);
  }

  if (analysisDate) {
    args.push("--analysis-date", analysisDate);
  }

  if (programId !== undefined && programId !== null && programId !== "") {
    args.push("--program-id", String(programId));
  }

  if (worldpopYear) {
    args.push("--worldpop-year", String(worldpopYear));
  }

  if (worldpopDataset) {
    args.push("--worldpop-dataset", String(worldpopDataset));
  }

  if (worldpopApiKey) {
    args.push("--worldpop-api-key", String(worldpopApiKey));
  }

  if (
    schoolAgeMin !== undefined &&
    schoolAgeMin !== null &&
    schoolAgeMin !== ""
  ) {
    args.push("--school-age-min", String(schoolAgeMin));
  }

  if (
    schoolAgeMax !== undefined &&
    schoolAgeMax !== null &&
    schoolAgeMax !== ""
  ) {
    args.push("--school-age-max", String(schoolAgeMax));
  }

  if (
    childClassMax !== undefined &&
    childClassMax !== null &&
    childClassMax !== ""
  ) {
    args.push("--child-class-max", String(childClassMax));
  }

  if (adminLevel) {
    args.push("--admin-level", adminLevel);
  }

  if (coverageDistanceKm) {
    args.push("--coverage-distance-km", String(coverageDistanceKm));
  }

  if (missingDataStrategy) {
    args.push("--missing-data-strategy", missingDataStrategy);
  }

  if (Array.isArray(analysisTypes)) {
    analysisTypes.forEach((analysisType) => {
      args.push("--analysis-type", analysisType);
    });
  }

  if (apiHeaders && typeof apiHeaders === "object") {
    Object.entries(apiHeaders).forEach(([key, value]) => {
      args.push("--api-header", `${key}=${value}`);
    });
  }

  return args;
}

// Helper function to spawn the ETL process with the correct Python environment
function spawnEtlProcess(args) {
  const scriptPath = path.resolve(__dirname, "../../etl/main.py");
  const configuredPython = process.env.ETL_PYTHON_PATH;
  const localVenvPython = path.resolve(__dirname, "../../etl/venv/bin/python3");
  const pythonBinary =
    configuredPython ||
    (fs.existsSync(localVenvPython) ? localVenvPython : "python3");

  return spawn(pythonBinary, [scriptPath, ...args]);
}

// Job management functions
function createJob({ label, kind, meta = {} }) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    label,
    kind,
    meta,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    currentStage: null,
    process: null,
    terminateRequested: false,
    terminatedAt: null,
    logs: [],
  };

  jobs.set(jobId, job);
  recentJobIds.unshift(jobId);
  if (recentJobIds.length > MAX_RECENT_JOBS) {
    const staleJobId = recentJobIds.pop();
    if (staleJobId) {
      jobs.delete(staleJobId);
    }
  }

  appendJobLog(job, "Job created and waiting to start.");
  return job;
}

// Appends a log entry to the job's logs, ensuring we don't exceed the maximum log count
function appendJobLog(job, message, level = "info") {
  const entry = {
    at: new Date().toISOString(),
    level,
    message: String(message).trimEnd(),
  };
  job.logs.push(entry);
  if (job.logs.length > MAX_JOB_LOGS) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOGS);
  }
}

// Serializes a job object for API responses, including log count and recent logs
function serializeJob(job) {
  return {
    id: job.id,
    label: job.label,
    kind: job.kind,
    meta: job.meta,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    currentStage: job.currentStage,
    terminatedAt: job.terminatedAt,
    canTerminate:
      job.status === "queued" ||
      job.status === "running" ||
      job.status === "terminating",
    logCount: job.logs.length,
    logs: job.logs,
  };
}

function clearJobLogs(job) {
  if (!job) {
    return;
  }

  job.logs = [];
}

function markJobTerminated(job, message) {
  job.status = "terminated";
  job.finishedAt = new Date().toISOString();
  job.terminatedAt = job.finishedAt;
  job.currentStage = null;
  job.process = null;
  appendJobLog(job, message || "Job terminated.", "error");
}

function terminateJob(job) {
  if (!job) {
    return {
      ok: false,
      message: "Job not found",
    };
  }

  if (["completed", "failed", "terminated"].includes(job.status)) {
    return {
      ok: false,
      message: "This job has already finished",
    };
  }

  if (job.status === "queued" && !job.process) {
    job.terminateRequested = true;
    markJobTerminated(job, "Job terminated before execution started.");
    return {
      ok: true,
      message: "Queued job terminated successfully.",
    };
  }

  if (!job.process) {
    job.terminateRequested = true;
    job.status = "terminating";
    appendJobLog(
      job,
      "Termination requested. Waiting for the active process handle.",
      "error",
    );
    return {
      ok: true,
      message: "Termination requested for the active job.",
    };
  }

  if (job.status !== "terminating") {
    job.status = "terminating";
    job.terminateRequested = true;
    appendJobLog(
      job,
      "Termination requested. Sending SIGTERM to the ETL process.",
      "error",
    );
    job.process.kill("SIGTERM");
    setTimeout(() => {
      if (job.process && !job.process.killed) {
        appendJobLog(
          job,
          "Process did not exit after SIGTERM. Sending SIGKILL.",
          "error",
        );
        job.process.kill("SIGKILL");
      }
    }, 5000);
  }

  return {
    ok: true,
    message: "Termination requested for the active job.",
  };
}

// Runs a single stage of the workflow by spawning the ETL process and handling its output and completion
function runProcessForJob(job, args, stageLabel) {
  return new Promise((resolve, reject) => {
    if (job.terminateRequested) {
      reject(new Error("Job termination requested before stage start."));
      return;
    }

    job.currentStage = stageLabel;
    appendJobLog(job, `Starting ${stageLabel}...`);
    const pythonProcess = spawnEtlProcess(args);
    job.process = pythonProcess;

    pythonProcess.stdout.on("data", (data) => {
      const message = data.toString();
      message
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => appendJobLog(job, line, "stdout"));
      console.log(`ETL stdout [${job.id}/${stageLabel}]: ${message}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      const message = data.toString();
      message
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => appendJobLog(job, line, "stderr"));
      console.error(`ETL stderr [${job.id}/${stageLabel}]: ${message}`);
    });

    pythonProcess.on("error", (error) => {
      appendJobLog(
        job,
        `Unable to start ${stageLabel}: ${error.message}`,
        "error",
      );
      reject(error);
    });

    pythonProcess.on("close", (code, signal) => {
      job.process = null;
      job.currentStage = null;

      if (job.terminateRequested) {
        appendJobLog(
          job,
          `${stageLabel} terminated${signal ? ` by ${signal}` : ""}.`,
          "error",
        );
        reject(new Error(`${stageLabel} terminated`));
        return;
      }

      appendJobLog(
        job,
        `${stageLabel} finished with exit code ${code}${signal ? ` (${signal})` : ""}.`,
        code === 0 ? "info" : "error",
      );
      console.log(
        `ETL process [${job.id}/${stageLabel}] exited with code ${code} and signal ${signal}`,
      );

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${stageLabel} exited with code ${code}`));
    });
  });
}

// Runs the entire workflow for a job, executing each stage sequentially and updating job status accordingly
async function runWorkflow(job, stages) {
  if (job.terminateRequested) {
    markJobTerminated(job, "Job terminated before workflow start.");
    return;
  }

  job.status = "running";
  job.startedAt = new Date().toISOString();

  try {
    for (const stage of stages) {
      if (job.terminateRequested) {
        throw new Error("Job termination requested.");
      }
      await runProcessForJob(job, stage.args, stage.label);
    }
    job.status = "completed";
    appendJobLog(job, "Job completed successfully.");
  } catch (error) {
    if (job.terminateRequested) {
      markJobTerminated(job, error.message || "Job terminated.");
    } else {
      job.status = "failed";
      appendJobLog(job, error.message || "Job failed.", "error");
    }
  } finally {
    if (!job.finishedAt) {
      job.finishedAt = new Date().toISOString();
    }
  }
}

// Queues the workflow to run asynchronously, allowing the API to respond immediately while the job executes in the background
function queueWorkflow(job, stages) {
  setImmediate(() => {
    if (job.terminateRequested || job.status === "terminated") {
      if (!job.finishedAt) {
        markJobTerminated(job, "Job terminated before workflow execution.");
      }
      return;
    }

    runWorkflow(job, stages).catch((error) => {
      if (job.terminateRequested) {
        markJobTerminated(job, error.message || "Job terminated.");
        return;
      }

      job.status = "failed";
      job.finishedAt = new Date().toISOString();
      appendJobLog(
        job,
        error.message || "Unexpected workflow failure.",
        "error",
      );
    });
  });
}

function isJobRunningForTask(taskKey) {
  return Array.from(jobs.values()).some(
    (job) => job.status === "running" && job.meta?.task === taskKey,
  );
}

function getOverpassDefaults() {
  return {
    overpassUrl: DEFAULT_OVERPASS_URL,
    overpassQuery: DEFAULT_OVERPASS_QUERY,
    overpassTimeout: DEFAULT_OVERPASS_TIMEOUT,
    roadClipDistricts: DEFAULT_OVERPASS_DISTRICTS,
  };
}

function queueOverpassRoadSync(trigger) {
  if (!DEFAULT_OVERPASS_QUERY) {
    console.warn("Overpass road sync skipped: query is not configured.");
    return;
  }
  if (isJobRunningForTask("roads_overpass_sync")) {
    console.log("Overpass road sync skipped: job already running.");
    return;
  }

  const job = createJob({
    label: `Overpass road sync (${trigger})`,
    kind: "preset",
    meta: {
      task: "roads_overpass_sync",
      trigger,
    },
  });
  const stages = presetTaskDefinitions.roads_overpass_sync.stages(
    getOverpassDefaults(),
  );
  queueWorkflow(job, stages);
}

let overpassSchedulerStarted = false;
function startOverpassRoadSchedule() {
  if (overpassSchedulerStarted) {
    return;
  }
  const dailyAt = process.env.OVERPASS_ROADS_SCHEDULE_AT;
  if (dailyAt) {
    const [hourText, minuteText] = String(dailyAt).split(":");
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return;
    }

    overpassSchedulerStarted = true;
    const scheduleNext = () => {
      const now = new Date();
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      const delayMs = next.getTime() - now.getTime();
      setTimeout(() => {
        queueOverpassRoadSync("scheduled");
        scheduleNext();
      }, delayMs);
    };
    scheduleNext();
    return;
  }

  const intervalMinutes = Number(
    process.env.OVERPASS_ROADS_SCHEDULE_MINUTES || 0,
  );
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return;
  }

  overpassSchedulerStarted = true;
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => queueOverpassRoadSync("scheduled"), intervalMs);
  setTimeout(() => queueOverpassRoadSync("startup"), 5000);
}

// API endpoint to retrieve available task presets, returning their keys, labels, and descriptions for frontend display
/**
 * @openapi
 * /api/v1/admin/task-presets:
 *   get:
 *     summary: List available admin task presets
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Task presets
 */
router.get("/task-presets", auth, async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    let allowedDepartments = [];

    if (!isGlobalAccessRole(authUser.role)) {
      allowedDepartments = await getAccessibleDepartmentsForUser(
        authUser.id,
        authUser.role,
        "recompute",
      );
    }

    const presets = Object.entries(presetTaskDefinitions)
      .filter(([key]) => {
        const department = TASK_DEPARTMENT_MAP[key];
        if (!department) {
          return isGlobalAccessRole(authUser.role);
        }

        return (
          isGlobalAccessRole(authUser.role) ||
          allowedDepartments.includes(department)
        );
      })
      .map(([key, definition]) => ({
        key,
        label: definition.label,
        description: definition.description,
      }));

    return res.json({
      status: "success",
      data: {
        presets,
      },
    });
  } catch (error) {
    console.error("Task preset authorization error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load task presets",
    });
  }
});

router.get("/flood-raster", auth, async (req, res) => {
  try {
    const allowed = await requireDepartmentCapability(
      req,
      res,
      "disaster",
      "read",
    );
    if (!allowed) {
      return;
    }

    const registryEntry = await resolveRegisteredSystemFile("active_flood_raster");
    const resolvedPath = registryEntry?.file_path
      ? path.resolve(registryEntry.file_path)
      : path.resolve(DEFAULT_FLOOD_RASTER_PATH);
    const exists = fs.existsSync(resolvedPath);

    return res.json({
      status: "success",
      data: {
        path: resolvedPath,
        exists,
        source: registryEntry ? "registry" : "default",
        original_filename: registryEntry?.original_filename || null,
        updated_at: registryEntry?.updated_at || null,
      },
    });
  } catch (error) {
    console.error("Flood raster lookup error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load the active flood raster",
    });
  }
});

//@Get endpoint
//@desc Retrieves job details, either for a specific job if job_id is provided or a list of recent jobs if not
/**
 * @openapi
 * /api/v1/admin/jobs:
 *   get:
 *     summary: List admin jobs or fetch a specific job
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Job list or job details
 */
router.get("/jobs", auth, async (req, res) => {
  try {
    const jobId = req.query.job_id;
    const authUser = getAuthUser(req);
    const isGlobal = isGlobalAccessRole(authUser.role);
    const allowedDepartments = isGlobal
      ? []
      : await getAccessibleDepartmentsForUser(
          authUser.id,
          authUser.role,
          "read",
        );

    if (jobId) {
      const job = jobs.get(jobId);
      if (!job) {
        return res
          .status(404)
          .json({ status: "error", message: "Job not found" });
      }

      const department = resolveJobDepartment(job);
      if (
        !isGlobal &&
        (!department || !allowedDepartments.includes(department))
      ) {
        return res.status(403).json({
          status: "error",
          message: "You do not have access to this job",
        });
      }

      return res.json({
        status: "success",
        data: {
          job: serializeJob(job),
        },
      });
    }

    return res.json({
      status: "success",
      data: {
        jobs: recentJobIds
          .map((id) => jobs.get(id))
          .filter(Boolean)
          .filter((job) => {
            if (isGlobal) {
              return true;
            }

            const department = resolveJobDepartment(job);
            return Boolean(
              department && allowedDepartments.includes(department),
            );
          })
          .map((job) => serializeJob(job)),
      },
    });
  } catch (error) {
    console.error("Admin jobs authorization error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load jobs",
    });
  }
});

router.delete("/jobs/:id/logs", auth, async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const job = jobs.get(req.params.id);

    if (!job) {
      return res.status(404).json({
        status: "error",
        message: "Job not found",
      });
    }

    const department = resolveJobDepartment(job);
    if (
      !isGlobalAccessRole(authUser.role) &&
      (!department ||
        !(await userHasDepartmentAccess(
          authUser.id,
          authUser.role,
          department,
          "read",
        )))
    ) {
      return res.status(403).json({
        status: "error",
        message: "You do not have access to this job",
      });
    }

    clearJobLogs(job);

    return res.json({
      status: "success",
      message: "Job console cleared successfully.",
      data: {
        job: serializeJob(job),
      },
    });
  } catch (error) {
    console.error("Clear job logs error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to clear job console",
    });
  }
});

router.post("/jobs/:id/terminate", auth, async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const job = jobs.get(req.params.id);

    if (!job) {
      return res.status(404).json({
        status: "error",
        message: "Job not found",
      });
    }

    const department = resolveJobDepartment(job);
    if (
      !isGlobalAccessRole(authUser.role) &&
      (!department ||
        !(await userHasDepartmentAccess(
          authUser.id,
          authUser.role,
          department,
          "recompute",
        )))
    ) {
      return res.status(403).json({
        status: "error",
        message: "You do not have permission to terminate this job",
      });
    }

    const result = terminateJob(job);
    if (!result.ok) {
      return res.status(409).json({
        status: "error",
        message: result.message,
      });
    }

    return res.json({
      status: "success",
      message: result.message,
      data: {
        job: serializeJob(job),
      },
    });
  } catch (error) {
    console.error("Terminate job error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to terminate job",
    });
  }
});

/**
 * POST /admin/upload
 * Handles dataset uploads, creating a new job for the upload and queuing it for background processing
 * Expects multipart/form-data with fields for dataset type, source type, and the file itself, along with optional parameters
 */
/**
 * @openapi
 * /api/v1/admin/upload:
 *   post:
 *     summary: Upload a dataset and queue a background job
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Upload queued
 *       400:
 *         description: Missing required fields
 */
router.post("/upload", [auth, upload.single("file")], async (req, res) => {
  const {
    type,
    sourceType = "file",
    gazetteerPath,
    district,
    programId,
    missingDataStrategy = "flag",
    worldpopYear = 2020,
    worldpopDataset = "wpgppop",
    worldpopApiKey,
    schoolAgeMin = 5,
    schoolAgeMax = 17,
    childClassMax = 15,
    districtGroup,
    analysisDate,
  } = req.body;
  const file = req.file;

  if (!type) {
    return res
      .status(400)
      .json({ status: "error", message: "Dataset type is required" });
  }

  if (!file) {
    return res
      .status(400)
      .json({ status: "error", message: "No file uploaded" });
  }

  if (
    type === "welfare_beneficiary" &&
    (programId === undefined ||
      programId === null ||
      String(programId).trim() === "")
  ) {
    return res.status(400).json({
      status: "error",
      message: "Program id is required for welfare beneficiary uploads",
    });
  }

  const department = DATASET_DEPARTMENT_MAP[type];
  if (department) {
    const allowed = await requireDepartmentCapability(
      req,
      res,
      department,
      "write",
    );
    if (!allowed) {
      return;
    }
  } else if (!requireGlobalAccess(req, res)) {
    return;
  }

  let resolvedFilePath = path.resolve(file.path);
  let activeFloodRaster = null;
  if (type === "flood") {
    try {
      const persistedFloodRasterPath = persistUploadedFloodRaster(file);
      activeFloodRaster = await registerSystemFile({
        registryKey: "active_flood_raster",
        filePath: persistedFloodRasterPath,
        originalFilename: file.originalname,
        contentType: file.mimetype,
        uploadedByUserId: getAuthUser(req).id,
        metadata: {
          source: "admin_upload",
          upload_field: "file",
          uploaded_at: new Date().toISOString(),
        },
      });
      resolvedFilePath = path.resolve(persistedFloodRasterPath);
    } catch (error) {
      console.error("Flood raster upload persistence error:", error.message);
      return res.status(500).json({
        status: "error",
        message: "Unable to persist the uploaded flood raster",
      });
    }
  }

  const args = buildEtlArgs({
    type,
    sourceType: type === "worldpop" ? "worldpop" : sourceType,
    filePath: resolvedFilePath,
    gazetteerPath,
    district,
    programId,
    missingDataStrategy,
    worldpopYear,
    worldpopDataset,
    worldpopApiKey,
    schoolAgeMin,
    schoolAgeMax,
    childClassMax,
    districtGroup,
    analysisDate,
  });

  const job = createJob({
    label: `Upload ${type} dataset`,
    kind: "upload",
    meta: {
      datasetType: type,
      filename: file.originalname,
    },
  });

  queueWorkflow(job, [{ label: `Upload ${type} dataset`, args }]);

  return res.json({
    status: "success",
    message:
      type === "flood"
        ? "Flood raster uploaded, registered as active, and queued for processing."
        : "Dataset upload queued and processing in the background.",
    data: {
      job_id: job.id,
      label: job.label,
      active_flood_raster_path:
        type === "flood" ? activeFloodRaster?.file_path || resolvedFilePath : null,
    },
  });
});

/**
 * POST /admin/sync
 * Initiates a background synchronization job to fetch and process data from an external API, creating a new job and queuing it for execution
 * Expects JSON body with parameters for dataset type, API URL, headers, and other optional settings depending on the type of sync
 */
/**
 * @openapi
 * /api/v1/admin/sync:
 *   post:
 *     summary: Queue a background sync job
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Sync queued
 */
router.post("/sync", auth, async (req, res) => {
  const {
    type,
    apiUrl,
    apiHeaders,
    gazetteerPath,
    missingDataStrategy = "flag",
    district,
    worldpopYear = 2020,
    worldpopDataset = "wpgppop",
    worldpopApiKey,
    schoolAgeMin = 5,
    schoolAgeMax = 17,
    childClassMax = 15,
    analysisTypes,
    adminLevel,
    coverageDistanceKm = DEFAULT_HEALTH_COVERAGE_DISTANCE_KM,
  } = req.body;

  if (!type) {
    return res.status(400).json({
      status: "error",
      message: "Dataset type is required for API sync",
    });
  }

  if (!["worldpop", "analysis"].includes(type) && !apiUrl) {
    return res.status(400).json({
      status: "error",
      message: "apiUrl is required for non-WorldPop API sync",
    });
  }

  if (!requireGlobalAccess(req, res)) {
    return;
  }

  const args = buildEtlArgs({
    type,
    sourceType: type === "worldpop" ? "worldpop" : "api",
    apiUrl,
    apiHeaders,
    gazetteerPath,
    district,
    missingDataStrategy,
    worldpopYear,
    worldpopDataset,
    worldpopApiKey,
    schoolAgeMin,
    schoolAgeMax,
    childClassMax,
    analysisTypes,
    adminLevel,
    coverageDistanceKm,
  });

  const job = createJob({
    label: `Run ${type} background sync`,
    kind: "sync",
    meta: {
      datasetType: type,
    },
  });

  queueWorkflow(job, [{ label: `Run ${type} sync`, args }]);

  return res.json({
    status: "success",
    message: "Background sync queued successfully.",
    data: {
      job_id: job.id,
      label: job.label,
    },
  });
});

/**
 * POST /admin/run-task
 * t
 */
/**
 * @openapi
 * /api/v1/admin/run-task:
 *   post:
 *     summary: Run a predefined admin task preset
 *     tags:
 *       - Admin
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Task queued
 */
router.post("/run-task", auth, async (req, res) => {
  const {
    task,
    apiUrl = "https://api.worldpop.org/v1/services/stats",
    worldpopYear = 2020,
    worldpopApiKey,
    schoolAgeMin = 5,
    schoolAgeMax = 17,
    childClassMax = 15,
    adminLevel = "District",
    coverageDistanceKm = DEFAULT_HEALTH_COVERAGE_DISTANCE_KM,
    overpassUrl = DEFAULT_OVERPASS_URL,
    overpassQuery = DEFAULT_OVERPASS_QUERY,
    overpassTimeout = DEFAULT_OVERPASS_TIMEOUT,
    roadClipDistricts = DEFAULT_OVERPASS_DISTRICTS,
    floodRasterPath: requestedFloodRasterPath,
    analysisDate,
  } = req.body;

  const definition = presetTaskDefinitions[task];
  if (!definition) {
    return res.status(400).json({
      status: "error",
      message: "Unknown admin task preset",
    });
  }

  const authUser = getAuthUser(req);
  const department = TASK_DEPARTMENT_MAP[task];

  if (!isGlobalAccessRole(authUser.role)) {
    if (department) {
      const allowed = await requireDepartmentCapability(
        req,
        res,
        department,
        "recompute",
      );
      if (!allowed) {
        return;
      }
    } else if (!requireGlobalAccess(req, res)) {
      return;
    }
  }

  const floodRasterPath = await resolveFloodRasterPath(requestedFloodRasterPath);

  const stages = definition.stages({
    apiUrl,
    worldpopYear,
    worldpopApiKey,
    schoolAgeMin,
    schoolAgeMax,
    childClassMax,
    adminLevel,
    coverageDistanceKm,
    overpassUrl,
    overpassQuery,
    overpassTimeout,
    roadClipDistricts,
    floodRasterPath,
    analysisDate,
  });

  const includesFloodStage = stages.some(
    (stage) =>
      Array.isArray(stage.args) &&
      stage.args.includes("--type") &&
      stage.args.includes("flood"),
  );

  if (includesFloodStage && !fs.existsSync(path.resolve(floodRasterPath))) {
    return res.status(400).json({
      status: "error",
      message: `Flood raster file not found: ${path.resolve(floodRasterPath)}`,
    });
  }

  const job = createJob({
    label: definition.label,
    kind: "preset",
    meta: {
      task,
    },
  });

  queueWorkflow(job, stages);

  return res.json({
    status: "success",
    message: `${definition.label} has started in the background.`,
    data: {
      job_id: job.id,
      label: job.label,
      task,
      flood_raster_path: includesFloodStage ? floodRasterPath : null,
    },
  });
});

startOverpassRoadSchedule();

module.exports = router;
