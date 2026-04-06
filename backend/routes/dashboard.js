const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Helper to handle async queries
const runQuery = async (res, sql, params = []) => {
  try {
    const result = await query(sql, params);
    return result.rows;
  } catch (err) {
    console.error('Database Query Error:', err);
    res.status(500).json({ error: 'Database query failed', details: err.message });
    throw err;
  }
};

// GET /districts - List all unique districts
router.get('/districts', async (req, res) => {
  try {
    const rows = await runQuery(res, "SELECT name FROM administrative_units WHERE type = 'District' ORDER BY name");
    res.json({ data: rows.map(r => r.name) });
  } catch (err) { /* handled in runQuery */ }
});

// GET /summary - Total metrics for stat cards
router.get('/summary', async (req, res) => {
  const { district } = req.query;
  const whereClause = district ? 'WHERE name = $1 AND type = \'District\'' : 'WHERE type = \'District\'';
  const params = district ? [district] : [];

  try {
    // 1. Population Total
    const popRes = await query(`SELECT SUM(population_total) as total FROM administrative_units ${whereClause}`, params);
    
    // 2. Schools Count
    const schoolSql = district 
      ? 'SELECT COUNT(*) as total FROM education_facilities WHERE district_id = (SELECT id FROM administrative_units WHERE name = $1 AND type = \'District\')'
      : 'SELECT COUNT(*) as total FROM education_facilities';
    const schoolRes = await query(schoolSql, params);

    // 3. Health Facilities Count
    const healthSql = district
      ? 'SELECT COUNT(*) as total FROM health_facilities WHERE district_id = (SELECT id FROM administrative_units WHERE name = $1 AND type = \'District\')'
      : 'SELECT COUNT(*) as total FROM health_facilities';
    const healthRes = await query(healthSql, params);

    // 4. Welfare Beneficiaries Sum
    const welfareSql = district
      ? 'SELECT SUM(beneficiary_count) as total FROM welfare_beneficiaries wb LEFT JOIN administrative_units au ON wb.ward_id = au.id WHERE au.parent_id = (SELECT id FROM administrative_units WHERE name = $1 AND type = \'District\')'
      : 'SELECT SUM(beneficiary_count) as total FROM welfare_beneficiaries';
    const welfareRes = await query(welfareSql, params);

    res.json({
      data: {
        total_estimated_population: parseInt(popRes.rows[0].total || 0),
        total_schools: parseInt(schoolRes.rows[0].total || 0),
        total_health_facilities: parseInt(healthRes.rows[0].total || 0),
        total_welfare_beneficiaries: parseInt(welfareRes.rows[0].total || 0),
      }
    });

  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary', details: err.message });
  }
});

// GET /population-by-district - Aggregate for bar chart
router.get('/population-by-district', async (req, res) => {
  try {
    const rows = await runQuery(res, `
      SELECT name as district, population_total as population 
      FROM administrative_units 
      WHERE type = 'District' 
      ORDER BY population_total DESC
    `);
    res.json({ data: rows });
  } catch (err) { }
});

// GET /welfare-distribution - Aggregate for pie chart
router.get('/welfare-distribution', async (req, res) => {
  const { district } = req.query;
  const sql = district 
    ? `SELECT program_name as name, SUM(beneficiary_count) as value 
       FROM welfare_beneficiaries wb 
       LEFT JOIN administrative_units au ON wb.ward_id = au.id 
       WHERE au.parent_id = (SELECT id FROM administrative_units WHERE name = $1 AND type = 'District') 
       GROUP BY program_name`
    : `SELECT program_name as name, SUM(beneficiary_count) as value FROM welfare_beneficiaries GROUP BY program_name`;
  const params = district ? [district] : [];

  try {
    const rows = await runQuery(res, sql, params);
    res.json({ data: rows });
  } catch (err) { }
});

// GET /admin-units - GeoJSON boundaries
router.get('/admin-units', async (req, res) => {
  const { type = 'District', district } = req.query;
  
  let sql = '';
  let params = [];

  if (type === 'District') {
    sql = 'SELECT id, name, type, population_total, ST_AsGeoJSON(geom)::json as geometry FROM administrative_units WHERE type = \'District\'';
    if (district) {
      sql += ' AND name = $1';
      params = [district];
    }
  } else if (type === 'Ward' && district) {
    sql = 'SELECT id, name, type, population_total, ST_AsGeoJSON(geom)::json as geometry FROM administrative_units WHERE type = \'Ward\' AND parent_id = (SELECT id FROM administrative_units WHERE name = $1 AND type = \'District\')';
    params = [district];
  } else {
    // Default to all districts if invalid combination
    sql = 'SELECT id, name, type, population_total, ST_AsGeoJSON(geom)::json as geometry FROM administrative_units WHERE type = \'District\'';
  }

  try {
    const rows = await query(sql, params);
    const features = rows.rows.map(row => ({
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        id: row.id,
        name: row.name,
        type: row.type,
        population: row.population_total
      }
    }));

    res.json({
      data: {
        type: 'FeatureCollection',
        features
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch admin units', details: err.message });
  }
});

module.exports = router;
