const express = require("express");
const path = require("path");
const router = express.Router();
const db = require("../db");
const {
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

function normalizeFacilityType(facilityType) {
  if (!facilityType) return null;
  const normalized = String(facilityType).trim().toLowerCase();
  if (normalized === "education" || normalized === "health") return normalized;
  return null;
}

function appendOptionalTaCondition(
  conditions,
  params,
  taColumnExpression,
  taName,
) {
  if (!taName) {
    return;
  }

  params.push(taName);
  conditions.push(`LOWER(${taColumnExpression}) = LOWER($${params.length})`);
}

function parseRunMetadata(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  return null;
}

function normalizePreviewAssetPath(filePath, publicDirName) {
  if (!filePath) {
    return null;
  }

  const value = String(filePath);
  const marker = `/${publicDirName}/`;
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    return value.slice(markerIndex);
  }

  const filename = path.basename(value);
  if (!filename) {
    return null;
  }

  return `/${publicDirName}/${filename}`;
}

async function fetchLatestFloodPreviewAsset(districtValues) {
  const baseQuery = `
    SELECT run_metadata, completed_at
    FROM data_load_log
    WHERE dataset_type = 'flood'
      AND status = 'Success'
  `;
  const orderClause = " ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1";
  let result = null;

  if (Array.isArray(districtValues) && districtValues.length) {
    result = await db.query(
      `${baseQuery} AND (run_metadata->'district_names' ?| $1)${orderClause}`,
      [districtValues],
    );
  }

  if (!result || !result.rows.length) {
    result = await db.query(`${baseQuery}${orderClause}`);
  }

  const row = result.rows[0] || {};
  const metadata = parseRunMetadata(row.run_metadata);
  const previewAssets = Array.isArray(metadata?.preview_assets)
    ? metadata.preview_assets
    : [];
  const previewAsset =
    previewAssets.find((asset) => asset?.key === "flood_risk_surface") ||
    previewAssets[0] ||
    null;

  return {
    assetUrl: normalizePreviewAssetPath(previewAsset?.json, "worldpop"),
    completedAt: row.completed_at || null,
  };
}

router.get("/flood/raster-metadata", async (req, res) => {
  const { district } = req.query;

  try {
    const districtValues = resolveDistrictFilterValues(district);
    const { assetUrl, completedAt } = await fetchLatestFloodPreviewAsset(
      districtValues,
    );

    return res.json({
      status: "success",
      data: {
        district: district || null,
        asset_url: assetUrl,
        completed_at: completedAt,
      },
    });
  } catch (error) {
    console.error("Disaster raster metadata error:", error.message);
    return res.json({
      status: "success",
      data: {
        district: district || null,
        asset_url: null,
        completed_at: null,
      },
    });
  }
});

