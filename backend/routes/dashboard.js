const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

function normalizeAdminType(adminType) {
  if (!adminType) return null;
  const normalized = String(adminType).trim().toLowerCase();
  if (normalized === "district") return "District";
  if (normalized === "ta" || normalized === "admin3") return "TA";
  if (normalized === "village") return "Village";
  return String(adminType).trim();
}

function appendOptionalTaCondition(conditions, params, columnExpression, taName) {
  if (!taName) {
    return;
  }

  params.push(taName);
  conditions.push(`LOWER(${columnExpression}) = LOWER($${params.length})`);
}

function buildCanonicalDistrictNameExpression(columnExpression) {
  return `CASE
    WHEN LOWER(${columnExpression}) IN ('zomba', 'zomba city') THEN 'Zomba'
    ELSE ${columnExpression}
  END`;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((toFiniteNumber(value) + Number.EPSILON) * factor) / factor;
}

function buildPriorityNarrative(row) {
  const drivers = [];

  if (row.flood_exposed_population_pct >= 20) {
    drivers.push(
      `${roundTo(row.flood_exposed_population_pct, 1)}% of people exposed to flooding`,
    );
  }
  if (row.health_vulnerability_score >= 60) {
    drivers.push("elevated health-service vulnerability");
  }
  if (row.education_vulnerability_score >= 60) {
    drivers.push("education access pressure");
  }
  if (row.beneficiary_count >= 100) {
    drivers.push(`${formatPriorityCount(row.beneficiary_count)} welfare beneficiaries concentrated here`);
  }

  if (!drivers.length) {
    drivers.push("moderate but multi-sector development pressure");
  }

  return `${row.admin_unit_name} combines ${drivers.join(", ")}, so district planning should treat it as a coordinated intervention area rather than a single-sector issue.`;
}

function buildPriorityActions(row) {
  const actions = [];

  if (row.education_vulnerability_score >= 60 || row.education_flood_isolation_score >= 40) {
    actions.push("Prioritize school-access improvements, classroom expansion, and back-to-school outreach for the most underserved settlements in this area.");
  }

  if (row.health_vulnerability_score >= 60 || row.health_flood_isolation_score >= 40) {
    actions.push("Review clinic catchments, mobile outreach schedules, and referral transport support to reduce healthcare access delays here.");
  }

  if (row.flood_exposed_population_pct >= 20) {
    actions.push("Align flood preparedness with beneficiary targeting and protect the roads, schools, and facilities most likely to fail during flood events.");
  }

  if (row.beneficiary_count >= 100 && actions.length < 3) {
    actions.push("Use social welfare programme targeting here to bundle education, health, and resilience interventions around the same vulnerable households.");
  }

  if (!actions.length) {
    actions.push("Keep this area on the district watchlist and compare it against higher-risk TAs before committing scarce capital investment.");
  }

  return actions.slice(0, 3);
}

function formatPriorityCount(value) {
  return Math.round(toFiniteNumber(value)).toLocaleString();
}

function normalizeDepartment(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["education", "health", "disaster", "welfare", "overview"].includes(normalized)) {
    return normalized;
  }
  return "overview";
}

function buildDepartmentPriorityNarrative(row, department) {
  if (department === "education") {
    return `${row.admin_unit_name} stands out for education planning because school-access pressure scores ${roundTo(row.education_vulnerability_score, 1)} and flood-related school isolation scores ${roundTo(row.education_flood_isolation_score, 1)}.`;
  }
  if (department === "health") {
    return `${row.admin_unit_name} stands out for health planning because health-service vulnerability scores ${roundTo(row.health_vulnerability_score, 1)} and flood-related care isolation scores ${roundTo(row.health_flood_isolation_score, 1)}.`;
  }
  if (department === "disaster") {
    return `${row.admin_unit_name} stands out for disaster planning because ${roundTo(row.flood_exposed_population_pct, 1)}% of the local population is flood-exposed and service continuity is at risk during shock events.`;
  }
  if (department === "welfare") {
    return `${row.admin_unit_name} stands out for welfare targeting because ${formatPriorityCount(row.beneficiary_count)} beneficiaries are concentrated here alongside linked service-access and flood pressures.`;
  }
  return buildPriorityNarrative(row);
}

