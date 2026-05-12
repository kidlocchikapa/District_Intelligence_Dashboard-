const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
  resolveDistrictFilterValues,
  buildCanonicalDistrictExpression,
} = require("./queryFilters");

function parseNumericValue(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) {
    return 0;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAdminType(adminType) {
  if (!adminType) return "District";
  const normalized = String(adminType).trim().toLowerCase();
  if (normalized === "district") return "District";
  if (normalized === "ta" || normalized === "admin3") return "TA";
  if (normalized === "village") return "Village";
  return String(adminType).trim();
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
  return (
    source
      .map((value) =>
        String(value || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      )
      .filter(Boolean)
      .join("-") || "malawi"
  );
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

function computeQuantile(values, quantile) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return (
    sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight
  );
}

function buildEducationThresholds(rows) {
  const schoolsPer10kValues = rows
    .filter((row) => row.population_total > 0)
    .map((row) => row.schools_per_10k)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const studentsPerSchoolValues = rows
    .filter((row) => row.students_per_school > 0)
    .map((row) => row.students_per_school)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const populationValues = rows
    .map((row) => row.population_total)
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    schools_per_10k_low: computeQuantile(schoolsPer10kValues, 0.33),
    schools_per_10k_high: computeQuantile(schoolsPer10kValues, 0.67),
    students_per_school_low: computeQuantile(studentsPerSchoolValues, 0.33),
    students_per_school_high: computeQuantile(studentsPerSchoolValues, 0.67),
    population_high: computeQuantile(populationValues, 0.67),
  };
}

function classifyEducationDistrict(row, thresholds) {
  const isUnderserved = row.schools_per_10k <= thresholds.schools_per_10k_low;
  const isOvercrowded =
    row.students_per_school >= thresholds.students_per_school_high;
  const isUnderutilized =
    row.schools_per_10k >= thresholds.schools_per_10k_high &&
    row.students_per_school <= thresholds.students_per_school_low;

  let classification = "adequate";
  if (isUnderserved) {
    classification = "underserved";
  } else if (isOvercrowded) {
    classification = "overcrowded";
  }

  let insight = "balanced capacity";
  if (row.population_total >= thresholds.population_high && isUnderserved) {
    insight = "infrastructure gap";
  } else if (isOvercrowded) {
    insight = "overcrowding risk";
  } else if (isUnderutilized) {
    insight = "underutilized schools";
  }

  return {
    ...row,
    classification,
    classification_label: classification.replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    ),
    insight,
    insight_label: insight.replace(/\b\w/g, (letter) => letter.toUpperCase()),
  };
}

function summarizeEducationInsights(rows) {
  return rows.reduce(
    (summary, row) => {
      summary.total_districts += 1;

      if (row.classification === "underserved") {
        summary.underserved_count += 1;
      } else if (row.classification === "overcrowded") {
        summary.overcrowded_count += 1;
      } else {
        summary.adequate_count += 1;
      }

      if (row.insight === "infrastructure gap") {
        summary.infrastructure_gap_count += 1;
      } else if (row.insight === "overcrowding risk") {
        summary.overcrowding_risk_count += 1;
      } else if (row.insight === "underutilized schools") {
        summary.underutilized_count += 1;
      }

      return summary;
    },
    {
      total_districts: 0,
      underserved_count: 0,
      overcrowded_count: 0,
      adequate_count: 0,
      infrastructure_gap_count: 0,
      overcrowding_risk_count: 0,
      underutilized_count: 0,
    },
  );
}