async function getFloodGeoJson(req, res) {
  const { district, ta, admin_type: adminType = "District" } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const andWhereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const unitAggregationSql =
      normalizedAdminType === "TA"
        ? `
          SELECT
            src.ta_id AS unit_id,
            src.ta_name AS unit_name,
            'TA'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            SUM(src.exposed_area_sq_km) AS exposed_area_sq_km,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          WHERE src.ta_id <> 0
          ${andWhereClause}
          GROUP BY src.ta_id, src.ta_name, src.district_id, src.district_name
        `
        : `
          SELECT
            src.district_id AS unit_id,
            src.district_name AS unit_name,
            'District'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            SUM(src.exposed_area_sq_km) AS exposed_area_sq_km,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          ${whereClause}
          GROUP BY src.district_id, src.district_name
        `;

    const geometryJoinSql =
      normalizedAdminType === "TA"
        ? `
          JOIN admin3_units au
            ON au.id = agg.unit_id
           AND LOWER(au.type) = LOWER('TA')
           AND au.geom IS NOT NULL
        `
        : `
          JOIN districts au
            ON au.id = agg.unit_id
           AND au.geom IS NOT NULL
        `;

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_zones
      ),
      source_rows AS (
        SELECT fz.*
        FROM flood_zones fz
        JOIN latest_analysis la
          ON fz.analysis_date = la.analysis_date
        WHERE fz.ta_id <> 0
           OR NOT EXISTS (
             SELECT 1
             FROM flood_zones fz_ta
             WHERE fz_ta.analysis_date = la.analysis_date
               AND fz_ta.ta_id <> 0
           )
      ),
      agg AS (
        ${unitAggregationSql}
      )
      SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
          SELECT jsonb_build_object(
              'type', 'Feature',
              'id', agg.unit_id,
              'geometry', ST_AsGeoJSON(au.geom)::jsonb,
              'properties', jsonb_build_object(
                  'event_type', 'flood',
                  'admin_unit_id', agg.unit_id,
                  'admin_unit_name', agg.unit_name,
                  'admin_unit_type', agg.admin_unit_type,
                  'district_id', agg.district_id,
                  'district_name', agg.district_name,
                  'analysis_date', agg.analysis_date,
                  'total_population', agg.total_population,
                  'exposed_population', agg.exposed_population,
                  'not_exposed_population', GREATEST(COALESCE(agg.total_population, 0) - COALESCE(agg.exposed_population, 0), 0),
                  'low_risk_population', agg.low_risk_population,
                  'medium_risk_population', agg.medium_risk_population,
                  'high_risk_population', agg.high_risk_population,
                  'exposed_area_sq_km', agg.exposed_area_sq_km,
                  'exposed_population_pct', CASE
                    WHEN COALESCE(agg.total_population, 0) > 0
                      THEN (agg.exposed_population * 100.0 / agg.total_population)
                    ELSE 0
                  END,
                  'dominant_risk_class', CASE
                    WHEN COALESCE(agg.high_risk_population, 0) >= COALESCE(agg.medium_risk_population, 0)
                         AND COALESCE(agg.high_risk_population, 0) >= COALESCE(agg.low_risk_population, 0)
                      THEN 'high'
                    WHEN COALESCE(agg.medium_risk_population, 0) >= COALESCE(agg.low_risk_population, 0)
                      THEN 'medium'
                    ELSE 'low'
                  END,
                  'risk_level', CASE
                    WHEN COALESCE(agg.total_population, 0) = 0 THEN 'unknown'
                    WHEN (agg.high_risk_population * 100.0 / agg.total_population) >= 5 THEN 'high'
                    WHEN (agg.medium_risk_population * 100.0 / agg.total_population) >= 2 THEN 'medium'
                    ELSE 'low'
                  END
              )
          ) AS feature
          FROM agg
          ${geometryJoinSql}
          ORDER BY agg.unit_name
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
}