function buildDepartmentPriorityActions(row, department) {
  if (department === "education") {
    return [
      "Use this area to prioritise school-access investment, classroom expansion, and enrolment outreach.",
      ...(row.recommended_actions || []),
    ].slice(0, 3);
  }
  if (department === "health") {
    return [
      "Use this area to prioritise clinic catchment review, mobile outreach, and referral support.",
      ...(row.recommended_actions || []),
    ].slice(0, 3);
  }
  if (department === "disaster") {
    return [
      "Use this area to prioritise flood-readiness, evacuation planning, and public-service continuity measures.",
      ...(row.recommended_actions || []),
    ].slice(0, 3);
  }
  if (department === "welfare") {
    return [
      "Use this area to prioritise bundled welfare support with education, health, and resilience interventions.",
      ...(row.recommended_actions || []),
    ].slice(0, 3);
  }
  return row.recommended_actions || buildPriorityActions(row);
}

// Import sub-routers for different dashboard sections
const educationRoutes = require("./education");
const healthRoutes = require("./health");
const disasterRoutes = require("./disaster");
const analysisRoutes = require("./analysis");

// Mount sub-routers for different dashboard sections
router.use("/education", educationRoutes);
router.use("/health", healthRoutes);
router.use("/disaster", disasterRoutes);
router.use("/analysis", analysisRoutes);

/**
 * @route   GET /api/v1/dashboard/summary
 * @desc    Get summary statistics for the dashboard with optional district filter
 */
/**
 * @openapi
 * /api/v1/dashboard/summary:
 *   get:
 *     summary: Get dashboard summary statistics
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Summary metrics
 */
