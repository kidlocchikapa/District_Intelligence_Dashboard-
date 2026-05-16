const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const db = require("../db");
const auth = require("../middleware/auth");
const requireDepartmentAccess = require("../middleware/requireDepartmentAccess");
const ensureAdminDataSchema = require("../helpers/adminDataSchema");
const {
  validateEducationCreate,
  validateEducationUpdate,
  validateHealthCreate,
  validateHealthUpdate,
  validateWelfareCreate,
  validateWelfareUpdate,
  validateDisasterCreate,
  validateDisasterUpdate,
  validateWelfareProgramCreate,
  validateWelfareBeneficiaryCreate,
} = require("../validators/adminDataValidation");
const {
  getAuthUser,
  parsePositiveInteger,
  normalizeSortOrder,
  writeAuditEntry,
  validateDistrictWardRelationship,
  validateWardExists,
  markDepartmentStale,
  clearDepartmentStale,
  getStaleDepartments,
} = require("../services/adminDataService");
const {
  getAccessibleDepartmentsForUser,
  isGlobalAccessRole,
} = require("../services/rbacService");

const router = express.Router();

const RECOMPUTE_DEFINITION = {
  education: {
    task: "education_insights",
    analysisTypes: [
      "education_summary",
      "nearest_school_distance",
      "school_service_coverage",
    ],
  },
  health: {
    task: "health_insights",
    analysisTypes: [
      "health_summary",
      "health_population_served",
      "health_2sfca_access",
      "nearest_health_distance",
      "health_service_coverage",
    ],
  },
  disaster: {
    task: "disaster_insights",
    analysisTypes: ["disaster_vulnerability"],
  },
};

const recomputeState = {
  education: {
    status: "idle",
    stale: false,
    task: RECOMPUTE_DEFINITION.education.task,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  },
  health: {
    status: "idle",
    stale: false,
    task: RECOMPUTE_DEFINITION.health.task,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  },
  welfare: {
    status: "not_supported",
    stale: false,
    task: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  },
  disaster: {
    status: "idle",
    stale: false,
    task: RECOMPUTE_DEFINITION.disaster.task,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastError: null,
  },
};

let welfareWardColumnPromise = null;

const EDUCATION_SORT_COLUMNS = {
  name: "COALESCE(to_jsonb(ef)->>'name', to_jsonb(ef)->>'school_name')",
  status: "ef.status",
  student_enrollment_total: "ef.student_enrollment_total",
  teacher_count: "ef.teacher_count",
  created_at: "ef.created_at",
  updated_at: "ef.updated_at",
};

const EDUCATION_LIST_SORT_COLUMNS = {
  name: "name",
  status: "status",
  student_enrollment_total: "student_enrollment_total",
  teacher_count: "teacher_count",
  created_at: "created_at",
  updated_at: "updated_at",
};

const HEALTH_SORT_COLUMNS = {
  name: "hf.name",
  type: "hf.type",
  healthcare: "COALESCE(to_jsonb(hf)->>'healthcare', hf.type)",
  beds_count: "hf.beds_count",
  patient_visits_total: "hf.patient_visits_total",
  created_at: "hf.created_at",
  updated_at: "hf.updated_at",
};

const WELFARE_SORT_COLUMNS = {
  program_name: "wb.program_name",
  beneficiary_count: "wb.beneficiary_count",
  created_at: "wb.created_at",
  updated_at: "wb.updated_at",
};

const DISASTER_SORT_COLUMNS = {
  event_type: "dz.event_type",
  risk_level: "dz.risk_level",
  population_at_risk: "dz.population_at_risk",
  created_at: "dz.created_at",
  updated_at: "dz.updated_at",
};

const EDUCATION_SELECT_FIELDS = `
  ef.school_id,
  COALESCE(to_jsonb(ef)->>'name', to_jsonb(ef)->>'school_name') AS name,
  COALESCE(to_jsonb(ef)->>'name:en', to_jsonb(ef)->>'school_name') AS name_en,
  to_jsonb(ef)->>'name:ny' AS name_ny,
  to_jsonb(ef)->>'amenity' AS amenity,
  to_jsonb(ef)->>'building' AS building,
  COALESCE(to_jsonb(ef)->>'operator:type', to_jsonb(ef)->>'operator') AS operator_type,
  CASE
    WHEN (to_jsonb(ef)->>'capacity:persons') ~ '^[0-9]+$'
      THEN (to_jsonb(ef)->>'capacity:persons')::integer
    ELSE NULL
  END AS capacity_persons,
  to_jsonb(ef)->>'addr:full' AS address_full,
  to_jsonb(ef)->>'addr:city' AS address_city,
  to_jsonb(ef)->>'source' AS source,
  ef.status,
  to_jsonb(ef)->>'comments' AS comments,
  COALESCE(to_jsonb(ef)->'student_enrollment', '{}'::jsonb) AS student_enrollment,
  ef.student_enrollment_total,
  ef.student_classroom_ratio,
  ef.special_needs_students,
  ef.teacher_distribution,
  ef.teacher_count,
  ef.blocks_count,
  ef.water_equipment_facility_count,
  ef.toilets_count,
  ef.classroom_pressure,
  ef.teacher_pressure,
  ef.x_coordinate,
  ef.y_coordinate,
  to_jsonb(ef)->>'osm_id' AS osm_id,
  to_jsonb(ef)->>'osm_type' AS osm_type,
  ef.ta_id AS ward_id,
  ward.name AS ward_name,
  ef.district_id,
  district.name AS district_name,
  ef.is_active,
  ef.created_at,
  ef.updated_at,
  ST_Y(ef.geom) AS latitude,
  ST_X(ef.geom) AS longitude
`;

const HEALTH_SELECT_FIELDS = `
  hf.id,
  hf.name,
  hf.type,
  COALESCE(to_jsonb(hf)->>'healthcare', hf.type) AS healthcare,
  hf.beds_count,
  hf.patient_visits_total,
  hf.services_offered,
  hf.ta_id AS ward_id,
  ward.name AS ward_name,
  hf.district_id,
  district.name AS district_name,
  hf.is_active,
  hf.created_at,
  hf.updated_at,
  ST_Y(hf.geom) AS latitude,
  ST_X(hf.geom) AS longitude
`;

function normalizeWelfareWardColumn(columnName) {
  return columnName === "ta_id" ? "ta_id" : "ward_id";
}

