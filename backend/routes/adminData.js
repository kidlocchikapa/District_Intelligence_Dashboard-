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

const EDUCATION_SORT_COLUMNS = {
  name: "ef.name",
  status: "ef.status",
  student_enrollment_total: "ef.student_enrollment_total",
  teacher_count: "ef.teacher_count",
  created_at: "ef.created_at",
  updated_at: "ef.updated_at",
};

const HEALTH_SORT_COLUMNS = {
  name: "hf.name",
  type: "hf.type",
  healthcare: "hf.healthcare",
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
  ef.name,
  ef."name:en" AS name_en,
  ef."name:ny" AS name_ny,
  ef.amenity,
  ef.building,
  ef."operator:type" AS operator_type,
  ef."capacity:persons" AS capacity_persons,
  ef."addr:full" AS address_full,
  ef."addr:city" AS address_city,
  ef.source,
  ef.status,
  ef.comments,
  ef.student_enrollment,
  ef.student_enrollment_total,
  ef.teacher_distribution,
  ef.teacher_count,
  ef.osm_id,
  ef.osm_type,
  ef.ward_id,
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
  hf.healthcare,
  hf.beds_count,
  hf.patient_visits_total,
  hf.services_offered,
  hf.ward_id,
  ward.name AS ward_name,
  hf.district_id,
  district.name AS district_name,
  hf.is_active,
  hf.created_at,
  hf.updated_at,
  ST_Y(hf.geom) AS latitude,
  ST_X(hf.geom) AS longitude
`;

const WELFARE_SELECT_FIELDS = `
  wb.id,
  wb.program_name,
  wb.beneficiary_count,
  wb.ward_id,
  ward.name AS ward_name,
  ward.parent_id AS district_id,
  district.name AS district_name,
  wb.is_active,
  wb.created_at,
  wb.updated_at,
  ST_Y(wb.geom) AS latitude,
  ST_X(wb.geom) AS longitude
`;

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

  if (!["education", "health", "welfare", "disaster"].includes(segments[0])) {
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

  return requireDepartmentAccess(
    accessRule.department,
    accessRule.action,
  )(req, res, next);
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
        COALESCE(ef.name, '') ILIKE $${params.length}
        OR COALESCE(ef."name:en", '') ILIKE $${params.length}
        OR COALESCE(ef."name:ny", '') ILIKE $${params.length}
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
    conditions.push(`ef.ward_id = $${params.length}`);
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
        OR COALESCE(hf.healthcare, '') ILIKE $${params.length}
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
    conditions.push(`hf.ward_id = $${params.length}`);
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    districtId,
    wardId,
    isActive,
  };
}

function buildWelfareListFilters(query) {
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
    conditions.push(`wb.ward_id = $${params.length}`);
  }

  const districtId = parsePositiveInteger(query.district_id, null);
  if (districtId) {
    params.push(districtId);
    conditions.push(`ward.parent_id = $${params.length}`);
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
    ["name", "name"],
    ["nameEn", '"name:en"'],
    ["nameNy", '"name:ny"'],
    ["amenity", "amenity"],
    ["building", "building"],
    ["operatorType", '"operator:type"'],
    ["capacityPersons", '"capacity:persons"'],
    ["addressFull", '"addr:full"'],
    ["addressCity", '"addr:city"'],
    ["source", "source"],
    ["status", "status"],
    ["comments", "comments"],
    ["studentEnrollmentTotal", "student_enrollment_total"],
    ["teacherCount", "teacher_count"],
    ["districtId", "district_id"],
    ["wardId", "ward_id"],
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
    ["wardId", "ward_id"],
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

function mapWelfarePayloadToColumns(payload) {
  const columnMap = [
    ["programName", "program_name"],
    ["beneficiaryCount", "beneficiary_count"],
    ["wardId", "ward_id"],
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
      LEFT JOIN administrative_units ward ON ward.id = ef.ward_id
      LEFT JOIN administrative_units district ON district.id = ef.district_id
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
      LEFT JOIN administrative_units ward ON ward.id = hf.ward_id
      LEFT JOIN administrative_units district ON district.id = hf.district_id
      WHERE hf.id = $1
      LIMIT 1
    `,
    [id],
  );

  return result.rows[0] || null;
}

