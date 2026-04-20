const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
  resolveDistrictFilterValues,
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
router.get("/", async (req, res) => {
  const { district } = req.query;

  try {
    const conditions = ["geom IS NOT NULL"];
    const params = [];
    appendDistrictGeometryCondition(conditions, params, "ef.geom", district);
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
    appendDistrictGeometryCondition(conditions, params, "ef.geom", district);
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

// @route   GET api/v1/dashboard/education/insights
// @desc    Get district education access and utilization insights
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

module.exports = router;