async function getWelfareWardColumn() {
  if (!welfareWardColumnPromise) {
    welfareWardColumnPromise = db
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'welfare_beneficiaries'
            AND column_name IN ('ta_id', 'ward_id')
          ORDER BY CASE WHEN column_name = 'ta_id' THEN 0 ELSE 1 END
          LIMIT 1
        `,
      )
      .then((result) =>
        normalizeWelfareWardColumn(result.rows[0]?.column_name),
      )
      .catch((error) => {
        welfareWardColumnPromise = null;
        throw error;
      });
  }

  return welfareWardColumnPromise;
}

function buildWelfareSelectFields(wardColumn) {
  const safeWardColumn = normalizeWelfareWardColumn(wardColumn);

  return `
    wb.id,
    wb.program_name,
    wb.beneficiary_count,
    wb.${safeWardColumn} AS ward_id,
    ward.name AS ward_name,
    ward.district_id AS district_id,
    district.name AS district_name,
    wb.is_active,
    wb.created_at,
    wb.updated_at,
    ST_Y(wb.geom) AS latitude,
    ST_X(wb.geom) AS longitude
  `;
}

const DISASTER_SELECT_FIELDS = `
  dz.id,
  dz.event_type,
  dz.risk_level,
  dz.population_at_risk,
  dz.is_active,
  dz.created_at,
  dz.updated_at,
  ST_AsGeoJSON(dz.geom)::jsonb AS geometry
`;

router.use(auth);
router.use(async (req, res, next) => {
  try {
    await ensureAdminDataSchema();
    return next();
  } catch (error) {
    console.error("Admin data schema ensure error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to prepare admin data schema support",
    });
  }
});

function resolveAdminDataAccessRule(req) {
  const segments = String(req.path || "")
    .split("/")
    .filter(Boolean);

  if (!segments.length) {
    return null;
  }

  if (segments[0] === "recompute") {
    if (segments[1] === "status") {
      return { kind: "status" };
    }

    return {
      kind: "department",
      department: segments[1],
      action: "recompute",
    };
  }

  if (
    !["education", "health", "social_welfare", "disaster"].includes(segments[0])
  ) {
    return null;
  }

  return {
    kind: "department",
    department: segments[0],
    action: req.method === "GET" ? "read" : "write",
  };
}

router.use(async (req, res, next) => {
  const accessRule = resolveAdminDataAccessRule(req);
  if (!accessRule || accessRule.kind === "status") {
    return next();
  }

  return requireDepartmentAccess(accessRule.department, accessRule.action)(
    req,
    res,
    next,
  );
});

function parseBooleanFilter(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const normalized = String(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

function normalizeSortColumn(sortBy, map, fallback) {
  return map[sortBy] || map[fallback] || map.updated_at;
}

function requireLatLngTogether(payload) {
  if (
    (Object.prototype.hasOwnProperty.call(payload, "latitude") &&
      !Object.prototype.hasOwnProperty.call(payload, "longitude")) ||
    (!Object.prototype.hasOwnProperty.call(payload, "latitude") &&
      Object.prototype.hasOwnProperty.call(payload, "longitude"))
  ) {
    throw new Error("latitude and longitude must be provided together");
  }
}

function parseDisasterGeometry(geometryGeoJson) {
  if (geometryGeoJson == null) {
    return null;
  }

  if (typeof geometryGeoJson === "string") {
    const trimmed = geometryGeoJson.trim();
    if (!trimmed) {
      return null;
    }

    return trimmed;
  }

  return JSON.stringify(geometryGeoJson);
}

function mergeRecomputeStaleState() {
  const stale = getStaleDepartments();
  Object.keys(recomputeState).forEach((department) => {
    recomputeState[department].stale = stale[department] || false;
  });

  return recomputeState;
}

function spawnEtlProcess(args) {
  const scriptPath = path.resolve(__dirname, "../../etl/main.py");
  const configuredPython = process.env.ETL_PYTHON_PATH;
  const localVenvPython = path.resolve(__dirname, "../../etl/venv/bin/python3");
  const pythonBinary =
    configuredPython ||
    (fs.existsSync(localVenvPython) ? localVenvPython : "python3");

  return spawn(pythonBinary, [scriptPath, ...args]);
}

function runRecomputeInBackground(
  department,
  { adminLevel, coverageDistanceKm, worldpopYear },
) {
  const definition = RECOMPUTE_DEFINITION[department];
  if (!definition) {
    throw new Error("Recompute is not supported for this department");
  }

  if (recomputeState[department].status === "running") {
    throw new Error(`${department} recompute is already running`);
  }

  const args = [
    "--type",
    "analysis",
    "--source-type",
    "file",
    "--admin-level",
    adminLevel || "District",
  ];

  if (
    coverageDistanceKm !== undefined &&
    coverageDistanceKm !== null &&
    coverageDistanceKm !== ""
  ) {
    args.push("--coverage-distance-km", String(coverageDistanceKm));
  }

  if (department === "health" && worldpopYear) {
    args.push("--worldpop-year", String(worldpopYear));
  }

  definition.analysisTypes.forEach((analysisType) => {
    args.push("--analysis-type", analysisType);
  });

  const processHandle = spawnEtlProcess(args);

  recomputeState[department].status = "running";
  recomputeState[department].lastStartedAt = new Date().toISOString();
  recomputeState[department].lastFinishedAt = null;
  recomputeState[department].lastError = null;

  processHandle.on("close", (code) => {
    recomputeState[department].lastFinishedAt = new Date().toISOString();

    if (code === 0) {
      recomputeState[department].status = "completed";
      clearDepartmentStale(department);
      recomputeState[department].stale = false;
      return;
    }

    recomputeState[department].status = "failed";
    recomputeState[department].lastError =
      `ETL process exited with code ${code}`;
    markDepartmentStale(department);
    recomputeState[department].stale = true;
  });

  processHandle.on("error", (error) => {
    recomputeState[department].status = "failed";
    recomputeState[department].lastError = error.message;
    recomputeState[department].lastFinishedAt = new Date().toISOString();
    markDepartmentStale(department);
    recomputeState[department].stale = true;
  });
}

function buildEducationListFilters(query) {
  const conditions = [];
  const params = [];

  if (String(query.include_archived).toLowerCase() !== "true") {
    conditions.push("COALESCE(ef.is_active, TRUE) = TRUE");
  }

  const isActive = parseBooleanFilter(query.is_active);
  if (isActive !== null) {
    params.push(isActive);
    conditions.push(`COALESCE(ef.is_active, TRUE) = $${params.length}`);
  }

  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`
      (
        COALESCE(to_jsonb(ef)->>'name', to_jsonb(ef)->>'school_name', '') ILIKE $${params.length}
        OR COALESCE(to_jsonb(ef)->>'name:en', '') ILIKE $${params.length}
        OR COALESCE(to_jsonb(ef)->>'name:ny', '') ILIKE $${params.length}
        OR COALESCE(ef.status, '') ILIKE $${params.length}
      )
    `);
  }

  if (query.status && String(query.status).trim()) {
    params.push(`%${String(query.status).trim()}%`);
    conditions.push(`COALESCE(ef.status, '') ILIKE $${params.length}`);
  }

  const districtId = parsePositiveInteger(query.district_id, null);
  if (districtId) {
    params.push(districtId);
    conditions.push(`ef.district_id = $${params.length}`);
  }

  const wardId = parsePositiveInteger(query.ward_id, null);
  if (wardId) {
    params.push(wardId);
    conditions.push(`ef.ta_id = $${params.length}`);
  }

  if (query.filter === "flood_exposed") {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM flood_facility_exposure ffe
        WHERE ffe.facility_type = 'education'
          AND ffe.is_exposed = TRUE
          AND ffe.facility_id = ef.school_id
      )
    `);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
    isActive,
  };
}

function buildHealthListFilters(query) {
  const conditions = [];
  const params = [];

  if (String(query.include_archived).toLowerCase() !== "true") {
    conditions.push("COALESCE(hf.is_active, TRUE) = TRUE");
  }

  const isActive = parseBooleanFilter(query.is_active);
  if (isActive !== null) {
    params.push(isActive);
    conditions.push(`COALESCE(hf.is_active, TRUE) = $${params.length}`);
  }

  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`
      (
        COALESCE(hf.name, '') ILIKE $${params.length}
        OR COALESCE(hf.type, '') ILIKE $${params.length}
        OR COALESCE(to_jsonb(hf)->>'healthcare', '') ILIKE $${params.length}
      )
    `);
  }

  const districtId = parsePositiveInteger(query.district_id, null);
  if (districtId) {
    params.push(districtId);
    conditions.push(`hf.district_id = $${params.length}`);
  }

  const wardId = parsePositiveInteger(query.ward_id, null);
  if (wardId) {
    params.push(wardId);
    conditions.push(`hf.ta_id = $${params.length}`);
  }

  if (query.filter === "flood_exposed") {
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM flood_facility_exposure ffe
        WHERE ffe.facility_type = 'health'
          AND ffe.is_exposed = TRUE
          AND ffe.facility_id = hf.id
      )
    `);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
    isActive,
  };
}

function buildWelfareListFilters(query, wardColumn) {
  const safeWardColumn = normalizeWelfareWardColumn(wardColumn);
  const conditions = [];
  const params = [];

  if (String(query.include_archived).toLowerCase() !== "true") {
    conditions.push("COALESCE(wb.is_active, TRUE) = TRUE");
  }

  const isActive = parseBooleanFilter(query.is_active);
  if (isActive !== null) {
    params.push(isActive);
    conditions.push(`COALESCE(wb.is_active, TRUE) = $${params.length}`);
  }

  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`COALESCE(wb.program_name, '') ILIKE $${params.length}`);
  }

  const wardId = parsePositiveInteger(query.ward_id, null);
  if (wardId) {
    params.push(wardId);
    conditions.push(`wb.${safeWardColumn} = $${params.length}`);
  }

  const districtId = parsePositiveInteger(query.district_id, null);
  if (districtId) {
    params.push(districtId);
    conditions.push(`ward.district_id = $${params.length}`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
    isActive,
  };
}

function buildDisasterListFilters(query) {
  const conditions = [];
  const params = [];

  if (String(query.include_archived).toLowerCase() !== "true") {
    conditions.push("COALESCE(dz.is_active, TRUE) = TRUE");
  }

  const isActive = parseBooleanFilter(query.is_active);
  if (isActive !== null) {
    params.push(isActive);
    conditions.push(`COALESCE(dz.is_active, TRUE) = $${params.length}`);
  }

  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    conditions.push(`
      (
        COALESCE(dz.event_type, '') ILIKE $${params.length}
        OR COALESCE(dz.risk_level, '') ILIKE $${params.length}
      )
    `);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId: null,
    wardId: null,
    isActive,
  };
}

function mapEducationPayloadToColumns(payload) {
  const columnMap = [
    ["name", "school_name"],
    ["operatorType", "operator"],
    ["status", "status"],
    ["studentEnrollmentTotal", "student_enrollment_total"],
    ["studentClassroomRatio", "student_classroom_ratio"],
    ["specialNeedsStudents", "special_needs_students"],
    ["teacherDistribution", "teacher_distribution"],
    ["teacherCount", "teacher_count"],
    ["blocksCount", "blocks_count"],
    ["waterEquipmentFacilityCount", "water_equipment_facility_count"],
    ["toiletsCount", "toilets_count"],
    ["classroomPressure", "classroom_pressure"],
    ["teacherPressure", "teacher_pressure"],
    ["districtId", "district_id"],
    ["wardId", "ta_id"],
    ["isActive", "is_active"],
  ];

  return columnMap
    .filter(([inputKey]) =>
      Object.prototype.hasOwnProperty.call(payload, inputKey),
    )
    .map(([inputKey, columnName]) => ({
      columnName,
      value: payload[inputKey],
    }));
}

function mapHealthPayloadToColumns(payload) {
  const columnMap = [
    ["name", "name"],
    ["type", "type"],
    ["healthcare", "healthcare"],
    ["bedsCount", "beds_count"],
    ["patientVisitsTotal", "patient_visits_total"],
    ["servicesOffered", "services_offered"],
    ["districtId", "district_id"],
    ["wardId", "ta_id"],
    ["isActive", "is_active"],
  ];

  return columnMap
    .filter(([inputKey]) =>
      Object.prototype.hasOwnProperty.call(payload, inputKey),
    )
    .map(([inputKey, columnName]) => ({
      columnName,
      value: payload[inputKey],
    }));
}

function mapWelfarePayloadToColumns(payload, wardColumn) {
  const safeWardColumn = normalizeWelfareWardColumn(wardColumn);
  const columnMap = [
    ["programName", "program_name"],
    ["beneficiaryCount", "beneficiary_count"],
    ["wardId", safeWardColumn],
    ["isActive", "is_active"],
  ];

  return columnMap
    .filter(([inputKey]) =>
      Object.prototype.hasOwnProperty.call(payload, inputKey),
    )
    .map(([inputKey, columnName]) => ({
      columnName,
      value: payload[inputKey],
    }));
}

function mapDisasterPayloadToColumns(payload) {
  const columnMap = [
    ["eventType", "event_type"],
    ["riskLevel", "risk_level"],
    ["populationAtRisk", "population_at_risk"],
    ["isActive", "is_active"],
  ];

  return columnMap
    .filter(([inputKey]) =>
      Object.prototype.hasOwnProperty.call(payload, inputKey),
    )
    .map(([inputKey, columnName]) => ({
      columnName,
      value: payload[inputKey],
    }));
}

async function fetchEducationRecord(client, schoolId) {
  const result = await client.query(
    `
      SELECT
        ${EDUCATION_SELECT_FIELDS}
      FROM education_facilities ef
      LEFT JOIN admin3_units ward ON ward.id = ef.ta_id
      LEFT JOIN districts district ON district.id = COALESCE(ef.district_id, ward.district_id)
      WHERE ef.school_id = $1
      LIMIT 1
    `,
    [schoolId],
  );

  return result.rows[0] || null;
}

async function fetchHealthRecord(client, id) {
  const result = await client.query(
    `
      SELECT
        ${HEALTH_SELECT_FIELDS}
      FROM health_facilities hf
      LEFT JOIN admin3_units ward ON ward.id = hf.ta_id
      LEFT JOIN districts district ON district.id = COALESCE(hf.district_id, ward.district_id)
      WHERE hf.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