router.get("/summary", async (req, res) => {
  const { district, ta } = req.query;

  try {
    let schoolsCount;
    let healthCount;
    let populationTotal;

    if (ta) {
      const schoolConditions = ["ef.geom IS NOT NULL"];
      const schoolParams = [];
      appendDistrictNameCondition(
        schoolConditions,
        schoolParams,
        "d.name",
        district,
      );
      appendOptionalTaCondition(schoolConditions, schoolParams, "a3.name", ta);

      const schoolWhereClause = schoolConditions.length
        ? `WHERE ${schoolConditions.join(" AND ")}`
        : "";

      schoolsCount = await db.query(
        `
          SELECT COUNT(*)
          FROM education_facilities ef
          LEFT JOIN admin3_units a3 ON a3.id = ef.ta_id
          LEFT JOIN districts d ON d.id = a3.district_id
          ${schoolWhereClause}
        `,
        schoolParams,
      );

      const healthConditions = ["hf.geom IS NOT NULL"];
      const healthParams = [];
      appendDistrictNameCondition(
        healthConditions,
        healthParams,
        "d.name",
        district,
      );
      appendOptionalTaCondition(healthConditions, healthParams, "a3.name", ta);

      const healthWhereClause = healthConditions.length
        ? `WHERE ${healthConditions.join(" AND ")}`
        : "";

      healthCount = await db.query(
        `
          SELECT COUNT(*)
          FROM health_facilities hf
          LEFT JOIN admin3_units a3 ON a3.id = hf.ta_id
          LEFT JOIN districts d ON d.id = a3.district_id
          ${healthWhereClause}
        `,
        healthParams,
      );

      const populationConditions = [];
      const populationParams = [];
      appendDistrictNameCondition(
        populationConditions,
        populationParams,
        "d.name",
        district,
      );
      appendOptionalTaCondition(
        populationConditions,
        populationParams,
        "a3.name",
        ta,
      );

      const populationWhereClause = populationConditions.length
        ? `WHERE ${populationConditions.join(" AND ")}`
        : "";

      populationTotal = await db.query(
        `
          SELECT SUM(a3.population_total)
          FROM admin3_units a3
          LEFT JOIN districts d ON d.id = a3.district_id
          ${populationWhereClause}
        `,
        populationParams,
      );
    } else if (district) {
      const schoolConditions = ["ef.geom IS NOT NULL"];
      const schoolParams = [];
      appendDistrictGeometryCondition(
        schoolConditions,
        schoolParams,
        "ef.geom",
        district,
      );

      const schoolWhereClause = schoolConditions.length
        ? `WHERE ${schoolConditions.join(" AND ")}`
        : "";

      schoolsCount = await db.query(
        `
                SELECT COUNT(*)
                FROM education_facilities ef
                ${schoolWhereClause}
                `,
        schoolParams,
      );

      const healthConditions = ["hf.geom IS NOT NULL"];
      const healthParams = [];
      appendDistrictGeometryCondition(
        healthConditions,
        healthParams,
        "hf.geom",
        district,
      );

      const healthWhereClause = healthConditions.length
        ? `WHERE ${healthConditions.join(" AND ")}`
        : "";

      healthCount = await db.query(
        `
                SELECT COUNT(*)
                FROM health_facilities hf
                ${healthWhereClause}
                `,
        healthParams,
      );

      const populationConditions = [];
      const populationParams = [];
      appendDistrictNameCondition(
        populationConditions,
        populationParams,
        "name",
        district,
      );

      const populationWhereClause = populationConditions.length
        ? `WHERE ${populationConditions.join(" AND ")}`
        : "";

      populationTotal = await db.query(
        `
                SELECT SUM(population_total)
                FROM districts
                ${populationWhereClause}
                `,
        populationParams,
      );
    } else {
      schoolsCount = await db.query(
        "SELECT COUNT(*) FROM education_facilities",
      );
      healthCount = await db.query("SELECT COUNT(*) FROM health_facilities");
      populationTotal = await db.query(
        "SELECT SUM(population_total) FROM districts",
      );
    }

    res.json({
      status: "success",
      data: {
        total_schools: parseInt(schoolsCount.rows[0].count),
        total_health_facilities: parseInt(healthCount.rows[0].count),
        total_estimated_population: parseInt(populationTotal.rows[0].sum || 0),
        selected_district: district || null,
        selected_ta: ta || null,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/districts
 * @desc    Get list of districts for dropdown filter
 */
/**
 * @openapi
 * /api/v1/dashboard/districts:
 *   get:
 *     summary: List districts
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: District list
 */
router.get("/districts", async (req, res) => {
  try {
    const result = await db.query(
      `
            SELECT canonical_name
            FROM (
              SELECT DISTINCT ${buildCanonicalDistrictNameExpression("name")} AS canonical_name
              FROM districts
            ) district_names
            ORDER BY canonical_name
            `,
    );

    res.json({
      status: "success",
      data: result.rows.map((row) => row.canonical_name),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/population-by-district
 * @desc    Get district population totals for the overview bar chart
 */
/**
 * @openapi
 * /api/v1/dashboard/population-by-district:
 *   get:
 *     summary: Get district population totals
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Population totals by district
 */
router.get("/population-by-district", async (req, res) => {
  const { district } = req.query;

  try {
    const params = [];
    const conditions = [];
    appendDistrictNameCondition(conditions, params, "name", district);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const canonicalDistrictName = buildCanonicalDistrictNameExpression("name");

    const result = await db.query(
      `
        SELECT
          ${canonicalDistrictName} AS district,
          SUM(COALESCE(population_total, 0)) AS population
        FROM districts
        ${whereClause}
        GROUP BY ${canonicalDistrictName}
        ORDER BY ${canonicalDistrictName}
      `,
      params,
    );

    res.json({
      status: "success",
      data: result.rows.map((row) => ({
        district: row.district,
        population: parseInt(row.population || 0, 10),
      })),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/population-by-admin3
 * @desc    Get TA/admin3 population totals for the overview bar chart
 */
/**
 * @openapi
 * /api/v1/dashboard/population-by-admin3:
 *   get:
 *     summary: Get admin3 population totals
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Population totals by admin3 unit
 */
router.get("/population-by-admin3", async (req, res) => {
  const { district, type = "TA" } = req.query;

  try {
    const params = [];
    const conditions = ["a3.geom IS NOT NULL"];

    if (type) {
      params.push(type);
      conditions.push(`LOWER(a3.type) = LOWER($${params.length})`);
    }

    if (district) {
      const districtConditions = [];
      appendDistrictNameCondition(
        districtConditions,
        params,
        "d.name",
        district,
      );
      if (districtConditions.length) {
        conditions.push(districtConditions.join(" AND "));
      }
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await db.query(
      `
        SELECT
          a3.id AS admin3_id,
          a3.name AS admin3_name,
          a3.type AS admin3_type,
          d.name AS district,
          COALESCE(a3.population_total, 0) AS population
        FROM admin3_units a3
        LEFT JOIN districts d ON d.id = a3.district_id
        ${whereClause}
        ORDER BY a3.name
      `,
      params,
    );

    res.json({
      status: "success",
      data: result.rows.map((row) => ({
        admin3_id: Number(row.admin3_id),
        admin3_name: row.admin3_name,
        admin3_type: row.admin3_type,
        district: row.district,
        population: parseInt(row.population || 0, 10),
      })),
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/admin-units
 * @desc    Get administrative units as GeoJSON with optional type and district filters
 */
/**
 * @openapi
 * /api/v1/dashboard/admin-units:
 *   get:
 *     summary: Get administrative units as GeoJSON
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: Admin unit GeoJSON
 */
router.get("/admin-units", async (req, res) => {
  const { type: adminType, district } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const includeDistrict =
      !normalizedAdminType || normalizedAdminType === "District";
    const includeAdmin3 =
      !normalizedAdminType ||
      ["TA", "Village", "Admin3"].includes(normalizedAdminType);

    const params = [];
    let districtFilterDistricts = "";
    let districtFilterAdmin3 = "";

    if (includeDistrict) {
      const districtConditions = [];
      appendDistrictNameCondition(
        districtConditions,
        params,
        "d.name",
        district,
      );
      districtFilterDistricts = districtConditions.length
        ? ` AND ${districtConditions.join(" AND ")}`
        : "";
    }

    if (includeAdmin3) {
      const admin3DistrictConditions = [];
      appendDistrictNameCondition(
        admin3DistrictConditions,
        params,
        "d.name",
        district,
      );
      districtFilterAdmin3 = admin3DistrictConditions.length
        ? ` AND ${admin3DistrictConditions.join(" AND ")}`
        : "";
    }

    const districtTypePredicate =
      !normalizedAdminType || normalizedAdminType === "District"
        ? "TRUE"
        : "FALSE";

    const admin3TypePredicate =
      normalizedAdminType && normalizedAdminType !== "District"
        ? `LOWER(a3.type) = LOWER('${normalizedAdminType}')`
        : "TRUE";

    const subqueries = [];

    if (includeDistrict) {
      subqueries.push(`
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', d.id,
          'geometry', ST_AsGeoJSON(d.geom)::jsonb,
          'properties', jsonb_build_object(
            'code', d.code,
            'name', d.name,
            'type', 'District',
            'parent_id', NULL,
            'source', NULL,
            'level', 2,
            'population_total', d.population_total,
            'population_density', d.population_density,
            'area_sq_km', d.area_sq_km,
            'metadata', d.metadata
          )
        ) AS feature,
        'District'::text AS sort_type,
        d.name AS sort_name
        FROM districts d
        WHERE d.geom IS NOT NULL
          AND ${districtTypePredicate}
          ${districtFilterDistricts}
      `);
    }

    if (includeAdmin3) {
      subqueries.push(`
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', a3.id,
          'geometry', ST_AsGeoJSON(a3.geom)::jsonb,
          'properties', jsonb_build_object(
            'code', a3.code,
            'name', a3.name,
            'type', a3.type,
            'parent_id', a3.district_id,
            'source', NULL,
            'level', 3,
            'population_total', a3.population_total,
            'population_density', a3.population_density,
            'area_sq_km', NULL,
            'metadata', a3.metadata
          )
        ) AS feature,
        a3.type AS sort_type,
        a3.name AS sort_name
        FROM admin3_units a3
        LEFT JOIN districts d ON d.id = a3.district_id
        WHERE a3.geom IS NOT NULL
          AND ${admin3TypePredicate}
          ${districtFilterAdmin3}
      `);
    }

    if (!subqueries.length) {
      subqueries.push(
        "SELECT NULL::jsonb AS feature, NULL::text AS sort_type, NULL::text AS sort_name WHERE FALSE",
      );
    }

    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        ${subqueries.join("\nUNION ALL\n")}
      ) rowconf
      WHERE rowconf.feature IS NOT NULL;
    `;
    const result = await db.query(query, params);
    res.json({
      status: "success",
      data: result.rows[0].jsonb_build_object || {
        type: "FeatureCollection",
        features: [],
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/ta-service-stats
 * @desc    Get TA-level service counts for schools, hospitals, and beneficiaries
 */
/**
 * @openapi
 * /api/v1/dashboard/ta-service-stats:
 *   get:
 *     summary: Get TA-level service counts
 *     tags:
 *       - Dashboard
 *     responses:
 *       200:
 *         description: TA service counts
 */
router.get("/ta-service-stats", async (req, res) => {
  const { district, type = "TA" } = req.query;
  const normalizedAdminType = normalizeAdminType(type);

  if (normalizedAdminType && normalizedAdminType !== "TA") {
    return res.status(400).json({
      status: "error",
      message: "Only TA/admin3 scope is supported for ta-service-stats",
    });
  }

  try {
    const params = [];
    const conditions = ["a3.geom IS NOT NULL", "LOWER(a3.type) = LOWER('TA')"];
    appendDistrictNameCondition(conditions, params, "d.name", district);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await db.query(
      `
        WITH ta_scope AS (
          SELECT
            a3.id AS ta_id,
            a3.name AS ta_name,
            d.name AS district_name
          FROM admin3_units a3
          LEFT JOIN districts d
            ON d.id = a3.district_id
          ${whereClause}
        ),
        school_counts AS (
          SELECT
            ef.ta_id,
            COUNT(*)::int AS schools_count
          FROM education_facilities ef
          WHERE ef.ta_id IS NOT NULL
          GROUP BY ef.ta_id
        ),
        health_counts AS (
          SELECT
            hf.ta_id,
            COUNT(*)::int AS health_facilities_count,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(hf.type, '')) LIKE '%hospital%'
            )::int AS hospitals_count
          FROM health_facilities hf
          WHERE hf.ta_id IS NOT NULL
          GROUP BY hf.ta_id
        ),
        beneficiary_counts AS (
          SELECT
            wb.ta_id,
            COUNT(*)::int AS beneficiaries_count
          FROM welfare_beneficiary wb
          WHERE wb.ta_id IS NOT NULL
          GROUP BY wb.ta_id
        )
        SELECT
          ts.ta_id,
          ts.ta_name,
          ts.district_name,
          COALESCE(sc.schools_count, 0)::int AS schools_count,
          COALESCE(hc.health_facilities_count, 0)::int AS health_facilities_count,
          COALESCE(hc.hospitals_count, 0)::int AS hospitals_count,
          COALESCE(bc.beneficiaries_count, 0)::int AS beneficiaries_count
        FROM ta_scope ts
        LEFT JOIN school_counts sc
          ON sc.ta_id = ts.ta_id
        LEFT JOIN health_counts hc
          ON hc.ta_id = ts.ta_id
        LEFT JOIN beneficiary_counts bc
          ON bc.ta_id = ts.ta_id
        ORDER BY ts.ta_name ASC
      `,
      params,
    );

    return res.json({
      status: "success",
      data: result.rows.map((row) => ({
        ta_id: Number(row.ta_id),
        ta_name: row.ta_name,
        district_name: row.district_name,
        schools_count: Number(row.schools_count || 0),
        health_facilities_count: Number(row.health_facilities_count || 0),
        hospitals_count: Number(row.hospitals_count || 0),
        beneficiaries_count: Number(row.beneficiaries_count || 0),
      })),
    });
  } catch (err) {
    console.error("Dashboard ta-service-stats error:", err.message);
    return res.status(500).send("Server error");
  }
});

router.get("/planning-priorities", async (req, res) => {
  const { district, ta, admin_type: adminType = "TA", limit: limitParam, department } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType) || "TA";
  const normalizedDepartment = normalizeDepartment(department);
  const limit = Math.min(Math.max(parseInt(limitParam || "5", 10) || 5, 1), 20);

  if (!["TA", "District"].includes(normalizedAdminType)) {
    return res.status(400).json({
      status: "error",
      message: "planning-priorities only supports District or TA admin_type",
    });
  }

  try {
    const params = [];
    const conditions = [];
    appendDistrictNameCondition(conditions, params, "d.name", district);
    if (normalizedAdminType === "TA") {
      appendOptionalTaCondition(conditions, params, "a3.name", ta);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const districtColumn = buildCanonicalDistrictNameExpression("d.name");
    const areaScopeSql =
      normalizedAdminType === "District"
        ? `
            SELECT
              d.id AS admin_unit_id,
              ${districtColumn} AS admin_unit_name,
              'District'::text AS admin_unit_type,
              ${districtColumn} AS district_name,
              COALESCE(d.population_total, 0)::numeric AS population_total
            FROM districts d
            ${whereClause}
          `
        : `
            SELECT
              a3.id AS admin_unit_id,
              a3.name AS admin_unit_name,
              'TA'::text AS admin_unit_type,
              ${districtColumn} AS district_name,
              COALESCE(a3.population_total, 0)::numeric AS population_total
            FROM admin3_units a3
            LEFT JOIN districts d
              ON d.id = a3.district_id
            WHERE LOWER(a3.type) = LOWER('TA')
              ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
          `;

    const result = await db.query(
      `
        WITH area_scope AS (
          ${areaScopeSql}
        ),
        welfare_counts AS (
          SELECT
            ${normalizedAdminType === "District" ? "wb.district_id" : "wb.ta_id"} AS admin_unit_id,
            COUNT(*)::int AS beneficiary_count
          FROM welfare_beneficiary wb
          WHERE ${normalizedAdminType === "District" ? "wb.district_id" : "wb.ta_id"} IS NOT NULL
          GROUP BY ${normalizedAdminType === "District" ? "wb.district_id" : "wb.ta_id"}
        ),
        school_counts AS (
          SELECT
            ${normalizedAdminType === "District" ? "ef.district_id" : "ef.ta_id"} AS admin_unit_id,
            COUNT(*)::int AS schools_count
          FROM education_facilities ef
          WHERE ${normalizedAdminType === "District" ? "ef.district_id" : "ef.ta_id"} IS NOT NULL
          GROUP BY ${normalizedAdminType === "District" ? "ef.district_id" : "ef.ta_id"}
        ),
        health_counts AS (
          SELECT
            ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"} AS admin_unit_id,
            COUNT(*)::int AS health_facilities_count
          FROM health_facilities hf
          WHERE ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"} IS NOT NULL
          GROUP BY ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"}
        ),
        flood_stats AS (
          SELECT
            ${normalizedAdminType === "District" ? "fz.district_id" : "fz.ta_id"} AS admin_unit_id,
            MAX(COALESCE(fz.exposed_population, 0)) AS flood_exposed_population,
            MAX(
              CASE
                WHEN COALESCE(fz.total_population, 0) > 0
                  THEN (COALESCE(fz.exposed_population, 0) / fz.total_population) * 100.0
                ELSE 0
              END
            ) AS flood_exposed_population_pct
          FROM flood_zones fz
          WHERE fz.analysis_date = (SELECT MAX(analysis_date) FROM flood_zones)
          GROUP BY ${normalizedAdminType === "District" ? "fz.district_id" : "fz.ta_id"}
        ),
        edu_vuln AS (
          SELECT
            admin_unit_id,
            MAX(metric_value) AS education_vulnerability_score
          FROM analysis_results
          WHERE analysis_type = 'education_welfare_vulnerability'
            AND LOWER(admin_unit_type) = LOWER($${params.length + 1})
          GROUP BY admin_unit_id
        ),
        edu_iso AS (
          SELECT
            admin_unit_id,
            MAX(metric_value) AS education_flood_isolation_score
          FROM analysis_results
          WHERE analysis_type = 'education_flood_isolation'
            AND LOWER(admin_unit_type) = LOWER($${params.length + 1})
          GROUP BY admin_unit_id
        ),
        health_vuln AS (
          SELECT
            admin_unit_id,
            MAX(metric_value) AS health_vulnerability_score
          FROM analysis_results
          WHERE analysis_type = 'health_welfare_vulnerability'
            AND LOWER(admin_unit_type) = LOWER($${params.length + 1})
          GROUP BY admin_unit_id
        ),
        health_iso AS (
          SELECT
            admin_unit_id,
            MAX(metric_value) AS health_flood_isolation_score
          FROM analysis_results
          WHERE analysis_type = 'health_flood_isolation'
            AND LOWER(admin_unit_type) = LOWER($${params.length + 1})
          GROUP BY admin_unit_id
        )
        SELECT
          scope.admin_unit_id,
          scope.admin_unit_name,
          scope.admin_unit_type,
          scope.district_name,
          scope.population_total,
          COALESCE(welfare_counts.beneficiary_count, 0) AS beneficiary_count,
          COALESCE(school_counts.schools_count, 0) AS schools_count,
          COALESCE(health_counts.health_facilities_count, 0) AS health_facilities_count,
          COALESCE(flood_stats.flood_exposed_population_pct, 0) AS flood_exposed_population_pct,
          COALESCE(flood_stats.flood_exposed_population, 0) AS flood_exposed_population,
          COALESCE(edu_vuln.education_vulnerability_score, 0) AS education_vulnerability_score,
          COALESCE(edu_iso.education_flood_isolation_score, 0) AS education_flood_isolation_score,
          COALESCE(health_vuln.health_vulnerability_score, 0) AS health_vulnerability_score,
          COALESCE(health_iso.health_flood_isolation_score, 0) AS health_flood_isolation_score
        FROM area_scope scope
        LEFT JOIN welfare_counts
          ON welfare_counts.admin_unit_id = scope.admin_unit_id
        LEFT JOIN school_counts
          ON school_counts.admin_unit_id = scope.admin_unit_id
        LEFT JOIN health_counts
          ON health_counts.admin_unit_id = scope.admin_unit_id
        LEFT JOIN flood_stats
          ON flood_stats.admin_unit_id = scope.admin_unit_id
        LEFT JOIN edu_vuln
          ON edu_vuln.admin_unit_id = scope.admin_unit_id
        LEFT JOIN edu_iso
          ON edu_iso.admin_unit_id = scope.admin_unit_id
        LEFT JOIN health_vuln
          ON health_vuln.admin_unit_id = scope.admin_unit_id
        LEFT JOIN health_iso
          ON health_iso.admin_unit_id = scope.admin_unit_id
      `,
      [...params, normalizedAdminType],
    );

    const rows = result.rows.map((row) => {
      const populationTotal = toFiniteNumber(row.population_total);
      const beneficiaryCount = toFiniteNumber(row.beneficiary_count);
      const beneficiaryDensityScore =
        populationTotal > 0 ? clampScore((beneficiaryCount / populationTotal) * 6000) : 0;
      const serviceGapScore = clampScore(
        (toFiniteNumber(row.education_vulnerability_score) * 0.4) +
        (toFiniteNumber(row.health_vulnerability_score) * 0.4) +
        (toFiniteNumber(row.education_flood_isolation_score) * 0.1) +
        (toFiniteNumber(row.health_flood_isolation_score) * 0.1),
      );
      const floodRiskScore = clampScore(
        (toFiniteNumber(row.flood_exposed_population_pct) * 0.7) +
        (toFiniteNumber(row.education_flood_isolation_score) * 0.15) +
        (toFiniteNumber(row.health_flood_isolation_score) * 0.15),
      );
      let planningPriorityScore = clampScore(
        (beneficiaryDensityScore * 0.25) +
        (serviceGapScore * 0.45) +
        (floodRiskScore * 0.3),
      );

      if (normalizedDepartment === "education") {
        planningPriorityScore = clampScore(
          (toFiniteNumber(row.education_vulnerability_score) * 0.55) +
          (toFiniteNumber(row.education_flood_isolation_score) * 0.2) +
          (beneficiaryDensityScore * 0.15) +
          (toFiniteNumber(row.flood_exposed_population_pct) * 0.1),
        );
      } else if (normalizedDepartment === "health") {
        planningPriorityScore = clampScore(
          (toFiniteNumber(row.health_vulnerability_score) * 0.55) +
          (toFiniteNumber(row.health_flood_isolation_score) * 0.2) +
          (beneficiaryDensityScore * 0.15) +
          (toFiniteNumber(row.flood_exposed_population_pct) * 0.1),
        );
      } else if (normalizedDepartment === "disaster") {
        planningPriorityScore = clampScore(
          (toFiniteNumber(row.flood_exposed_population_pct) * 0.55) +
          (toFiniteNumber(row.education_flood_isolation_score) * 0.15) +
          (toFiniteNumber(row.health_flood_isolation_score) * 0.15) +
          (beneficiaryDensityScore * 0.15),
        );
      } else if (normalizedDepartment === "welfare") {
        planningPriorityScore = clampScore(
          (beneficiaryDensityScore * 0.4) +
          (serviceGapScore * 0.35) +
          (floodRiskScore * 0.25),
        );
      }

      const normalizedRow = {
        admin_unit_id: Number(row.admin_unit_id),
        admin_unit_name: row.admin_unit_name,
        admin_unit_type: row.admin_unit_type,
        district_name: row.district_name,
        population_total: Math.round(populationTotal),
        beneficiary_count: Math.round(beneficiaryCount),
        schools_count: Math.round(toFiniteNumber(row.schools_count)),
        health_facilities_count: Math.round(toFiniteNumber(row.health_facilities_count)),
        flood_exposed_population_pct: roundTo(row.flood_exposed_population_pct, 1),
        flood_exposed_population: Math.round(toFiniteNumber(row.flood_exposed_population)),
        education_vulnerability_score: roundTo(row.education_vulnerability_score, 1),
        education_flood_isolation_score: roundTo(row.education_flood_isolation_score, 1),
        health_vulnerability_score: roundTo(row.health_vulnerability_score, 1),
        health_flood_isolation_score: roundTo(row.health_flood_isolation_score, 1),
        beneficiary_density_score: roundTo(beneficiaryDensityScore, 1),
        service_gap_score: roundTo(serviceGapScore, 1),
        flood_risk_score: roundTo(floodRiskScore, 1),
        planning_priority_score: roundTo(planningPriorityScore, 1),
      };

      return {
        ...normalizedRow,
        narrative: buildDepartmentPriorityNarrative(normalizedRow, normalizedDepartment),
        recommended_actions: buildDepartmentPriorityActions(
          {
            ...normalizedRow,
            recommended_actions: buildPriorityActions(normalizedRow),
          },
          normalizedDepartment,
        ),
      };
    });

    const ranked = rows
      .sort((left, right) => right.planning_priority_score - left.planning_priority_score)
      .map((row, index) => ({
        ...row,
        rank: index + 1,
        priority_band:
          row.planning_priority_score >= 70
            ? "Critical"
            : row.planning_priority_score >= 50
              ? "High"
              : row.planning_priority_score >= 30
                ? "Moderate"
                : "Watch",
      }));

    const topRows = ranked.slice(0, limit);
    const summary = {
      admin_unit_type: normalizedAdminType,
      department: normalizedDepartment,
      selected_district: district || null,
      selected_ta: ta || null,
      areas_ranked: ranked.length,
      highest_priority_area: topRows[0]?.admin_unit_name || null,
      highest_priority_score: topRows[0]?.planning_priority_score || 0,
    };

    return res.json({
      status: "success",
      data: {
        summary,
        priorities: topRows,
        all_priorities: ranked,
      },
    });
  } catch (err) {
    console.error("Dashboard planning-priorities error:", err.message);
    return res.status(500).send("Server error");
  }
});

router.get("/data-freshness", async (req, res) => {
  try {
    const result = await db.query(`
      WITH freshness AS (
        SELECT 'education_facilities'::text AS dataset, MAX(created_at) AS last_updated FROM education_facilities
        UNION ALL
        SELECT 'health_facilities'::text AS dataset, MAX(created_at) AS last_updated FROM health_facilities
        UNION ALL
        SELECT 'welfare_beneficiary'::text AS dataset, MAX(COALESCE(updated_at, created_at)) AS last_updated FROM welfare_beneficiary
        UNION ALL
        SELECT 'welfare_beneficiary_indicators'::text AS dataset, MAX(COALESCE(updated_at, created_at)) AS last_updated FROM welfare_beneficiary_indicators
        UNION ALL
        SELECT 'analysis_results'::text AS dataset, MAX(calculated_at) AS last_updated FROM analysis_results
        UNION ALL
        SELECT 'worldpop_age_sex'::text AS dataset, MAX(created_at) AS last_updated FROM worldpop_age_sex
        UNION ALL
        SELECT 'flood_risk_polygons'::text AS dataset, MAX(created_at) AS last_updated FROM flood_risk_polygons
      )
      SELECT dataset, last_updated
      FROM freshness
      ORDER BY dataset ASC
    `);

    return res.json({
      status: "success",
      data: result.rows.map((row) => ({
        dataset: row.dataset,
        last_updated: row.last_updated,
      })),
    });
  } catch (err) {
    console.error("Dashboard data-freshness error:", err.message);
    return res.status(500).send("Server error");
  }
});

module.exports = router;
