const DISTRICT_GROUPS = {
  zomba: ["Zomba", "Zomba City", "Zomba (All)"],
  "zomba city": ["Zomba", "Zomba City", "Zomba (All)"],
  "zomba (all)": ["Zomba", "Zomba City", "Zomba (All)"],
};

function buildCanonicalDistrictExpression(columnExpression) {
  return `CASE
    WHEN LOWER(${columnExpression}) LIKE 'zomba%' THEN 'zomba'
    ELSE LOWER(${columnExpression})
  END`;
}

function resolveDistrictCanonicalValue(district) {
  const normalized = String(district || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (DISTRICT_GROUPS[normalized]) {
    return "zomba";
  }

  return normalized;
}

function resolveDistrictFilterValues(district) {
  const normalized = String(district || "").trim();
  if (!normalized) {
    return [];
  }

  const groupKey = normalized.toLowerCase();
  if (DISTRICT_GROUPS[groupKey]) {
    return DISTRICT_GROUPS[groupKey];
  }
  return [normalized];
}

/**
 *
 * @param {*} conditions
 * @param {*} params
 * @param {*} columnExpression
 * @param {*} district
 * @returns
 */
function appendDistrictNameCondition(
  conditions,
  params,
  columnExpression,
  district,
) {
  const canonicalValue = resolveDistrictCanonicalValue(district);
  if (!canonicalValue) return;

  params.push(canonicalValue);
  conditions.push(
    `${buildCanonicalDistrictExpression(columnExpression)} = $${params.length}`,
  );
}

/**
 *
 * @param {*} conditions
 * @param {*} params
 * @param {*} geometryExpression
 * @param {*} district
 * @returns
 */
function appendDistrictGeometryCondition(
  conditions,
  params,
  geometryExpression,
  district,
) {
  const canonicalValue = resolveDistrictCanonicalValue(district);
  if (!canonicalValue) return;

  params.push(canonicalValue);
  const districtNamePredicate = `${buildCanonicalDistrictExpression(
    "district_filter.name",
  )} = $${params.length}`;

  conditions.push(`
      EXISTS (
        SELECT 1
        FROM districts district_filter
        WHERE district_filter.geom IS NOT NULL
          AND ${districtNamePredicate}
          AND ST_Intersects(${geometryExpression}, district_filter.geom)
      )
    `);
}

module.exports = {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
  buildCanonicalDistrictExpression,
  resolveDistrictFilterValues,
};
