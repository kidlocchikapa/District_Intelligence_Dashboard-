const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

function normalizeAdminType(adminType = "District") {
  const normalized = String(adminType || "District")
    .trim()
    .toLowerCase();
  if (normalized === "district") return "District";
  if (normalized === "ta" || normalized === "admin3") return "TA";
  if (normalized === "village") return "Village";
  return "District";
}

// @route   GET api/v1/dashboard/health
// @desc    Get health facility locations (GeoJSON)
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "hf.geom", district);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const query = `
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
                SELECT jsonb_build_object(
                    'type', 'Feature',
                  'id', hf.id,
                  'geometry', ST_AsGeoJSON(hf.geom)::jsonb,
                  'properties', (
                    (to_jsonb(hf) - 'geom')
                    || jsonb_build_object(
                      'name', hf.name,
                      'name_en', COALESCE(hf.common_name, hf.name),
                      'amenity', hf.type,
                      'building', NULL,
                      'healthcare', hf.type,
                      'healthcare_speciality', NULL,
                      'operator_type', hf.ownership,
                      'capacity_persons', hf."capacity:persons",
                      'address_full', NULL,
                      'address_city', hf.district,
                      'source', NULL,
                      'name_ny', NULL,
                      'ward_id', hf.ta_id,
                      'ta_id', hf.ta_id,
                      'district_id', hf.district_id
                    )
                  )
                ) AS feature
                FROM health_facilities hf
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
  const normalizedAdminType = normalizeAdminType(adminType);

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
      "LOWER(admin_unit_type) = LOWER($2)",
    ];
    const params = [analysisType, normalizedAdminType];
    appendDistrictNameCondition(
      conditions,
      params,
      "admin_unit_name",
      district,
    );

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
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [
      "analysis_type = 'health_population_served'",
      "LOWER(admin_unit_type) = LOWER($1)",
    ];
    const params = [normalizedAdminType];
    appendDistrictNameCondition(
      conditions,
      params,
      "admin_unit_name",
      district,
    );

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
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const params = [normalizedAdminType];
    const conditions = ["au.geom IS NOT NULL", "LOWER(au.type) = LOWER($1)"];
    appendDistrictGeometryCondition(conditions, params, "au.geom", district);

    const query = `
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
        WITH admin_units AS (
          SELECT
            d.id,
            d.code,
            d.name,
            'District'::text AS type,
            d.population_total,
            d.population_density,
            d.geom
          FROM districts d
          UNION ALL
          SELECT
            a3.id,
            a3.code,
            a3.name,
            a3.type::text AS type,
            a3.population_total,
            a3.population_density,
            a3.geom
          FROM admin3_units a3
        )
                SELECT jsonb_build_object(
                    'type', 'Feature',
                    'id', au.id,
          'geometry', ST_AsGeoJSON(au.geom)::jsonb,
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
                FROM admin_units au
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
                      AND LOWER(admin_unit_type) = LOWER($1)
                    GROUP BY admin_unit_id
                ) ar
                  ON ar.admin_unit_id = au.id
                WHERE ${conditions.join(" AND ")}
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

