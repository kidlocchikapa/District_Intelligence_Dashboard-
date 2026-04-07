const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

// @route   GET api/v1/dashboard/education
// @desc    Get education facility locations (GeoJSON)
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "education_facilities.geom", district);
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const query = `
            SELECT jsonb_build_object(
                'type',     'FeatureCollection',
                'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
            )
            FROM (
              SELECT jsonb_build_object(
                'type',       'Feature',
                'id',         school_id,
                'geometry',   ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                    'name', name,
                    'name_en', "name:en",
                    'amenity', amenity,
                    'building', building,
                    'operator_type', "operator:type",
                    'capacity_persons', "capacity:persons",
                    'address_full', "addr:full",
                    'address_city', "addr:city",
                    'source', source,
                    'name_ny', "name:ny",
                    'source_school_id', source_school_id,
                    'source_gid', source_gid,
                    'status', status,
                    'comments', comments,
                    'student_enrollment', student_enrollment,
                    'student_enrollment_total', student_enrollment_total,
                    'teacher_distribution', teacher_distribution,
                    'teacher_count', teacher_count,
                    'osm_id', osm_id,
                    'osm_type', osm_type,
                    'ward_id', ward_id,
                    'district_id', district_id
                )
              ) AS feature
              FROM education_facilities
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

// @route   GET api/v1/dashboard/education/summary
// @desc    Get ward/district education aggregates
router.get("/summary", async (req, res) => {
  const { admin_type: adminType = "Ward", district } = req.query;

  try {
    const conditions = [
      "analysis_type = 'education_summary'",
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

module.exports = router;
