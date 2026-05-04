const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
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

// Import sub-routers for different dashboard sections
const educationRoutes = require("./education");
const healthRoutes = require("./health");
const disasterRoutes = require("./disaster");
const analysisRoutes = require("./analysis");

// Mount sub-routers for different dashboard sections
router.use("/education", educationRoutes);
router.use("/health", healthRoutes);
router.use("/disaster", disasterRoutes);
router.use(
  "/analysis",
  auth,
  requireRole("admin", "super_admin"),
  analysisRoutes,
);

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

module.exports = router;
