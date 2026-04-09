const express = require("express");
const router = express.Router();
const db = require("../db");
const { appendDistrictNameCondition } = require("./queryFilters");

/**
 * @route   GET /api/v1/dashboard/analysis
 * @desc    Get analysis results with optional filters
 */
router.get("/", async (req, res) => {
  const {
    analysis_type: analysisType,
    admin_type: adminType,
    metric_name: metricName,
    district,
  } = req.query;

  try {
    const conditions = [];
    const params = [];

    if (analysisType) {
      params.push(analysisType);
      conditions.push(`analysis_type = $${params.length}`);
    }

    if (adminType) {
      params.push(adminType);
      conditions.push(`admin_unit_type = $${params.length}`);
    }

    if (metricName) {
      params.push(metricName);
      conditions.push(`metric_name = $${params.length}`);
    }

    appendDistrictNameCondition(
      conditions,
      params,
      "admin_unit_name",
      district,
    );

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const query = `
              SELECT
                  id,
                  analysis_type,
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
              ${whereClause}
              ORDER BY analysis_type, metric_name, admin_unit_name
          `;
    const result = await db.query(query, params);
    res.json({
      status: "success",
      data: result.rows,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET /api/v1/dashboard/analysis/geojson
 * @desc    Get analysis results as GeoJSON with optional filters
 */
router.get("/geojson", async (req, res) => {
  const {
    analysis_type: analysisType,
    admin_type: adminType,
    metric_name: metricName,
    district,
  } = req.query;

  try {
    const conditions = [];
    const params = [];

    if (analysisType) {
      params.push(analysisType);
      conditions.push(`analysis_type = $${params.length}`);
    }

    if (adminType) {
      params.push(adminType);
      conditions.push(`admin_unit_type = $${params.length}`);
    }

    if (metricName) {
      params.push(metricName);
      conditions.push(`metric_name = $${params.length}`);
    }

    appendDistrictNameCondition(
      conditions,
      params,
      "ar.admin_unit_name",
      district,
    );

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
                      'id', ar.id,
                      'geometry', ST_AsGeoJSON(COALESCE(ar.geom, au.simplified_geom, au.geom))::jsonb,
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
                  LEFT JOIN administrative_units au
                    ON au.id = ar.admin_unit_id
                  ${whereClause}
                  ORDER BY ar.analysis_type, ar.metric_name, ar.admin_unit_name
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