async function getFloodSummary(req, res) {
  const { district, ta, admin_type: adminType = "District" } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const andWhereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const unitTotalsSql =
      normalizedAdminType === "TA"
        ? `
          SELECT
            src.ta_id AS unit_id,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            SUM(src.exposed_area_sq_km) AS exposed_area_sq_km
          FROM source_rows src
          WHERE src.ta_id <> 0
            ${whereClause ? `AND (${conditions.join(" AND ")})` : ""}
          GROUP BY src.ta_id
        `
        : `
          SELECT
            src.district_id AS unit_id,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            SUM(src.exposed_area_sq_km) AS exposed_area_sq_km
          FROM source_rows src
          WHERE 1=1
            ${whereClause ? `AND (${conditions.join(" AND ")})` : ""}
          GROUP BY src.district_id
        `;

    const unitAreaSql =
      normalizedAdminType === "TA"
        ? `
          SELECT
            ut.unit_id,
            COALESCE((ST_Area(ST_Transform(a3.geom, 3857)) / 1000000.0), 0) AS unit_area_sq_km
          FROM unit_totals ut
          LEFT JOIN admin3_units a3
            ON a3.id = ut.unit_id
           AND LOWER(a3.type) = LOWER('TA')
           AND a3.geom IS NOT NULL
        `
        : `
          SELECT
            ut.unit_id,
            COALESCE(d.area_sq_km, (ST_Area(ST_Transform(d.geom, 3857)) / 1000000.0), 0) AS unit_area_sq_km
          FROM unit_totals ut
          LEFT JOIN districts d
            ON d.id = ut.unit_id
           AND d.geom IS NOT NULL
        `;

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_zones
      ),
      source_rows AS (
        SELECT fz.*
        FROM flood_zones fz
        JOIN latest_analysis la
          ON fz.analysis_date = la.analysis_date
        WHERE fz.ta_id <> 0
           OR NOT EXISTS (
             SELECT 1
             FROM flood_zones fz_ta
             WHERE fz_ta.analysis_date = la.analysis_date
               AND fz_ta.ta_id <> 0
           )
      ),
      unit_totals AS (
        ${unitTotalsSql}
      ),
      unit_areas AS (
        ${unitAreaSql}
      ),
      totals AS (
        SELECT
          COALESCE(SUM(ut.total_population), 0) AS total_population,
          COALESCE(SUM(ut.exposed_population), 0) AS exposed_population,
          COALESCE(SUM(ut.low_risk_population), 0) AS low_risk_population,
          COALESCE(SUM(ut.medium_risk_population), 0) AS medium_risk_population,
          COALESCE(SUM(ut.high_risk_population), 0) AS high_risk_population,
          COALESCE(SUM(ua.unit_area_sq_km), 0) AS total_area_sq_km,
          COALESCE(SUM(ut.exposed_area_sq_km), 0) AS exposed_area_sq_km,
          COUNT(*)::int AS unit_count
        FROM unit_totals ut
        LEFT JOIN unit_areas ua
          ON ua.unit_id = ut.unit_id
      )
      SELECT * FROM totals;
    `;

    const result = await db.query(query, params);
    const totals = result.rows[0] || {};
    const totalPopulation = Number(totals.total_population || 0);
    const exposedPopulation = Number(totals.exposed_population || 0);
    const lowRiskPopulation = Number(totals.low_risk_population || 0);
    const mediumRiskPopulation = Number(totals.medium_risk_population || 0);
    const highRiskPopulation = Number(totals.high_risk_population || 0);
    const notExposedPopulation = Math.max(
      totalPopulation - exposedPopulation,
      0,
    );
    const totalAreaSqKm = Number(totals.total_area_sq_km || 0);
    const exposedAreaSqKm = Number(totals.exposed_area_sq_km || 0);

    res.json({
      status: "success",
      data: {
        admin_unit_type: normalizedAdminType,
        unit_count: Number(totals.unit_count || 0),
        total_population: totalPopulation,
        exposed_population: exposedPopulation,
        not_exposed_population: notExposedPopulation,
        low_risk_population: lowRiskPopulation,
        medium_risk_population: mediumRiskPopulation,
        high_risk_population: highRiskPopulation,
        total_area_sq_km: totalAreaSqKm,
        exposed_area_sq_km: exposedAreaSqKm,
        exposed_population_pct:
          totalPopulation > 0 ? (exposedPopulation * 100) / totalPopulation : 0,
      },
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
}

// Compatibility route
/**
 * @openapi
 * /api/v1/dashboard/disaster:
 *   get:
 *     summary: Get flood exposure zones as GeoJSON
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood exposure GeoJSON
 */
router.get("/", getFloodGeoJson);

// @route   GET api/v1/dashboard/disaster/flood
// @desc    Get flood exposure zones (GeoJSON) for District or TA
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood:
 *   get:
 *     summary: Get flood exposure zones as GeoJSON
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood exposure GeoJSON
 */
router.get("/flood", getFloodGeoJson);

// Compatibility route
/**
 * @openapi
 * /api/v1/dashboard/disaster/summary:
 *   get:
 *     summary: Get flood risk summary totals
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood summary totals
 */
router.get("/summary", getFloodSummary);

// @route   GET api/v1/dashboard/disaster/flood/summary
// @desc    Get flood risk summary totals (exposed vs not exposed and risk bands)
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood/summary:
 *   get:
 *     summary: Get flood risk summary totals
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood summary totals
 */
router.get("/flood/summary", getFloodSummary);

// @route   GET api/v1/dashboard/disaster/flood/population
// @desc    Get tabular population exposure by District/TA
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood/population:
 *   get:
 *     summary: Get flood exposure by population
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood population exposure
 */
router.get("/flood/population", async (req, res) => {
  const { district, ta, admin_type: adminType = "District" } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const andWhereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const aggregationSql =
      normalizedAdminType === "TA"
        ? `
          SELECT
            src.ta_id AS admin_unit_id,
            src.ta_name AS admin_unit_name,
            'TA'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          WHERE src.ta_id <> 0
          ${andWhereClause}
          GROUP BY src.ta_id, src.ta_name, src.district_id, src.district_name
        `
        : `
          SELECT
            src.district_id AS admin_unit_id,
            src.district_name AS admin_unit_name,
            'District'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            SUM(src.total_population) AS total_population,
            SUM(src.exposed_population) AS exposed_population,
            SUM(src.low_risk_population) AS low_risk_population,
            SUM(src.medium_risk_population) AS medium_risk_population,
            SUM(src.high_risk_population) AS high_risk_population,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          ${whereClause}
          GROUP BY src.district_id, src.district_name
        `;

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_zones
      ),
      source_rows AS (
        SELECT fz.*
        FROM flood_zones fz
        JOIN latest_analysis la
          ON fz.analysis_date = la.analysis_date
        WHERE fz.ta_id <> 0
           OR NOT EXISTS (
             SELECT 1
             FROM flood_zones fz_ta
             WHERE fz_ta.analysis_date = la.analysis_date
               AND fz_ta.ta_id <> 0
           )
      )
      SELECT
        agg.*,
        GREATEST(COALESCE(agg.total_population, 0) - COALESCE(agg.exposed_population, 0), 0) AS not_exposed_population,
        CASE
          WHEN COALESCE(agg.total_population, 0) > 0
            THEN (agg.exposed_population * 100.0 / agg.total_population)
          ELSE 0
        END AS exposed_population_pct,
        CASE
          WHEN COALESCE(agg.total_population, 0) = 0 THEN 'unknown'
          WHEN (agg.high_risk_population * 100.0 / agg.total_population) >= 5 THEN 'high'
          WHEN (agg.medium_risk_population * 100.0 / agg.total_population) >= 2 THEN 'medium'
          ELSE 'low'
        END AS risk_level
      FROM (
        ${aggregationSql}
      ) agg
      ORDER BY agg.admin_unit_name;
    `;

    const result = await db.query(query, params);
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/disaster/flood/facilities
// @desc    Get flood facility exposure detail (education/health)
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood/facilities:
 *   get:
 *     summary: Get flood facility exposure details
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood facility exposure
 */