// @route   GET api/v1/dashboard/health/access-zones/geojson
// @desc    Get served/unserved health access zones plus facility points
router.get("/access-zones/geojson", async (req, res) => {
  const { district, buffer_km: bufferKmParam } = req.query;
  const parsedBufferKm = Number(bufferKmParam);
  const bufferKm =
    Number.isFinite(parsedBufferKm) && parsedBufferKm > 0
      ? Math.min(parsedBufferKm, 30)
      : 8;
  const bufferMeters = bufferKm * 1000;

  try {
    const params = [bufferMeters];
    const districtConditions = ["d.geom IS NOT NULL"];
    appendDistrictNameCondition(districtConditions, params, "d.name", district);
    const districtWhereClause = districtConditions.length
      ? `WHERE ${districtConditions.join(" AND ")}`
      : "";

    const query = `
      WITH district_ids AS (
        SELECT d.id, d.name, d.geom
        FROM districts d
        ${districtWhereClause}
      ),
      admin3_scope AS (
        SELECT a3.id, a3.name, a3.geom, a3.district_id, di.name AS district_name
        FROM admin3_units a3
        JOIN district_ids di ON a3.district_id = di.id
        WHERE a3.geom IS NOT NULL
      ),
      facility_scope AS (
        SELECT
          hf.id AS facility_id,
          COALESCE(hf.name, '') AS facility_name,
          hf.geom
        FROM health_facilities hf
        JOIN district_ids di
          ON hf.geom IS NOT NULL
         AND ST_Intersects(hf.geom, di.geom)
        WHERE hf.geom IS NOT NULL
      ),
      facility_buffers AS (
        SELECT
          ST_UnaryUnion(
            ST_Collect(ST_Buffer(fs.geom::geography, $1)::geometry)
          ) AS geom
        FROM facility_scope fs
      ),
      zone_raw AS (
        SELECT
          a3.id AS admin_unit_id,
          a3.name AS admin_unit_name,
          a3.district_name AS district_name,
          a3.geom AS admin_unit_geom,
          fb.geom AS buffer_geom
        FROM admin3_scope a3
        LEFT JOIN facility_buffers fb ON TRUE
      ),
      zone_geometries AS (
        SELECT
          zr.admin_unit_id,
          zr.admin_unit_name,
          zr.district_name,
          zr.admin_unit_geom,
          ST_Multi(
            COALESCE(
              ST_CollectionExtract(
                CASE
                  WHEN zr.buffer_geom IS NULL
                    THEN ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)
                  ELSE ST_Intersection(zr.admin_unit_geom, zr.buffer_geom)
                END,
                3
              ),
              ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)
            )
          ) AS served_geom,
          ST_Multi(
            COALESCE(
              ST_CollectionExtract(
                CASE
                  WHEN zr.buffer_geom IS NULL
                    THEN zr.admin_unit_geom
                  ELSE ST_Difference(
                    zr.admin_unit_geom,
                    ST_Intersection(zr.admin_unit_geom, zr.buffer_geom)
                  )
                END,
                3
              ),
              ST_GeomFromText('MULTIPOLYGON EMPTY', 4326)
            )
          ) AS unserved_geom
        FROM zone_raw zr
      ),
      zone_metrics AS (
        SELECT
          zg.admin_unit_id,
          zg.admin_unit_name,
          zg.district_name,
          zg.served_geom,
          zg.unserved_geom,
          CASE
            WHEN ST_Area(ST_Transform(zg.admin_unit_geom, 3857)) > 0
              THEN (
                ST_Area(ST_Transform(zg.served_geom, 3857))
                / ST_Area(ST_Transform(zg.admin_unit_geom, 3857))
              ) * 100
            ELSE 0
          END AS served_pct
        FROM zone_geometries zg
      )
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT('served-', zm.admin_unit_id),
          'geometry', ST_AsGeoJSON(zm.served_geom)::jsonb,
          'properties', jsonb_build_object(
            'zone_type', 'served',
            'admin_unit_id', zm.admin_unit_id,
            'admin_unit_name', zm.admin_unit_name,
            'district_name', zm.district_name,
            'coverage_distance_km', $1 / 1000.0,
            'coverage_pct', zm.served_pct
          )
        ) AS feature
        FROM zone_metrics zm
        WHERE zm.served_geom IS NOT NULL
          AND NOT ST_IsEmpty(zm.served_geom)

        UNION ALL

        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT('unserved-', zm.admin_unit_id),
          'geometry', ST_AsGeoJSON(zm.unserved_geom)::jsonb,
          'properties', jsonb_build_object(
            'zone_type', 'unserved',
            'admin_unit_id', zm.admin_unit_id,
            'admin_unit_name', zm.admin_unit_name,
            'district_name', zm.district_name,
            'coverage_distance_km', $1 / 1000.0,
            'coverage_pct', zm.served_pct
          )
        ) AS feature
        FROM zone_metrics zm
        WHERE zm.unserved_geom IS NOT NULL
          AND NOT ST_IsEmpty(zm.unserved_geom)

        UNION ALL

        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT('facility-', fs.facility_id),
          'geometry', ST_AsGeoJSON(fs.geom)::jsonb,
          'properties', jsonb_build_object(
            'zone_type', 'facility_point',
            'facility_id', fs.facility_id,
            'facility_name', fs.facility_name,
            'coverage_distance_km', $1 / 1000.0
          )
        ) AS feature
        FROM facility_scope fs
      ) features;
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
    console.error("Health access zones geojson error", {
      message: err.message,
      district,
      bufferKm,
    });
    res.status(500).send("Server error");
  }
});

module.exports = router;
