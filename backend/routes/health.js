const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
  resolveDistrictFilterValues,
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

function appendOptionalTaCondition(
  conditions,
  params,
  columnExpression,
  taName,
) {
  if (!taName) {
    return;
  }

  params.push(taName);
  conditions.push(`LOWER(${columnExpression}) = LOWER($${params.length})`);
}

async function tableExists(tableName) {
  const result = await db.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
      ) AS exists
    `,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

function buildRasterSlug(district) {
  const normalized = String(district || "").trim().toLowerCase();
  if (
    normalized === "zomba" ||
    normalized === "zomba city" ||
    normalized === "zomba (all)"
  ) {
    return "zomba-zomba-city";
  }

  const values = resolveDistrictFilterValues(district);
  const source = values.length ? values : ["malawi"];
  return source
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("-") || "malawi";
}

// @route   GET api/v1/dashboard/health
// @desc    Get health facility locations (GeoJSON)
/**
 * @openapi
 * /api/v1/dashboard/health:
 *   get:
 *     summary: Get health facility locations as GeoJSON
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Health facilities GeoJSON
 */
router.get("/", async (req, res) => {
  const { district, ta } = req.query;

  try {
    const conditions = ["hf.geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "hf.geom", district);
    appendOptionalTaCondition(conditions, params, "a3.name", ta);
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
                      'ta_name', a3.name,
                      'district_id', hf.district_id
                    )
                  )
                ) AS feature
                FROM health_facilities hf
                LEFT JOIN admin3_units a3 ON a3.id = hf.ta_id
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
/**
 * @openapi
 * /api/v1/dashboard/health/summary:
 *   get:
 *     summary: Get health summary metrics
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Health summary
 */
router.get("/summary", async (req, res) => {
  const {
    admin_type: adminType = "District",
    analysis_type: analysisType = "health_summary",
    district,
    ta,
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
    if (normalizedAdminType === "TA") {
      appendOptionalTaCondition(conditions, params, "admin_unit_name", ta);
      const districtConditions = [];
      appendDistrictNameCondition(
        districtConditions,
        params,
        "d.name",
        district,
      );
      if (districtConditions.length) {
        conditions.push(`
          EXISTS (
            SELECT 1
            FROM admin3_units a3
            JOIN districts d ON d.id = a3.district_id
            WHERE a3.id = analysis_results.admin_unit_id
              AND ${districtConditions.join(" AND ")}
          )
        `);
      }
    } else {
      appendDistrictNameCondition(
        conditions,
        params,
        "admin_unit_name",
        district,
      );
    }

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
/**
 * @openapi
 * /api/v1/dashboard/health/served-population:
 *   get:
 *     summary: Get health served population metrics
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Served population metrics
 */
router.get("/served-population", async (req, res) => {
  const { admin_type: adminType = "District", district, ta } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [
      "analysis_type = 'health_population_served'",
      "LOWER(admin_unit_type) = LOWER($1)",
    ];
    const params = [normalizedAdminType];
    if (normalizedAdminType === "TA") {
      appendOptionalTaCondition(conditions, params, "admin_unit_name", ta);
      const districtConditions = [];
      appendDistrictNameCondition(
        districtConditions,
        params,
        "d.name",
        district,
      );
      if (districtConditions.length) {
        conditions.push(`
          EXISTS (
            SELECT 1
            FROM admin3_units a3
            JOIN districts d ON d.id = a3.district_id
            WHERE a3.id = analysis_results.admin_unit_id
              AND ${districtConditions.join(" AND ")}
          )
        `);
      }
    } else {
      appendDistrictNameCondition(
        conditions,
        params,
        "admin_unit_name",
        district,
      );
    }

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

// @route   GET api/v1/dashboard/health/service-coverage
// @desc    Get ward/district health service coverage percentages
/**
 * @openapi
 * /api/v1/dashboard/health/service-coverage:
 *   get:
 *     summary: Get health service coverage metrics
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Service coverage metrics
 */
router.get("/service-coverage", async (req, res) => {
  const { admin_type: adminType = "District", district, ta } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [
      "ar.analysis_type = 'health_service_coverage'",
      "ar.metric_name = 'health_service_coverage_pct'",
      "LOWER(ar.admin_unit_type) = LOWER($1)",
    ];
    const params = [normalizedAdminType];

    if (normalizedAdminType === "TA") {
      appendOptionalTaCondition(conditions, params, "ar.admin_unit_name", ta);
      appendDistrictNameCondition(conditions, params, "d.name", district);
    } else {
      appendDistrictNameCondition(
        conditions,
        params,
        "ar.admin_unit_name",
        district,
      );
    }

    const result = await db.query(
      `
            SELECT
                ar.admin_unit_id,
                ar.admin_unit_code,
                ar.admin_unit_name,
                ar.admin_unit_type,
                ar.metric_name,
                ar.metric_value,
                ar.metric_unit,
                ar.metadata,
                ar.calculated_at
            FROM analysis_results ar
            LEFT JOIN admin3_units a3
              ON LOWER(ar.admin_unit_type) IN (LOWER('TA'), LOWER('Village'), LOWER('Admin3'))
             AND a3.id = ar.admin_unit_id
            LEFT JOIN districts d
              ON d.id = a3.district_id
            WHERE ${conditions.join(" AND ")}
            ORDER BY ar.metric_value ASC, ar.admin_unit_name ASC
            `,
      params,
    );

    res.json({
      status: "success",
      data: result.rows,
    });
  } catch (err) {
    console.error("Health service coverage error", {
      message: err.message,
      district,
      ta,
      adminType: normalizedAdminType,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/health/served-population/geojson
// @desc    Get ward/district health served population results as GeoJSON
/**
 * @openapi
 * /api/v1/dashboard/health/served-population/geojson:
 *   get:
 *     summary: Get health served population as GeoJSON
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Served population GeoJSON
 */
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

// @route   GET api/v1/dashboard/health/2sfca
// @desc    Get health 2SFCA access metrics
/**
 * @openapi
 * /api/v1/dashboard/health/2sfca:
 *   get:
 *     summary: Get health 2SFCA access metrics
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: 2SFCA access metrics
 */
router.get("/2sfca", async (req, res) => {
  const { admin_type: adminType = "District", district, ta } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [
      "analysis_type = 'health_2sfca_access'",
      "LOWER(admin_unit_type) = LOWER($1)",
    ];
    const params = [normalizedAdminType];
    if (normalizedAdminType === "TA") {
      appendOptionalTaCondition(conditions, params, "admin_unit_name", ta);
    } else {
      appendDistrictNameCondition(
        conditions,
        params,
        "admin_unit_name",
        district,
      );
    }

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

// @route   GET api/v1/dashboard/health/2sfca/geojson
// @desc    Get health 2SFCA access results as GeoJSON
/**
 * @openapi
 * /api/v1/dashboard/health/2sfca/geojson:
 *   get:
 *     summary: Get health 2SFCA access as GeoJSON
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: 2SFCA access GeoJSON
 */
router.get("/2sfca/geojson", async (req, res) => {
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
                        'health_2sfca_access_score', ar.health_2sfca_access_score,
                        'catchment_minutes', ar.catchment_minutes,
                        'calculated_at', ar.calculated_at
                    )
                ) AS feature
                FROM admin_units au
                JOIN (
                    SELECT
                        admin_unit_id,
                        MAX(CASE WHEN metric_name = 'health_2sfca_access_score' THEN metric_value END) AS health_2sfca_access_score,
                        MAX((metadata->>'catchment_minutes')::numeric) AS catchment_minutes,
                        MAX(calculated_at) AS calculated_at
                    FROM analysis_results
                    WHERE analysis_type = 'health_2sfca_access'
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

// @route   GET api/v1/dashboard/health/raster-metadata
// @desc    Get static raster metadata descriptors for health access visualizations
router.get("/raster-metadata", async (req, res) => {
  const { district } = req.query;
  const slug = buildRasterSlug(district);

  res.json({
    status: "success",
    data: {
      district: district || null,
      assets: {
        health_buffer_8km: `/health-access/${slug}.health_buffer_8km.preview.json`,
        health_network_8km: `/health-access/${slug}.health_network_8km.preview.json`,
        health_travel_time: `/health-access/${slug}.health_travel_time.preview.json`,
        health_2sfca: `/health-access/${slug}.health_2sfca.preview.json`,
        health_welfare_vulnerability: `/health-access/${slug}.health_welfare_vulnerability.preview.json`,
        health_flood_isolation: `/health-access/${slug}.health_flood_isolation.preview.json`,
        health_school_gap: `/health-access/${slug}.health_school_gap.preview.json`,
      },
    },
  });
});

// @route   GET api/v1/dashboard/health/facility-buffers/geojson
// @desc    Get facility 8 km buffer polygons with buffer-based and network-based metrics
router.get("/facility-buffers/geojson", async (req, res) => {
  const { district, ta, buffer_km: bufferKmParam } = req.query;
  const parsedBufferKm = Number(bufferKmParam);
  const bufferKm =
    Number.isFinite(parsedBufferKm) && parsedBufferKm > 0
      ? Math.min(parsedBufferKm, 30)
      : 8;
  const hasMetricsTable = await tableExists("health_facility_access_metrics");

  try {
    const params = [bufferKm * 1000];
    const conditions = ["hf.geom IS NOT NULL"];
    appendDistrictGeometryCondition(conditions, params, "hf.geom", district);
    appendOptionalTaCondition(conditions, params, "a3.name", ta);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const metricsJoin = hasMetricsTable
      ? `
        LEFT JOIN health_facility_access_metrics ham
          ON ham.facility_id = hf.id
      `
      : "";
    const metricsFields = hasMetricsTable
      ? `
        'worldpop_population_within_8km_buffer', COALESCE(ham.worldpop_population_within_buffer, 0),
        'welfare_beneficiaries_within_8km_buffer', COALESCE(ham.welfare_beneficiaries_within_buffer, 0),
        'welfare_beneficiaries_served_by_8km_network', COALESCE(ham.welfare_beneficiaries_served_by_8km_network, 0),
        'avg_network_distance_km', ham.avg_network_distance_km,
        'avg_travel_time_min', ham.avg_travel_time_min,
      `
      : `
        'worldpop_population_within_8km_buffer', NULL,
        'welfare_beneficiaries_within_8km_buffer', NULL,
        'welfare_beneficiaries_served_by_8km_network', NULL,
        'avg_network_distance_km', NULL,
        'avg_travel_time_min', NULL,
      `;

    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT('facility-buffer-', hf.id),
          'geometry', ST_AsGeoJSON(ST_Buffer(hf.geom::geography, $1)::geometry)::jsonb,
          'properties', jsonb_build_object(
            'facility_id', hf.id,
            'facility_name', hf.name,
            'facility_type', hf.type,
            'ownership', hf.ownership,
            'ta_name', a3.name,
            'district_name', d.name,
            'coverage_distance_km', $1 / 1000.0,
            'coverage_metric_type', 'buffer_based',
            ${metricsFields}
            'metric_source', ${hasMetricsTable ? "'health_facility_access_metrics'" : "'not_calculated'"}
          )
        ) AS feature
        FROM health_facilities hf
        LEFT JOIN admin3_units a3
          ON a3.id = hf.ta_id
        LEFT JOIN districts d
          ON d.id = hf.district_id
        ${metricsJoin}
        ${whereClause}
      ) features;
    `;

    const result = await db.query(query, params);
    res.json({
      status: "success",
      data: result.rows[0]?.jsonb_build_object || {
        type: "FeatureCollection",
        features: [],
      },
    });
  } catch (err) {
    console.error("Health facility buffers geojson error", {
      message: err.message,
      district,
      ta,
      bufferKm,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/health/access-zones/geojson
// @desc    Get served/unserved health access zones plus facility points
/**
 * @openapi
 * /api/v1/dashboard/health/access-zones/geojson:
 *   get:
 *     summary: Get health access zones as GeoJSON
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Access zones GeoJSON
 */
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

// @route   GET api/v1/dashboard/health/drilldown
// @desc    Get health drilldown summary, TA breakdown, and facility-level details
/**
 * @openapi
 * /api/v1/dashboard/health/drilldown:
 *   get:
 *     summary: Get health drilldown statistics
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Health drilldown
 */
router.get("/drilldown", async (req, res) => {
  const {
    district,
    ta,
    admin_type: adminType = "District",
    buffer_km: bufferKmParam,
  } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);
  const parsedBufferKm = Number(bufferKmParam);
  const bufferKm =
    Number.isFinite(parsedBufferKm) && parsedBufferKm > 0
      ? Math.min(parsedBufferKm, 30)
      : 8;
  const bufferMeters = bufferKm * 1000;

  try {
    const hasFacilityAccessMetricsTable = await tableExists(
      "health_facility_access_metrics",
    );
    const facilityParams = [bufferMeters];
    const facilityConditions = ["hf.geom IS NOT NULL"];
    appendDistrictGeometryCondition(
      facilityConditions,
      facilityParams,
      "hf.geom",
      district,
    );
    appendOptionalTaCondition(
      facilityConditions,
      facilityParams,
      "a3.name",
      ta,
    );
    const facilityWhereClause = facilityConditions.length
      ? `WHERE ${facilityConditions.join(" AND ")}`
      : "";

    const facilityQuery = `
      WITH facility_scope AS (
        SELECT
          hf.id AS facility_id,
          COALESCE(hf.name, '') AS facility_name,
          hf.type AS facility_type,
          hf.ownership AS ownership,
          hf."capacity:persons" AS capacity_persons,
          hf.doctor_count,
          hf.nurse_midwife_count,
          hf.patient_visits_total,
          hf.bed_capacity,
          hf.beds_count,
          hf.ta_id,
          a3.name AS ta_name,
          hf.district_id,
          d.name AS district_name,
          hf.geom,
          ST_Buffer(hf.geom::geography, $1)::geometry AS buffer_geom
        FROM health_facilities hf
        LEFT JOIN admin3_units a3
          ON a3.id = hf.ta_id
        LEFT JOIN districts d
          ON d.id = hf.district_id
        ${facilityWhereClause}
      ),
      admin_scope AS (
        SELECT
          a3.id,
          a3.population_total,
          a3.geom
        FROM admin3_units a3
        WHERE a3.geom IS NOT NULL
      ),
      served_population AS (
        SELECT
          fs.facility_id,
          SUM(
            CASE
              WHEN ST_Area(ST_Transform(a3.geom, 3857)) > 0
                THEN COALESCE(a3.population_total, 0)
                  * ST_Area(
                      ST_Transform(
                        ST_Intersection(fs.buffer_geom, a3.geom),
                        3857
                      )
                    )
                  / ST_Area(ST_Transform(a3.geom, 3857))
              ELSE 0
            END
          ) AS served_population_est
        FROM facility_scope fs
        JOIN admin_scope a3
          ON ST_Intersects(fs.buffer_geom, a3.geom)
        GROUP BY fs.facility_id
      ),
      welfare_access AS (
        SELECT
          fs.facility_id,
          COUNT(wb.id) AS welfare_beneficiaries_within_buffer
        FROM facility_scope fs
        LEFT JOIN welfare_beneficiary wb
          ON wb.geom IS NOT NULL
         AND ST_Intersects(wb.geom, fs.buffer_geom)
        GROUP BY fs.facility_id
      ),
      network_access AS (
        SELECT
          travel.facility_id,
          COUNT(travel.beneficiary_id) FILTER (
            WHERE travel.routing_status = 'routed'
              AND travel.network_distance_km IS NOT NULL
              AND travel.network_distance_km <= 8
          ) AS welfare_beneficiaries_served_by_8km_network,
          AVG(travel.network_distance_km) FILTER (
            WHERE travel.routing_status = 'routed'
              AND travel.network_distance_km IS NOT NULL
          ) AS avg_network_distance_km,
          AVG(travel.travel_time_min) FILTER (
            WHERE travel.routing_status = 'routed'
              AND travel.travel_time_min IS NOT NULL
          ) AS avg_travel_time_min
        FROM beneficiary_facility_travel travel
        WHERE travel.facility_type = 'health'
        GROUP BY travel.facility_id
      ),
      flood_latest AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_facility_exposure
        WHERE LOWER(facility_type) = LOWER('health')
      ),
      flood_exposure AS (
        SELECT
          ffe.facility_id,
          ffe.risk_class,
          ffe.is_exposed,
          ffe.analysis_date
        FROM flood_facility_exposure ffe
        JOIN flood_latest fl
          ON ffe.analysis_date = fl.analysis_date
        WHERE LOWER(ffe.facility_type) = LOWER('health')
      ),
      nearest_facility AS (
        SELECT
          fs.facility_id,
          MIN(
            ST_Distance(fs.geom::geography, hf2.geom::geography)
          ) AS nearest_distance_m
        FROM facility_scope fs
        JOIN health_facilities hf2
          ON hf2.geom IS NOT NULL
         AND hf2.id <> fs.facility_id
        GROUP BY fs.facility_id
      )
      SELECT
        fs.facility_id,
        fs.facility_name,
        fs.facility_type,
        fs.ownership,
        fs.capacity_persons,
        fs.doctor_count,
        fs.nurse_midwife_count,
        fs.patient_visits_total,
        fs.bed_capacity,
        fs.beds_count,
        fs.ta_id,
        fs.ta_name,
        fs.district_id,
        fs.district_name,
        ST_AsGeoJSON(fs.geom)::jsonb AS geom,
        COALESCE(${hasFacilityAccessMetricsTable ? "ham.worldpop_population_within_buffer" : "sp.served_population_est"}, 0) AS served_population_est,
        COALESCE(${hasFacilityAccessMetricsTable ? "ham.worldpop_population_within_buffer" : "sp.served_population_est"}, 0) AS worldpop_population_within_8km_buffer,
        COALESCE(wa.welfare_beneficiaries_within_buffer, 0) AS welfare_beneficiaries_within_buffer,
        COALESCE(${hasFacilityAccessMetricsTable ? "ham.welfare_beneficiaries_served_by_8km_network" : "na.welfare_beneficiaries_served_by_8km_network"}, 0) AS welfare_beneficiaries_served_by_8km_network,
        COALESCE(${hasFacilityAccessMetricsTable ? "ham.avg_network_distance_km" : "na.avg_network_distance_km"}, 0) AS avg_network_distance_km,
        COALESCE(${hasFacilityAccessMetricsTable ? "ham.avg_travel_time_min" : "na.avg_travel_time_min"}, 0) AS avg_travel_time_min,
        'buffer_based'::text AS buffer_metric_type,
        'network_distance_km<=8'::text AS network_metric_type,
        fe.risk_class AS flood_risk_class,
        COALESCE(fe.is_exposed, FALSE) AS flood_is_exposed,
        fe.analysis_date AS flood_analysis_date,
        COALESCE(nf.nearest_distance_m, 0) / 1000.0 AS nearest_facility_distance_km,
        $1 / 1000.0 AS coverage_distance_km
      FROM facility_scope fs
      LEFT JOIN served_population sp
        ON sp.facility_id = fs.facility_id
      LEFT JOIN welfare_access wa
        ON wa.facility_id = fs.facility_id
      LEFT JOIN network_access na
        ON na.facility_id = fs.facility_id
      ${
        hasFacilityAccessMetricsTable
          ? `LEFT JOIN health_facility_access_metrics ham
        ON ham.facility_id = fs.facility_id`
          : ""
      }
      LEFT JOIN flood_exposure fe
        ON fe.facility_id = fs.facility_id
      LEFT JOIN nearest_facility nf
        ON nf.facility_id = fs.facility_id
      ORDER BY fs.district_name, fs.ta_name, fs.facility_name;
    `;

    const facilitiesResult = await db.query(facilityQuery, facilityParams);

    const summaryConditions = ["a3.geom IS NOT NULL"];
    const summaryParams = [];
    appendDistrictNameCondition(
      summaryConditions,
      summaryParams,
      "d.name",
      district,
    );
    const summaryWhereClause = summaryConditions.length
      ? `WHERE ${summaryConditions.join(" AND ")}`
      : "";

    const taQuery = `
      WITH ta_base AS (
        SELECT
          a3.id AS ta_id,
          a3.name AS ta_name,
          d.name AS district_name,
          COALESCE(a3.population_total, 0) AS population_total,
          COUNT(hf.id) AS facility_count
        FROM admin3_units a3
        LEFT JOIN districts d
          ON d.id = a3.district_id
        LEFT JOIN health_facilities hf
          ON hf.ta_id = a3.id
        ${summaryWhereClause}
        GROUP BY a3.id, a3.name, d.name, a3.population_total
      ),
      coverage AS (
        SELECT
          admin_unit_id,
          MAX(CASE WHEN metric_name = 'health_population_served_total' THEN metric_value END) AS health_population_served_total,
          MAX(CASE WHEN metric_name = 'health_population_served_pct' THEN metric_value END) AS health_population_served_pct
        FROM analysis_results
        WHERE analysis_type = 'health_population_served'
          AND LOWER(admin_unit_type) = LOWER('TA')
        GROUP BY admin_unit_id
      ),
      ta_metrics AS (
        SELECT
          tb.ta_id,
          tb.ta_name,
          tb.district_name,
          tb.population_total,
          tb.facility_count,
          COALESCE(c.health_population_served_total, 0) AS health_population_served_total,
          COALESCE(c.health_population_served_pct, 0) AS health_population_served_pct,
          CASE
            WHEN tb.facility_count > 0
              THEN tb.population_total / tb.facility_count
            ELSE NULL
          END AS population_per_facility
        FROM ta_base tb
        LEFT JOIN coverage c
          ON c.admin_unit_id = tb.ta_id
      )
      SELECT
        ta_metrics.*,
        percent_rank() OVER (ORDER BY population_per_facility) AS population_per_facility_percentile,
        percent_rank() OVER (ORDER BY health_population_served_pct) AS coverage_percentile,
        CASE
          WHEN population_per_facility IS NOT NULL AND population_per_facility > 10000
            THEN TRUE
          ELSE FALSE
        END AS gap_population_per_facility
      FROM ta_metrics
      ORDER BY district_name, ta_name;
    `;

    const taResult = await db.query(taQuery, summaryParams);

    const summary = taResult.rows.reduce(
      (accumulator, row) => {
        accumulator.population_total += Number(row.population_total || 0);
        accumulator.facility_count += Number(row.facility_count || 0);
        accumulator.health_population_served_total += Number(
          row.health_population_served_total || 0,
        );
        return accumulator;
      },
      {
        population_total: 0,
        facility_count: 0,
        health_population_served_total: 0,
      },
    );

    summary.population_per_facility = summary.facility_count
      ? summary.population_total / summary.facility_count
      : null;
    summary.health_population_served_pct = summary.population_total
      ? (summary.health_population_served_total * 100.0) /
        summary.population_total
      : 0;
    summary.gap_population_per_facility =
      summary.population_per_facility !== null &&
      summary.population_per_facility > 10000;

    res.json({
      status: "success",
      data: {
        admin_type: normalizedAdminType,
        district: district || null,
        ta: ta || null,
        coverage_distance_km: bufferKm,
        summary,
        ta_breakdown: normalizedAdminType === "District" ? taResult.rows : [],
        facilities: facilitiesResult.rows,
      },
    });
  } catch (err) {
    console.error("Health drilldown error", {
      message: err.message,
      district,
      ta,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/health/analytics/ta
// @desc    Get aggregated TA-level deep-dive analytics
router.get("/analytics/ta", async (req, res) => {
  const { district } = req.query;
  try {
    const query = `
      SELECT 
          admin_unit_name,
          MAX(CASE WHEN analysis_type = 'health_welfare_vulnerability' THEN metric_value END) as vulnerability_score,
          MAX(CASE WHEN analysis_type = 'health_welfare_vulnerability' THEN (metadata->>'raw_beneficiary_count')::numeric END) as beneficiary_count,
          MAX(CASE WHEN analysis_type = 'health_flood_isolation' THEN metric_value END) as flood_isolation_risk,
          MAX(CASE WHEN analysis_type = 'school_health_gap' THEN (metadata->>'student_enrolment_affected')::numeric END) as student_enrolment_affected,
          MAX(CASE WHEN analysis_type = 'school_health_gap' THEN metric_value END) as avg_distance_to_health
      FROM analysis_results
      WHERE analysis_type IN ('health_welfare_vulnerability', 'health_flood_isolation', 'school_health_gap')
        AND LOWER(admin_unit_type) = 'ta'
      GROUP BY admin_unit_name
      ORDER BY vulnerability_score DESC NULLS LAST;
    `;
    const result = await db.query(query);
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    console.error("TA Analytics Error:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

// @route   GET api/v1/dashboard/health/analytics/facility
// @desc    Get Facility-level deep-dive analytics (Burden)
router.get("/analytics/facility", async (req, res) => {
  try {
    const query = `
      SELECT 
        hf.name as facility_name,
        COALESCE(hf.doctor_count, 0) + COALESCE(hf.nurse_midwife_count, 0) as staff_count,
        hf.beds_count,
        COALESCE(am.worldpop_population_within_buffer, 0) as catchment_population
      FROM health_facilities hf
      LEFT JOIN health_facility_access_metrics am ON hf.id = am.facility_id AND am.coverage_distance_km = 8
      WHERE hf.geom IS NOT NULL
    `;
    const result = await db.query(query);
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    console.error("Facility Analytics Error:", err);
    res.status(500).json({ status: "error", message: "Server error" });
  }
});

module.exports = router;