async function fetchWelfareRecord(client, id) {
  const result = await client.query(
    `
      SELECT
        ${WELFARE_SELECT_FIELDS}
      FROM welfare_beneficiaries wb
      LEFT JOIN administrative_units ward ON ward.id = wb.ward_id
      LEFT JOIN administrative_units district ON district.id = ward.parent_id
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
      EDUCATION_SORT_COLUMNS,
      "updated_at",
    );
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM education_facilities ef
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ${EDUCATION_SELECT_FIELDS}
        FROM education_facilities ef
        LEFT JOIN administrative_units ward ON ward.id = ef.ward_id
        LEFT JOIN administrative_units district ON district.id = ef.district_id
        ${whereClause}
        ORDER BY ${orderBy} ${orderDirection}, ef.school_id DESC
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
        LEFT JOIN administrative_units ward ON ward.id = hf.ward_id
        LEFT JOIN administrative_units district ON district.id = hf.district_id
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

router.get("/welfare", async (req, res) => {
  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(
      parsePositiveInteger(req.query.page_size, 25),
      100,
    );
    const offset = (page - 1) * pageSize;
    const { whereClause, params, districtId, wardId, isActive } =
      buildWelfareListFilters(req.query);
    const orderBy = normalizeSortColumn(
      req.query.sort_by,
      WELFARE_SORT_COLUMNS,
      "updated_at",
    );
    const orderDirection = normalizeSortOrder(req.query.sort_order);

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        FROM welfare_beneficiaries wb
        LEFT JOIN administrative_units ward ON ward.id = wb.ward_id
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT
          ${WELFARE_SELECT_FIELDS}
        FROM welfare_beneficiaries wb
        LEFT JOIN administrative_units ward ON ward.id = wb.ward_id
        LEFT JOIN administrative_units district ON district.id = ward.parent_id
        ${whereClause}
        ORDER BY ${orderBy} ${orderDirection}, wb.id DESC
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
    console.error("Admin welfare list error:", error.message);
    return res.status(500).json({
      status: "error",
      message: "Unable to load welfare records",
    });
  }
});

router.get("/welfare/programs", async (req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          program_id,
          program_name,
          department,
          description
        FROM welfare_programs
        ORDER BY program_name
      `,
    );

    return res.json({
      status: "success",
      data: {
        items: result.rows,
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
    return res
      .status(500)
      .json({
        status: "error",
        message: "Unable to load the education record",
      });
  }
});

router.get("/health/:id", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
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

router.get("/welfare/:id", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "A valid welfare record id is required",
        });
    }

    const record = await fetchWelfareRecord(db, id);
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

router.get("/disaster/:id", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
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
    return res
      .status(500)
      .json({
        status: "error",
        message: "Unable to load education record history",
      });
  }
});

router.get("/health/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "A valid health record id is required",
        });
    }

    const items = await fetchHistoryRows("health_facilities", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin health history error:", error.message);
    return res
      .status(500)
      .json({
        status: "error",
        message: "Unable to load health record history",
      });
  }
});

router.get("/welfare/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "A valid welfare record id is required",
        });
    }

    const items = await fetchHistoryRows("welfare_beneficiaries", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin welfare history error:", error.message);
    return res
      .status(500)
      .json({
        status: "error",
        message: "Unable to load welfare record history",
      });
  }
});

