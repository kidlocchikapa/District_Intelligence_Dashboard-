const express = require("express");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const db = require("../db");
const auth = require("../middleware/auth");
const requireDepartmentAccess = require("../middleware/requireDepartmentAccess");
const ensureAdminDataSchema = require("../helpers/adminDataSchema");
const requireGlobalAdmin = require("../middleware/requireGlobalAdmin");
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
      "school_population_buffer",
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

const REVIEW_TABLES_BY_DEPARTMENT = {
  education: ["education_facilities"],
  health: ["health_facilities"],
  social_welfare: [
    "welfare_beneficiary",
    "welfare_programs",
    "welfare_beneficiaries",
  ],
  disaster: ["disaster_zones"],
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
  code: "hf.code",
  type: "hf.type",
  status: "hf.status",
  ownership: "hf.ownership",
  beds_count: "hf.beds_count",
  bed_capacity: "hf.bed_capacity",
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
  ROUND(ef.classroom_pressure::numeric, 2) AS classroom_pressure,
  ROUND(ef.teacher_pressure::numeric, 2) AS teacher_pressure,
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

const HEALTH_FACILITY_LATERAL_JOIN = `
  LEFT JOIN LATERAL (
    SELECT h.*
    FROM health_facilities h
    WHERE LOWER(TRIM(ffe.facility_type)) = 'health'
      AND (
        h.id = ffe.facility_id
        OR (
          LOWER(TRIM(COALESCE(h.name, ''))) = LOWER(TRIM(COALESCE(ffe.facility_name, '')))
          AND NULLIF(TRIM(COALESCE(ffe.facility_name, '')), '') IS NOT NULL
        )
      )
    ORDER BY CASE WHEN h.id = ffe.facility_id THEN 0 ELSE 1 END, h.id ASC
    LIMIT 1
  ) hf ON TRUE
`;

const EDUCATION_FACILITY_LATERAL_JOIN = `
  LEFT JOIN LATERAL (
    SELECT e.*
    FROM education_facilities e
    WHERE LOWER(TRIM(ffe.facility_type)) = 'education'
      AND (
        e.school_id = ffe.facility_id
        OR (
          LOWER(TRIM(COALESCE(e.school_name, ''))) = LOWER(TRIM(COALESCE(ffe.facility_name, '')))
          AND NULLIF(TRIM(COALESCE(ffe.facility_name, '')), '') IS NOT NULL
        )
      )
    ORDER BY CASE WHEN e.school_id = ffe.facility_id THEN 0 ELSE 1 END, e.school_id ASC
    LIMIT 1
  ) ef ON TRUE
`;

const HEALTH_SELECT_FIELDS = `
  hf.id,
  hf.code,
  hf.name,
  hf.common_name,
  hf.type,
  hf.ownership,
  hf."capacity:persons" AS capacity_persons,
  hf.zone,
  hf.district AS district_label,
  hf.status,
  hf.doctor_count,
  hf.nurse_midwife_count,
  hf.bed_capacity,
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
  COALESCE(ST_Y(hf.geom), hf.latitude) AS latitude,
  COALESCE(ST_X(hf.geom), hf.longitude) AS longitude
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

async function stagePendingAdminDataEdit(
  client,
  {
    tableName,
    recordId = null,
    action,
    userId,
    beforeData = null,
    requestPayload = null,
  },
) {
  await writeAuditEntry(client, {
    tableName,
    recordId,
    action,
    userId,
    beforeData,
    afterData: requestPayload,
    status: "pending",
    requestPayload,
  });
}

async function fetchPendingReviewById(client, reviewId) {
  const result = await client.query(
    `
      SELECT *
      FROM admin_data_edits
      WHERE id = $1
      LIMIT 1
    `,
    [reviewId],
  );

  return result.rows[0] || null;
}

async function lockPendingReviewById(client, reviewId) {
  const result = await client.query(
    `
      SELECT *
      FROM admin_data_edits
      WHERE id = $1
      FOR UPDATE
    `,
    [reviewId],
  );

  return result.rows[0] || null;
}

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

async function resolveCurrentAuthUser(req) {
  const authUser = getAuthUser(req);

  if (authUser.id && !authUser.role) {
    const userResult = await db.query(
      `
        SELECT role
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [authUser.id],
    );

    if (userResult.rowCount) {
      authUser.role = userResult.rows[0].role;
    }
  }

  return authUser;
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

function triggerApprovedReviewRecompute(department) {
  if (!Object.prototype.hasOwnProperty.call(RECOMPUTE_DEFINITION, department)) {
    return false;
  }

  try {
    runRecomputeInBackground(department, {
      adminLevel: "District",
      coverageDistanceKm: 5,
      worldpopYear: 2020,
    });
    return true;
  } catch (error) {
    console.warn(
      `Unable to auto-start recompute for ${department} after approval:`,
      error.message,
    );
    return false;
  }
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

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
    isActive,
  };
}

function mapHealthFacilityAccessRow(row) {
  return {
    facility_id: Number(row.facility_id),
    coverage_distance_km:
      row.coverage_distance_km != null
        ? Number(row.coverage_distance_km)
        : null,
    worldpop_population_within_buffer:
      row.worldpop_population_within_buffer != null
        ? Math.round(Number(row.worldpop_population_within_buffer))
        : null,
    welfare_beneficiaries_within_buffer:
      row.welfare_beneficiaries_within_buffer != null
        ? Number(row.welfare_beneficiaries_within_buffer)
        : null,
    welfare_beneficiaries_served_by_8km_network:
      row.welfare_beneficiaries_served_by_8km_network != null
        ? Number(row.welfare_beneficiaries_served_by_8km_network)
        : null,
    avg_network_distance_km:
      row.avg_network_distance_km != null
        ? Number(Number(row.avg_network_distance_km).toFixed(2))
        : null,
    avg_travel_time_min:
      row.avg_travel_time_min != null
        ? Number(Number(row.avg_travel_time_min).toFixed(1))
        : null,
    metadata: row.metadata || null,
    calculated_at: row.calculated_at || null,
    health_facility_id: row.health_facility_id != null ? Number(row.health_facility_id) : null,
    code: row.code || null,
    name: row.name || row.facility_name || null,
    common_name: row.common_name || null,
    type: row.health_facility_type || row.type || null,
    ownership: row.ownership || null,
    status: row.status || null,
    zone: row.zone || null,
    district_label: row.district_label || null,
    district_name: row.district_name || null,
    ward_name: row.ward_name || null,
    doctor_count: row.doctor_count != null ? Number(row.doctor_count) : null,
    nurse_midwife_count:
      row.nurse_midwife_count != null ? Number(row.nurse_midwife_count) : null,
    bed_capacity: row.bed_capacity != null ? Number(row.bed_capacity) : null,
    beds_count: row.beds_count != null ? Number(row.beds_count) : null,
    capacity_persons:
      row.capacity_persons != null ? Number(row.capacity_persons) : null,
    patient_visits_total:
      row.patient_visits_total != null ? Number(row.patient_visits_total) : null,
    services_offered: row.services_offered || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    is_active: row.is_active != null ? Boolean(row.is_active) : null,
  };
}

