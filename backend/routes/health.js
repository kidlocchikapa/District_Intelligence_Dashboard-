const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const requireDepartmentAccess = require("../middleware/requireDepartmentAccess");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

router.use(auth, requireDepartmentAccess("health", "read"));

// @route   GET api/v1/dashboard/health
// @desc    Get health facility locations (GeoJSON)
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "health_facilities.geom", district);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', id,
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', jsonb_build_object(
                        'name', name,
                        'name_en', "name:en",
                        'amenity', amenity,
                        'building', building,
                        'type', type,
                        'healthcare', healthcare,
                        'healthcare_speciality', "healthcare:speciality",
                        'operator_type', "operator:type",
                        'capacity_persons', "capacity:persons",
                        'address_full', "addr:full",
                        'address_city', "addr:city",
                        'source', source,
                        'name_ny', "name:ny",
                        'beds_count', beds_count,
                        'patient_visits_total', patient_visits_total,
                        'services_offered', services_offered,
                        'osm_id', osm_id,
                        'osm_type', osm_type,
                        'ward_id', ward_id,
                        'district_id', district_id
                    )
                ) AS feature
                FROM health_facilities
                ${whereClause}
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

// @route   GET api/v1/dashboard/health/summary
// @desc    Get ward/district health aggregates
router.get("/summary", async (req, res) => {
  const {
    admin_type: adminType = "District",
    analysis_type: analysisType = "health_summary",
    district,
  } = req.query;

  if (!["health_summary", "health_population_served"].includes(analysisType)) {
    return res.status(400).json({
      status: "error",
      message:
        "analysis_type must be health_summary or health_population_served",
    });
  }

  try {
    const conditions = [
      "analysis_type = $1",
      "admin_unit_type = $2",
    ];
    const params = [analysisType, adminType];
    appendDistrictNameCondition(conditions, params, "admin_unit_name", district);

    const result = await db.query(
      `
            SELECT
                admin_unit_id,
                admin_unit_code,
                admin_unit_name,
                admin_unit_type,
                metric_name,
                metric_value,
                metric_unit,
                metadata,
                calculated_at
            FROM analysis_results
            WHERE ${conditions.join(" AND ")}
            ORDER BY admin_unit_name, metric_name
            `,
      params,
    );
    res.json({
      status: "success",
      data: result.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/health/served-population
// @desc    Get ward/district health served population aggregates
router.get("/served-population", async (req, res) => {
  const { admin_type: adminType = "District", district } = req.query;

  try {
    const conditions = [
      "analysis_type = 'health_population_served'",
      "admin_unit_type = $1",
    ];
    const params = [adminType];
    appendDistrictNameCondition(conditions, params, "admin_unit_name", district);

    const result = await db.query(
      `
            SELECT
                admin_unit_id,
                admin_unit_code,
                admin_unit_name,
                admin_unit_type,
                metric_name,
                metric_value,
                metric_unit,
                metadata,
                calculated_at
            FROM analysis_results
            WHERE ${conditions.join(" AND ")}
            ORDER BY admin_unit_name, metric_name
            `,
      params,
    );
    res.json({
      status: "success",
      data: result.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/health/served-population/geojson
// @desc    Get ward/district health served population results as GeoJSON
router.get("/served-population/geojson", async (req, res) => {
  const { admin_type: adminType = "District", district } = req.query;

  try {
    const params = [adminType];
    let districtClause = "";
    if (district) {
      params.push(district);
      districtClause = ` AND LOWER(au.name) = LOWER($${params.length})`;
    }

    const query = `
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', au.id,
                    'geometry', ST_AsGeoJSON(COALESCE(au.simplified_geom, au.geom))::jsonb,
                    'properties', jsonb_build_object(
                        'admin_unit_id', au.id,
                        'admin_unit_code', au.code,
                        'admin_unit_name', au.name,
                        'admin_unit_type', au.type,
                        'population_total', au.population_total,
                        'population_density', au.population_density,
                        'health_population_served_total', ar.health_population_served_total,
                        'health_population_served_pct', ar.health_population_served_pct,
                        'health_population_unserved_total', ar.health_population_unserved_total,
                        'health_population_unserved_pct', ar.health_population_unserved_pct,
                        'coverage_distance_km', ar.coverage_distance_km,
                        'calculated_at', ar.calculated_at
                    )
                ) AS feature
                FROM administrative_units au
                JOIN (
                    SELECT
                        admin_unit_id,
                        MAX(CASE WHEN metric_name = 'health_population_served_total' THEN metric_value END) AS health_population_served_total,
                        MAX(CASE WHEN metric_name = 'health_population_served_pct' THEN metric_value END) AS health_population_served_pct,
                        MAX(CASE WHEN metric_name = 'health_population_unserved_total' THEN metric_value END) AS health_population_unserved_total,
                        MAX(CASE WHEN metric_name = 'health_population_unserved_pct' THEN metric_value END) AS health_population_unserved_pct,
                        MAX((metadata->>'coverage_distance_km')::numeric) AS coverage_distance_km,
                        MAX(calculated_at) AS calculated_at
                    FROM analysis_results
                    WHERE analysis_type = 'health_population_served'
                      AND admin_unit_type = $1
                    GROUP BY admin_unit_id
                ) ar
                  ON ar.admin_unit_id = au.id
                WHERE au.geom IS NOT NULL
                  ${districtClause}
                ORDER BY au.name
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
