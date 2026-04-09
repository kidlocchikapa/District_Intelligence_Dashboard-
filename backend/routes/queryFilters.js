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
  if (!district) {
    return;
  }

  params.push(district);
  conditions.push(`LOWER(${columnExpression}) = LOWER($${params.length})`);
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
  if (!district) {
    return;
  }

  params.push(district);
  const districtParam = `$${params.length}`;
  conditions.push(`
      EXISTS (
        SELECT 1
        FROM administrative_units district_filter
        WHERE district_filter.geom IS NOT NULL
          AND LOWER(district_filter.type) = LOWER('District')
          AND LOWER(district_filter.name) = LOWER(${districtParam})
          AND ST_Intersects(${geometryExpression}, district_filter.geom)
      )
    `);
}

module.exports = {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
};
