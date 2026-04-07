<<<<<<< HEAD
function appendDistrictNameCondition(conditions, params, columnExpression, district) {
=======
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
>>>>>>> 1fbbe4e7c05a5045e38feee18900b0f25d6248e4
  if (!district) {
    return;
  }

  params.push(district);
  conditions.push(`LOWER(${columnExpression}) = LOWER($${params.length})`);
}

<<<<<<< HEAD
function appendDistrictGeometryCondition(conditions, params, geometryExpression, district) {
=======

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
>>>>>>> 1fbbe4e7c05a5045e38feee18900b0f25d6248e4
  if (!district) {
    return;
  }

  params.push(district);
  const districtParam = `$${params.length}`;
  conditions.push(`
<<<<<<< HEAD
    EXISTS (
      SELECT 1
      FROM administrative_units district_filter
      WHERE district_filter.geom IS NOT NULL
        AND LOWER(district_filter.type) = LOWER('District')
        AND LOWER(district_filter.name) = LOWER(${districtParam})
        AND ST_Intersects(${geometryExpression}, district_filter.geom)
    )
  `);
=======
      EXISTS (
        SELECT 1
        FROM administrative_units district_filter
        WHERE district_filter.geom IS NOT NULL
          AND LOWER(district_filter.type) = LOWER('District')
          AND LOWER(district_filter.name) = LOWER(${districtParam})
          AND ST_Intersects(${geometryExpression}, district_filter.geom)
      )
    `);
>>>>>>> 1fbbe4e7c05a5045e38feee18900b0f25d6248e4
}

module.exports = {
  appendDistrictGeometryCondition,
  appendDistrictNameCondition,
};