router.get("/disaster/:id/history", async (req, res) => {
  try {
    const id = parsePositiveInteger(req.params.id, null);
    if (!id) {
      return res
        .status(400)
        .json({
          status: "error",
          message: "A valid disaster record id is required",
        });
    }

    const items = await fetchHistoryRows("disaster_zones", id);
    return res.json({ status: "success", data: { items } });
  } catch (error) {
    console.error("Admin disaster history error:", error.message);
    return res
      .status(500)
      .json({
        status: "error",
        message: "Unable to load disaster record history",
      });
  }
});

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
              name,
              "name:en",
              "name:ny",
              amenity,
              building,
              "operator:type",
              "capacity:persons",
              "addr:full",
              "addr:city",
              source,
              status,
              comments,
              student_enrollment_total,
              teacher_count,
              district_id,
              ward_id,
              geom,
              is_active,
              updated_at
            )
            VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16,
              ST_SetSRID(ST_MakePoint($17, $18), 4326),
              COALESCE($19, TRUE),
              CURRENT_TIMESTAMP
            )
            RETURNING school_id
          `,
          [
            value.name,
            value.nameEn ?? null,
            value.nameNy ?? null,
            value.amenity ?? null,
            value.building ?? null,
            value.operatorType ?? null,
            value.capacityPersons ?? null,
            value.addressFull ?? null,
            value.addressCity ?? null,
            value.source ?? null,
            value.status ?? null,
            value.comments ?? null,
            value.studentEnrollmentTotal ?? null,
            value.teacherCount ?? null,
            value.districtId ?? null,
            value.wardId ?? null,
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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to create education record",
      });
  }
});

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to create health record",
      });
  }
});

router.post("/welfare/programs", async (req, res) => {
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

router.post("/welfare", async (req, res) => {
  const { error, value } = validateWelfareCreate(req.body);
  if (error) {
    return res.status(400).json({ status: "error", message: error });
  }

  try {
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
              ward_id,
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
        const record = await fetchWelfareRecord(client, id);

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to create welfare record",
      });
  }
});

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to create disaster record",
      });
  }
});

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

        const nextDistrictId = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        )
          ? value.districtId
          : existingRecord.district_id;
        const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
          ? value.wardId
          : existingRecord.ward_id;

        await validateDistrictWardRelationship(
          client,
          nextDistrictId,
          nextWardId,
        );

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to update education record",
      });
  }
});

router.patch("/health/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
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

        const nextDistrictId = Object.prototype.hasOwnProperty.call(
          value,
          "districtId",
        )
          ? value.districtId
          : existingRecord.district_id;
        const nextWardId = Object.prototype.hasOwnProperty.call(value, "wardId")
          ? value.wardId
          : existingRecord.ward_id;

        await validateDistrictWardRelationship(
          client,
          nextDistrictId,
          nextWardId,
        );

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to update health record",
      });
  }
});

router.patch("/welfare/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
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

  const pendingUpdates = mapWelfarePayloadToColumns(value);
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

        const existingRecord = await fetchWelfareRecord(client, id);
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

        const record = await fetchWelfareRecord(client, id);

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to update welfare record",
      });
  }
});

router.patch("/disaster/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to update disaster record",
      });
  }
});

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to archive education record",
      });
  }
});

router.post("/health/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to archive health record",
      });
  }
});

router.post("/welfare/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
        status: "error",
        message: "A valid welfare record id is required",
      });
  }

  try {
    const authUser = getAuthUser(req);
    const archivedRecord = await db.pool.connect().then(async (client) => {
      try {
        await client.query("BEGIN");

        const existingRecord = await fetchWelfareRecord(client, id);
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

        const record = await fetchWelfareRecord(client, id);

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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to archive welfare record",
      });
  }
});

router.post("/disaster/:id/archive", async (req, res) => {
  const id = parsePositiveInteger(req.params.id, null);
  if (!id) {
    return res
      .status(400)
      .json({
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
    return res
      .status(400)
      .json({
        status: "error",
        message: err.message || "Unable to archive disaster record",
      });
  }
});

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

    const filteredDepartments = departments.reduce((accumulator, department) => {
      if (Object.prototype.hasOwnProperty.call(mergedState, department)) {
        accumulator[department] = mergedState[department];
      }
      return accumulator;
    }, {});

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