router.get("/flood/facilities", async (req, res) => {
  const {
    district,
    ta,
    facility_type: facilityType,
    exposed_only: exposedOnly = "true",
  } = req.query;
  const normalizedFacilityType = normalizeFacilityType(facilityType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);

    if (normalizedFacilityType) {
      params.push(normalizedFacilityType);
      conditions.push(`LOWER(src.facility_type) = LOWER($${params.length})`);
    }

    if (String(exposedOnly).toLowerCase() !== "false") {
      conditions.push("src.is_exposed = TRUE");
    }

    const whereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_facility_exposure
      )
      SELECT
        src.analysis_date,
        src.district_id,
        src.district_name,
        src.ta_id,
        src.ta_name,
        src.facility_type,
        src.facility_id,
        src.facility_name,
        src.flood_value,
        src.risk_class,
        src.is_exposed
      FROM flood_facility_exposure src
      JOIN latest_analysis la
        ON src.analysis_date = la.analysis_date
      WHERE 1=1
        ${whereClause}
      ORDER BY src.facility_type, src.risk_class DESC, src.facility_name;
    `;

    const result = await db.query(query, params);
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/disaster/flood/facilities/summary
// @desc    Get flood facility exposure summary by District/TA and facility type
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood/facilities/summary:
 *   get:
 *     summary: Get flood facility exposure summary
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Flood facility exposure summary
 */
router.get("/flood/facilities/summary", async (req, res) => {
  const {
    district,
    ta,
    admin_type: adminType = "District",
    facility_type: facilityType,
  } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);
  const normalizedFacilityType = normalizeFacilityType(facilityType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);
    if (normalizedFacilityType) {
      params.push(normalizedFacilityType);
      conditions.push(`LOWER(src.facility_type) = LOWER($${params.length})`);
    }
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const andWhereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const aggregationSql =
      normalizedAdminType === "TA"
        ? `
          SELECT
            src.ta_id AS admin_unit_id,
            src.ta_name AS admin_unit_name,
            'TA'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            src.facility_type,
            SUM(src.total_facilities) AS total_facilities,
            SUM(src.exposed_facilities) AS exposed_facilities,
            SUM(src.low_risk_count) AS low_risk_count,
            SUM(src.medium_risk_count) AS medium_risk_count,
            SUM(src.high_risk_count) AS high_risk_count,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          WHERE src.ta_id <> 0
          ${andWhereClause}
          GROUP BY src.ta_id, src.ta_name, src.district_id, src.district_name, src.facility_type
        `
        : `
          SELECT
            src.district_id AS admin_unit_id,
            src.district_name AS admin_unit_name,
            'District'::text AS admin_unit_type,
            src.district_id,
            src.district_name,
            src.facility_type,
            SUM(src.total_facilities) AS total_facilities,
            SUM(src.exposed_facilities) AS exposed_facilities,
            SUM(src.low_risk_count) AS low_risk_count,
            SUM(src.medium_risk_count) AS medium_risk_count,
            SUM(src.high_risk_count) AS high_risk_count,
            MAX(src.analysis_date) AS analysis_date
          FROM source_rows src
          ${whereClause}
          GROUP BY src.district_id, src.district_name, src.facility_type
        `;

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_facility_exposure_summary
      ),
      source_rows AS (
        SELECT s.*
        FROM flood_facility_exposure_summary s
        JOIN latest_analysis la
          ON s.analysis_date = la.analysis_date
        WHERE s.ta_id <> 0
           OR NOT EXISTS (
             SELECT 1
             FROM flood_facility_exposure_summary s_ta
             WHERE s_ta.analysis_date = la.analysis_date
               AND s_ta.ta_id <> 0
           )
      )
      SELECT
        agg.*,
        GREATEST(COALESCE(agg.total_facilities, 0) - COALESCE(agg.exposed_facilities, 0), 0) AS not_exposed_facilities,
        CASE
          WHEN COALESCE(agg.total_facilities, 0) > 0
            THEN (agg.exposed_facilities * 100.0 / agg.total_facilities)
          ELSE 0
        END AS exposed_facilities_pct
      FROM (
        ${aggregationSql}
      ) agg
      ORDER BY agg.admin_unit_name, agg.facility_type;
    `;

    const result = await db.query(query, params);
    res.json({ status: "success", data: result.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET api/v1/dashboard/disaster/flood/facilities/geojson
// @desc    Get exposed health/education facilities as GeoJSON for map overlays
/**
 * @openapi
 * /api/v1/dashboard/disaster/flood/facilities/geojson:
 *   get:
 *     summary: Get exposed facilities as GeoJSON
 *     tags:
 *       - Disaster
 *     responses:
 *       200:
 *         description: Exposed facilities GeoJSON
 */
router.get("/flood/facilities/geojson", async (req, res) => {
  const {
    district,
    ta,
    facility_type: facilityType,
    exposed_only: exposedOnly = "true",
  } = req.query;
  const normalizedFacilityType = normalizeFacilityType(facilityType);

  try {
    const conditions = [];
    const params = [];
    appendDistrictNameCondition(
      conditions,
      params,
      "src.district_name",
      district,
    );
    appendOptionalTaCondition(conditions, params, "src.ta_name", ta);
    if (normalizedFacilityType) {
      params.push(normalizedFacilityType);
      conditions.push(`LOWER(src.facility_type) = LOWER($${params.length})`);
    }
    if (String(exposedOnly).toLowerCase() !== "false") {
      conditions.push("src.is_exposed = TRUE");
    }
    const whereClause = conditions.length
      ? `AND ${conditions.join(" AND ")}`
      : "";

    const query = `
      WITH latest_analysis AS (
        SELECT MAX(analysis_date) AS analysis_date
        FROM flood_facility_exposure
      ),
      src AS (
        SELECT ffe.*
        FROM flood_facility_exposure ffe
        JOIN latest_analysis la
          ON ffe.analysis_date = la.analysis_date
        WHERE 1=1
          ${whereClause}
      )
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
      )
      FROM (
        SELECT jsonb_build_object(
          'type', 'Feature',
          'id', CONCAT(src.facility_type, '-', src.facility_id),
          'geometry', ST_AsGeoJSON(COALESCE(ef.geom, hf.geom))::jsonb,
          'properties', jsonb_build_object(
            'analysis_date', src.analysis_date,
            'facility_type', src.facility_type,
            'facility_id', src.facility_id,
            'facility_name', COALESCE(src.facility_name, ef.school_name, hf.name),
            'district_id', src.district_id,
            'district_name', src.district_name,
            'ta_id', src.ta_id,
            'ta_name', src.ta_name,
            'flood_value', src.flood_value,
            'risk_class', src.risk_class,
            'risk_level', src.risk_class,
            'is_exposed', src.is_exposed
          )
        ) AS feature
        FROM src
        LEFT JOIN education_facilities ef
          ON LOWER(src.facility_type) = LOWER('education')
         AND ef.school_id = src.facility_id
        LEFT JOIN health_facilities hf
          ON LOWER(src.facility_type) = LOWER('health')
         AND hf.id = src.facility_id
        WHERE COALESCE(ef.geom, hf.geom) IS NOT NULL
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
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
