const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

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

/**
 * @route   GET api/v1/dashboard/welfare
 * @desc    Get welfare beneficiary locations (GeoJSON)
 */
router.get("/", async (req, res) => {
  const { district, ta, program_id } = req.query;

  try {
    const conditions = ["wb.geom IS NOT NULL"];
    const params = [];
    
    if (district) {
      appendDistrictGeometryCondition(conditions, params, "wb.geom", district);
    }

    appendOptionalTaCondition(conditions, params, "a3.name", ta);

    if (program_id) {
      params.push(program_id);
      conditions.push(`wb.program_id = $${params.length}`);
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
                'id',         wb.id,
                'geometry',   ST_AsGeoJSON(wb.geom)::jsonb,
                'properties', (
                  jsonb_build_object(
                      'beneficiary_id', wb.id,
                      'program_id', wb.program_id,
                      'program_name', wp.program_name,
                      'firstname', wb.firstname,
                      'lastname', wb.lastname,
                      'gender', wb.gender,
                      'age', wb.age,
                      'household_size', wb.household_size,
                      'status', wb.status,
                      'district_name', d.name,
                      'ta_name', a3.name,
                      'has_health_facility_access', wbi.has_health_facility_access,
                      'has_school_access', wbi.has_school_access,
                      'affected_by_flood', wbi.affected_by_flood
                  )
                )
              ) AS feature
              FROM welfare_beneficiary wb
              JOIN welfare_programs wp ON wb.program_id = wp.program_id
              LEFT JOIN welfare_beneficiary_indicators wbi ON wb.id = wbi.beneficiary_id
              LEFT JOIN districts d ON wb.district_id = d.id
              LEFT JOIN admin3_units a3 ON wb.ta_id = a3.id
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
    console.error("Dashboard welfare geojson error:", err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET api/v1/dashboard/welfare/summary
 * @desc    Get aggregate welfare statistics
 */
router.get("/summary", async (req, res) => {
  const { district, ta } = req.query;

  try {
    const params = [];
    const conditions = [];
    
    if (district) {
      appendDistrictNameCondition(conditions, params, "d.name", district);
    }

    appendOptionalTaCondition(conditions, params, "a3.name", ta);

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const query = `
      SELECT 
        wp.program_name,
        COUNT(DISTINCT wb.id) as beneficiary_count,
        COUNT(DISTINCT CASE WHEN wbi.affected_by_flood THEN wb.id END) as flood_affected_count,
        COUNT(DISTINCT CASE WHEN wbi.has_health_facility_access THEN wb.id END) as health_access_count,
        COUNT(DISTINCT CASE WHEN wbi.has_school_access THEN wb.id END) as school_access_count
      FROM welfare_programs wp
      LEFT JOIN welfare_beneficiary wb ON wp.program_id = wb.program_id
      LEFT JOIN welfare_beneficiary_indicators wbi ON wb.id = wbi.beneficiary_id
      LEFT JOIN districts d ON wb.district_id = d.id
      LEFT JOIN admin3_units a3 ON wb.ta_id = a3.id
      ${whereClause}
      GROUP BY wp.program_name
    `;

    const result = await db.query(query, params);
    
    res.json({
      status: "success",
      data: result.rows
    });
  } catch (err) {
    console.error("Dashboard welfare summary error:", err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