// @route   GET api/v1/dashboard/education
// @desc    Get education facility locations (GeoJSON)
/**
 * @openapi
 * /api/v1/dashboard/education:
 *   get:
 *     summary: Get education facility locations as GeoJSON
 *     tags:
 *       - Education
 *     responses:
 *       200:
 *         description: Education facilities GeoJSON
 */
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    if (district) {
      params.push(
        String(district).trim().toLowerCase().startsWith("zomba")
          ? "zomba"
          : String(district).trim().toLowerCase(),
      );
      conditions.push(
        `${buildCanonicalDistrictExpression(
          "COALESCE(direct_district.name, spatial_district.name, '')",
        )} = $${params.length}`,
      );
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const query = `
            SELECT jsonb_build_object(
                'type',     'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
              SELECT jsonb_build_object(
                'type',       'Feature',
                'id',         ef.school_id,
                'geometry',   ST_AsGeoJSON(ef.geom)::jsonb,
                'properties', (
                  (to_jsonb(ef) - 'geom')
                  || jsonb_build_object(
                      'name', COALESCE(ef.school_name, ''),
                      'school_name', ef.school_name,
                      'operator_type', ef.operator,
                      'status', ef.status,
                      'student_enrollment_total', ef.student_enrollment_total,
                      'teacher_distribution', ef.teacher_distribution,
                      'teacher_count', ef.teacher_count,
                      'ward_id', ef.ta_id,
                      'ta_id', ef.ta_id,
                      'district_id', ef.district_id
                  )
                )
              ) AS feature
              FROM education_facilities ef
              LEFT JOIN districts direct_district
                ON direct_district.id = ef.district_id
              LEFT JOIN districts spatial_district
                ON spatial_district.geom IS NOT NULL
               AND ef.geom IS NOT NULL
               AND ST_Intersects(ef.geom, spatial_district.geom)
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

// @route   GET api/v1/dashboard/education/service-coverage/geojson
// @desc    Get education school service coverage results as GeoJSON
/**
 * @openapi
 * /api/v1/dashboard/education/service-coverage/geojson:
 *   get:
 *     summary: Get education service coverage as GeoJSON
 *     tags:
 *       - Education
 *     responses:
 *       200:
 *         description: Service coverage GeoJSON
 */
router.get("/service-coverage/geojson", async (req, res) => {
  const { district, admin_type: adminType = "District" } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [
      "ar.analysis_type = 'school_service_coverage'",
      "ar.metric_name = 'school_service_coverage_pct'",
      "LOWER(ar.admin_unit_type) = LOWER($1)",
    ];
    const params = [normalizedAdminType];

    appendDistrictNameCondition(
      conditions,
      params,
      "ar.admin_unit_name",
      district,
    );

    const query = `
      SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
          SELECT jsonb_build_object(
              'type', 'Feature',
              'id', ar.id,
              'geometry', ST_AsGeoJSON(COALESCE(ar.geom, d.geom, a3.geom))::jsonb,
              'properties', (
                  jsonb_build_object(
                    'analysis_type', ar.analysis_type,
                    'admin_unit_id', ar.admin_unit_id,
                    'admin_unit_code', ar.admin_unit_code,
                    'admin_unit_name', ar.admin_unit_name,
                    'admin_unit_type', ar.admin_unit_type,
                    'metric_name', ar.metric_name,
                    'metric_value', ar.metric_value,
                    'metric_unit', ar.metric_unit,
                    'metadata', ar.metadata,
                    'calculated_at', ar.calculated_at
                  ) || jsonb_build_object(ar.metric_name, ar.metric_value)
              )
          ) AS feature
          FROM analysis_results ar
          LEFT JOIN districts d
            ON LOWER(ar.admin_unit_type) = LOWER('District')
           AND d.id = ar.admin_unit_id
          LEFT JOIN admin3_units a3
            ON LOWER(ar.admin_unit_type) IN (LOWER('TA'), LOWER('Village'), LOWER('Admin3'))
           AND a3.id = ar.admin_unit_id
          WHERE COALESCE(ar.geom, d.geom, a3.geom) IS NOT NULL
            AND ${conditions.join(" AND ")}
          ORDER BY ar.admin_unit_name
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
    console.error("Education service coverage geojson error", {
      message: err.message,
      district,
      adminType: normalizedAdminType,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/education/access-zones/geojson
// @desc    Get served/unserved education access zones plus school points
/**
 * @openapi
 * /api/v1/dashboard/education/access-zones/geojson:
 *   get:
 *     summary: Get education access zones as GeoJSON
 *     tags:
 *       - Education
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
      : 5;
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
      school_scope AS (
        SELECT
          ef.school_id,
          COALESCE(ef.school_name, '') AS school_name,
          ef.geom
        FROM education_facilities ef
        JOIN district_ids di
          ON ef.geom IS NOT NULL
         AND ST_Intersects(ef.geom, di.geom)
        WHERE ef.geom IS NOT NULL
      ),
      school_buffers AS (
        SELECT
          ST_UnaryUnion(
            ST_Collect(ST_Buffer(ss.geom::geography, $1)::geometry)
          ) AS geom
        FROM school_scope ss
      ),
      zone_raw AS (
        SELECT
          a3.id AS admin_unit_id,
          a3.name AS admin_unit_name,
          a3.district_name AS district_name,
          a3.geom AS admin_unit_geom,
          sb.geom AS buffer_geom
        FROM admin3_scope a3
        LEFT JOIN school_buffers sb ON TRUE
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
          'id', CONCAT('school-', ss.school_id),
          'geometry', ST_AsGeoJSON(ss.geom)::jsonb,
          'properties', jsonb_build_object(
            'zone_type', 'school_point',
            'school_id', ss.school_id,
            'school_name', ss.school_name,
            'coverage_distance_km', $1 / 1000.0
          )
        ) AS feature
        FROM school_scope ss
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
    console.error("Education access zones geojson error", {
      message: err.message,
      district,
      bufferKm,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/education/facility-buffers/geojson
// @desc    Get school buffer polygons with buffer-based and network-based metrics
router.get("/facility-buffers/geojson", async (req, res) => {
  const { district, ta, buffer_km: bufferKmParam } = req.query;
  const parsedBufferKm = Number(bufferKmParam);
  const fallbackBufferKm =
    Number.isFinite(parsedBufferKm) && parsedBufferKm > 0
      ? Math.min(parsedBufferKm, 30)
      : 5;
  const hasMetricsTable = await tableExists("education_facility_access_metrics");

  try {
    const params = [fallbackBufferKm];
    const conditions = ["ef.geom IS NOT NULL"];
    appendDistrictGeometryCondition(conditions, params, "ef.geom", district);
    appendOptionalTaCondition(conditions, params, "a3.name", ta);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const metricsJoin = hasMetricsTable
      ? `
        LEFT JOIN education_facility_access_metrics eam
          ON eam.facility_id = ef.school_id
      `
      : "";
    const metricsFields = hasMetricsTable
      ? `
        'worldpop_population_within_buffer', COALESCE(eam.worldpop_population_within_buffer, 0),
        'welfare_beneficiaries_within_buffer', COALESCE(eam.welfare_beneficiaries_within_buffer, 0),
        'avg_network_distance_km', eam.avg_network_distance_km,
        'avg_travel_time_min', eam.avg_travel_time_min,
      `
      : `
        'worldpop_population_within_buffer', NULL,
        'welfare_beneficiaries_within_buffer', NULL,
        'avg_network_distance_km', NULL,
        'avg_travel_time_min', NULL,
      `;
    const bufferDistanceExpr = hasMetricsTable
      ? "COALESCE(eam.coverage_distance_km, $1)"
      : "$1";

    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT('school-buffer-', ef.school_id),
          'geometry', ST_AsGeoJSON(
            ST_Buffer(ef.geom::geography, (${bufferDistanceExpr}) * 1000)::geometry
          )::jsonb,
          'properties', jsonb_build_object(
            'school_id', ef.school_id,
            'school_name', ef.school_name,
            'name', ef.school_name,
            'operator_type', ef.operator,
            'status', ef.status,
            'ta_name', a3.name,
            'district_name', d.name,
            'coverage_distance_km', ${bufferDistanceExpr},
            ${metricsFields}
            'metric_source', ${hasMetricsTable ? "'education_facility_access_metrics'" : "'not_calculated'"}
          )
        ) AS feature
        FROM education_facilities ef
        LEFT JOIN admin3_units a3
          ON a3.id = ef.ta_id
        LEFT JOIN districts d
          ON d.id = ef.district_id
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
    console.error("Education facility buffers geojson error", {
      message: err.message,
      district,
      ta,
      fallbackBufferKm,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/education/summary
// @desc    Get ward/district education aggregates
/**
 * @openapi
 * /api/v1/dashboard/education/summary:
 *   get:
 *     summary: Get education summary metrics
 *     tags:
 *       - Education
 *     responses:
 *       200:
 *         description: Education summary
 */
router.get("/summary", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["ef.geom IS NOT NULL"];
    const params = [];
    if (district) {
      params.push(
        String(district).trim().toLowerCase().startsWith("zomba")
          ? "zomba"
          : String(district).trim().toLowerCase(),
      );
      conditions.push(
        `${buildCanonicalDistrictExpression(
          "COALESCE(direct_district.name, spatial_district.name, '')",
        )} = $${params.length}`,
      );
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const result = await db.query(
      `
        SELECT
          school_id,
          student_enrollment_total,
          teacher_count,
          teacher_distribution
        FROM education_facilities ef
        LEFT JOIN districts direct_district
          ON direct_district.id = ef.district_id
        LEFT JOIN districts spatial_district
          ON spatial_district.geom IS NOT NULL
         AND ef.geom IS NOT NULL
         AND ST_Intersects(ef.geom, spatial_district.geom)
        ${whereClause}
      `,
      params,
    );

    const facilityTotals = result.rows.reduce(
      (accumulator, row) => {
        accumulator.school_count += 1;
        accumulator.student_enrollment_total += parseNumericValue(
          row.student_enrollment_total,
        );
        accumulator.teacher_count_total += parseNumericValue(
          row.teacher_count ?? row.teacher_distribution,
        );
        return accumulator;
      },
      {
        school_count: 0,
        student_enrollment_total: 0,
        teacher_count_total: 0,
      },
    );

    const worldpopConditions = [
      "admin_unit_type = $1",
      "worldpop_year = (SELECT MAX(worldpop_year) FROM worldpop_age_sex)",
    ];
    const worldpopParams = ["District"];
    appendDistrictNameCondition(
      worldpopConditions,
      worldpopParams,
      "admin_unit_name",
      district,
    );

    const worldpopResult = await db.query(
      `
        SELECT COALESCE(
          SUM(
            COALESCE(
              total_population,
              0
            )
            * GREATEST(
                LEAST(
                  COALESCE(
                    NULLIF(REGEXP_REPLACE(COALESCE(age_class, ''), '[^0-9.]', '', 'g'), '')::numeric,
                    -9999
                  ) + 5,
                  18
                )
                - GREATEST(
                  COALESCE(
                    NULLIF(REGEXP_REPLACE(COALESCE(age_class, ''), '[^0-9.]', '', 'g'), '')::numeric,
                    -9999
                  ),
                  5
                ),
                0
              )
            / 5.0
          ),
          0
        ) AS school_age_population_total
        FROM worldpop_age_sex
        WHERE ${worldpopConditions.join(" AND ")}
      `,
      worldpopParams,
    );
    const schoolAgePopulationTotal = parseNumericValue(
      worldpopResult.rows[0]?.school_age_population_total,
    );
    const notInSchoolTotal = Math.max(
      schoolAgePopulationTotal - facilityTotals.student_enrollment_total,
      0,
    );

    res.json({
      status: "success",
      data: {
        ...facilityTotals,
        school_age_population_total: Math.round(schoolAgePopulationTotal),
        not_in_school_total: Math.round(notInSchoolTotal),
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/education/raster-metadata
// @desc    Get static raster metadata descriptors for education access visualizations
router.get("/raster-metadata", async (req, res) => {
  const { district } = req.query;
  const slug = buildRasterSlug(district);

  res.json({
    status: "success",
    data: {
      district: district || null,
      assets: {
        education_network_distance: `/education-access/${slug}.education_network_distance.preview.json`,
        education_travel_time: `/education-access/${slug}.education_travel_time.preview.json`,
      },
    },
  });
});

// @route   GET api/v1/dashboard/education/insights
// @desc    Get district education access and utilization insights
/**
 * @openapi
 * /api/v1/dashboard/education/insights:
 *   get:
 *     summary: Get education insights
 *     tags:
 *       - Education
 *     responses:
 *       200:
 *         description: Education insights
 */
router.get("/insights", async (req, res) => {
  const { district } = req.query;

  try {
    const params = [];
    const conditions = ["LOWER(a3.type) IN ('ta', 'ward', 'admin3')"];
    appendDistrictNameCondition(conditions, params, "d.name", district);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const result = await db.query(
      `
      WITH school_age AS (
        SELECT
          admin_unit_id,
          SUM(COALESCE(total_population, 0)) AS population_total,
          SUM(
            COALESCE(
              total_population,
              0
            )
            * GREATEST(
                LEAST(
                  COALESCE(
                    NULLIF(REGEXP_REPLACE(COALESCE(age_class, ''), '[^0-9.]', '', 'g'), '')::numeric,
                    -9999
                  ) + 5,
                  18
                )
                - GREATEST(
                  COALESCE(
                    NULLIF(REGEXP_REPLACE(COALESCE(age_class, ''), '[^0-9.]', '', 'g'), '')::numeric,
                    -9999
                  ),
                  5
                ),
                0
              )
            / 5.0
          ) AS school_age_population_total
        FROM worldpop_age_sex
        WHERE admin_unit_type = 'TA'
          AND worldpop_year = (SELECT MAX(worldpop_year) FROM worldpop_age_sex)
        GROUP BY admin_unit_id
      )
      SELECT
        a3.id AS admin_unit_id,
        a3.code AS admin_unit_code,
        a3.name AS admin_unit_name,
        d.name AS district,
        COALESCE(NULLIF(a3.population_total, 0), sa.population_total, 0) AS population_total,
        COALESCE(sa.school_age_population_total, 0) AS school_age_population_total,
        COUNT(ef.school_id) AS school_count,
        COALESCE(
          SUM(
            COALESCE(
              NULLIF(TRIM(COALESCE(ef.student_enrollment_total::text, '')), '')::numeric,
              0
            )
          ),
          0
        ) AS student_enrollment_total,
        COALESCE(
          SUM(
            COALESCE(
              NULLIF(TRIM(COALESCE(ef.teacher_count::text, '')), '')::numeric,
              NULLIF(REGEXP_REPLACE(COALESCE(ef.teacher_distribution::text, ''), '[^0-9.]', '', 'g'), '')::numeric,
              0
            )
          ),
          0
        ) AS teacher_count_total
      FROM admin3_units a3
      LEFT JOIN districts d
          ON d.id = a3.district_id
      LEFT JOIN school_age sa
          ON sa.admin_unit_id = a3.id
      LEFT JOIN education_facilities ef
          ON a3.geom IS NOT NULL
       AND ef.geom IS NOT NULL
         AND ST_Intersects(ef.geom, a3.geom)
      ${whereClause}
      GROUP BY
        a3.id,
        a3.code,
        a3.name,
        d.name,
        a3.population_total,
        sa.population_total,
        sa.school_age_population_total
      ORDER BY d.name, a3.name
    `,
      params,
    );

    const thresholds = buildEducationThresholds(
      result.rows.map((row) => {
        const schoolCount = toFiniteNumber(row.school_count);
        const populationTotal = toFiniteNumber(row.population_total);
        const schoolAgePopulationTotal = toFiniteNumber(
          row.school_age_population_total,
        );
        const studentEnrollmentTotal = toFiniteNumber(
          row.student_enrollment_total,
        );

        return {
          schools_per_10k: populationTotal
            ? (schoolCount / populationTotal) * 10000
            : 0,
          students_per_school: schoolCount
            ? studentEnrollmentTotal / schoolCount
            : 0,
          population_total: populationTotal,
        };
      }),
    );

    const insightPriority = {
      "infrastructure gap": 0,
      "overcrowding risk": 1,
      "underutilized schools": 2,
      "balanced capacity": 3,
    };

    const allDistrictInsights = result.rows
      .map((row) => {
        const schoolCount = toFiniteNumber(row.school_count);
        const populationTotal = toFiniteNumber(row.population_total);
        const schoolAgePopulationTotal = toFiniteNumber(
          row.school_age_population_total,
        );
        const studentEnrollmentTotal = toFiniteNumber(
          row.student_enrollment_total,
        );
        const teacherCountTotal = toFiniteNumber(row.teacher_count_total);

        return classifyEducationDistrict(
          {
            admin_unit_id: row.admin_unit_id,
            admin_unit_code: row.admin_unit_code,
            admin_unit_name: row.admin_unit_name,
            district: row.district,
            population_total: populationTotal,
            school_age_population_total: schoolAgePopulationTotal,
            school_count: schoolCount,
            student_enrollment_total: studentEnrollmentTotal,
            teacher_count_total: teacherCountTotal,
            schools_per_10k: populationTotal
              ? (schoolCount / populationTotal) * 10000
              : 0,
            schools_per_children: schoolAgePopulationTotal
              ? schoolCount / schoolAgePopulationTotal
              : 0,
            students_per_school: schoolCount
              ? studentEnrollmentTotal / schoolCount
              : 0,
          },
          thresholds,
        );
      })
      .filter(
        (row) =>
          row.population_total > 0 ||
          row.school_age_population_total > 0 ||
          row.school_count > 0 ||
          row.student_enrollment_total > 0,
      )
      .sort((left, right) => {
        const insightOrder =
          (insightPriority[left.insight] ?? 99) -
          (insightPriority[right.insight] ?? 99);
        if (insightOrder !== 0) {
          return insightOrder;
        }

        if (left.schools_per_10k !== right.schools_per_10k) {
          return left.schools_per_10k - right.schools_per_10k;
        }

        return right.students_per_school - left.students_per_school;
      });

    const selectedDistrictValues = resolveDistrictFilterValues(district).map(
      (value) => value.toLowerCase(),
    );
    const visibleDistrictInsights = selectedDistrictValues.length
      ? allDistrictInsights.filter((row) =>
          selectedDistrictValues.includes(row.district.toLowerCase()),
        )
      : allDistrictInsights;

    res.json({
      status: "success",
      data: {
        all_districts: allDistrictInsights,
        districts: visibleDistrictInsights,
        summary: summarizeEducationInsights(allDistrictInsights),
        visible_summary: summarizeEducationInsights(visibleDistrictInsights),
        thresholds,
        selected_district: district || null,
      },
    });
  } catch (err) {
    console.error("Education insights query error", {
      message: err.message,
      code: err.code,
      detail: err.detail,
      hint: err.hint,
      where: err.where,
      position: err.position,
      routine: err.routine,
    });
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/education/drilldown
// @desc    Get education drilldown summary, TA breakdown, and facility-level details
/**
 * @openapi
 * /api/v1/dashboard/education/drilldown:
 *   get:
 *     summary: Get education drilldown statistics
 *     tags:
 *       - Education
 *     responses:
 *       200:
 *         description: Education drilldown
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
      : 5;
  const bufferMeters = bufferKm * 1000;

  try {
    const facilityParams = [bufferMeters];
    const facilityConditions = ["ef.geom IS NOT NULL"];
    appendDistrictGeometryCondition(
      facilityConditions,
      facilityParams,
      "ef.geom",
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
          ef.school_id AS facility_id,
          COALESCE(ef.school_name, '') AS facility_name,
          ef.operator AS operator,
          ef.status AS status,
          ef.student_enrollment_total,
          ef.teacher_count,
          ef.teacher_distribution,
          ef.blocks_count,
          ef.ta_id,
          a3.name AS ta_name,
          ef.district_id,
          d.name AS district_name,
          ef.geom,
          ST_Buffer(ef.geom::geography, $1)::geometry AS buffer_geom
        FROM education_facilities ef
        LEFT JOIN admin3_units a3
          ON a3.id = ef.ta_id
        LEFT JOIN districts d
          ON d.id = ef.district_id
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
      flood_latest AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_facility_exposure
        WHERE LOWER(facility_type) = LOWER('education')
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
        WHERE LOWER(ffe.facility_type) = LOWER('education')
      ),
      nearest_facility AS (
        SELECT
          fs.facility_id,
          MIN(
            ST_Distance(fs.geom::geography, ef2.geom::geography)
          ) AS nearest_distance_m
        FROM facility_scope fs
        JOIN education_facilities ef2
          ON ef2.geom IS NOT NULL
         AND ef2.school_id <> fs.facility_id
        GROUP BY fs.facility_id
      )
      SELECT
        fs.facility_id,
        fs.facility_name,
        fs.operator,
        fs.status,
        fs.student_enrollment_total,
        fs.teacher_count,
        fs.teacher_distribution,
        fs.blocks_count,
        fs.ta_id,
        fs.ta_name,
        fs.district_id,
        fs.district_name,
        ST_AsGeoJSON(fs.geom)::jsonb AS geom,
        COALESCE(sp.served_population_est, 0) AS served_population_est,
        COALESCE(wa.welfare_beneficiaries_within_buffer, 0) AS welfare_beneficiaries_within_buffer,
        fe.risk_class AS flood_risk_class,
        COALESCE(fe.is_exposed, FALSE) AS flood_is_exposed,
        fe.analysis_date AS flood_analysis_date,
        COALESCE(nf.nearest_distance_m, 0) / 1000.0 AS nearest_facility_distance_km,
        CASE
          WHEN COALESCE(fs.teacher_count, fs.teacher_distribution, 0) > 0
            THEN COALESCE(fs.student_enrollment_total, 0)::numeric
              / COALESCE(fs.teacher_count, fs.teacher_distribution, 0)
          ELSE NULL
        END AS students_per_teacher,
        CASE
          WHEN COALESCE(fs.blocks_count, 0) > 0
            THEN COALESCE(fs.student_enrollment_total, 0)::numeric
              / COALESCE(fs.blocks_count, 0)
          ELSE NULL
        END AS students_per_block,
        CASE
          WHEN COALESCE(fs.teacher_count, fs.teacher_distribution, 0) > 0
            THEN COALESCE(fs.student_enrollment_total, 0)::numeric
              / COALESCE(fs.teacher_count, fs.teacher_distribution, 0)
              > 60
          ELSE NULL
        END AS gap_teacher_student_ratio,
        CASE
          WHEN COALESCE(fs.blocks_count, 0) > 0
            THEN COALESCE(fs.student_enrollment_total, 0)::numeric
              / COALESCE(fs.blocks_count, 0)
              > 40
          ELSE NULL
        END AS gap_block_capacity,
        $1 / 1000.0 AS coverage_distance_km
      FROM facility_scope fs
      LEFT JOIN served_population sp
        ON sp.facility_id = fs.facility_id
      LEFT JOIN welfare_access wa
        ON wa.facility_id = fs.facility_id
      LEFT JOIN flood_exposure fe
        ON fe.facility_id = fs.facility_id
      LEFT JOIN nearest_facility nf
        ON nf.facility_id = fs.facility_id
      ORDER BY fs.district_name, fs.ta_name, fs.facility_name;
    `;

    const facilitiesResult = await db.query(facilityQuery, facilityParams);

    const summaryConditions = [
      "a3.geom IS NOT NULL",
      "LOWER(a3.type) IN ('ta', 'ward', 'admin3')",
    ];
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
          COUNT(ef.school_id) AS facility_count,
          COALESCE(SUM(COALESCE(ef.student_enrollment_total, 0)), 0) AS student_enrollment_total,
          COALESCE(SUM(COALESCE(ef.teacher_count, ef.teacher_distribution, 0)), 0) AS teacher_count_total,
          COALESCE(SUM(COALESCE(ef.blocks_count, 0)), 0) AS blocks_count_total
        FROM admin3_units a3
        LEFT JOIN districts d
          ON d.id = a3.district_id
        LEFT JOIN education_facilities ef
          ON ef.ta_id = a3.id
        ${summaryWhereClause}
        GROUP BY a3.id, a3.name, d.name, a3.population_total
      ),
      coverage AS (
        SELECT
          admin_unit_id,
          MAX(CASE WHEN metric_name = 'school_service_coverage_pct' THEN metric_value END) AS school_service_coverage_pct
        FROM analysis_results
        WHERE analysis_type = 'school_service_coverage'
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
          tb.student_enrollment_total,
          tb.teacher_count_total,
          tb.blocks_count_total,
          COALESCE(c.school_service_coverage_pct, 0) AS school_service_coverage_pct,
          CASE
            WHEN tb.facility_count > 0
              THEN tb.population_total / tb.facility_count
            ELSE NULL
          END AS population_per_school,
          CASE
            WHEN tb.teacher_count_total > 0
              THEN tb.student_enrollment_total / tb.teacher_count_total
            ELSE NULL
          END AS students_per_teacher,
          CASE
            WHEN tb.blocks_count_total > 0
              THEN tb.student_enrollment_total / tb.blocks_count_total
            ELSE NULL
          END AS students_per_block
        FROM ta_base tb
        LEFT JOIN coverage c
          ON c.admin_unit_id = tb.ta_id
      )
      SELECT
        ta_metrics.*,
        percent_rank() OVER (ORDER BY population_per_school) AS population_per_school_percentile,
        percent_rank() OVER (ORDER BY school_service_coverage_pct) AS coverage_percentile,
        CASE
          WHEN population_per_school IS NOT NULL AND population_per_school > 1000
            THEN TRUE
          ELSE FALSE
        END AS gap_population_per_school,
        CASE
          WHEN students_per_teacher IS NOT NULL AND students_per_teacher > 60
            THEN TRUE
          ELSE FALSE
        END AS gap_teacher_student_ratio,
        CASE
          WHEN students_per_block IS NOT NULL AND students_per_block > 40
            THEN TRUE
          ELSE FALSE
        END AS gap_block_capacity
      FROM ta_metrics
      ORDER BY district_name, ta_name;
    `;

    const taResult = await db.query(taQuery, summaryParams);

    const summary = taResult.rows.reduce(
      (accumulator, row) => {
        accumulator.population_total += Number(row.population_total || 0);
        accumulator.facility_count += Number(row.facility_count || 0);
        accumulator.student_enrollment_total += Number(
          row.student_enrollment_total || 0,
        );
        accumulator.teacher_count_total += Number(row.teacher_count_total || 0);
        accumulator.blocks_count_total += Number(row.blocks_count_total || 0);
        return accumulator;
      },
      {
        population_total: 0,
        facility_count: 0,
        student_enrollment_total: 0,
        teacher_count_total: 0,
        blocks_count_total: 0,
      },
    );

    summary.population_per_school = summary.facility_count
      ? summary.population_total / summary.facility_count
      : null;
    summary.students_per_teacher = summary.teacher_count_total
      ? summary.student_enrollment_total / summary.teacher_count_total
      : null;
    summary.students_per_block = summary.blocks_count_total
      ? summary.student_enrollment_total / summary.blocks_count_total
      : null;
    summary.gap_population_per_school =
      summary.population_per_school !== null &&
      summary.population_per_school > 1000;
    summary.gap_teacher_student_ratio =
      summary.students_per_teacher !== null &&
      summary.students_per_teacher > 60;
    summary.gap_block_capacity =
      summary.students_per_block !== null && summary.students_per_block > 40;

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
    console.error("Education drilldown error", {
      message: err.message,
      district,
      ta,
    });
    res.status(500).send("Server error");
  }
});

module.exports = router;
