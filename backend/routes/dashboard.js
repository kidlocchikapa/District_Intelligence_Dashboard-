const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");

function normalizeAdminType(adminType) {
  if (!adminType) return null;
  const normalized = String(adminType).trim().toLowerCase();
  if (normalized === "district") return "District";
  if (normalized === "ta" || normalized === "admin3") return "TA";
  if (normalized === "village") return "Village";
  return String(adminType).trim();
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
router.use(auth, requireRole("admin", "super_admin"));

/**
 * @route   GET /api/v1/dashboard/summary
 * @desc    Get summary statistics for the dashboard with optional district filter
 */
router.get("/summary", async (req, res) => {
  const { district } = req.query;

  try {
    let schoolsCount;
    let healthCount;
    let populationTotal;

    if (district) {
      // For district-specific summary, we need to count facilities that intersect with the district geometry
      schoolsCount = await db.query(
        `
                SELECT COUNT(*)
                FROM education_facilities ef
                WHERE ef.geom IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM districts d
                    WHERE d.geom IS NOT NULL
                      AND LOWER(d.name) = LOWER($1)
                      AND ST_Intersects(ef.geom, d.geom)
                  )
                `,
        [district],
      );
      // For health facilities, we do the same spatial intersection count
      healthCount = await db.query(
        `
                SELECT COUNT(*)
                FROM health_facilities hf
                WHERE hf.geom IS NOT NULL
                  AND EXISTS (
                    SELECT 1
                    FROM districts d
                    WHERE d.geom IS NOT NULL
                      AND LOWER(d.name) = LOWER($1)
                      AND ST_Intersects(hf.geom, d.geom)
                  )
                `,
        [district],
      );
      // For population, we sum the population_total for the specific district
      populationTotal = await db.query(
        `
                SELECT SUM(population_total)
                FROM districts
                WHERE LOWER(name) = LOWER($1)
                `,
        [district],
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
router.get("/districts", async (req, res) => {
  try {
    const result = await db.query(
      `
            SELECT DISTINCT name
            FROM districts
            ORDER BY name
            `,
    );

    res.json({
      status: "success",
      data: result.rows.map((row) => row.name),
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
router.get("/population-by-district", async (req, res) => {
  const { district } = req.query;

  try {
    const params = [];
    let whereClause = "WHERE 1=1";

    if (district) {
      params.push(district);
      whereClause += ` AND LOWER(name) = LOWER($${params.length})`;
    }

    const result = await db.query(
      `
        SELECT
          name AS district,
          COALESCE(population_total, 0) AS population
        FROM districts
        ${whereClause}
        ORDER BY name
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
 * @route   GET /api/v1/dashboard/admin-units
 * @desc    Get administrative units as GeoJSON with optional type and district filters
 */
router.get("/admin-units", async (req, res) => {
  const { type: adminType, district } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const params = [];
    let districtFilterDistricts = "";
    let districtFilterAdmin3 = "";
    if (district) {
      params.push(district);
      districtFilterDistricts = ` AND LOWER(d.name) = LOWER($${params.length})`;
      districtFilterAdmin3 = ` AND LOWER(d.name) = LOWER($${params.length})`;
    }

    const includeDistrict =
      !normalizedAdminType || normalizedAdminType === "District";
    const includeAdmin3 =
      !normalizedAdminType ||
      ["TA", "Village", "Admin3"].includes(normalizedAdminType);

    const districtTypePredicate =
      !normalizedAdminType || normalizedAdminType === "District"
        ? "TRUE"
        : "FALSE";

    const admin3TypePredicate =
      normalizedAdminType && normalizedAdminType !== "District"
        ? `LOWER(a3.type) = LOWER('${normalizedAdminType}')`
        : "TRUE";

    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        ${
          includeDistrict
            ? `
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
        `
            : `SELECT NULL::jsonb AS feature, NULL::text AS sort_type, NULL::text AS sort_name WHERE FALSE`
        }

        ${includeDistrict && includeAdmin3 ? "UNION ALL" : ""}

        ${
          includeAdmin3
            ? `
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
        `
            : `SELECT NULL::jsonb AS feature, NULL::text AS sort_type, NULL::text AS sort_name WHERE FALSE`
        }
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