async function fetchWelfareRecord(client, id, wardColumn) {
  const safeWardColumn = normalizeWelfareWardColumn(wardColumn);
  const selectFields = buildWelfareSelectFields(safeWardColumn);
  const result = await client.query(
    `
      SELECT
        ${selectFields}
      FROM welfare_beneficiaries wb
      LEFT JOIN admin3_units ward ON ward.id = wb.${safeWardColumn}
      LEFT JOIN districts district ON district.id = ward.district_id
      WHERE wb.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

async function fetchDisasterRecord(client, id) {
  const result = await client.query(
    `
      SELECT
        ${DISASTER_SELECT_FIELDS}
      FROM disaster_zones dz
      WHERE dz.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

async function fetchHistoryRows(tableName, recordId) {
  const result = await db.query(
    `
      SELECT
        ade.id,
        ade.table_name,
        ade.record_id,
        ade.action,
        ade.changed_by_user_id,
        ade.before_data,
        ade.after_data,
        ade.changed_fields,
        ade.changed_at,
        u.email AS changed_by_email,
        u.full_name AS changed_by_full_name
      FROM admin_data_edits ade
      LEFT JOIN users u ON u.id = ade.changed_by_user_id
      WHERE ade.table_name = $1
        AND ade.record_id = $2
      ORDER BY ade.changed_at DESC, ade.id DESC
    `,
    [tableName, recordId],
  );

  return result.rows;
}

/**
 * @openapi
 * /api/v1/admin-data/education:
 *   get:
 *     summary: List education records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Education records
 */
router.get("/education", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(
      parsePositiveInteger(req.query.page_size, 25),
      100,
    );
    const offset = (page - 1) * pageSize;
    const { whereClause, params, districtId, wardId, isActive } =
      buildEducationListFilters(req.query);
    const orderBy = normalizeSortColumn(
      req.query.sort_by,
      EDUCATION_LIST_SORT_COLUMNS,
      "updated_at",
    );
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM (
          SELECT 1
          FROM education_facilities ef
          ${whereClause}
          GROUP BY
            LOWER(TRIM(COALESCE(to_jsonb(ef)->>'name', to_jsonb(ef)->>'school_name', ''))),
            COALESCE(ef.ta_id, 0),
            COALESCE(ef.district_id, 0)
        ) deduped_education
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        WITH ranked_education AS (
          SELECT
            ${EDUCATION_SELECT_FIELDS},
            ROW_NUMBER() OVER (
              PARTITION BY
                LOWER(TRIM(COALESCE(to_jsonb(ef)->>'name', to_jsonb(ef)->>'school_name', ''))),
                COALESCE(ef.ta_id, 0),
                COALESCE(ef.district_id, ward.district_id, 0)
              ORDER BY
                ef.updated_at DESC NULLS LAST,
                ef.created_at DESC NULLS LAST,
                ef.school_id DESC
            ) AS duplicate_rank
          FROM education_facilities ef
          LEFT JOIN admin3_units ward ON ward.id = ef.ta_id
          LEFT JOIN districts district ON district.id = COALESCE(ef.district_id, ward.district_id)
          ${whereClause}
        )
        SELECT *
        FROM ranked_education
        WHERE duplicate_rank = 1
        ORDER BY ${orderBy} ${orderDirection}, school_id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
          is_active: isActive,
          include_archived:
            String(req.query.include_archived).toLowerCase() === "true",
        },
      },
    });
  } catch (error) {
    console.error("Admin education list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load education records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/facility_access:
 *   get:
 *     summary: List education facility access metrics
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page_size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: district_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: ward_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Education facility access metrics
 */
router.get("/education/facility_access", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`ef.district_id = $${params.length}`);
    }

    const wardId = parsePositiveInteger(req.query.ward_id, null);
    if (wardId) {
      params.push(wardId);
      conditions.push(`ef.ta_id = $${params.length}`);
    }

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`COALESCE(ef.school_name, '') ILIKE $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM education_facility_access_metrics eam
        JOIN education_facilities ef ON ef.school_id = eam.facility_id
        ${whereClause}
      `,
      params
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          eam.facility_id,
          ef.school_name                              AS name,
          ward.name                                   AS ward_name,
          district.name                               AS district_name,
          eam.coverage_distance_km,
          eam.worldpop_population_within_buffer,
          eam.welfare_beneficiaries_within_buffer,
          eam.avg_network_distance_km,
          eam.avg_travel_time_min,
          eam.calculated_at
        FROM education_facility_access_metrics eam
        JOIN education_facilities ef
          ON ef.school_id = eam.facility_id
        LEFT JOIN admin3_units ward
          ON ward.id = ef.ta_id
        LEFT JOIN districts district
          ON district.id = COALESCE(ef.district_id, ward.district_id)
        ${whereClause}
        ORDER BY district.name ASC NULLS LAST, ward.name ASC NULLS LAST, ef.school_name ASC NULLS LAST
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map((row) => ({
          facility_id: Number(row.facility_id),
          name: row.name || null,
          ward_name: row.ward_name || null,
          district_name: row.district_name || null,
          coverage_distance_km: row.coverage_distance_km != null ? Number(row.coverage_distance_km) : null,
          worldpop_population_within_buffer: row.worldpop_population_within_buffer != null
            ? Math.round(Number(row.worldpop_population_within_buffer))
            : null,
          welfare_beneficiaries_within_buffer: row.welfare_beneficiaries_within_buffer != null
            ? Number(row.welfare_beneficiaries_within_buffer)
            : null,
          avg_network_distance_km: row.avg_network_distance_km != null
            ? Number(Number(row.avg_network_distance_km).toFixed(2))
            : null,
          avg_travel_time_min: row.avg_travel_time_min != null
            ? Number(Number(row.avg_travel_time_min).toFixed(1))
            : null,
          calculated_at: row.calculated_at || null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
        },
      },
    });
  } catch (error) {
    console.error("Admin education facility access error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load education facility access metrics",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/flood_exposed:
 *   get:
 *     summary: List flood-exposed education facilities from flood_facility_exposure
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page_size
 *         schema:
 *           type: integer
 *       - in: query
 *         name: district_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: ta_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: risk_class
 *         schema:
 *           type: string
 *           enum: [low, medium, high]
 *       - in: query
 *         name: exposed_only
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Flood-exposed education facilities
 */
router.get("/education/flood_exposed", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = ["LOWER(ffe.facility_type) = 'education'"];
    const params = [];

    // Always use the latest analysis date
    conditions.push(
      `ffe.analysis_date = (SELECT MAX(analysis_date) FROM flood_facility_exposure WHERE LOWER(facility_type) = 'education')`
    );

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`ffe.district_id = $${params.length}`);
    }

    const taId = parsePositiveInteger(req.query.ta_id, null);
    if (taId) {
      params.push(taId);
      conditions.push(`ffe.ta_id = $${params.length}`);
    }

    const riskClass = req.query.risk_class
      ? String(req.query.risk_class).trim().toLowerCase()
      : null;
    if (riskClass && ["low", "medium", "high"].includes(riskClass)) {
      params.push(riskClass);
      conditions.push(`LOWER(ffe.risk_class) = $${params.length}`);
    }

    const exposedOnly = parseBooleanFilter(req.query.exposed_only);
    if (exposedOnly === true) {
      conditions.push("ffe.is_exposed = TRUE");
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM flood_facility_exposure ffe ${whereClause}`,
      params
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ffe.id,
          ffe.facility_id,
          ffe.facility_name,
          ffe.district_id,
          ffe.district_name,
          ffe.ta_id,
          ffe.ta_name,
          ffe.flood_value,
          ffe.risk_class,
          ffe.is_exposed,
          ffe.analysis_date,
          ef.school_name                              AS school_name,
          ef.student_enrollment_total,
          ef.teacher_count,
          ef.status                                   AS school_status,
          ST_Y(ef.geom)                               AS latitude,
          ST_X(ef.geom)                               AS longitude
        FROM flood_facility_exposure ffe
        LEFT JOIN education_facilities ef
          ON ef.school_id = ffe.facility_id
        ${whereClause}
        ORDER BY ffe.is_exposed DESC, ffe.risk_class DESC, ffe.district_name ASC, ffe.ta_name ASC, ffe.facility_name ASC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map((row) => ({
          id: Number(row.id),
          facility_id: Number(row.facility_id),
          facility_name: row.facility_name || row.school_name || null,
          school_name: row.school_name || null,
          district_id: Number(row.district_id),
          district_name: row.district_name || null,
          ta_id: Number(row.ta_id),
          ta_name: row.ta_name || null,
          flood_value: row.flood_value != null ? Number(Number(row.flood_value).toFixed(4)) : null,
          risk_class: row.risk_class || null,
          is_exposed: Boolean(row.is_exposed),
          analysis_date: row.analysis_date || null,
          student_enrollment_total: row.student_enrollment_total != null
            ? Number(row.student_enrollment_total)
            : null,
          teacher_count: row.teacher_count != null ? Number(row.teacher_count) : null,
          school_status: row.school_status || null,
          latitude: row.latitude != null ? Number(row.latitude) : null,
          longitude: row.longitude != null ? Number(row.longitude) : null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          district_id: districtId,
          ta_id: taId,
          risk_class: riskClass,
          exposed_only: exposedOnly,
        },
      },
    });
  } catch (error) {
    console.error("Admin education flood exposed error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load flood-exposed education facilities",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health:
 *   get:
 *     summary: List health records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Health records
 */
router.get("/health", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(
      parsePositiveInteger(req.query.page_size, 25),
      100,
    );
    const offset = (page - 1) * pageSize;
    const { whereClause, params, districtId, wardId, isActive } =
      buildHealthListFilters(req.query);
    const orderBy = normalizeSortColumn(
      req.query.sort_by,
      HEALTH_SORT_COLUMNS,
      "updated_at",
    );
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM health_facilities hf
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ${HEALTH_SELECT_FIELDS}
        FROM health_facilities hf
        LEFT JOIN admin3_units ward ON ward.id = hf.ta_id
        LEFT JOIN districts district ON district.id = COALESCE(hf.district_id, ward.district_id)
        ${whereClause}
        ORDER BY ${orderBy} ${orderDirection}, hf.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
          is_active: isActive,
          include_archived:
            String(req.query.include_archived).toLowerCase() === "true",
        },
      },
    });
  } catch (error) {
    console.error("Admin health list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load health records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare:
 *   get:
 *     summary: List individual welfare beneficiary records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Welfare beneficiary records
 */
router.get("/social_welfare", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`(
        COALESCE(wb.firstname, '') ILIKE $${params.length}
        OR COALESCE(wb.lastname, '') ILIKE $${params.length}
        OR COALESCE(wp.program_name, '') ILIKE $${params.length}
      )`);
    }

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`wb.district_id = $${params.length}`);
    }

    const wardId = parsePositiveInteger(req.query.ward_id, null);
    if (wardId) {
      params.push(wardId);
      conditions.push(`wb.ta_id = $${params.length}`);
    }

    const programId = parsePositiveInteger(req.query.program_id, null);
    if (programId) {
      params.push(programId);
      conditions.push(`wb.program_id = $${params.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM welfare_beneficiary wb
       LEFT JOIN welfare_programs wp ON wp.program_id = wb.program_id
       ${whereClause}`,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          wb.id,
          wb.program_id,
          COALESCE(wp.program_name, CONCAT('Program ', wb.program_id::text)) AS program_name,
          wb.firstname,
          wb.lastname,
          wb.gender,
          wb.age,
          wb.district_id,
          wb.ta_id,
          wb.household_size,
          wb.status,
          wb.start_date,
          wb.end_date,
          d.name  AS district_name,
          a3.name AS ta_name,
          wb.created_at,
          wb.updated_at,
          ST_Y(wb.geom) AS latitude,
          ST_X(wb.geom) AS longitude
        FROM welfare_beneficiary wb
        LEFT JOIN welfare_programs wp ON wp.program_id = wb.program_id
        LEFT JOIN districts d  ON d.id  = wb.district_id
        LEFT JOIN admin3_units a3 ON a3.id = wb.ta_id
        ${whereClause}
        ORDER BY wb.updated_at DESC NULLS LAST, wb.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
          program_id: programId,
        },
      },
    });
  } catch (error) {
    console.error("Admin welfare beneficiary list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load welfare beneficiary records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/beneficiary_indicators:
 *   get:
 *     summary: List welfare beneficiary indicators
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Welfare beneficiary indicator records
 */
router.get("/social_welfare/beneficiary_indicators", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`wbi.district_id = $${params.length}`);
    }

    const wardId = parsePositiveInteger(req.query.ward_id, null);
    if (wardId) {
      params.push(wardId);
      conditions.push(`wbi.ta_id = $${params.length}`);
    }

    const programId = parsePositiveInteger(req.query.program_id, null);
    if (programId) {
      params.push(programId);
      conditions.push(`wbi.program_id = $${params.length}`);
    }

    if (req.query.affected_by_flood === "true") {
      conditions.push("wbi.affected_by_flood = TRUE");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM welfare_beneficiary_indicators wbi ${whereClause}`,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          wbi.id,
          wbi.beneficiary_id,
          CONCAT(wb.firstname, ' ', wb.lastname) AS beneficiary_name,
          COALESCE(wp.program_name, CONCAT('Program ', wbi.program_id::text)) AS program_name,
          d.name  AS district_name,
          a3.name AS ta_name,
          wbi.affected_by_flood,
          wbi.has_school_access,
          wbi.has_health_facility_access,
          wbi.created_at,
          wbi.updated_at
        FROM welfare_beneficiary_indicators wbi
        LEFT JOIN welfare_beneficiary wb ON wb.id = wbi.beneficiary_id
        LEFT JOIN welfare_programs wp    ON wp.program_id = wbi.program_id
        LEFT JOIN districts d            ON d.id  = wbi.district_id
        LEFT JOIN admin3_units a3        ON a3.id = wbi.ta_id
        ${whereClause}
        ORDER BY wbi.updated_at DESC NULLS LAST, wbi.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map((row) => ({
          ...row,
          affected_by_flood: Boolean(row.affected_by_flood),
          has_school_access: Boolean(row.has_school_access),
          has_health_facility_access: Boolean(row.has_health_facility_access),
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: { district_id: districtId, ward_id: wardId, program_id: programId },
      },
    });
  } catch (error) {
    console.error("Admin welfare indicators list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load welfare beneficiary indicators",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/facility_travel:
 *   get:
 *     summary: List beneficiary facility travel records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Beneficiary facility travel records
 */
router.get("/social_welfare/facility_travel", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    const facilityType = req.query.facility_type
      ? String(req.query.facility_type).trim().toLowerCase()
      : null;
    if (facilityType && ["health", "school"].includes(facilityType)) {
      params.push(facilityType);
      conditions.push(`LOWER(bft.facility_type) = $${params.length}`);
    }

    const routingStatus = req.query.routing_status
      ? String(req.query.routing_status).trim().toLowerCase()
      : null;
    if (routingStatus) {
      params.push(routingStatus);
      conditions.push(`LOWER(bft.routing_status) = $${params.length}`);
    }

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`(
        COALESCE(bft.facility_name, '') ILIKE $${params.length}
        OR COALESCE(wb.firstname, '') ILIKE $${params.length}
        OR COALESCE(wb.lastname, '') ILIKE $${params.length}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM beneficiary_facility_travel bft
       LEFT JOIN welfare_beneficiary wb ON wb.id = bft.beneficiary_id
       ${whereClause}`,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          bft.id,
          bft.beneficiary_id,
          CONCAT(wb.firstname, ' ', wb.lastname) AS beneficiary_name,
          d.name  AS district_name,
          a3.name AS ta_name,
          bft.facility_type,
          bft.facility_id,
          bft.facility_name,
          ROUND(bft.network_distance_km::numeric, 2)       AS network_distance_km,
          ROUND(bft.travel_time_min::numeric, 1)           AS travel_time_min,
          ROUND(bft.straight_line_distance_km::numeric, 2) AS straight_line_distance_km,
          bft.routing_status,
          bft.calculated_at
        FROM beneficiary_facility_travel bft
        LEFT JOIN welfare_beneficiary wb ON wb.id = bft.beneficiary_id
        LEFT JOIN districts d            ON d.id  = wb.district_id
        LEFT JOIN admin3_units a3        ON a3.id = wb.ta_id
        ${whereClause}
        ORDER BY bft.calculated_at DESC NULLS LAST, bft.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map((row) => ({
          id: Number(row.id),
          beneficiary_id: Number(row.beneficiary_id),
          beneficiary_name: row.beneficiary_name || null,
          district_name: row.district_name || null,
          ta_name: row.ta_name || null,
          facility_type: row.facility_type || null,
          facility_id: row.facility_id != null ? Number(row.facility_id) : null,
          facility_name: row.facility_name || null,
          network_distance_km: row.network_distance_km != null ? Number(row.network_distance_km) : null,
          travel_time_min: row.travel_time_min != null ? Number(row.travel_time_min) : null,
          straight_line_distance_km: row.straight_line_distance_km != null ? Number(row.straight_line_distance_km) : null,
          routing_status: row.routing_status || null,
          calculated_at: row.calculated_at || null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: { facility_type: facilityType, routing_status: routingStatus },
      },
    });
  } catch (error) {
    console.error("Admin welfare facility travel list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load beneficiary facility travel records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/programs:
 *   get:
 *     summary: List welfare programs
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Welfare programs
 */
router.get("/social_welfare/programs", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`(
        COALESCE(program_name, '') ILIKE $${params.length}
        OR COALESCE(department, '') ILIKE $${params.length}
        OR COALESCE(description, '') ILIKE $${params.length}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM welfare_programs ${whereClause}`,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const result = await db.query(
      `
        SELECT
          program_id,
          program_name,
          department,
          description,
          updated_at
        FROM welfare_programs
        ${whereClause}
        ORDER BY program_name
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: result.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch (error) {
    console.error("Admin welfare program list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load welfare programs",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster:
 *   get:
 *     summary: List disaster records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Disaster records
 */
router.get("/disaster", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(
      parsePositiveInteger(req.query.page_size, 25),
      100,
    );
    const offset = (page - 1) * pageSize;
    const { whereClause, params, districtId, wardId, isActive } =
      buildDisasterListFilters(req.query);
    const orderBy = normalizeSortColumn(
      req.query.sort_by,
      DISASTER_SORT_COLUMNS,
      "updated_at",
    );
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM disaster_zones dz
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ${DISASTER_SELECT_FIELDS}
        FROM disaster_zones dz
        ${whereClause}
        ORDER BY ${orderBy} ${orderDirection}, dz.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ward_id: wardId,
          is_active: isActive,
          include_archived:
            String(req.query.include_archived).toLowerCase() === "true",
        },
      },
    });
  } catch (error) {
    console.error("Admin disaster list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load disaster records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/facility_exposure:
 *   get:
 *     summary: List flood facility exposure records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Flood facility exposure records
 */
router.get("/disaster/facility_exposure", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();

    const params = [];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      searchClause = `
        AND (
          COALESCE(ffe.facility_name, '') ILIKE $${params.length}
          OR COALESCE(ffe.facility_type, '') ILIKE $${params.length}
          OR COALESCE(ffe.risk_class, '') ILIKE $${params.length}
          OR COALESCE(ffe.ta_name, '') ILIKE $${params.length}
          OR COALESCE(ffe.district_name, '') ILIKE $${params.length}
        )
      `;
    }

    const countResult = await db.query(
      `
        WITH latest AS (
          SELECT MAX(analysis_date) AS analysis_date
          FROM flood_facility_exposure
        )
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure ffe
        JOIN latest
          ON ffe.analysis_date = latest.analysis_date
        WHERE TRUE
        ${searchClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        WITH latest AS (
          SELECT MAX(analysis_date) AS analysis_date
          FROM flood_facility_exposure
        )
        SELECT
          ffe.id,
          ffe.facility_name AS name,
          ffe.facility_type AS type,
          ffe.risk_class AS risk_level,
          ROUND(COALESCE(ffe.flood_value, 0)::numeric, 3) AS flood_depth,
          ffe.district_name,
          ffe.ta_name AS ward_name,
          ffe.is_exposed,
          ffe.facility_id,
          ffe.analysis_date,
          ffe.updated_at
        FROM flood_facility_exposure ffe
        JOIN latest
          ON ffe.analysis_date = latest.analysis_date
        WHERE TRUE
        ${searchClause}
        ORDER BY ffe.updated_at DESC, ffe.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;
    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch (error) {
    console.error("Admin disaster facility exposure list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load disaster facility exposure records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/exposure_summary:
 *   get:
 *     summary: List flood exposure summary records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Flood exposure summary records
 */
router.get("/disaster/exposure_summary", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();

    const params = [];
    let searchClause = "";
    if (search) {
      params.push(`%${search}%`);
      searchClause = `
        AND (
          COALESCE(ffes.district_name, '') ILIKE $${params.length}
          OR COALESCE(ffes.ta_name, '') ILIKE $${params.length}
          OR COALESCE(ffes.facility_type, '') ILIKE $${params.length}
        )
      `;
    }

    const countResult = await db.query(
      `
        WITH latest AS (
          SELECT MAX(analysis_date) AS analysis_date
          FROM flood_facility_exposure_summary
        )
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure_summary ffes
        JOIN latest
          ON ffes.analysis_date = latest.analysis_date
        WHERE TRUE
        ${searchClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        WITH latest AS (
          SELECT MAX(analysis_date) AS analysis_date
          FROM flood_facility_exposure_summary
        )
        SELECT
          ffes.id,
          CASE
            WHEN COALESCE(ffes.ta_id, 0) <> 0 THEN ffes.ta_name
            ELSE ffes.district_name
          END AS admin_unit_name,
          ffes.facility_type,
          ffes.total_facilities,
          ffes.exposed_facilities AS at_risk_count,
          ROUND(
            CASE
              WHEN ffes.total_facilities > 0 THEN
                (ffes.exposed_facilities::numeric * 100) / ffes.total_facilities
              ELSE 0
            END,
            2
          ) AS risk_percentage,
          ffes.analysis_date,
          ffes.updated_at
        FROM flood_facility_exposure_summary ffes
        JOIN latest
          ON ffes.analysis_date = latest.analysis_date
        WHERE TRUE
        ${searchClause}
        ORDER BY ffes.updated_at DESC, ffes.id DESC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;
    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
      },
    });
  } catch (error) {
    console.error("Admin disaster exposure summary list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load disaster exposure summary records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/{id}:
 *   get:
 *     summary: Get an education record
 *     tags:
 *       - Admin Data
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
 *         description: Education record
 *       404:
 *         description: Record not found
 */
router.get("/education/:id", async (req, res) => {
  try {
    const schoolId = parsePositiveInteger(req.params.id, null);
    if (!schoolId) {
      return res
        .status(400)
        .json({ status: "error", message: "A valid school id is required" });
    }

    const record = await fetchEducationRecord(db, schoolId);
    if (!record) {
      return res
        .status(404)
        .json({ status: "error", message: "Education record not found" });
    }

    return res.json({ status: "success", data: { record } });
  } catch (error) {
    console.error("Admin education detail error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load the education record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health/{id}:
 *   get:
 *     summary: Get a health record
 *     tags:
 *       - Admin Data
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
 *         description: Health record
 *       404:
 *         description: Record not found
 */
router.get("/health/:id", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid health record id is required",
      });
    }

    const record = await fetchHealthRecord(db, id);
    if (!record) {
      return res
        .status(404)
        .json({ status: "error", message: "Health record not found" });
    }

    return res.json({ status: "success", data: { record } });
  } catch (error) {
    console.error("Admin health detail error:", error.message);
    return res
      .status(500)
      .json({ status: "error", message: "Unable to load the health record" });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/{id}:
 *   get:
 *     summary: Get a welfare record
 *     tags:
 *       - Admin Data
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
 *         description: Welfare record
 *       404:
 *         description: Record not found
 */
router.get("/social_welfare/:id", async (req, res) => {
  try {
    const welfareWardColumn = await getWelfareWardColumn();
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid welfare record id is required",
      });
    }

    const record = await fetchWelfareRecord(db, id, welfareWardColumn);
    if (!record) {
      return res
        .status(404)
        .json({ status: "error", message: "Welfare record not found" });
    }

    return res.json({ status: "success", data: { record } });
  } catch (error) {
    console.error("Admin welfare detail error:", error.message);
    return res
      .status(500)
      .json({ status: "error", message: "Unable to load the welfare record" });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/{id}:
 *   get:
 *     summary: Get a disaster record
 *     tags:
 *       - Admin Data
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
 *         description: Disaster record
 *       404:
 *         description: Record not found
 */
router.get("/disaster/:id", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid disaster record id is required",
      });
    }

    const record = await fetchDisasterRecord(db, id);
    if (!record) {
      return res
        .status(404)
        .json({ status: "error", message: "Disaster record not found" });
    }

    return res.json({ status: "success", data: { record } });
  } catch (error) {
    console.error("Admin disaster detail error:", error.message);
    return res
      .status(500)
      .json({ status: "error", message: "Unable to load the disaster record" });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/{id}/history:
 *   get:
 *     summary: Get education record history
 *     tags:
 *       - Admin Data
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
 *         description: Education history
 */
router.get("/education/:id/history", async (req, res) => {
  try {
    const schoolId = parsePositiveInteger(req.params.id, null);
    if (!schoolId) {
      return res
        .status(400)
        .json({ status: "error", message: "A valid school id is required" });
    }

    const items = await fetchHistoryRows("education_facilities", schoolId);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin education history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load education record history",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health/{id}/history:
 *   get:
 *     summary: Get health record history
 *     tags:
 *       - Admin Data
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
 *         description: Health history
 */
router.get("/health/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid health record id is required",
      });
    }

    const items = await fetchHistoryRows("health_facilities", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin health history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load health record history",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/{id}/history:
 *   get:
 *     summary: Get welfare record history
 *     tags:
 *       - Admin Data
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
 *         description: Welfare history
 */
router.get("/social_welfare/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid welfare record id is required",
      });
    }

    const items = await fetchHistoryRows("welfare_beneficiaries", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin welfare history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load welfare record history",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/{id}/history:
 *   get:
 *     summary: Get disaster record history
 *     tags:
 *       - Admin Data
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
 *         description: Disaster history
 */
router.get("/disaster/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "A valid disaster record id is required",
      });
    }

    const items = await fetchHistoryRows("disaster_zones", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin disaster history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load disaster record history",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education:
 *   post:
 *     summary: Create an education record
 *     tags:
 *       - Admin Data
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
 *         description: Education record created
 */
router.post("/education", async (req, res) => {
  const { error, value } = validateEducationCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const authUser = getAuthUser(req);
    const createdRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateDistrictWardRelationship(
          client,
          value.districtId,
          value.wardId,
        );

        const insertedResult = await client.query(
          `
            INSERT INTO education_facilities (
              school_name,
              operator,
              status,
              student_enrollment_total,
              student_classroom_ratio,
              special_needs_students,
              teacher_distribution,
              teacher_count,
              blocks_count,
              water_equipment_facility_count,
              toilets_count,
              classroom_pressure,
              teacher_pressure,
              district_id,
              ta_id,
              x_coordinate,
              y_coordinate,
              geom,
              is_active,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14,
              ST_SetSRID(ST_MakePoint($15, $16), 4326),
              COALESCE($17, TRUE),
              CURRENT_TIMESTAMP
            )
            RETURNING school_id
          `,
          [
            value.name,
            value.operatorType ?? null,
            value.status ?? null,
            value.studentEnrollmentTotal ?? null,
            value.studentClassroomRatio ?? null,
            value.specialNeedsStudents ?? null,
            value.teacherDistribution ?? null,
            value.teacherCount ?? null,
            value.blocksCount ?? null,
            value.waterEquipmentFacilityCount ?? null,
            value.toiletsCount ?? null,
            value.classroomPressure ?? null,
            value.teacherPressure ?? null,
            value.districtId ?? null,
            value.wardId ?? null,
            value.longitude,
            value.latitude,
            value.longitude,
            value.latitude,
            value.isActive,
          ],
        );

        const schoolId = insertedResult.rows[0].school_id;
        const record = await fetchEducationRecord(client, schoolId);

        await writeAuditEntry(client, {
          tableName: "education_facilities",
          recordId: schoolId,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    markDepartmentStale("education");

    return res.status(201).json({
      status: "success",
      message: "Education record created successfully",
      data: { record: createdRecord },
    });
  } catch (err) {
    console.error("Admin education create error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to create education record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health:
 *   post:
 *     summary: Create a health record
 *     tags:
 *       - Admin Data
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
 *         description: Health record created
 */
router.post("/health", async (req, res) => {
  const { error, value } = validateHealthCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const authUser = getAuthUser(req);
    const createdRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateDistrictWardRelationship(
          client,
          value.districtId,
          value.wardId,
        );

        const insertedResult = await client.query(
          `
            INSERT INTO health_facilities (
              name,
              type,
              healthcare,
              beds_count,
              patient_visits_total,
              services_offered,
              district_id,
              ward_id,
              geom,
              is_active,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7, $8,
              ST_SetSRID(ST_MakePoint($9, $10), 4326),
              COALESCE($11, TRUE),
              CURRENT_TIMESTAMP
            )
            RETURNING id
          `,
          [
            value.name,
            value.type ?? null,
            value.healthcare ?? null,
            value.bedsCount ?? null,
            value.patientVisitsTotal ?? null,
            value.servicesOffered ?? [],
            value.districtId ?? null,
            value.wardId ?? null,
            value.longitude,
            value.latitude,
            value.isActive,
          ],
        );

        const id = insertedResult.rows[0].id;
        const record = await fetchHealthRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "health_facilities",
          recordId: id,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    markDepartmentStale("health");

    return res.status(201).json({
      status: "success",
      message: "Health record created successfully",
      data: { record: createdRecord },
    });
  } catch (err) {
    console.error("Admin health create error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to create health record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/programs:
 *   post:
 *     summary: Create a welfare program
 *     tags:
 *       - Admin Data
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
 *         description: Welfare program created
 */
router.post("/social_welfare/programs", async (req, res) => {
  const { error, value } = validateWelfareProgramCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const result = await db.query(
      `INSERT INTO welfare_programs (program_name, department, description)
       VALUES ($1, $2, $3)
       RETURNING program_id`,
      [value.program_name, value.department, value.description],
    );

    res.status(201).json({
      status: "success",
      message: "Welfare program created successfully",
      data: { program_id: result.rows[0].program_id },
    });
  } catch (err) {
    console.error("Admin welfare program create error:", err.message);
    res.status(500).json({
      status: "error",
      message: err.message || "Unable to create welfare program",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/beneficiary:
 *   post:
 *     summary: Create an individual welfare beneficiary record
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [programId, firstname, lastname, latitude, longitude]
 *     responses:
 *       201:
 *         description: Welfare beneficiary created
 */
router.post("/social_welfare/beneficiary", async (req, res) => {
  const { error, value } = validateWelfareBeneficiaryCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const authUser = getAuthUser(req);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      // Verify program exists
      const programCheck = await client.query(
        "SELECT program_id FROM welfare_programs WHERE program_id = $1",
        [value.programId],
      );
      if (!programCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          status: "error",
          message: `Program with id ${value.programId} does not exist`,
        });
      }

      const insertResult = await client.query(
        `
          INSERT INTO welfare_beneficiary (
            program_id,
            firstname,
            lastname,
            gender,
            age,
            household_size,
            status,
            start_date,
            end_date,
            district_id,
            ta_id,
            center_lat,
            center_long,
            geom,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::date, $9::date,
            $10, $11,
            $12, $13,
            ST_SetSRID(ST_MakePoint($13, $12), 4326),
            CURRENT_TIMESTAMP
          )
          RETURNING id
        `,
        [
          value.programId,
          value.firstname,
          value.lastname,
          value.gender ?? null,
          value.age ?? null,
          value.householdSize ?? null,
          value.status ?? null,
          value.startDate ?? null,
          value.endDate ?? null,
          value.districtId ?? null,
          value.taId ?? null,
          value.latitude,
          value.longitude,
        ],
      );

      const newId = insertResult.rows[0].id;

      // Fetch the created record to return
      const recordResult = await client.query(
        `
          SELECT
            wb.id,
            wb.program_id,
            COALESCE(wp.program_name, CONCAT('Program ', wb.program_id::text)) AS program_name,
            wb.firstname,
            wb.lastname,
            wb.gender,
            wb.age,
            wb.household_size,
            wb.status,
            wb.start_date,
            wb.end_date,
            d.name  AS district_name,
            a3.name AS ta_name,
            wb.created_at,
            wb.updated_at
          FROM welfare_beneficiary wb
          LEFT JOIN welfare_programs wp ON wp.program_id = wb.program_id
          LEFT JOIN districts d         ON d.id  = wb.district_id
          LEFT JOIN admin3_units a3     ON a3.id = wb.ta_id
          WHERE wb.id = $1
        `,
        [newId],
      );

      await writeAuditEntry(client, {
        tableName: "welfare_beneficiary",
        recordId: newId,
        action: "create",
        userId: authUser.id,
        beforeData: null,
        afterData: recordResult.rows[0],
      });

      await client.query("COMMIT");

      return res.status(201).json({
        status: "success",
        message: "Welfare beneficiary created successfully",
        data: { record: recordResult.rows[0] },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Admin welfare beneficiary create error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to create welfare beneficiary",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/beneficiary/{id}:
 *   patch:
 *     summary: Update an individual welfare beneficiary
 *     tags: [Admin Data]
 *     security: [{BearerAuth: []}]
 *     responses:
 *       200:
 *         description: Beneficiary updated
 */
router.patch("/social_welfare/beneficiary/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({ status: "error", message: "Valid beneficiary id required" });
  }

  const allowed = [
    "programId", "firstname", "lastname", "gender", "age",
    "householdSize", "status", "startDate", "endDate",
    "districtId", "taId", "latitude", "longitude",
  ];
  const payload = {};
  allowed.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      payload[key] = req.body[key];
    }
  });

  if (!Object.keys(payload).length) {
    return res.status(400).json({ status: "error", message: "No editable fields provided" });
  }

  try {
    const authUser = getAuthUser(req);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT * FROM welfare_beneficiary WHERE id = $1", [id]
      );
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ status: "error", message: "Beneficiary not found" });
      }

      const setClauses = [];
      const params = [];

      const columnMap = {
        programId: "program_id",
        firstname: "firstname",
        lastname: "lastname",
        gender: "gender",
        age: "age",
        householdSize: "household_size",
        status: "status",
        startDate: "start_date",
        endDate: "end_date",
        districtId: "district_id",
        taId: "ta_id",
      };

      Object.entries(columnMap).forEach(([payloadKey, col]) => {
        if (Object.prototype.hasOwnProperty.call(payload, payloadKey)) {
          params.push(payload[payloadKey] ?? null);
          setClauses.push(`${col} = $${params.length}`);
        }
      });

      const hasLat = Object.prototype.hasOwnProperty.call(payload, "latitude");
      const hasLng = Object.prototype.hasOwnProperty.call(payload, "longitude");
      if (hasLat || hasLng) {
        const lat = hasLat ? payload.latitude : existing.rows[0].center_lat;
        const lng = hasLng ? payload.longitude : existing.rows[0].center_long;
        params.push(lat, lng);
        setClauses.push(`center_lat = $${params.length - 1}`);
        setClauses.push(`center_long = $${params.length}`);
        setClauses.push(
          `geom = ST_SetSRID(ST_MakePoint($${params.length}, $${params.length - 1}), 4326)`
        );
      }

      setClauses.push("updated_at = CURRENT_TIMESTAMP");
      params.push(id);

      await client.query(
        `UPDATE welfare_beneficiary SET ${setClauses.join(", ")} WHERE id = $${params.length}`,
        params,
      );

      const updated = await client.query(
        `SELECT wb.id, wb.program_id,
           COALESCE(wp.program_name, CONCAT('Program ', wb.program_id::text)) AS program_name,
           wb.firstname, wb.lastname, wb.gender, wb.age, wb.household_size,
           wb.status, wb.start_date, wb.end_date, wb.district_id, wb.ta_id,
           d.name AS district_name, a3.name AS ta_name,
           wb.created_at, wb.updated_at,
           ST_Y(wb.geom) AS latitude, ST_X(wb.geom) AS longitude
         FROM welfare_beneficiary wb
         LEFT JOIN welfare_programs wp ON wp.program_id = wb.program_id
         LEFT JOIN districts d ON d.id = wb.district_id
         LEFT JOIN admin3_units a3 ON a3.id = wb.ta_id
         WHERE wb.id = $1`,
        [id],
      );

      await writeAuditEntry(client, {
        tableName: "welfare_beneficiary",
        recordId: id,
        action: "update",
        userId: authUser.id,
        beforeData: existing.rows[0],
        afterData: updated.rows[0],
      });

      await client.query("COMMIT");
      return res.json({
        status: "success",
        message: "Beneficiary updated successfully",
        data: { record: updated.rows[0] },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Admin welfare beneficiary update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update beneficiary",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/beneficiary/{id}:
 *   delete:
 *     summary: Delete an individual welfare beneficiary
 *     tags: [Admin Data]
 *     security: [{BearerAuth: []}]
 *     responses:
 *       200:
 *         description: Beneficiary deleted
 */
router.delete("/social_welfare/beneficiary/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({ status: "error", message: "Valid beneficiary id required" });
  }

  try {
    const authUser = getAuthUser(req);
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT * FROM welfare_beneficiary WHERE id = $1", [id]
      );
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ status: "error", message: "Beneficiary not found" });
      }

      await client.query("DELETE FROM welfare_beneficiary WHERE id = $1", [id]);

      await writeAuditEntry(client, {
        tableName: "welfare_beneficiary",
        recordId: id,
        action: "delete",
        userId: authUser.id,
        beforeData: existing.rows[0],
        afterData: null,
      });

      await client.query("COMMIT");
      return res.json({ status: "success", message: "Beneficiary deleted successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Admin welfare beneficiary delete error:", err.message);
    return res.status(500).json({
      status: "error",
      message: err.message || "Unable to delete beneficiary",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/programs/{id}:
 *   patch:
 *     summary: Update a welfare program
 *     tags: [Admin Data]
 *     security: [{BearerAuth: []}]
 *     responses:
 *       200:
 *         description: Program updated
 */
router.patch("/social_welfare/programs/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({ status: "error", message: "Valid program id required" });
  }

  const { program_name, department, description } = req.body;
  const setClauses = [];
  const params = [];

  if (program_name !== undefined) {
    params.push(String(program_name).trim());
    setClauses.push(`program_name = $${params.length}`);
  }
  if (department !== undefined) {
    params.push(department ?? null);
    setClauses.push(`department = $${params.length}`);
  }
  if (description !== undefined) {
    params.push(description ?? null);
    setClauses.push(`description = $${params.length}`);
  }

  if (!setClauses.length) {
    return res.status(400).json({ status: "error", message: "No editable fields provided" });
  }

  setClauses.push("updated_at = CURRENT_TIMESTAMP");
  params.push(id);

  try {
    const result = await db.query(
      `UPDATE welfare_programs SET ${setClauses.join(", ")} WHERE program_id = $${params.length} RETURNING *`,
      params,
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: "error", message: "Program not found" });
    }
    return res.json({
      status: "success",
      message: "Program updated successfully",
      data: { record: result.rows[0] },
    });
  } catch (err) {
    console.error("Admin welfare program update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update program",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/programs/{id}:
 *   delete:
 *     summary: Delete a welfare program
 *     tags: [Admin Data]
 *     security: [{BearerAuth: []}]
 *     responses:
 *       200:
 *         description: Program deleted
 */
router.delete("/social_welfare/programs/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({ status: "error", message: "Valid program id required" });
  }

  try {
    const result = await db.query(
      "DELETE FROM welfare_programs WHERE program_id = $1 RETURNING program_id",
      [id],
    );
    if (!result.rows.length) {
      return res.status(404).json({ status: "error", message: "Program not found" });
    }
    return res.json({ status: "success", message: "Program deleted successfully" });
  } catch (err) {
    console.error("Admin welfare program delete error:", err.message);
    return res.status(500).json({
      status: "error",
      message: err.message || "Unable to delete program",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare:
 *   post:
 *     summary: Create a welfare record
 *     tags:
 *       - Admin Data
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
 *         description: Welfare record created
 */
router.post("/social_welfare", async (req, res) => {
  const { error, value } = validateWelfareCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const welfareWardColumn = await getWelfareWardColumn();
    const authUser = getAuthUser(req);
    const createdRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateWardExists(client, value.wardId);

        const insertedResult = await client.query(
          `
            INSERT INTO welfare_beneficiaries (
              program_name,
              beneficiary_count,
              ${welfareWardColumn},
              geom,
              is_active,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              ST_SetSRID(ST_MakePoint($4, $5), 4326),
              COALESCE($6, TRUE),
              CURRENT_TIMESTAMP
            )
            RETURNING id
          `,
          [
            value.programName,
            value.beneficiaryCount ?? null,
            value.wardId,
            value.longitude,
            value.latitude,
            value.isActive,
          ],
        );

        const id = insertedResult.rows[0].id;
        const record = await fetchWelfareRecord(client, id, welfareWardColumn);

        await writeAuditEntry(client, {
          tableName: "welfare_beneficiaries",
          recordId: id,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    markDepartmentStale("welfare");

    return res.status(201).json({
      status: "success",
      message: "Welfare record created successfully",
      data: { record: createdRecord },
    });
  } catch (err) {
    console.error("Admin welfare create error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to create welfare record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster:
 *   post:
 *     summary: Create a disaster record
 *     tags:
 *       - Admin Data
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
 *         description: Disaster record created
 */
router.post("/disaster", async (req, res) => {
  const { error, value } = validateDisasterCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    const authUser = getAuthUser(req);
    const geometryPayload = parseDisasterGeometry(value.geometryGeoJson);
    if (!geometryPayload) {
      return res
        .status(400)
        .json({ status: "error", message: "geometryGeoJson is required" });
    }

    const createdRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const insertedResult = await client.query(
          `
            INSERT INTO disaster_zones (
              event_type,
              risk_level,
              population_at_risk,
              geom,
              is_active,
              updated_at
            )
            VALUES (
              $1,
              $2,
              $3,
              ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)),
              COALESCE($5, TRUE),
              CURRENT_TIMESTAMP
            )
            RETURNING id
          `,
          [
            value.eventType,
            value.riskLevel,
            value.populationAtRisk ?? null,
            geometryPayload,
            value.isActive,
          ],
        );

        const id = insertedResult.rows[0].id;
        const record = await fetchDisasterRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "disaster_zones",
          recordId: id,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    markDepartmentStale("disaster");

    return res.status(201).json({
      status: "success",
      message: "Disaster record created successfully",
      data: { record: createdRecord },
    });
  } catch (err) {
    console.error("Admin disaster create error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to create disaster record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/{id}:
 *   patch:
 *     summary: Update an education record
 *     tags:
 *       - Admin Data
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
 *         description: Education record updated
 */
router.patch("/education/:id", async (req, res) => {
  const schoolId = parsePositiveInteger(req.params.id, null);
  if (!schoolId) {
    return res
      .status(400)
      .json({ status: "error", message: "A valid school id is required" });
  }

  const { error, value } = validateEducationUpdate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    requireLatLngTogether(value);
  } catch (err) {
    return res.status(400).json({ status: "error", message: err.message });
  }

  const pendingUpdates = mapEducationPayloadToColumns(value);
  const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
    value,
    "latitude",
  );

  if (!pendingUpdates.length && !includesGeometryUpdate) {
    return res
      .status(400)
      .json({ status: "error", message: "No editable fields were provided" });
  }

  try {
    const authUser = getAuthUser(req);

    const updatedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchEducationRecord(client, schoolId);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        );
        const hasWardUpdate = Object.prototype.hasOwnProperty.call(
          value,
          "wardId",
        );
        const nextDistrictId = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        )
          ? value.districtId
          : existingRecord.district_id;
        const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
          ? value.wardId
          : existingRecord.ward_id;

        if (hasDistrictUpdate || hasWardUpdate) {
          await validateDistrictWardRelationship(
            client,
            nextDistrictId,
            nextWardId,
          );
        }

        const setClauses = [];
        const params = [];

        pendingUpdates.forEach(({ columnName, value: columnValue }) => {
          params.push(columnValue ?? null);
          setClauses.push(`${columnName} = $${params.length}`);
        });

        if (includesGeometryUpdate) {
          params.push(value.longitude, value.latitude);
          setClauses.push(
            `geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`,
          );
        }

        setClauses.push("updated_at = CURRENT_TIMESTAMP");
        params.push(schoolId);

        await client.query(
          `
            UPDATE education_facilities
            SET ${setClauses.join(", ")}
            WHERE school_id = $${params.length}
          `,
          params,
        );

        const record = await fetchEducationRecord(client, schoolId);

        await writeAuditEntry(client, {
          tableName: "education_facilities",
          recordId: schoolId,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!updatedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Education record not found" });
    }

    markDepartmentStale("education");

    return res.json({
      status: "success",
      message: "Education record updated successfully",
      data: { record: updatedRecord },
    });
  } catch (err) {
    console.error("Admin education update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update education record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health/{id}:
 *   patch:
 *     summary: Update a health record
 *     tags:
 *       - Admin Data
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
 *         description: Health record updated
 */
router.patch("/health/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid health record id is required",
    });
  }

  const { error, value } = validateHealthUpdate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    requireLatLngTogether(value);
  } catch (err) {
    return res.status(400).json({ status: "error", message: err.message });
  }

  const pendingUpdates = mapHealthPayloadToColumns(value);
  const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
    value,
    "latitude",
  );

  if (!pendingUpdates.length && !includesGeometryUpdate) {
    return res
      .status(400)
      .json({ status: "error", message: "No editable fields were provided" });
  }

  try {
    const authUser = getAuthUser(req);

    const updatedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchHealthRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        );
        const hasWardUpdate = Object.prototype.hasOwnProperty.call(
          value,
          "wardId",
        );
        const nextDistrictId = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        )
          ? value.districtId
          : existingRecord.district_id;
        const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
          ? value.wardId
          : existingRecord.ward_id;

        if (hasDistrictUpdate || hasWardUpdate) {
          await validateDistrictWardRelationship(
            client,
            nextDistrictId,
            nextWardId,
          );
        }

        const setClauses = [];
        const params = [];

        pendingUpdates.forEach(({ columnName, value: columnValue }) => {
          params.push(columnValue ?? null);
          setClauses.push(`${columnName} = $${params.length}`);
        });

        if (includesGeometryUpdate) {
          params.push(value.longitude, value.latitude);
          setClauses.push(
            `geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`,
          );
        }

        setClauses.push("updated_at = CURRENT_TIMESTAMP");
        params.push(id);

        await client.query(
          `
            UPDATE health_facilities
            SET ${setClauses.join(", ")}
            WHERE id = $${params.length}
          `,
          params,
        );

        const record = await fetchHealthRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "health_facilities",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!updatedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Health record not found" });
    }

    markDepartmentStale("health");

    return res.json({
      status: "success",
      message: "Health record updated successfully",
      data: { record: updatedRecord },
    });
  } catch (err) {
    console.error("Admin health update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update health record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/{id}:
 *   patch:
 *     summary: Update a welfare record
 *     tags:
 *       - Admin Data
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
 *         description: Welfare record updated
 */
router.patch("/social_welfare/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid welfare record id is required",
    });
  }

  const { error, value } = validateWelfareUpdate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
    requireLatLngTogether(value);
  } catch (err) {
    return res.status(400).json({ status: "error", message: err.message });
  }

  try {
    const welfareWardColumn = await getWelfareWardColumn();
    const pendingUpdates = mapWelfarePayloadToColumns(value, welfareWardColumn);
    const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
      value,
      "latitude",
    );

    if (!pendingUpdates.length && !includesGeometryUpdate) {
      return res.status(400).json({
        status: "error",
        message: "No editable fields were provided",
      });
    }

    const authUser = getAuthUser(req);

    const updatedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchWelfareRecord(
          client,
          id,
          welfareWardColumn,
        );
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
          ? value.wardId
          : existingRecord.ward_id;

        await validateWardExists(client, nextWardId);

        const setClauses = [];
        const params = [];

        pendingUpdates.forEach(({ columnName, value: columnValue }) => {
          params.push(columnValue ?? null);
          setClauses.push(`${columnName} = $${params.length}`);
        });

        if (includesGeometryUpdate) {
          params.push(value.longitude, value.latitude);
          setClauses.push(
            `geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`,
          );
        }

        setClauses.push("updated_at = CURRENT_TIMESTAMP");
        params.push(id);

        await client.query(
          `
            UPDATE welfare_beneficiaries
            SET ${setClauses.join(", ")}
            WHERE id = $${params.length}
          `,
          params,
        );

        const record = await fetchWelfareRecord(
          client,
          id,
          welfareWardColumn,
        );

        await writeAuditEntry(client, {
          tableName: "welfare_beneficiaries",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!updatedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Welfare record not found" });
    }

    markDepartmentStale("welfare");

    return res.json({
      status: "success",
      message: "Welfare record updated successfully",
      data: { record: updatedRecord },
    });
  } catch (err) {
    console.error("Admin welfare update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update welfare record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/{id}:
 *   patch:
 *     summary: Update a disaster record
 *     tags:
 *       - Admin Data
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
 *         description: Disaster record updated
 */
router.patch("/disaster/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid disaster record id is required",
    });
  }

  const { error, value } = validateDisasterUpdate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  const pendingUpdates = mapDisasterPayloadToColumns(value);
  const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
    value,
    "geometryGeoJson",
  );

  if (!pendingUpdates.length && !includesGeometryUpdate) {
    return res
      .status(400)
      .json({ status: "error", message: "No editable fields were provided" });
  }

  try {
    const authUser = getAuthUser(req);
    const updatedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchDisasterRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        const setClauses = [];
        const params = [];

        pendingUpdates.forEach(({ columnName, value: columnValue }) => {
          params.push(columnValue ?? null);
          setClauses.push(`${columnName} = $${params.length}`);
        });

        if (includesGeometryUpdate) {
          const geometryPayload = parseDisasterGeometry(value.geometryGeoJson);
          if (!geometryPayload) {
            throw new Error("geometryGeoJson cannot be empty when provided");
          }

          params.push(geometryPayload);
          setClauses.push(
            `geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${params.length}), 4326))`,
          );
        }

        setClauses.push("updated_at = CURRENT_TIMESTAMP");
        params.push(id);

        await client.query(
          `
            UPDATE disaster_zones
            SET ${setClauses.join(", ")}
            WHERE id = $${params.length}
          `,
          params,
        );

        const record = await fetchDisasterRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "disaster_zones",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!updatedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Disaster record not found" });
    }

    markDepartmentStale("disaster");

    return res.json({
      status: "success",
      message: "Disaster record updated successfully",
      data: { record: updatedRecord },
    });
  } catch (err) {
    console.error("Admin disaster update error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to update disaster record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/education/{id}/archive:
 *   post:
 *     summary: Archive an education record
 *     tags:
 *       - Admin Data
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
 *         description: Education record archived
 */
router.post("/education/:id/archive", async (req, res) => {
  const schoolId = parsePositiveInteger(req.params.id, null);
  if (!schoolId) {
    return res
      .status(400)
      .json({ status: "error", message: "A valid school id is required" });
  }

  try {
    const authUser = getAuthUser(req);
    const archivedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchEducationRecord(client, schoolId);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `
            UPDATE education_facilities
            SET is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE school_id = $1
          `,
          [schoolId],
        );

        const record = await fetchEducationRecord(client, schoolId);

        await writeAuditEntry(client, {
          tableName: "education_facilities",
          recordId: schoolId,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!archivedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Education record not found" });
    }

    markDepartmentStale("education");

    return res.json({
      status: "success",
      message: "Education record archived successfully",
      data: { record: archivedRecord },
    });
  } catch (err) {
    console.error("Admin education archive error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to archive education record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health/{id}/archive:
 *   post:
 *     summary: Archive a health record
 *     tags:
 *       - Admin Data
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
 *         description: Health record archived
 */
router.post("/health/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid health record id is required",
    });
  }

  try {
    const authUser = getAuthUser(req);
    const archivedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchHealthRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `
            UPDATE health_facilities
            SET is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [id],
        );

        const record = await fetchHealthRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "health_facilities",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!archivedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Health record not found" });
    }

    markDepartmentStale("health");

    return res.json({
      status: "success",
      message: "Health record archived successfully",
      data: { record: archivedRecord },
    });
  } catch (err) {
    console.error("Admin health archive error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to archive health record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/social_welfare/{id}/archive:
 *   post:
 *     summary: Archive a welfare record
 *     tags:
 *       - Admin Data
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
 *         description: Welfare record archived
 */
router.post("/social_welfare/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid welfare record id is required",
    });
  }

  try {
    const welfareWardColumn = await getWelfareWardColumn();
    const authUser = getAuthUser(req);
    const archivedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchWelfareRecord(
          client,
          id,
          welfareWardColumn,
        );
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `
            UPDATE welfare_beneficiaries
            SET is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [id],
        );

        const record = await fetchWelfareRecord(
          client,
          id,
          welfareWardColumn,
        );

        await writeAuditEntry(client, {
          tableName: "welfare_beneficiaries",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!archivedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Welfare record not found" });
    }

    markDepartmentStale("welfare");

    return res.json({
      status: "success",
      message: "Welfare record archived successfully",
      data: { record: archivedRecord },
    });
  } catch (err) {
    console.error("Admin welfare archive error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to archive welfare record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/{id}/archive:
 *   post:
 *     summary: Archive a disaster record
 *     tags:
 *       - Admin Data
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
 *         description: Disaster record archived
 */
router.post("/disaster/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res.status(400).json({
      status: "error",
      message: "A valid disaster record id is required",
    });
  }

  try {
    const authUser = getAuthUser(req);
    const archivedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchDisasterRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await client.query(
          `
            UPDATE disaster_zones
            SET is_active = FALSE,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [id],
        );

        const record = await fetchDisasterRecord(client, id);

        await writeAuditEntry(client, {
          tableName: "disaster_zones",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          afterData: record,
        });

        await client.query("COMMIT");
        return record;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!archivedRecord) {
      return res
        .status(404)
        .json({ status: "error", message: "Disaster record not found" });
    }

    markDepartmentStale("disaster");

    return res.json({
      status: "success",
      message: "Disaster record archived successfully",
      data: { record: archivedRecord },
    });
  } catch (err) {
    console.error("Admin disaster archive error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to archive disaster record",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/recompute/status:
 *   get:
 *     summary: Get recompute status
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Recompute status
 */
router.get("/recompute/status", async (req, res) => {
  const mergedState = mergeRecomputeStaleState();
  const authUser = getAuthUser(req);

  if (!isGlobalAccessRole(authUser.role)) {
    const departments = await getAccessibleDepartmentsForUser(
      authUser.id,
      authUser.role,
      "read",
    );

    if (!departments.length) {
      return res.status(403).json({
        status: "error",
        message: "You do not have access to any department recompute status",
      });
    }

    const filteredDepartments = departments.reduce(
      (accumulator, department) => {
        if (Object.prototype.hasOwnProperty.call(mergedState, department)) {
          accumulator[department] = mergedState[department];
        }
        return accumulator;
      },
      {},
    );

    return res.json({
      status: "success",
      data: {
        departments: filteredDepartments,
      },
    });
  }

  return res.json({
    status: "success",
    data: {
      departments: mergedState,
    },
  });
});

/**
 * @openapi
 * /api/v1/admin-data/recompute/{department}:
 *   post:
 *     summary: Trigger a department recompute task
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: department
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       202:
 *         description: Recompute started
 */
router.post("/recompute/:department", async (req, res) => {
  try {
    const department = String(req.params.department || "").toLowerCase();
    if (
      !Object.prototype.hasOwnProperty.call(RECOMPUTE_DEFINITION, department)
    ) {
      return res.status(400).json({
        status: "error",
        message:
          "Recompute is supported for education, health, and disaster only",
      });
    }

    runRecomputeInBackground(department, {
      adminLevel: req.body?.adminLevel || "District",
      coverageDistanceKm: req.body?.coverageDistanceKm ?? 5,
      worldpopYear: req.body?.worldpopYear ?? 2020,
    });

    return res.status(202).json({
      status: "success",
      message: `${department} recompute has started in the background`,
      data: {
        department,
        task: RECOMPUTE_DEFINITION[department].task,
        state: recomputeState[department],
      },
    });
  } catch (error) {
    return res.status(400).json({
      status: "error",
      message: error.message || "Unable to trigger recompute",
    });
  }
});

module.exports = router;
