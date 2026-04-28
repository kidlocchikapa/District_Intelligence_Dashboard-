const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
} = require("./queryFilters");

let welfareProgramIdColumnPromise;

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

function normalizeAdminType(adminType = "TA") {
  const normalized = String(adminType || "TA")
    .trim()
    .toLowerCase();

  if (normalized === "district") return "District";
  if (normalized === "ta" || normalized === "admin3") return "TA";
  if (normalized === "village") return "Village";
  return "TA";
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getWelfareProgramIdColumn() {
  if (!welfareProgramIdColumnPromise) {
    welfareProgramIdColumnPromise = (async () => {
      const result = await db.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'welfare_programs'
            AND column_name IN ('program_id', 'id')
          ORDER BY CASE WHEN column_name = 'program_id' THEN 0 ELSE 1 END
          LIMIT 1
        `,
      );

      return result.rows[0]?.column_name || "id";
    })();
  }

  return welfareProgramIdColumnPromise;
}

function buildBeneficiaryScopeQuery(programIdColumn, district, ta, programId) {
  const params = [];
  const conditions = [];

  appendDistrictNameCondition(conditions, params, "d.name", district);
  appendOptionalTaCondition(conditions, params, "a3.name", ta);

  if (programId) {
    params.push(programId);
    conditions.push(`wb.program_id = $${params.length}`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  return {
    params,
    query: `
      WITH beneficiary_scope AS (
        SELECT
          wb.id AS beneficiary_id,
          wb.program_id,
          COALESCE(wp.program_name, CONCAT('Program ', wb.program_id::text)) AS program_name,
          wb.firstname,
          wb.lastname,
          wb.gender,
          wb.age,
          COALESCE(wb.household_size, 1) AS household_size,
          wb.status,
          wb.start_date,
          wb.end_date,
          wb.geom,
          wb.district_id,
          d.name AS district_name,
          wb.ta_id,
          a3.name AS ta_name,
          COALESCE(wbi.affected_by_flood, FALSE) AS affected_by_flood,
          COALESCE(wbi.has_school_access, FALSE) AS has_school_access,
          COALESCE(wbi.has_health_facility_access, FALSE) AS has_health_facility_access
        FROM welfare_beneficiary wb
        LEFT JOIN welfare_programs wp
          ON wb.program_id = wp.${programIdColumn}
        LEFT JOIN welfare_beneficiary_indicators wbi
          ON wb.id = wbi.beneficiary_id
        LEFT JOIN districts d
          ON wb.district_id = d.id
        LEFT JOIN admin3_units a3
          ON wb.ta_id = a3.id
        ${whereClause}
      )
    `,
  };
}

function buildDepartmentSummary(summary, programBreakdown) {
  const totalBeneficiaries = toNumber(summary.total_beneficiaries);
  const householdPopulationReached = toNumber(
    summary.estimated_household_population,
  );
  const schoolAccessCount = toNumber(summary.school_access_count);
  const healthAccessCount = toNumber(summary.health_access_count);
  const floodAffectedCount = toNumber(summary.flood_affected_count);
  const schoolAgePopulation = toNumber(summary.school_age_population_total);
  const schoolAgeUnenrolled = toNumber(summary.school_age_population_unenrolled);
  const studentEnrollmentTotal = toNumber(summary.student_enrollment_total);
  const publicFacilityAccessCount = toNumber(summary.public_facility_access_count);
  const privateFacilityAccessCount = toNumber(
    summary.private_facility_access_count,
  );
  const publicHospitalAccessCount = toNumber(summary.public_hospital_access_count);
  const privateHospitalAccessCount = toNumber(
    summary.private_hospital_access_count,
  );

  return [
    {
      department: "social_welfare",
      label: "Social Welfare",
      metrics: {
        total_beneficiaries: totalBeneficiaries,
        active_programs: programBreakdown.length,
        estimated_household_population: householdPopulationReached,
      },
    },
    {
      department: "education",
      label: "Education",
      metrics: {
        beneficiaries_with_school_access: schoolAccessCount,
        student_enrollment_total: studentEnrollmentTotal,
        school_age_population_total: schoolAgePopulation,
        school_age_population_unenrolled: schoolAgeUnenrolled,
      },
    },
    {
      department: "health",
      label: "Health",
      metrics: {
        beneficiaries_with_health_access: healthAccessCount,
        public_facility_access_count: publicFacilityAccessCount,
        private_facility_access_count: privateFacilityAccessCount,
        public_hospital_access_count: publicHospitalAccessCount,
        private_hospital_access_count: privateHospitalAccessCount,
      },
    },
    {
      department: "disaster",
      label: "Disaster",
      metrics: {
        flood_affected_count: floodAffectedCount,
        flood_affected_pct:
          totalBeneficiaries > 0
            ? (floodAffectedCount * 100) / totalBeneficiaries
            : 0,
      },
    },
  ];
}

function buildDecisionSignals(summary) {
  const totalBeneficiaries = toNumber(summary.total_beneficiaries);
  const floodAffectedCount = toNumber(summary.flood_affected_count);
  const healthAccessCount = toNumber(summary.health_access_count);
  const schoolAccessCount = toNumber(summary.school_access_count);
  const schoolAgePopulation = toNumber(summary.school_age_population_total);
  const schoolAgeUnenrolled = toNumber(summary.school_age_population_unenrolled);
  const publicHospitalAccessCount = toNumber(summary.public_hospital_access_count);

  const signals = [];
  const floodPct =
    totalBeneficiaries > 0 ? (floodAffectedCount * 100) / totalBeneficiaries : 0;
  const healthAccessPct =
    totalBeneficiaries > 0 ? (healthAccessCount * 100) / totalBeneficiaries : 0;
  const schoolAccessPct =
    totalBeneficiaries > 0 ? (schoolAccessCount * 100) / totalBeneficiaries : 0;
  const schoolUnenrolledPct =
    schoolAgePopulation > 0
      ? (schoolAgeUnenrolled * 100) / schoolAgePopulation
      : 0;

  if (floodPct >= 20) {
    signals.push({
      severity: "high",
      title: "Flood-sensitive welfare footprint",
      description:
        "A large share of beneficiaries live in flood-prone locations, so response planning should align cash support, shelter, and continuity of services.",
    });
  }

  if (healthAccessPct < 70 && totalBeneficiaries > 0) {
    signals.push({
      severity: "medium",
      title: "Health access gap around beneficiary households",
      description:
        "A sizeable portion of beneficiaries are outside the current health access threshold, which may justify outreach, transport support, or facility siting review.",
    });
  }

  if (schoolAccessPct < 70 || schoolUnenrolledPct >= 25) {
    signals.push({
      severity: "medium",
      title: "Education vulnerability in beneficiary areas",
      description:
        "Beneficiary locations show either weak school proximity or a notable school-age unenrolled population, which is important for coordinated education and welfare targeting.",
    });
  }

  if (publicHospitalAccessCount === 0 && totalBeneficiaries > 0) {
    signals.push({
      severity: "medium",
      title: "No nearby public hospital coverage captured",
      description:
        "The selected scope does not currently show beneficiaries within the hospital reach threshold for public facilities, which can affect referral planning.",
    });
  }

  if (!signals.length) {
    signals.push({
      severity: "info",
      title: "Integrated baseline is available",
      description:
        "The current scope has enough linked welfare, education, health, and flood context to support comparative targeting and service planning by area.",
    });
  }

  return signals;
}

/**
 * @route   GET api/v1/dashboard/welfare/integration
 * @desc    Get integrated welfare decision-support metrics by TA or District
 */
router.get("/integration", async (req, res) => {
  const {
    district,
    ta,
    program_id: programId,
    admin_type: adminType = "TA",
    preview_limit: previewLimitParam,
  } = req.query;
  const normalizedAdminType = normalizeAdminType(adminType);
  const previewLimit = Math.min(
    Math.max(parseInt(previewLimitParam || "12", 10) || 12, 1),
    50,
  );

  try {
    const programIdColumn = await getWelfareProgramIdColumn();
    const scope = buildBeneficiaryScopeQuery(
      programIdColumn,
      district,
      ta,
      programId,
    );

    const adminUnitIdExpression =
      normalizedAdminType === "District" ? "bs.district_id" : "bs.ta_id";
    const adminUnitNameExpression =
      normalizedAdminType === "District" ? "bs.district_name" : "bs.ta_name";
    const adminUnitPresenceCondition =
      normalizedAdminType === "District"
        ? "bs.district_id IS NOT NULL"
        : "bs.ta_id IS NOT NULL";
    const floodUnitIdExpression =
      normalizedAdminType === "District" ? "fz.district_id" : "fz.ta_id";
    const floodUnitNameExpression =
      normalizedAdminType === "District" ? "fz.district_name" : "fz.ta_name";
    const floodAdminTypeFilter =
      normalizedAdminType === "District" ? "" : "WHERE fz.ta_id <> 0";

    const nearestHealthCte = `
      nearest_health AS (
        SELECT
          bs.beneficiary_id,
          nh.facility_id,
          nh.facility_name,
          nh.facility_type,
          nh.ownership,
          nh.ownership_category,
          nh.distance_km
        FROM beneficiary_scope bs
        LEFT JOIN LATERAL (
          SELECT
            hf.id AS facility_id,
            hf.name AS facility_name,
            hf.type AS facility_type,
            hf.ownership,
            CASE
              WHEN hf.ownership IS NULL OR BTRIM(hf.ownership) = '' THEN 'unknown'
              WHEN LOWER(hf.ownership) ~ '(public|government|govt|ministry|district|central)' THEN 'public'
              WHEN LOWER(hf.ownership) ~ '(private|for.?profit|company|commercial)' THEN 'private'
              WHEN LOWER(hf.ownership) ~ '(mission|faith|church|ngo|non.?government|community|cham)' THEN 'private'
              ELSE 'private'
            END AS ownership_category,
            ST_Distance(bs.geom::geography, hf.geom::geography) / 1000.0 AS distance_km
          FROM health_facilities hf
          WHERE bs.geom IS NOT NULL
            AND hf.geom IS NOT NULL
          ORDER BY bs.geom <-> hf.geom
          LIMIT 1
        ) nh ON TRUE
      ),
      nearest_hospital AS (
        SELECT
          bs.beneficiary_id,
          nh.facility_id,
          nh.facility_name,
          nh.facility_type,
          nh.ownership,
          nh.ownership_category,
          nh.distance_km
        FROM beneficiary_scope bs
        LEFT JOIN LATERAL (
          SELECT
            hf.id AS facility_id,
            hf.name AS facility_name,
            hf.type AS facility_type,
            hf.ownership,
            CASE
              WHEN hf.ownership IS NULL OR BTRIM(hf.ownership) = '' THEN 'unknown'
              WHEN LOWER(hf.ownership) ~ '(public|government|govt|ministry|district|central)' THEN 'public'
              WHEN LOWER(hf.ownership) ~ '(private|for.?profit|company|commercial)' THEN 'private'
              WHEN LOWER(hf.ownership) ~ '(mission|faith|church|ngo|non.?government|community|cham)' THEN 'private'
              ELSE 'private'
            END AS ownership_category,
            ST_Distance(bs.geom::geography, hf.geom::geography) / 1000.0 AS distance_km
          FROM health_facilities hf
          WHERE bs.geom IS NOT NULL
            AND hf.geom IS NOT NULL
            AND LOWER(COALESCE(hf.type, '')) LIKE '%hospital%'
          ORDER BY bs.geom <-> hf.geom
          LIMIT 1
        ) nh ON TRUE
      ),
      education_context AS (
        SELECT
          ar.admin_unit_id,
          MAX(CASE WHEN ar.metric_name = 'school_count' THEN ar.metric_value END) AS school_count,
          MAX(CASE WHEN ar.metric_name = 'student_enrollment_total' THEN ar.metric_value END) AS student_enrollment_total,
          MAX(CASE WHEN ar.metric_name = 'school_age_population_total' THEN ar.metric_value END) AS school_age_population_total,
          MAX(CASE WHEN ar.metric_name = 'school_age_population_unenrolled' THEN ar.metric_value END) AS school_age_population_unenrolled
        FROM analysis_results ar
        WHERE ar.analysis_type = 'education_summary'
          AND LOWER(ar.admin_unit_type) = LOWER('${normalizedAdminType}')
        GROUP BY ar.admin_unit_id
      ),
      health_context AS (
        SELECT
          ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"} AS admin_unit_id,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(hf.ownership, '')) ~ '(public|government|govt|ministry|district|central)'
          ) AS public_health_facility_count,
          COUNT(*) FILTER (
            WHERE NOT (
              LOWER(COALESCE(hf.ownership, '')) ~ '(public|government|govt|ministry|district|central)'
            )
          ) AS private_health_facility_count
        FROM health_facilities hf
        WHERE ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"} IS NOT NULL
        GROUP BY ${normalizedAdminType === "District" ? "hf.district_id" : "hf.ta_id"}
      ),
      latest_flood AS (
        SELECT MAX(fz.analysis_date) AS analysis_date
        FROM flood_zones fz
      ),
      flood_context AS (
        SELECT
          ${floodUnitIdExpression} AS admin_unit_id,
          ${floodUnitNameExpression} AS admin_unit_name,
          SUM(fz.total_population) AS area_total_population,
          SUM(fz.exposed_population) AS area_exposed_population
        FROM flood_zones fz
        JOIN latest_flood lf
          ON fz.analysis_date = lf.analysis_date
        ${floodAdminTypeFilter}
        GROUP BY ${floodUnitIdExpression}, ${floodUnitNameExpression}
      )
    `;

    const byAreaQuery = `
      ${scope.query},
      ${nearestHealthCte}
      SELECT
        ${adminUnitIdExpression} AS admin_unit_id,
        ${adminUnitNameExpression} AS admin_unit_name,
        '${normalizedAdminType}'::text AS admin_unit_type,
        MAX(bs.district_name) AS district_name,
        COUNT(*)::int AS beneficiary_count,
        COUNT(*) FILTER (
          WHERE COALESCE(NULLIF(LOWER(BTRIM(bs.status)), ''), 'active')
            NOT IN ('inactive', 'closed', 'ended', 'expired', 'dropped', 'exit', 'exited')
        )::int AS active_beneficiary_count,
        SUM(COALESCE(bs.household_size, 1))::int AS estimated_household_population,
        COUNT(*) FILTER (WHERE COALESCE(bs.age, 0) < 18)::int AS beneficiary_records_under_18,
        COUNT(*) FILTER (WHERE bs.has_school_access)::int AS school_access_count,
        COUNT(*) FILTER (WHERE bs.has_health_facility_access)::int AS health_access_count,
        COUNT(*) FILTER (WHERE bs.affected_by_flood)::int AS flood_affected_count,
        COUNT(*) FILTER (
          WHERE nh.distance_km <= 8
            AND nh.ownership_category = 'public'
        )::int AS public_facility_access_count,
        COUNT(*) FILTER (
          WHERE nh.distance_km <= 8
            AND nh.ownership_category = 'private'
        )::int AS private_facility_access_count,
        COUNT(*) FILTER (
          WHERE hosp.distance_km <= 8
            AND hosp.ownership_category = 'public'
        )::int AS public_hospital_access_count,
        COUNT(*) FILTER (
          WHERE hosp.distance_km <= 8
            AND hosp.ownership_category = 'private'
        )::int AS private_hospital_access_count,
        COUNT(DISTINCT bs.program_id)::int AS program_count,
        COALESCE(MAX(ec.school_count), 0) AS school_count,
        COALESCE(MAX(ec.student_enrollment_total), 0) AS student_enrollment_total,
        COALESCE(MAX(ec.school_age_population_total), 0) AS school_age_population_total,
        COALESCE(MAX(ec.school_age_population_unenrolled), 0) AS school_age_population_unenrolled,
        COALESCE(MAX(hc.public_health_facility_count), 0) AS public_health_facility_count,
        COALESCE(MAX(hc.private_health_facility_count), 0) AS private_health_facility_count,
        COALESCE(MAX(fc.area_total_population), 0) AS area_total_population,
        COALESCE(MAX(fc.area_exposed_population), 0) AS area_exposed_population
      FROM beneficiary_scope bs
      LEFT JOIN nearest_health nh
        ON bs.beneficiary_id = nh.beneficiary_id
      LEFT JOIN nearest_hospital hosp
        ON bs.beneficiary_id = hosp.beneficiary_id
      LEFT JOIN education_context ec
        ON ec.admin_unit_id = ${adminUnitIdExpression}
      LEFT JOIN health_context hc
        ON hc.admin_unit_id = ${adminUnitIdExpression}
      LEFT JOIN flood_context fc
        ON fc.admin_unit_id = ${adminUnitIdExpression}
      WHERE ${adminUnitPresenceCondition}
      GROUP BY ${adminUnitIdExpression}, ${adminUnitNameExpression}
      ORDER BY beneficiary_count DESC, admin_unit_name ASC
    `;

    const previewQuery = `
      ${scope.query},
      ${nearestHealthCte}
      SELECT
        bs.beneficiary_id,
        bs.firstname,
        bs.lastname,
        bs.gender,
        bs.age,
        bs.household_size,
        bs.status,
        bs.program_id,
        bs.program_name,
        bs.district_name,
        bs.ta_name,
        bs.affected_by_flood,
        bs.has_school_access,
        bs.has_health_facility_access,
        ROUND(COALESCE(nh.distance_km, 0)::numeric, 2) AS nearest_facility_distance_km,
        nh.facility_name AS nearest_facility_name,
        nh.facility_type AS nearest_facility_type,
        nh.ownership_category AS nearest_facility_ownership_category,
        ROUND(COALESCE(hosp.distance_km, 0)::numeric, 2) AS nearest_hospital_distance_km,
        hosp.facility_name AS nearest_hospital_name,
        hosp.ownership_category AS nearest_hospital_ownership_category
      FROM beneficiary_scope bs
      LEFT JOIN nearest_health nh
        ON bs.beneficiary_id = nh.beneficiary_id
      LEFT JOIN nearest_hospital hosp
        ON bs.beneficiary_id = hosp.beneficiary_id
      ORDER BY
        bs.affected_by_flood DESC,
        bs.has_health_facility_access ASC,
        bs.has_school_access ASC,
        bs.lastname ASC,
        bs.firstname ASC
      LIMIT $${scope.params.length + 1}
    `;

    const programBreakdownQuery = `
      ${scope.query}
      SELECT
        bs.program_id,
        bs.program_name,
        COUNT(*)::int AS beneficiary_count,
        SUM(COALESCE(bs.household_size, 1))::int AS estimated_household_population
      FROM beneficiary_scope bs
      GROUP BY bs.program_id, bs.program_name
      ORDER BY beneficiary_count DESC, bs.program_name ASC
    `;

    const [byAreaResult, previewResult, programBreakdownResult] =
      await Promise.all([
        db.query(byAreaQuery, scope.params),
        db.query(previewQuery, [...scope.params, previewLimit]),
        db.query(programBreakdownQuery, scope.params),
      ]);

    const byArea = byAreaResult.rows.map((row) => {
      const areaTotalPopulation = toNumber(row.area_total_population);
      const areaExposedPopulation = toNumber(row.area_exposed_population);

      return {
        ...row,
        beneficiary_count: toNumber(row.beneficiary_count),
        active_beneficiary_count: toNumber(row.active_beneficiary_count),
        estimated_household_population: toNumber(
          row.estimated_household_population,
        ),
        beneficiary_records_under_18: toNumber(
          row.beneficiary_records_under_18,
        ),
        school_access_count: toNumber(row.school_access_count),
        health_access_count: toNumber(row.health_access_count),
        flood_affected_count: toNumber(row.flood_affected_count),
        public_facility_access_count: toNumber(row.public_facility_access_count),
        private_facility_access_count: toNumber(
          row.private_facility_access_count,
        ),
        public_hospital_access_count: toNumber(
          row.public_hospital_access_count,
        ),
        private_hospital_access_count: toNumber(
          row.private_hospital_access_count,
        ),
        program_count: toNumber(row.program_count),
        school_count: toNumber(row.school_count),
        student_enrollment_total: toNumber(row.student_enrollment_total),
        school_age_population_total: toNumber(row.school_age_population_total),
        school_age_population_unenrolled: toNumber(
          row.school_age_population_unenrolled,
        ),
        public_health_facility_count: toNumber(
          row.public_health_facility_count,
        ),
        private_health_facility_count: toNumber(
          row.private_health_facility_count,
        ),
        area_total_population: areaTotalPopulation,
        area_exposed_population: areaExposedPopulation,
        area_exposed_population_pct:
          areaTotalPopulation > 0
            ? (areaExposedPopulation * 100) / areaTotalPopulation
            : 0,
      };
    });

    const summary = byArea.reduce(
      (accumulator, row) => ({
        total_beneficiaries:
          accumulator.total_beneficiaries + row.beneficiary_count,
        active_beneficiary_count:
          accumulator.active_beneficiary_count + row.active_beneficiary_count,
        estimated_household_population:
          accumulator.estimated_household_population +
          row.estimated_household_population,
        beneficiary_records_under_18:
          accumulator.beneficiary_records_under_18 +
          row.beneficiary_records_under_18,
        school_access_count:
          accumulator.school_access_count + row.school_access_count,
        health_access_count:
          accumulator.health_access_count + row.health_access_count,
        flood_affected_count:
          accumulator.flood_affected_count + row.flood_affected_count,
        public_facility_access_count:
          accumulator.public_facility_access_count +
          row.public_facility_access_count,
        private_facility_access_count:
          accumulator.private_facility_access_count +
          row.private_facility_access_count,
        public_hospital_access_count:
          accumulator.public_hospital_access_count +
          row.public_hospital_access_count,
        private_hospital_access_count:
          accumulator.private_hospital_access_count +
          row.private_hospital_access_count,
        school_count: accumulator.school_count + row.school_count,
        student_enrollment_total:
          accumulator.student_enrollment_total + row.student_enrollment_total,
        school_age_population_total:
          accumulator.school_age_population_total +
          row.school_age_population_total,
        school_age_population_unenrolled:
          accumulator.school_age_population_unenrolled +
          row.school_age_population_unenrolled,
      }),
      {
        total_beneficiaries: 0,
        active_beneficiary_count: 0,
        estimated_household_population: 0,
        beneficiary_records_under_18: 0,
        school_access_count: 0,
        health_access_count: 0,
        flood_affected_count: 0,
        public_facility_access_count: 0,
        private_facility_access_count: 0,
        public_hospital_access_count: 0,
        private_hospital_access_count: 0,
        school_count: 0,
        student_enrollment_total: 0,
        school_age_population_total: 0,
        school_age_population_unenrolled: 0,
      },
    );

    summary.admin_unit_type = normalizedAdminType;
    summary.area_count = byArea.length;
    summary.active_programs = programBreakdownResult.rows.length;
    summary.school_access_pct =
      summary.total_beneficiaries > 0
        ? (summary.school_access_count * 100) / summary.total_beneficiaries
        : 0;
    summary.health_access_pct =
      summary.total_beneficiaries > 0
        ? (summary.health_access_count * 100) / summary.total_beneficiaries
        : 0;
    summary.flood_affected_pct =
      summary.total_beneficiaries > 0
        ? (summary.flood_affected_count * 100) / summary.total_beneficiaries
        : 0;

    const departmentSummary = buildDepartmentSummary(
      summary,
      programBreakdownResult.rows,
    );
    const decisionSignals = buildDecisionSignals(summary);

    res.json({
      status: "success",
      data: {
        admin_unit_type: normalizedAdminType,
        filters: {
          district: district || null,
          ta: ta || null,
          program_id: programId || null,
          preview_limit: previewLimit,
        },
        summary,
        department_summary: departmentSummary,
        program_breakdown: programBreakdownResult.rows.map((row) => ({
          program_id: row.program_id,
          program_name: row.program_name,
          beneficiary_count: toNumber(row.beneficiary_count),
          estimated_household_population: toNumber(
            row.estimated_household_population,
          ),
        })),
        by_area: byArea,
        beneficiary_preview: previewResult.rows.map((row) => ({
          ...row,
          age: row.age === null ? null : toNumber(row.age),
          household_size:
            row.household_size === null ? null : toNumber(row.household_size),
          nearest_facility_distance_km: toNumber(
            row.nearest_facility_distance_km,
          ),
          nearest_hospital_distance_km: toNumber(
            row.nearest_hospital_distance_km,
          ),
        })),
        decision_signals: decisionSignals,
        notes: [
          "School participation metrics in this response combine direct welfare-school proximity indicators with area-level education analysis.",
          "Direct counts of beneficiaries' children currently in school or out of school require child-level household fields in welfare uploads; the current source file only contains beneficiary-level records.",
        ],
      },
    });
  } catch (err) {
    console.error("Dashboard welfare integration error:", err.message);
    res.status(500).send("Server error");
  }
});

/**
 * @route   GET api/v1/dashboard/welfare
 * @desc    Get welfare beneficiary locations (GeoJSON)
 */
router.get("/", async (req, res) => {
  const { district, ta, program_id: programId } = req.query;

  try {
    const programIdColumn = await getWelfareProgramIdColumn();
    const conditions = ["wb.geom IS NOT NULL"];
    const params = [];

    if (district) {
      appendDistrictGeometryCondition(conditions, params, "wb.geom", district);
    }

    appendOptionalTaCondition(conditions, params, "a3.name", ta);

    if (programId) {
      params.push(programId);
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
                'program_name', COALESCE(wp.program_name, CONCAT('Program ', wb.program_id::text)),
                'firstname', wb.firstname,
                'lastname', wb.lastname,
                'gender', wb.gender,
                'age', wb.age,
                'household_size', wb.household_size,
                'status', wb.status,
                'district_name', d.name,
                'ta_name', a3.name,
                'has_health_facility_access', COALESCE(wbi.has_health_facility_access, FALSE),
                'has_school_access', COALESCE(wbi.has_school_access, FALSE),
                'affected_by_flood', COALESCE(wbi.affected_by_flood, FALSE)
            )
          )
        ) AS feature
        FROM welfare_beneficiary wb
        LEFT JOIN welfare_programs wp
          ON wb.program_id = wp.${programIdColumn}
        LEFT JOIN welfare_beneficiary_indicators wbi
          ON wb.id = wbi.beneficiary_id
        LEFT JOIN districts d
          ON wb.district_id = d.id
        LEFT JOIN admin3_units a3
          ON wb.ta_id = a3.id
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
    const programIdColumn = await getWelfareProgramIdColumn();
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
        COALESCE(wp.program_name, 'Unassigned Program') AS program_name,
        COUNT(DISTINCT wb.id) AS beneficiary_count,
        COUNT(DISTINCT CASE WHEN COALESCE(wbi.affected_by_flood, FALSE) THEN wb.id END) AS flood_affected_count,
        COUNT(DISTINCT CASE WHEN COALESCE(wbi.has_health_facility_access, FALSE) THEN wb.id END) AS health_access_count,
        COUNT(DISTINCT CASE WHEN COALESCE(wbi.has_school_access, FALSE) THEN wb.id END) AS school_access_count
      FROM welfare_programs wp
      LEFT JOIN welfare_beneficiary wb
        ON wp.${programIdColumn} = wb.program_id
      LEFT JOIN welfare_beneficiary_indicators wbi
        ON wb.id = wbi.beneficiary_id
      LEFT JOIN districts d
        ON wb.district_id = d.id
      LEFT JOIN admin3_units a3
        ON wb.ta_id = a3.id
      ${whereClause}
      GROUP BY COALESCE(wp.program_name, 'Unassigned Program')
      ORDER BY beneficiary_count DESC, program_name ASC
    `;

    const result = await db.query(query, params);

    res.json({
      status: "success",
      data: result.rows,
    });
  } catch (err) {
    console.error("Dashboard welfare summary error:", err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
