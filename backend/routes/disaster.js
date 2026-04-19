const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const requireDepartmentAccess = require("../middleware/requireDepartmentAccess");
const { appendDistrictGeometryCondition } = require("./queryFilters");

router.use(auth, requireDepartmentAccess("disaster", "read"));

// @route   GET api/v1/dashboard/disaster
// @desc    Get disaster zones (GeoJSON)
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "disaster_zones.geom", district);
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
                        'event_type', event_type,
                        'risk_level', risk_level,
                        'population_at_risk', population_at_risk
                    )
                ) AS feature
                FROM disaster_zones
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

module.exports = router;