function mapHealthFloodExposedRow(row) {
  return {
    id: Number(row.id),
    analysis_date: row.analysis_date || null,
    facility_id: Number(row.facility_id),
    facility_name: row.facility_name || row.name || null,
    district_id: row.district_id != null ? Number(row.district_id) : null,
    district_name: row.district_name || null,
    ta_id: row.ta_id != null ? Number(row.ta_id) : null,
    ta_name: row.ta_name || null,
    facility_type: row.facility_type || null,
    flood_value:
      row.flood_value != null
        ? Number(Number(row.flood_value).toFixed(4))
        : null,
    risk_class: row.risk_class || null,
    is_exposed: Boolean(row.is_exposed),
    exposure_created_at: row.exposure_created_at || null,
    exposure_updated_at: row.exposure_updated_at || null,
    health_facility_id:
      row.health_facility_id != null ? Number(row.health_facility_id) : null,
    code: row.code || null,
    name: row.name || row.facility_name || null,
    common_name: row.common_name || null,
    type: row.health_facility_type || row.type || null,
    ownership: row.ownership || null,
    status: row.status || null,
    zone: row.zone || null,
    district_label: row.district_label || null,
    ward_name: row.ward_name || null,
    doctor_count: row.doctor_count != null ? Number(row.doctor_count) : null,
    nurse_midwife_count:
      row.nurse_midwife_count != null ? Number(row.nurse_midwife_count) : null,
    bed_capacity: row.bed_capacity != null ? Number(row.bed_capacity) : null,
    beds_count: row.beds_count != null ? Number(row.beds_count) : null,
    capacity_persons:
      row.capacity_persons != null ? Number(row.capacity_persons) : null,
    patient_visits_total:
      row.patient_visits_total != null ? Number(row.patient_visits_total) : null,
    services_offered: row.services_offered || null,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    is_active: row.is_active != null ? Boolean(row.is_active) : null,
    facility_created_at: row.facility_created_at || null,
    facility_updated_at: row.facility_updated_at || null,
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

function quoteSqlIdentifier(columnName) {
  if (/^[a-z_][a-z0-9_]*$/i.test(columnName)) {
    return columnName;
  }

  return `"${String(columnName).replace(/"/g, '""')}"`;
}

function normalizeHealthServicesOffered(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mapHealthPayloadToColumns(payload) {
  const columnMap = [
    ["code", "code"],
    ["name", "name"],
    ["commonName", "common_name"],
    ["type", "type"],
    ["ownership", "ownership"],
    ["capacityPersons", "capacity:persons"],
    ["zone", "zone"],
    ["districtLabel", "district"],
    ["status", "status"],
    ["doctorCount", "doctor_count"],
    ["nurseMidwifeCount", "nurse_midwife_count"],
    ["bedCapacity", "bed_capacity"],
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
      value:
        inputKey === "servicesOffered"
          ? normalizeHealthServicesOffered(payload[inputKey])
          : payload[inputKey],
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
      `
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure ffe
        ${EDUCATION_FACILITY_LATERAL_JOIN}
        ${whereClause}
      `,
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
          COALESCE(
            ef.school_name,
            to_jsonb(ef)->>'name',
            to_jsonb(ef)->>'school_name',
            ffe.facility_name
          ) AS school_name,
          ef.student_enrollment_total,
          ef.teacher_count,
          ef.status AS school_status,
          COALESCE(ST_Y(ef.geom), ef.y_coordinate) AS latitude,
          COALESCE(ST_X(ef.geom), ef.x_coordinate) AS longitude
        FROM flood_facility_exposure ffe
        ${EDUCATION_FACILITY_LATERAL_JOIN}
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
          school_name: row.school_name || row.facility_name || null,
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
 * /api/v1/admin-data/health/facility_access:
 *   get:
 *     summary: List health facility access metrics
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Health facility access metrics
 */
router.get("/health/facility_access", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = [];
    const params = [];

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`hf.district_id = $${params.length}`);
    }

    const wardId = parsePositiveInteger(req.query.ward_id, null);
    if (wardId) {
      params.push(wardId);
      conditions.push(`hf.ta_id = $${params.length}`);
    }

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`
        (
          COALESCE(hf.name, '') ILIKE $${params.length}
          OR COALESCE(hf.code, '') ILIKE $${params.length}
          OR COALESCE(hf.common_name, '') ILIKE $${params.length}
          OR COALESCE(hf.type, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM health_facility_access_metrics ham
        JOIN health_facilities hf ON hf.id = ham.facility_id
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ham.facility_id,
          ham.coverage_distance_km,
          ham.worldpop_population_within_buffer,
          ham.welfare_beneficiaries_within_buffer,
          ham.welfare_beneficiaries_served_by_8km_network,
          ham.avg_network_distance_km,
          ham.avg_travel_time_min,
          ham.metadata,
          ham.calculated_at,
          hf.id AS health_facility_id,
          hf.code,
          hf.name,
          hf.common_name,
          hf.type,
          hf.ownership,
          hf."capacity:persons" AS capacity_persons,
          hf.zone,
          hf.district AS district_label,
          hf.status,
          hf.doctor_count,
          hf.nurse_midwife_count,
          hf.bed_capacity,
          hf.beds_count,
          hf.patient_visits_total,
          hf.services_offered,
          ward.name AS ward_name,
          hf.district_id,
          district.name AS district_name,
          hf.is_active,
          COALESCE(ST_Y(hf.geom), hf.latitude) AS latitude,
          COALESCE(ST_X(hf.geom), hf.longitude) AS longitude
        FROM health_facility_access_metrics ham
        JOIN health_facilities hf ON hf.id = ham.facility_id
        LEFT JOIN admin3_units ward ON ward.id = hf.ta_id
        LEFT JOIN districts district ON district.id = COALESCE(hf.district_id, ward.district_id)
        ${whereClause}
        ORDER BY ham.calculated_at DESC NULLS LAST, district.name ASC NULLS LAST, hf.name ASC NULLS LAST
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map(mapHealthFacilityAccessRow),
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
    console.error("Admin health facility access error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load health facility access metrics",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/health/flood_exposed:
 *   get:
 *     summary: List flood-exposed health facilities from flood_facility_exposure
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Flood-exposed health facilities
 */
router.get("/health/flood_exposed", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;

    const conditions = ["LOWER(ffe.facility_type) = 'health'"];
    const params = [];

    conditions.push(
      `ffe.analysis_date = (SELECT MAX(analysis_date) FROM flood_facility_exposure WHERE LOWER(facility_type) = 'health')`,
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

    if (req.query.search && String(req.query.search).trim()) {
      params.push(`%${String(req.query.search).trim()}%`);
      conditions.push(`
        (
          COALESCE(ffe.facility_name, '') ILIKE $${params.length}
          OR COALESCE(hf.name, '') ILIKE $${params.length}
          OR COALESCE(hf.code, '') ILIKE $${params.length}
          OR COALESCE(hf.common_name, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure ffe
        ${HEALTH_FACILITY_LATERAL_JOIN}
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ffe.id,
          ffe.analysis_date,
          ffe.facility_id,
          ffe.facility_name,
          ffe.district_id,
          ffe.district_name,
          ffe.ta_id,
          ffe.ta_name,
          ffe.facility_type,
          ffe.flood_value,
          ffe.risk_class,
          ffe.is_exposed,
          ffe.created_at AS exposure_created_at,
          ffe.updated_at AS exposure_updated_at,
          hf.id AS health_facility_id,
          hf.code,
          COALESCE(hf.name, hf.common_name, ffe.facility_name) AS name,
          hf.common_name,
          hf.type AS health_facility_type,
          hf.ownership,
          hf."capacity:persons" AS capacity_persons,
          hf.zone,
          hf.district AS district_label,
          hf.status,
          hf.doctor_count,
          hf.nurse_midwife_count,
          hf.bed_capacity,
          hf.beds_count,
          hf.patient_visits_total,
          hf.services_offered,
          ward.name AS ward_name,
          COALESCE(ST_Y(hf.geom), hf.latitude) AS latitude,
          COALESCE(ST_X(hf.geom), hf.longitude) AS longitude,
          hf.is_active,
          hf.created_at AS facility_created_at,
          hf.updated_at AS facility_updated_at
        FROM flood_facility_exposure ffe
        ${HEALTH_FACILITY_LATERAL_JOIN}
        LEFT JOIN admin3_units ward ON ward.id = hf.ta_id
        ${whereClause}
        ORDER BY ffe.is_exposed DESC, ffe.risk_class DESC, ffe.district_name ASC, ffe.ta_name ASC, ffe.facility_name ASC
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        items: rowsResult.rows.map(mapHealthFloodExposedRow),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search: req.query.search || "",
          district_id: districtId,
          ta_id: taId,
          risk_class: riskClass,
          exposed_only: exposedOnly,
        },
      },
    });
  } catch (error) {
    console.error("Admin health flood exposed error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load flood-exposed health facilities",
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
    const conditions = ["ffe.is_exposed = TRUE"];

    conditions.push(
      `ffe.analysis_date = (SELECT MAX(analysis_date) FROM flood_facility_exposure)`,
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

    const facilityType = req.query.facility_type
      ? String(req.query.facility_type).trim().toLowerCase()
      : null;
    if (facilityType) {
      params.push(facilityType);
      conditions.push(`LOWER(ffe.facility_type) = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`
        (
          COALESCE(ffe.facility_name, '') ILIKE $${params.length}
          OR COALESCE(ffe.facility_type, '') ILIKE $${params.length}
          OR COALESCE(ffe.risk_class, '') ILIKE $${params.length}
          OR COALESCE(ffe.ta_name, '') ILIKE $${params.length}
          OR COALESCE(ffe.district_name, '') ILIKE $${params.length}
          OR COALESCE(hf.name, '') ILIKE $${params.length}
          OR COALESCE(ef.school_name, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure ffe
        ${HEALTH_FACILITY_LATERAL_JOIN}
        ${EDUCATION_FACILITY_LATERAL_JOIN}
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ffe.id,
          ffe.analysis_date,
          ffe.district_id,
          ffe.district_name,
          ffe.ta_id,
          ffe.ta_name,
          ffe.facility_type,
          ffe.facility_id,
          ffe.facility_name,
          ffe.flood_value,
          ffe.risk_class,
          ffe.is_exposed,
          ffe.created_at,
          ffe.updated_at,
          hf.code AS health_code,
          COALESCE(hf.name, hf.common_name, ffe.facility_name) AS health_name,
          hf.type AS health_type,
          hf.status AS health_status,
          COALESCE(
            ef.school_name,
            to_jsonb(ef)->>'name',
            to_jsonb(ef)->>'school_name',
            CASE WHEN LOWER(TRIM(ffe.facility_type)) = 'education' THEN ffe.facility_name END
          ) AS school_name,
          ef.status AS school_status,
          ef.student_enrollment_total,
          ef.teacher_count,
          COALESCE(
            ST_Y(hf.geom),
            hf.latitude,
            ST_Y(ef.geom),
            ef.y_coordinate
          ) AS latitude,
          COALESCE(
            ST_X(hf.geom),
            hf.longitude,
            ST_X(ef.geom),
            ef.x_coordinate
          ) AS longitude
        FROM flood_facility_exposure ffe
        ${HEALTH_FACILITY_LATERAL_JOIN}
        ${EDUCATION_FACILITY_LATERAL_JOIN}
        ${whereClause}
        ORDER BY ffe.facility_type ASC, ffe.district_name ASC, ffe.ta_name ASC, ffe.facility_name ASC
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
          analysis_date: row.analysis_date || null,
          district_id: row.district_id != null ? Number(row.district_id) : null,
          district_name: row.district_name || null,
          ta_id: row.ta_id != null ? Number(row.ta_id) : null,
          ta_name: row.ta_name || null,
          facility_type: row.facility_type || null,
          facility_id: row.facility_id != null ? Number(row.facility_id) : null,
          facility_name: row.facility_name || null,
          flood_value:
            row.flood_value != null
              ? Number(Number(row.flood_value).toFixed(4))
              : null,
          risk_class: row.risk_class || null,
          is_exposed: Boolean(row.is_exposed),
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          health_code: row.health_code || null,
          health_name: row.health_name || row.facility_name || null,
          health_type: row.health_type || null,
          health_status: row.health_status || null,
          school_name: row.school_name || null,
          school_status: row.school_status || null,
          student_enrollment_total:
            row.student_enrollment_total != null
              ? Number(row.student_enrollment_total)
              : null,
          teacher_count:
            row.teacher_count != null ? Number(row.teacher_count) : null,
          latitude: row.latitude != null ? Number(row.latitude) : null,
          longitude: row.longitude != null ? Number(row.longitude) : null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
          district_id: districtId,
          ta_id: taId,
          facility_type: facilityType,
        },
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
    const conditions = [
      `ffes.analysis_date = (SELECT MAX(analysis_date) FROM flood_facility_exposure_summary)`,
    ];

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`ffes.district_id = $${params.length}`);
    }

    const taId = parsePositiveInteger(req.query.ta_id, null);
    if (taId) {
      params.push(taId);
      conditions.push(`ffes.ta_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`
        (
          COALESCE(ffes.district_name, '') ILIKE $${params.length}
          OR COALESCE(ffes.ta_name, '') ILIKE $${params.length}
          OR COALESCE(ffes.facility_type, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM flood_facility_exposure_summary ffes
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ffes.id,
          ffes.analysis_date,
          ffes.district_id,
          ffes.district_name,
          ffes.ta_id,
          ffes.ta_name,
          ffes.facility_type,
          ffes.total_facilities,
          ffes.exposed_facilities,
          ffes.low_risk_count,
          ffes.medium_risk_count,
          ffes.high_risk_count,
          ROUND(
            CASE
              WHEN ffes.total_facilities > 0 THEN
                (ffes.exposed_facilities::numeric * 100) / ffes.total_facilities
              ELSE 0
            END,
            2
          ) AS exposed_percentage,
          ffes.created_at,
          ffes.updated_at
        FROM flood_facility_exposure_summary ffes
        ${whereClause}
        ORDER BY ffes.facility_type ASC, ffes.district_name ASC, ffes.ta_name ASC
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
          analysis_date: row.analysis_date || null,
          district_id: row.district_id != null ? Number(row.district_id) : null,
          district_name: row.district_name || null,
          ta_id: row.ta_id != null ? Number(row.ta_id) : null,
          ta_name: row.ta_name || null,
          facility_type: row.facility_type || null,
          total_facilities:
            row.total_facilities != null ? Number(row.total_facilities) : null,
          exposed_facilities:
            row.exposed_facilities != null ? Number(row.exposed_facilities) : null,
          low_risk_count:
            row.low_risk_count != null ? Number(row.low_risk_count) : null,
          medium_risk_count:
            row.medium_risk_count != null ? Number(row.medium_risk_count) : null,
          high_risk_count:
            row.high_risk_count != null ? Number(row.high_risk_count) : null,
          exposed_percentage:
            row.exposed_percentage != null
              ? Number(row.exposed_percentage)
              : null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
          district_id: districtId,
          ta_id: taId,
        },
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
 * /api/v1/admin-data/disaster/flood_zones:
 *   get:
 *     summary: List flood zone population exposure records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Flood zone records
 */
router.get("/disaster/flood_zones", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();

    const params = [];
    const conditions = [
      `fz.analysis_date = (SELECT MAX(analysis_date) FROM flood_zones)`,
    ];

    const districtId = parsePositiveInteger(req.query.district_id, null);
    if (districtId) {
      params.push(districtId);
      conditions.push(`fz.district_id = $${params.length}`);
    }

    const taId = parsePositiveInteger(req.query.ta_id, null);
    if (taId) {
      params.push(taId);
      conditions.push(`fz.ta_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`
        (
          COALESCE(fz.district_name, '') ILIKE $${params.length}
          OR COALESCE(fz.ta_name, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM flood_zones fz
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          fz.id,
          fz.district_id,
          fz.district_name,
          fz.ta_id,
          fz.ta_name,
          fz.total_population,
          fz.exposed_population,
          fz.low_risk_population,
          fz.medium_risk_population,
          fz.high_risk_population,
          fz.exposed_area_sq_km,
          fz.analysis_date,
          fz.created_at,
          fz.updated_at
        FROM flood_zones fz
        ${whereClause}
        ORDER BY fz.district_name ASC, fz.ta_name ASC
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
          district_id: row.district_id != null ? Number(row.district_id) : null,
          district_name: row.district_name || null,
          ta_id: row.ta_id != null ? Number(row.ta_id) : null,
          ta_name: row.ta_name || null,
          total_population:
            row.total_population != null ? Number(row.total_population) : null,
          exposed_population:
            row.exposed_population != null ? Number(row.exposed_population) : null,
          low_risk_population:
            row.low_risk_population != null ? Number(row.low_risk_population) : null,
          medium_risk_population:
            row.medium_risk_population != null
              ? Number(row.medium_risk_population)
              : null,
          high_risk_population:
            row.high_risk_population != null ? Number(row.high_risk_population) : null,
          exposed_area_sq_km:
            row.exposed_area_sq_km != null
              ? Number(Number(row.exposed_area_sq_km).toFixed(4))
              : null,
          analysis_date: row.analysis_date || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
          district_id: districtId,
          ta_id: taId,
        },
      },
    });
  } catch (error) {
    console.error("Admin disaster flood zones list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load flood zone records",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/disaster/flood_risk_polygons:
 *   get:
 *     summary: List flood risk polygon records
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Flood risk polygon records
 */
router.get("/disaster/flood_risk_polygons", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();

    const params = [];
    const conditions = [
      `frp.analysis_date = (SELECT MAX(analysis_date) FROM flood_risk_polygons)`,
    ];

    const riskLevel = req.query.risk_level
      ? String(req.query.risk_level).trim().toLowerCase()
      : null;
    if (riskLevel) {
      params.push(riskLevel);
      conditions.push(`LOWER(frp.risk_level) = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`
        (
          COALESCE(frp.risk_level, '') ILIKE $${params.length}
          OR COALESCE(frp.source_raster, '') ILIKE $${params.length}
        )
      `);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM flood_risk_polygons frp
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          frp.id,
          frp.analysis_date,
          frp.risk_level,
          frp.source_raster,
          frp.created_at,
          ROUND((ST_Area(frp.geom::geography) / 1000000)::numeric, 4) AS area_sq_km,
          ST_Y(ST_Centroid(frp.geom)) AS latitude,
          ST_X(ST_Centroid(frp.geom)) AS longitude
        FROM flood_risk_polygons frp
        ${whereClause}
        ORDER BY frp.risk_level ASC, frp.id ASC
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
          analysis_date: row.analysis_date || null,
          risk_level: row.risk_level || null,
          source_raster: row.source_raster || null,
          area_sq_km:
            row.area_sq_km != null ? Number(row.area_sq_km) : null,
          latitude: row.latitude != null ? Number(row.latitude) : null,
          longitude: row.longitude != null ? Number(row.longitude) : null,
          created_at: row.created_at || null,
        })),
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
          risk_level: riskLevel,
        },
      },
    });
  } catch (error) {
    console.error("Admin disaster flood risk polygons list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load flood risk polygon records",
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateDistrictWardRelationship(
          client,
          value.districtId,
          value.wardId,
        );

        await stagePendingAdminDataEdit(client, {
          tableName: "education_facilities",
          recordId: null,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Education record submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateDistrictWardRelationship(
          client,
          value.districtId,
          value.wardId,
        );

        await stagePendingAdminDataEdit(client, {
          tableName: "health_facilities",
          recordId: null,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Health record submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const authUser = getAuthUser(req);
    await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_programs",
          recordId: null,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          requestPayload: value,
        });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Welfare program submitted for verification",
      data: { review_pending: true },
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

      await stagePendingAdminDataEdit(client, {
        tableName: "welfare_beneficiary",
        recordId: null,
        action: "create",
        userId: authUser.id,
        beforeData: null,
        requestPayload: value,
      });

      await client.query("COMMIT");

      return res.status(202).json({
        status: "pending",
        message: "Beneficiary submitted for verification",
        data: { review_pending: true },
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

      await stagePendingAdminDataEdit(client, {
        tableName: "welfare_beneficiary",
        recordId: id,
        action: "update",
        userId: authUser.id,
        beforeData: existing.rows[0],
        requestPayload: payload,
      });

      await client.query("COMMIT");
      return res.status(202).json({
        status: "pending",
        message: "Beneficiary update submitted for verification",
        data: { review_pending: true },
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

      await stagePendingAdminDataEdit(client, {
        tableName: "welfare_beneficiary",
        recordId: id,
        action: "delete",
        userId: authUser.id,
        beforeData: existing.rows[0],
        requestPayload: null,
      });

      await client.query("COMMIT");
      return res.status(202).json({
        status: "pending",
        message: "Beneficiary deletion submitted for verification",
        data: { review_pending: true },
      });
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

  try {
    const authUser = getAuthUser(req);
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          "SELECT * FROM welfare_programs WHERE program_id = $1",
          [id],
        );
        if (!existing.rows.length) {
          await client.query("ROLLBACK");
          return null;
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_programs",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existing.rows[0],
          requestPayload: {
            ...(Object.prototype.hasOwnProperty.call(req.body, "program_name")
              ? { program_name: program_name == null ? null : String(program_name).trim() }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(req.body, "department")
              ? { department: department ?? null }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(req.body, "description")
              ? { description: description ?? null }
              : {}),
          },
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!pendingRequest) {
      return res.status(404).json({ status: "error", message: "Program not found" });
    }

    return res.status(202).json({
      status: "pending",
      message: "Program update submitted for verification",
      data: { review_pending: true },
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
    const authUser = getAuthUser(req);
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          "SELECT * FROM welfare_programs WHERE program_id = $1",
          [id],
        );
        if (!existing.rows.length) {
          await client.query("ROLLBACK");
          return null;
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_programs",
          recordId: id,
          action: "delete",
          userId: authUser.id,
          beforeData: existing.rows[0],
          requestPayload: null,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (!pendingRequest) {
      return res.status(404).json({ status: "error", message: "Program not found" });
    }

    return res.status(202).json({
      status: "pending",
      message: "Program deletion submitted for verification",
      data: { review_pending: true },
    });
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
    const authUser = getAuthUser(req);
    await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");
        await validateWardExists(client, value.wardId);

        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_beneficiaries",
          recordId: null,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          requestPayload: value,
        });

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Welfare record submitted for verification",
      data: { review_pending: true },
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

    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        await stagePendingAdminDataEdit(client, {
          tableName: "disaster_zones",
          recordId: null,
          action: "create",
          userId: authUser.id,
          beforeData: null,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Disaster record submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
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

        await stagePendingAdminDataEdit(client, {
          tableName: "education_facilities",
          recordId: schoolId,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Education update submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
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

        await stagePendingAdminDataEdit(client, {
          tableName: "health_facilities",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Health update submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
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

        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_beneficiaries",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Welfare update submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchDisasterRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        if (includesGeometryUpdate) {
          const geometryPayload = parseDisasterGeometry(value.geometryGeoJson);
          if (!geometryPayload) {
            throw new Error("geometryGeoJson cannot be empty when provided");
          }
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "disaster_zones",
          recordId: id,
          action: "update",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: value,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Disaster update submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchEducationRecord(client, schoolId);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "education_facilities",
          recordId: schoolId,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: null,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Education archive submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchHealthRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "health_facilities",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: null,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Health archive submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
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

        await stagePendingAdminDataEdit(client, {
          tableName: "welfare_beneficiaries",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: null,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Welfare archive submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
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
    const pendingRequest = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchDisasterRecord(client, id);
        if (!existingRecord) {
          await client.query("ROLLBACK");
          return null;
        }

        await stagePendingAdminDataEdit(client, {
          tableName: "disaster_zones",
          recordId: id,
          action: "archive",
          userId: authUser.id,
          beforeData: existingRecord,
          requestPayload: null,
        });

        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    return res.status(202).json({
      status: "pending",
      message: "Disaster archive submitted for verification",
      data: { review_pending: Boolean(pendingRequest) },
    });
  } catch (err) {
    console.error("Admin disaster archive error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to archive disaster record",
    });
  }
});

function normalizeReviewPayload(payload) {
  if (payload == null) {
    return null;
  }

  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch (_err) {
      return payload;
    }
  }

  return payload;
}

async function finalizePendingReview(
  client,
  { reviewId, reviewerId, reviewNotes, recordId, afterData, status },
) {
  await client.query(
    `
      UPDATE admin_data_edits
      SET status = $1,
          reviewed_by_user_id = $2,
          reviewed_at = CURRENT_TIMESTAMP,
          review_notes = $3,
          record_id = COALESCE($4, record_id),
          after_data = $5::jsonb
      WHERE id = $6
    `,
    [
      status,
      reviewerId || null,
      reviewNotes || null,
      recordId || null,
      JSON.stringify(afterData ?? null),
      reviewId,
    ],
  );
}

async function applyPendingAdminDataReview(client, review) {
  const requestPayload = normalizeReviewPayload(review.request_payload) || {};
  const tableName = review.table_name;
  const action = review.action;

  if (tableName === "education_facilities") {
    if (action === "create") {
      const { error, value } = validateEducationCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      await validateDistrictWardRelationship(client, value.districtId, value.wardId);

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
          value.isActive,
        ],
      );

      const schoolId = insertedResult.rows[0].school_id;
      const record = await fetchEducationRecord(client, schoolId);
      return { department: "education", recordId: schoolId, afterData: record };
    }

    if (action === "update") {
      const { error, value } = validateEducationUpdate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      requireLatLngTogether(value);

      const pendingUpdates = mapEducationPayloadToColumns(value);
      const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
        value,
        "latitude",
      );

      if (!pendingUpdates.length && !includesGeometryUpdate) {
        throw new Error("No editable fields were provided");
      }

      const existingRecord = await fetchEducationRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Education record not found");
      }

      const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(value, "districtId");
      const hasWardUpdate = Object.prototype.hasOwnProperty.call(value, "wardId");
      const nextDistrictId = hasDistrictUpdate ? value.districtId : existingRecord.district_id;
      const nextWardId = hasWardUpdate ? value.wardId : existingRecord.ward_id;

      if (hasDistrictUpdate || hasWardUpdate) {
        await validateDistrictWardRelationship(client, nextDistrictId, nextWardId);
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
      params.push(review.record_id);

      await client.query(
        `
          UPDATE education_facilities
          SET ${setClauses.join(", ")}
          WHERE school_id = $${params.length}
        `,
        params,
      );

      const record = await fetchEducationRecord(client, review.record_id);
      return {
        department: "education",
        recordId: review.record_id,
        afterData: record,
      };
    }

    if (action === "archive") {
      const existingRecord = await fetchEducationRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Education record not found");
      }

      await client.query(
        `
          UPDATE education_facilities
          SET is_active = FALSE,
              updated_at = CURRENT_TIMESTAMP
          WHERE school_id = $1
        `,
        [review.record_id],
      );

      const record = await fetchEducationRecord(client, review.record_id);
      return {
        department: "education",
        recordId: review.record_id,
        afterData: record,
      };
    }
  }

  if (tableName === "health_facilities") {
    if (action === "create") {
      const { error, value } = validateHealthCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      await validateDistrictWardRelationship(client, value.districtId, value.wardId);

      const insertedResult = await client.query(
        `
          INSERT INTO health_facilities (
            code,
            name,
            common_name,
            type,
            ownership,
            "capacity:persons",
            zone,
            district,
            status,
            doctor_count,
            nurse_midwife_count,
            bed_capacity,
            beds_count,
            patient_visits_total,
            services_offered,
            district_id,
            ta_id,
            latitude,
            longitude,
            geom,
            is_active,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18, $19,
            ST_SetSRID(ST_MakePoint($19, $18), 4326),
            COALESCE($20, TRUE),
            CURRENT_TIMESTAMP
          )
          RETURNING id
        `,
        [
          value.code ?? null,
          value.name,
          value.commonName ?? null,
          value.type ?? null,
          value.ownership ?? null,
          value.capacityPersons ?? null,
          value.zone ?? null,
          value.districtLabel ?? null,
          value.status ?? null,
          value.doctorCount ?? null,
          value.nurseMidwifeCount ?? null,
          value.bedCapacity ?? null,
          value.bedsCount ?? null,
          value.patientVisitsTotal ?? null,
          normalizeHealthServicesOffered(value.servicesOffered) ?? [],
          value.districtId ?? null,
          value.wardId ?? null,
          value.latitude,
          value.longitude,
          value.isActive,
        ],
      );

      const id = insertedResult.rows[0].id;
      const record = await fetchHealthRecord(client, id);
      return { department: "health", recordId: id, afterData: record };
    }

    if (action === "update") {
      const { error, value } = validateHealthUpdate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      requireLatLngTogether(value);

      const pendingUpdates = mapHealthPayloadToColumns(value);
      const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
        value,
        "latitude",
      );

      if (!pendingUpdates.length && !includesGeometryUpdate) {
        throw new Error("No editable fields were provided");
      }

      const existingRecord = await fetchHealthRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Health record not found");
      }

      const hasDistrictUpdate = Object.prototype.hasOwnProperty.call(value, "districtId");
      const hasWardUpdate = Object.prototype.hasOwnProperty.call(value, "wardId");
      const nextDistrictId = hasDistrictUpdate ? value.districtId : existingRecord.district_id;
      const nextWardId = hasWardUpdate ? value.wardId : existingRecord.ward_id;

      if (hasDistrictUpdate || hasWardUpdate) {
        await validateDistrictWardRelationship(client, nextDistrictId, nextWardId);
      }

      const setClauses = [];
      const params = [];

      pendingUpdates.forEach(({ columnName, value: columnValue }) => {
        params.push(columnValue ?? null);
        setClauses.push(`${quoteSqlIdentifier(columnName)} = $${params.length}`);
      });

      if (includesGeometryUpdate) {
        params.push(value.longitude, value.latitude);
        setClauses.push(
          `geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`,
          `longitude = $${params.length - 1}`,
          `latitude = $${params.length}`,
        );
      }

      setClauses.push("updated_at = CURRENT_TIMESTAMP");
      params.push(review.record_id);

      await client.query(
        `
          UPDATE health_facilities
          SET ${setClauses.join(", ")}
          WHERE id = $${params.length}
        `,
        params,
      );

      const record = await fetchHealthRecord(client, review.record_id);
      return { department: "health", recordId: review.record_id, afterData: record };
    }

    if (action === "archive") {
      const existingRecord = await fetchHealthRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Health record not found");
      }

      await client.query(
        `
          UPDATE health_facilities
          SET is_active = FALSE,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [review.record_id],
      );

      const record = await fetchHealthRecord(client, review.record_id);
      return { department: "health", recordId: review.record_id, afterData: record };
    }
  }

  if (tableName === "welfare_beneficiaries") {
    const welfareWardColumn = await getWelfareWardColumn();

    if (action === "create") {
      const { error, value } = validateWelfareCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

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
      return {
        department: "welfare",
        recordId: id,
        afterData: record,
      };
    }

    if (action === "update") {
      const { error, value } = validateWelfareUpdate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      requireLatLngTogether(value);

      const pendingUpdates = mapWelfarePayloadToColumns(value, welfareWardColumn);
      const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
        value,
        "latitude",
      );

      if (!pendingUpdates.length && !includesGeometryUpdate) {
        throw new Error("No editable fields were provided");
      }

      const existingRecord = await fetchWelfareRecord(
        client,
        review.record_id,
        welfareWardColumn,
      );
      if (!existingRecord) {
        throw new Error("Welfare record not found");
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
      params.push(review.record_id);

      await client.query(
        `
          UPDATE welfare_beneficiaries
          SET ${setClauses.join(", ")}
          WHERE id = $${params.length}
        `,
        params,
      );

      const record = await fetchWelfareRecord(client, review.record_id, welfareWardColumn);
      return { department: "welfare", recordId: review.record_id, afterData: record };
    }

    if (action === "archive") {
      const existingRecord = await fetchWelfareRecord(
        client,
        review.record_id,
        welfareWardColumn,
      );
      if (!existingRecord) {
        throw new Error("Welfare record not found");
      }

      await client.query(
        `
          UPDATE welfare_beneficiaries
          SET is_active = FALSE,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [review.record_id],
      );

      const record = await fetchWelfareRecord(client, review.record_id, welfareWardColumn);
      return { department: "welfare", recordId: review.record_id, afterData: record };
    }
  }

  if (tableName === "welfare_beneficiary") {
    if (action === "create") {
      const { error, value } = validateWelfareBeneficiaryCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      const programCheck = await client.query(
        "SELECT program_id FROM welfare_programs WHERE program_id = $1",
        [value.programId],
      );
      if (!programCheck.rows.length) {
        throw new Error(`Program with id ${value.programId} does not exist`);
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
            geom,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8::date, $9::date,
            $10, $11,
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
            wb.updated_at,
            ST_Y(wb.geom) AS latitude,
            ST_X(wb.geom) AS longitude
          FROM welfare_beneficiary wb
          LEFT JOIN welfare_programs wp ON wp.program_id = wb.program_id
          LEFT JOIN districts d         ON d.id  = wb.district_id
          LEFT JOIN admin3_units a3     ON a3.id = wb.ta_id
          WHERE wb.id = $1
        `,
        [newId],
      );

      return {
        department: "welfare",
        recordId: newId,
        afterData: recordResult.rows[0],
      };
    }

    if (action === "update") {
      const allowed = [
        "programId",
        "firstname",
        "lastname",
        "gender",
        "age",
        "householdSize",
        "status",
        "startDate",
        "endDate",
        "districtId",
        "taId",
        "latitude",
        "longitude",
      ];
      const payload = {};
      allowed.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(requestPayload, key)) {
          payload[key] = requestPayload[key];
        }
      });

      const existing = await client.query(
        "SELECT * FROM welfare_beneficiary WHERE id = $1",
        [review.record_id],
      );
      if (!existing.rows.length) {
        throw new Error("Beneficiary not found");
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
        const existingCoordinateResult = await client.query(
          "SELECT ST_Y(geom) AS latitude, ST_X(geom) AS longitude FROM welfare_beneficiary WHERE id = $1",
          [review.record_id],
        );
        const currentLatitude = existingCoordinateResult.rows[0]?.latitude;
        const currentLongitude = existingCoordinateResult.rows[0]?.longitude;
        const nextLatitude = hasLat ? payload.latitude : currentLatitude;
        const nextLongitude = hasLng ? payload.longitude : currentLongitude;

        if (
          nextLatitude === null ||
          nextLatitude === undefined ||
          nextLongitude === null ||
          nextLongitude === undefined
        ) {
          throw new Error("Latitude and longitude are required to update beneficiary geometry");
        }
        params.push(nextLatitude, nextLongitude);
        setClauses.push(
          `geom = ST_SetSRID(ST_MakePoint($${params.length}, $${params.length - 1}), 4326)`,
        );
      }

      setClauses.push("updated_at = CURRENT_TIMESTAMP");
      params.push(review.record_id);

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
        [review.record_id],
      );

      return {
        department: "welfare",
        recordId: review.record_id,
        afterData: updated.rows[0],
      };
    }

    if (action === "delete") {
      const existing = await client.query(
        "SELECT * FROM welfare_beneficiary WHERE id = $1",
        [review.record_id],
      );
      if (!existing.rows.length) {
        throw new Error("Beneficiary not found");
      }

      await client.query("DELETE FROM welfare_beneficiary WHERE id = $1", [
        review.record_id,
      ]);

      return {
        department: "welfare",
        recordId: review.record_id,
        afterData: null,
      };
    }
  }

  if (tableName === "welfare_programs") {
    if (action === "create") {
      const { error, value } = validateWelfareProgramCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      const result = await client.query(
        `
          INSERT INTO welfare_programs (program_name, department, description)
          VALUES ($1, $2, $3)
          RETURNING *
        `,
        [value.program_name, value.department, value.description],
      );

      return {
        department: "welfare",
        recordId: result.rows[0].program_id,
        afterData: result.rows[0],
      };
    }

    if (action === "update") {
      const payload = normalizeReviewPayload(review.request_payload) || {};
      const setClauses = [];
      const params = [];

      if (Object.prototype.hasOwnProperty.call(payload, "program_name")) {
        params.push(payload.program_name == null ? null : String(payload.program_name).trim());
        setClauses.push(`program_name = $${params.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(payload, "department")) {
        params.push(payload.department ?? null);
        setClauses.push(`department = $${params.length}`);
      }
      if (Object.prototype.hasOwnProperty.call(payload, "description")) {
        params.push(payload.description ?? null);
        setClauses.push(`description = $${params.length}`);
      }

      if (!setClauses.length) {
        throw new Error("No editable fields provided");
      }

      setClauses.push("updated_at = CURRENT_TIMESTAMP");
      params.push(review.record_id);

      const result = await client.query(
        `UPDATE welfare_programs SET ${setClauses.join(", ")} WHERE program_id = $${params.length} RETURNING *`,
        params,
      );

      if (!result.rows.length) {
        throw new Error("Program not found");
      }

      return {
        department: "welfare",
        recordId: review.record_id,
        afterData: result.rows[0],
      };
    }

    if (action === "delete") {
      const result = await client.query(
        "DELETE FROM welfare_programs WHERE program_id = $1 RETURNING program_id",
        [review.record_id],
      );
      if (!result.rows.length) {
        throw new Error("Program not found");
      }

      return {
        department: "welfare",
        recordId: review.record_id,
        afterData: null,
      };
    }
  }

  if (tableName === "disaster_zones") {
    if (action === "create") {
      const { error, value } = validateDisasterCreate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      const geometryPayload = parseDisasterGeometry(value.geometryGeoJson);
      if (!geometryPayload) {
        throw new Error("geometryGeoJson is required");
      }

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
      return { department: "disaster", recordId: id, afterData: record };
    }

    if (action === "update") {
      const { error, value } = validateDisasterUpdate(requestPayload);
      if (error) {
        throw new Error(error);
      }

      const pendingUpdates = mapDisasterPayloadToColumns(value);
      const includesGeometryUpdate = Object.prototype.hasOwnProperty.call(
        value,
        "geometryGeoJson",
      );

      if (!pendingUpdates.length && !includesGeometryUpdate) {
        throw new Error("No editable fields were provided");
      }

      const existingRecord = await fetchDisasterRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Disaster record not found");
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
      params.push(review.record_id);

      await client.query(
        `
          UPDATE disaster_zones
          SET ${setClauses.join(", ")}
          WHERE id = $${params.length}
        `,
        params,
      );

      const record = await fetchDisasterRecord(client, review.record_id);
      return { department: "disaster", recordId: review.record_id, afterData: record };
    }

    if (action === "archive") {
      const existingRecord = await fetchDisasterRecord(client, review.record_id);
      if (!existingRecord) {
        throw new Error("Disaster record not found");
      }

      await client.query(
        `
          UPDATE disaster_zones
          SET is_active = FALSE,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [review.record_id],
      );

      const record = await fetchDisasterRecord(client, review.record_id);
      return { department: "disaster", recordId: review.record_id, afterData: record };
    }
  }

  throw new Error(`Unsupported pending review table: ${tableName}`);
}

function getReviewTablesForDepartment(department) {
  return REVIEW_TABLES_BY_DEPARTMENT[department] || [];
}

/**
 * @openapi
 * /api/v1/admin-data/reviews/pending:
 *   get:
 *     summary: List pending admin data reviews
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pending reviews
 */
router.get("/reviews/pending", requireGlobalAdmin, async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();
    const params = [];
    const conditions = ["ade.status = 'pending'"];

    if (search) {
      params.push(`%${search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(
          ade.table_name ILIKE ${placeholder}
          OR ade.action ILIKE ${placeholder}
          OR COALESCE(u.email, '') ILIKE ${placeholder}
          OR COALESCE(u.full_name, '') ILIKE ${placeholder}
          OR COALESCE(reviewer.full_name, '') ILIKE ${placeholder}
          OR COALESCE(ade.review_notes, '') ILIKE ${placeholder}
          OR COALESCE(ade.changed_fields::text, '') ILIKE ${placeholder}
        )`,
      );
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM admin_data_edits ade
        LEFT JOIN users u ON u.id = ade.changed_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = ade.reviewed_by_user_id
        ${whereClause}
      `,
      params,
    );

    const rowsResult = await db.query(
      `
        SELECT
          ade.id,
          ade.table_name,
          ade.record_id,
          ade.action,
          ade.status,
          ade.changed_by_user_id,
          u.email AS changed_by_email,
          u.full_name AS changed_by_full_name,
          reviewer.full_name AS reviewed_by_full_name,
          ade.changed_fields,
          ade.request_payload,
          ade.before_data,
          ade.after_data,
          ade.review_notes,
          ade.reviewed_at,
          ade.changed_at
        FROM admin_data_edits ade
        LEFT JOIN users u ON u.id = ade.changed_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = ade.reviewed_by_user_id
        ${whereClause}
        ORDER BY ade.changed_at DESC, ade.id DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `,
      [...params, pageSize, offset],
    );

    const total = countResult.rows[0]?.total || 0;
    return res.json({
      status: "success",
      data: {
        table: "pending_review_requests",
        label: "Pending Verifications",
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
        },
      },
    });
  } catch (error) {
    console.error("Admin review queue error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load pending verification requests",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/reviews/{id}/approve:
 *   patch:
 *     summary: Approve a pending admin data review
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Review approved
 */
router.patch("/reviews/:id/approve", requireGlobalAdmin, async (req, res) => {
  const reviewId = parsePositiveInteger(req.params.id, null);
  if (!reviewId) {
    return res.status(400).json({
      status: "error",
      message: "A valid review id is required",
    });
  }

  const reviewNotes = String(
    req.body?.reviewNotes ?? req.body?.review_notes ?? "",
  ).trim();

  try {
    const reviewer = getAuthUser(req);
    const result = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const review = await lockPendingReviewById(client, reviewId);
        if (!review) {
          await client.query("ROLLBACK");
          return { notFound: true };
        }

        if (review.status !== "pending") {
          throw new Error("Only pending reviews can be approved");
        }

        const applied = await applyPendingAdminDataReview(client, review);

        await finalizePendingReview(client, {
          reviewId,
          reviewerId: reviewer.id,
          reviewNotes: reviewNotes || null,
          recordId: applied.recordId,
          afterData: applied.afterData,
          status: "approved",
        });

        await client.query("COMMIT");
        return applied;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (result?.notFound) {
      return res.status(404).json({
        status: "error",
        message: "Pending review not found",
      });
    }

    let recomputeStarted = false;
    if (result?.department) {
      markDepartmentStale(result.department);
      recomputeStarted = triggerApprovedReviewRecompute(result.department);
    }

    return res.json({
      status: "success",
      message: "Review approved and applied successfully",
      data: {
        review_id: reviewId,
        record_id: result?.recordId ?? null,
        recompute_started: recomputeStarted,
      },
    });
  } catch (err) {
    console.error("Admin review approval error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to approve review",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/reviews/mine:
 *   get:
 *     summary: List the current user's submitted admin data reviews
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: User review history
 */
router.get("/reviews/mine", async (req, res) => {
  try {
    const authUser = getAuthUser(req);
    const department = String(req.query.department || "").trim().toLowerCase();

    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();
    const conditions = ["ade.changed_by_user_id = $1"];
    const params = [authUser.id || null];

    if (department) {
      const tableNames = getReviewTablesForDepartment(department);
      if (!tableNames.length) {
        return res.status(400).json({
          status: "error",
          message: "A valid department is required",
        });
      }

      params.push(tableNames);
      conditions.push(`ade.table_name = ANY($${params.length}::text[])`);
    }

    if (search) {
      params.push(`%${search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(
          ade.table_name ILIKE ${placeholder}
          OR ade.action ILIKE ${placeholder}
          OR COALESCE(ade.status, '') ILIKE ${placeholder}
          OR COALESCE(u.full_name, '') ILIKE ${placeholder}
          OR COALESCE(u.email, '') ILIKE ${placeholder}
          OR COALESCE(reviewer.full_name, '') ILIKE ${placeholder}
          OR COALESCE(ade.review_notes, '') ILIKE ${placeholder}
          OR COALESCE(ade.changed_fields::text, '') ILIKE ${placeholder}
        )`,
      );
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM admin_data_edits ade
        LEFT JOIN users u ON u.id = ade.changed_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = ade.reviewed_by_user_id
        ${whereClause}
      `,
      params,
    );

    const rowsResult = await db.query(
      `
        SELECT
          ade.id,
          ade.table_name,
          ade.record_id,
          ade.action,
          ade.status,
          ade.changed_by_user_id,
          u.email AS changed_by_email,
          u.full_name AS changed_by_full_name,
          ade.changed_fields,
          ade.request_payload,
          ade.before_data,
          ade.after_data,
          reviewer.full_name AS reviewed_by_full_name,
          ade.review_notes,
          ade.changed_at,
          ade.reviewed_at
        FROM admin_data_edits ade
        LEFT JOIN users u ON u.id = ade.changed_by_user_id
        LEFT JOIN users reviewer ON reviewer.id = ade.reviewed_by_user_id
        ${whereClause}
        ORDER BY ade.changed_at DESC, ade.id DESC
        LIMIT $${params.length + 1}
        OFFSET $${params.length + 2}
      `,
      [...params, pageSize, offset],
    );

    return res.json({
      status: "success",
      data: {
        table: "my_submission_history",
        label: "My Submission Status",
        items: rowsResult.rows,
        total: countResult.rows[0]?.total || 0,
        page,
        page_size: pageSize,
        total_pages: Math.max(1, Math.ceil((countResult.rows[0]?.total || 0) / pageSize)),
      },
    });
  } catch (error) {
    console.error("Admin submission history error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load submission history",
    });
  }
});

/**
 * @openapi
 * /api/v1/admin-data/reviews/{id}/reject:
 *   patch:
 *     summary: Reject a pending admin data review
 *     tags:
 *       - Admin Data
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Review rejected
 */
router.patch("/reviews/:id/reject", requireGlobalAdmin, async (req, res) => {
  const reviewId = parsePositiveInteger(req.params.id, null);
  if (!reviewId) {
    return res.status(400).json({
      status: "error",
      message: "A valid review id is required",
    });
  }

  const reviewNotes = String(
    req.body?.reviewNotes ?? req.body?.review_notes ?? "",
  ).trim();

  try {
    const reviewer = getAuthUser(req);
    const result = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const review = await lockPendingReviewById(client, reviewId);
        if (!review) {
          await client.query("ROLLBACK");
          return { notFound: true };
        }

        if (review.status !== "pending") {
          throw new Error("Only pending reviews can be rejected");
        }

        await client.query(
          `
            UPDATE admin_data_edits
            SET status = 'rejected',
                reviewed_by_user_id = $1,
                reviewed_at = CURRENT_TIMESTAMP,
                review_notes = $2
            WHERE id = $3
          `,
          [reviewer.id, reviewNotes || null, reviewId],
        );

        await client.query("COMMIT");
        return { rejected: true };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });

    if (result?.notFound) {
      return res.status(404).json({
        status: "error",
        message: "Pending review not found",
      });
    }

    return res.json({
      status: "success",
      message: "Review rejected successfully",
      data: {
        review_id: reviewId,
      },
    });
  } catch (err) {
    console.error("Admin review rejection error:", err.message);
    return res.status(400).json({
      status: "error",
      message: err.message || "Unable to reject review",
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
  const authUser = await resolveCurrentAuthUser(req);

  if (!isGlobalAccessRole(authUser.role)) {
    const departments = await getAccessibleDepartmentsForUser(
      authUser.id,
      authUser.role,
      "read",
    );

    if (!departments.length) {
      return res.json({
        status: "success",
        data: {
          departments: {},
        },
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
