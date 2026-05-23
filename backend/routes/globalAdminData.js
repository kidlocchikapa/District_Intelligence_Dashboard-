const express = require("express");
const auth = require("../middleware/auth");
const requireGlobalAdmin = require("../middleware/requireGlobalAdmin");
const db = require("../db");
const { parsePositiveInteger } = require("../services/adminDataService");

const router = express.Router();

const ANALYSIS_TYPE_OPTIONS = [
  "education_summary",
  "health_summary",
  "health_population_served",
  "health_2sfca_access",
  "nearest_school_distance",
  "nearest_health_distance",
  "school_service_coverage",
  "health_service_coverage",
  "education_standards_compliance",
  "education_catchment_access",
  "education_flood_isolation",
  "education_welfare_vulnerability",
  "school_capacity_risk",
  "disaster_vulnerability",
];

const GLOBAL_TABLES = {
  admin_data_edits: {
    label: "Admin Data Edits",
    fromSql: `
      FROM admin_data_edits ade
      LEFT JOIN users u ON u.id = ade.changed_by_user_id
    `,
    selectSql: `
      ade.id,
      ade.table_name,
      ade.record_id,
      ade.action,
      ade.changed_by_user_id,
      u.email AS changed_by_email,
      u.full_name AS changed_by_full_name,
      ade.changed_fields,
      ade.changed_at
    `,
    searchColumns: [
      "ade.table_name",
      "ade.action",
      "u.email",
      "u.full_name",
    ],
    defaultOrder: "ade.changed_at DESC, ade.id DESC",
  },
  districts: {
    label: "Districts",
    fromSql: "FROM districts d",
    selectSql: `
      d.id,
      d.name,
      d.code,
      d.valid_on,
      d.boundary_version,
      d.reference_name,
      d.population_total,
      d.population_density,
      d.area_sq_km,
      d.created_at,
      d.updated_at,
      ST_Y(ST_Centroid(d.geom)) AS latitude,
      ST_X(ST_Centroid(d.geom)) AS longitude
    `,
    searchColumns: ["d.name", "d.code", "d.reference_name"],
    defaultOrder: "d.name ASC, d.id ASC",
  },
  admin3_units: {
    label: "Admin Units",
    fromSql: `
      FROM admin3_units au
      LEFT JOIN districts d ON d.id = au.district_id
    `,
    selectSql: `
      au.id,
      au.name,
      au.code,
      au.type,
      au.district_id,
      d.name AS district_name,
      au.valid_on,
      au.boundary_version,
      au.reference_name,
      au.population_total,
      au.population_density,
      au.created_at,
      au.updated_at,
      ST_Y(ST_Centroid(au.geom)) AS latitude,
      ST_X(ST_Centroid(au.geom)) AS longitude
    `,
    searchColumns: ["au.name", "au.code", "au.type", "d.name"],
    defaultOrder: "d.name ASC NULLS LAST, au.type ASC, au.name ASC",
  },
  analysis_results: {
    label: "Analysis Results",
    fromSql: "FROM analysis_results ar",
    selectSql: `
      ar.id,
      ar.analysis_type,
      ar.admin_unit_id,
      ar.admin_unit_code,
      ar.admin_unit_name,
      ar.admin_unit_type,
      ar.metric_name,
      ar.metric_value,
      ar.metric_unit,
      ar.calculated_at,
      ST_Y(ST_Centroid(ar.geom)) AS latitude,
      ST_X(ST_Centroid(ar.geom)) AS longitude
    `,
    searchColumns: [
      "ar.analysis_type",
      "ar.admin_unit_name",
      "ar.admin_unit_code",
      "ar.metric_name",
    ],
    defaultOrder: "ar.analysis_type ASC, ar.admin_unit_name ASC, ar.metric_name ASC",
    filterColumn: "ar.analysis_type",
  },
  data_load_log: {
    label: "Data Load Logs",
    fromSql: "FROM data_load_log dll",
    selectSql: `
      dll.id,
      dll.source_filename,
      dll.source_type,
      dll.dataset_type,
      dll.table_name,
      dll.rows_read,
      dll.rows_processed,
      dll.rows_loaded,
      dll.rows_flagged,
      dll.status,
      dll.error_message,
      dll.started_at,
      dll.completed_at,
      dll.processed_at
    `,
    searchColumns: [
      "dll.source_filename",
      "dll.source_type",
      "dll.dataset_type",
      "dll.table_name",
      "dll.status",
    ],
    defaultOrder: "dll.started_at DESC NULLS LAST, dll.id DESC",
  },
  worldpop_age_sex: {
    label: "WorldPop Age Sex",
    fromSql: "FROM worldpop_age_sex was",
    selectSql: `
      was.id,
      was.admin_unit_id,
      was.admin_unit_code,
      was.admin_unit_name,
      was.admin_unit_type,
      was.worldpop_year,
      was.dataset_name,
      was.age_class,
      was.age_label,
      was.male_population,
      was.female_population,
      was.total_population,
      was.task_id,
      was.start_time,
      was.end_time,
      was.execution_time,
      was.created_at
    `,
    searchColumns: [
      "was.admin_unit_name",
      "was.admin_unit_code",
      "was.age_class",
      "was.dataset_name",
    ],
    defaultOrder: "was.worldpop_year DESC, was.admin_unit_name ASC, was.age_class ASC",
  },
  education_facility_access_metrics: {
    label: "Education Access Metrics",
    fromSql: `
      FROM education_facility_access_metrics eam
      JOIN education_facilities ef ON ef.school_id = eam.facility_id
      LEFT JOIN admin3_units ward ON ward.id = ef.ta_id
      LEFT JOIN districts district ON district.id = COALESCE(ef.district_id, ward.district_id)
    `,
    selectSql: `
      eam.facility_id,
      ef.school_name AS facility_name,
      district.name AS district_name,
      ward.name AS ward_name,
      eam.coverage_distance_km,
      eam.worldpop_population_within_buffer,
      eam.welfare_beneficiaries_within_buffer,
      eam.avg_network_distance_km,
      eam.avg_travel_time_min,
      eam.calculated_at
    `,
    searchColumns: ["ef.school_name", "district.name", "ward.name"],
    defaultOrder: "eam.calculated_at DESC NULLS LAST, ef.school_name ASC",
  },
  health_facility_access_metrics: {
    label: "Health Access Metrics",
    fromSql: `
      FROM health_facility_access_metrics ham
      JOIN health_facilities hf ON hf.id = ham.facility_id
      LEFT JOIN admin3_units ward ON ward.id = hf.ta_id
      LEFT JOIN districts district ON district.id = COALESCE(hf.district_id, ward.district_id)
    `,
    selectSql: `
      ham.facility_id,
      hf.name AS facility_name,
      hf.type AS facility_type,
      district.name AS district_name,
      ward.name AS ward_name,
      ham.coverage_distance_km,
      ham.worldpop_population_within_buffer,
      ham.welfare_beneficiaries_within_buffer,
      ham.welfare_beneficiaries_served_by_8km_network,
      ham.avg_network_distance_km,
      ham.avg_travel_time_min,
      ham.calculated_at
    `,
    searchColumns: ["hf.name", "hf.code", "district.name", "ward.name"],
    defaultOrder: "ham.calculated_at DESC NULLS LAST, hf.name ASC",
  },
};

