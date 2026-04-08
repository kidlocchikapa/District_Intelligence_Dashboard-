const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
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
  const { district } = req.query;

  try {
    const conditions = ["ef.geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(
      conditions,
      params,
      "ef.geom",
      district,
    );
    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
    const result = await db.query(
      `
        SELECT
          school_id,
          student_enrollment_total,
          teacher_count,
          student_enrollment,
          teacher_distribution
        FROM education_facilities ef
        ${whereClause}
      `,
      params,
    );

    const facilityTotals = result.rows.reduce(
      (accumulator, row) => {
        accumulator.school_count += 1;
        accumulator.student_enrollment_total += parseNumericValue(
          row.student_enrollment_total ?? row.student_enrollment,
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
            CASE
              WHEN age_class = '5' THEN total_population
              WHEN age_class = '10' THEN total_population
              WHEN age_class = '15' THEN total_population * 0.6
              ELSE 0
            END
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

module.exports = router;
