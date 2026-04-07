const express = require("express");
const router = express.Router();
const db = require("../db");

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
                    FROM administrative_units au
                    WHERE au.geom IS NOT NULL
                      AND LOWER(au.type) = LOWER('District')
                      AND LOWER(au.name) = LOWER($1)
                      AND ST_Intersects(ef.geom, au.geom)
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
                    FROM administrative_units au
                    WHERE au.geom IS NOT NULL
                      AND LOWER(au.type) = LOWER('District')
                      AND LOWER(au.name) = LOWER($1)
                      AND ST_Intersects(hf.geom, au.geom)
                  )
                `,
        [district],
      );
      // For population, we sum the population_total for the specific district
      populationTotal = await db.query(
        `
                SELECT SUM(population_total)
                FROM administrative_units
                WHERE LOWER(type) = LOWER('District')
                  AND LOWER(name) = LOWER($1)
                `,
        [district],
      );
    } else {
      schoolsCount = await db.query(
        "SELECT COUNT(*) FROM education_facilities",
      );
      healthCount = await db.query("SELECT COUNT(*) FROM health_facilities");
      populationTotal = await db.query(
        "SELECT SUM(population_total) FROM administrative_units WHERE LOWER(type) = LOWER('District')",
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
            FROM administrative_units
            WHERE LOWER(type) = LOWER('District')
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
 * @route   GET /api/v1/dashboard/admin-units
 * @desc    Get administrative units as GeoJSON with optional type and district filters
 */
router.get("/admin-units", async (req, res) => {
  const { type: adminType, district } = req.query;

  try {
    const params = [];
    let whereClause = "WHERE geom IS NOT NULL";

    if (adminType) {
      params.push(adminType);
      whereClause += ` AND type = $${params.length}`;
    }

    if (district) {
      params.push(district);
      whereClause += ` AND LOWER(name) = LOWER($${params.length})`;
    }

    const query = `
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', ST_AsGeoJSON(COALESCE(simplified_geom, geom))::jsonb,
                    'properties', jsonb_build_object(
                        'code', code,
                        'name', name,
                        'type', type,
                        'parent_id', parent_id,
                        'source', source,
                        'level', level,
                        'population_total', population_total,
                        'population_density', population_density,
                        'area_sq_km', area_sq_km,
                        'metadata', metadata
                    )
                ) AS feature
                FROM administrative_units
                ${whereClause}
                ORDER BY type, name
            ) rowconf;
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