router.use(auth);
router.use(requireGlobalAdmin);

function buildSearchClause(search, searchColumns, params) {
  if (!search || !searchColumns.length) {
    return "";
  }

  params.push(`%${search}%`);
  const placeholder = `$${params.length}`;
  const clauses = searchColumns.map((column) => `${column} ILIKE ${placeholder}`);
  return ` AND (${clauses.join(" OR ")})`;
}

async function listGlobalTable(tableKey, req, res) {
  const definition = GLOBAL_TABLES[tableKey];
  if (!definition) {
    return res.status(404).json({
      status: "error",
      message: "Unknown global admin table",
    });
  }

  try {
    const page = parsePositiveInteger(req.query.page, 1);
    const pageSize = Math.min(parsePositiveInteger(req.query.page_size, 25), 100);
    const offset = (page - 1) * pageSize;
    const search = String(req.query.search || "").trim();
    const params = [];
    const conditions = [];

    if (definition.filterColumn && req.query.analysis_type) {
      params.push(String(req.query.analysis_type).trim());
      conditions.push(`${definition.filterColumn} = $${params.length}`);
    }

    const searchClause = buildSearchClause(
      search,
      definition.searchColumns,
      params,
    );
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}${searchClause}`
      : searchClause
        ? `WHERE 1=1${searchClause}`
        : "";

    const countResult = await db.query(
      `
        SELECT COUNT(*)::int AS total
        ${definition.fromSql}
        ${whereClause}
      `,
      params,
    );

    const dataParams = [...params, pageSize, offset];
    const rowsResult = await db.query(
      `
        SELECT ${definition.selectSql}
        ${definition.fromSql}
        ${whereClause}
        ORDER BY ${definition.defaultOrder}
        LIMIT $${dataParams.length - 1}
        OFFSET $${dataParams.length}
      `,
      dataParams,
    );

    const total = countResult.rows[0]?.total || 0;

    return res.json({
      status: "success",
      data: {
        table: tableKey,
        label: definition.label,
        items: rowsResult.rows,
        page,
        page_size: pageSize,
        total,
        total_pages: total ? Math.ceil(total / pageSize) : 0,
        filters: {
          search,
          analysis_type: req.query.analysis_type || null,
        },
      },
    });
  } catch (error) {
    console.error(`Global admin list error (${tableKey}):`, error.message);
    return res.status(500).json({
      status: "error",
      message: `Unable to load ${definition.label}`,
    });
  }
}

router.get("/tables", (req, res) => {
  return res.json({
    status: "success",
    data: {
      tables: Object.entries(GLOBAL_TABLES).map(([id, definition]) => ({
        id,
        label: definition.label,
        supports_analysis_type_filter: Boolean(definition.filterColumn),
      })),
      analysis_types: ANALYSIS_TYPE_OPTIONS,
    },
  });
});

router.get("/admin-data-edits", (req, res) =>
  listGlobalTable("admin_data_edits", req, res),
);
router.get("/districts", (req, res) => listGlobalTable("districts", req, res));
router.get("/admin-units", (req, res) => listGlobalTable("admin3_units", req, res));
router.get("/analysis-results", (req, res) =>
  listGlobalTable("analysis_results", req, res),
);
router.get("/data-load-logs", (req, res) =>
  listGlobalTable("data_load_log", req, res),
);
router.get("/worldpop-age-sex", (req, res) =>
  listGlobalTable("worldpop_age_sex", req, res),
);
router.get("/education-access-metrics", (req, res) =>
  listGlobalTable("education_facility_access_metrics", req, res),
);
router.get("/health-access-metrics", (req, res) =>
  listGlobalTable("health_facility_access_metrics", req, res),
);

module.exports = router;
