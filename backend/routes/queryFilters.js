const DISTRICT_GROUPS = {
  zomba: ["Zomba", "Zomba City"],
};

const DEFAULT_DISTRICT_FILTER = "zomba";

function resolveDistrictFilterValues(district) {
  const normalized = String(district || DEFAULT_DISTRICT_FILTER).trim();
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
  const districtValues = resolveDistrictFilterValues(district);
  if (!districtValues.length) return;

  const placeholders = districtValues.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });

  if (placeholders.length === 1) {
    conditions.push(`LOWER(${columnExpression}) = LOWER(${placeholders[0]})`);
    return;
  }

  conditions.push(
    `LOWER(${columnExpression}) IN (${placeholders.map((placeholder) => `LOWER(${placeholder})`).join(", ")})`,
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
  const districtValues = resolveDistrictFilterValues(district);
  if (!districtValues.length) return;

  const placeholders = districtValues.map((value) => {
    params.push(value);
    return `$${params.length}`;
  });
  const districtNamePredicate =
    placeholders.length === 1
      ? `LOWER(district_filter.name) = LOWER(${placeholders[0]})`
      : `LOWER(district_filter.name) IN (${placeholders
          .map((placeholder) => `LOWER(${placeholder})`)
          .join(", ")})`;

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
};
