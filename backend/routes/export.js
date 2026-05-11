const express = require("express");
const db = require("../db");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const archiver = require("archiver");
const { appendDistrictNameCondition } = require("./queryFilters");

const router = express.Router();

function appendOptionalTaCondition(conditions, params, taColumnExpression, taName) {
  if (!taName) {
    return;
  }
  params.push(taName);
  conditions.push(`LOWER(${taColumnExpression}) = LOWER($${params.length})`);
}

function buildTaWhereClause(ta, district, params) {
  const conditions = ["LOWER(a3.type) = LOWER('TA')"];
  appendDistrictNameCondition(conditions, params, "d.name", district);
  appendOptionalTaCondition(conditions, params, "a3.name", ta);
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function queryTAReportData(ta, district, { fullRaw = false } = {}) {
  const summaryParams = [];
  const whereClause = buildTaWhereClause(ta, district, summaryParams);

  const summarySql = `
    SELECT
      COALESCE(a3.population_total, 0) AS total_population,
      COALESCE(schools.total_schools, 0) AS total_schools,
      COALESCE(health.total_health_facilities, 0) AS total_health_facilities,
      COALESCE(flood.exposed_population, 0) AS flood_exposed_population,
      COALESCE(flood.total_facilities, 0) AS flood_total_facilities,
      COALESCE(d.name, '') AS district_name,
      COALESCE(a3.name, '') AS ta_name
    FROM admin3_units a3
    JOIN districts d ON d.id = a3.district_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total_schools
      FROM education_facilities ef
      WHERE ef.ta_id = a3.id
    ) schools ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total_health_facilities
      FROM health_facilities hf
      WHERE hf.ta_id = a3.id
    ) health ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(total_facilities), 0) AS total_facilities,
        COALESCE(SUM(exposed_facilities), 0) AS exposed_population
      FROM flood_facility_exposure_summary f
      WHERE LOWER(f.ta_name) = LOWER(a3.name)
        AND LOWER(f.district_name) = LOWER(d.name)
    ) flood ON TRUE
    ${whereClause}
    LIMIT 1;
  `;

  const summaryResult = await db.query(summarySql, summaryParams);
  const summary = summaryResult.rows[0] || {
    total_population: 0,
    total_schools: 0,
    total_health_facilities: 0,
    flood_exposed_population: 0,
    flood_total_facilities: 0,
    district_name: district || "",
    ta_name: ta || "",
  };

  const populationParams = [];
  const populationWhereClause = buildTaWhereClause(null, district, populationParams);
  const populationSql = `
    SELECT
      a3.name AS ta_name,
      COALESCE(a3.population_total, 0) AS population
    FROM admin3_units a3
    JOIN districts d ON d.id = a3.district_id
    ${populationWhereClause}
    ORDER BY a3.name;
  `;
  const populationResult = await db.query(populationSql, populationParams);

  const floodParams = [];
  const floodWhereClause = buildTaWhereClause(ta, district, floodParams);
  const floodSql = `
    SELECT
      f.facility_type,
      SUM(f.total_facilities) AS total_facilities,
      SUM(f.exposed_facilities) AS exposed_facilities
    FROM flood_facility_exposure_summary f
    JOIN admin3_units a3 ON LOWER(a3.name) = LOWER(f.ta_name)
    JOIN districts d ON d.id = a3.district_id
    ${floodWhereClause}
    GROUP BY f.facility_type
    ORDER BY f.facility_type;
  `;
  const floodResult = await db.query(floodSql, floodParams);

  const rawCountParams = [];
  const rawCountWhereClause = buildTaWhereClause(ta, district, rawCountParams);
  const rawCountSql = `
    SELECT COALESCE(SUM(record_count), 0) AS raw_records_count
    FROM (
      SELECT COUNT(*) AS record_count
      FROM health_facilities hf
      JOIN admin3_units a3 ON a3.id = hf.ta_id
      JOIN districts d ON d.id = a3.district_id
      ${rawCountWhereClause}
      UNION ALL
      SELECT COUNT(*) AS record_count
      FROM education_facilities ef
      JOIN admin3_units a3 ON a3.id = ef.ta_id
      JOIN districts d ON d.id = a3.district_id
      ${rawCountWhereClause}
      UNION ALL
      SELECT COUNT(*) AS record_count
      FROM welfare_beneficiary wb
      JOIN admin3_units a3 ON a3.id = wb.ta_id
      JOIN districts d ON d.id = a3.district_id
      ${rawCountWhereClause}
    ) counts;
  `;
  const rawCountResult = await db.query(rawCountSql, rawCountParams);
  const raw_records_count = Number(rawCountResult.rows[0]?.raw_records_count || 0);

  let raw_records = [];
  if (fullRaw || raw_records_count <= 10000) {
    const rawRecordsParams = [];
    const rawRecordsWhereClause = buildTaWhereClause(ta, district, rawRecordsParams);
    const rawRecordsSql = `
      SELECT source, record_id, name, district, ta_name AS ta, status, latitude, longitude, capacity_persons, beds_count, patient_visits_total, student_enrollment_total, program_name, gender
      FROM (
        SELECT
          'health' AS source,
          hf.id::TEXT AS record_id,
          hf.name,
          hf.district,
          a3.name AS ta_name,
          hf.status,
          hf.latitude,
          hf.longitude,
          hf."capacity:persons" AS capacity_persons,
          hf.beds_count,
          hf.patient_visits_total,
          NULL::INTEGER AS student_enrollment_total,
          NULL::TEXT AS program_name,
          NULL::TEXT AS gender
        FROM health_facilities hf
        JOIN admin3_units a3 ON a3.id = hf.ta_id
        JOIN districts d ON d.id = a3.district_id
        ${rawRecordsWhereClause}
        UNION ALL
        SELECT
          'education' AS source,
          ef.school_id::TEXT AS record_id,
          ef.school_name AS name,
          ef.district,
          a3.name AS ta_name,
          ef.status,
          ef.y_coordinate AS latitude,
          ef.x_coordinate AS longitude,
          NULL::INTEGER AS capacity_persons,
          NULL::INTEGER AS beds_count,
          NULL::INTEGER AS patient_visits_total,
          ef.student_enrollment_total,
          NULL::TEXT AS program_name,
          NULL::TEXT AS gender
        FROM education_facilities ef
        JOIN admin3_units a3 ON a3.id = ef.ta_id
        JOIN districts d ON d.id = a3.district_id
        ${rawRecordsWhereClause}
        UNION ALL
        SELECT
          'welfare' AS source,
          wb.id::TEXT AS record_id,
          wb.program_name AS name,
          d.name AS district,
          a3.name AS ta_name,
          wb.status,
          wb.center_lat AS latitude,
          wb.center_long AS longitude,
          NULL::INTEGER AS capacity_persons,
          NULL::INTEGER AS beds_count,
          NULL::INTEGER AS patient_visits_total,
          NULL::INTEGER AS student_enrollment_total,
          wb.program_name,
          wb.gender
        FROM welfare_beneficiary wb
        JOIN admin3_units a3 ON a3.id = wb.ta_id
        JOIN districts d ON d.id = a3.district_id
        ${rawRecordsWhereClause}
      ) records
      ORDER BY source, record_id
      ${fullRaw ? "" : "LIMIT 200"};
    `;
    const rawRecordsResult = await db.query(rawRecordsSql, rawRecordsParams);
    raw_records = rawRecordsResult.rows;
  }

  const geojsonParams = [];
  const geojsonWhereClause = buildTaWhereClause(ta, district, geojsonParams);
  const geojsonSql = `
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
    ) AS geojson
    FROM (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', a3.id,
        'geometry', ST_AsGeoJSON(a3.geom)::jsonb,
        'properties', jsonb_build_object(
          'name', a3.name,
          'district', d.name
        )
      ) AS feature
      FROM admin3_units a3
      JOIN districts d ON d.id = a3.district_id
      ${geojsonWhereClause}
    ) features;
  `;
  const geojsonResult = await db.query(geojsonSql, geojsonParams);
  const map_geojson = geojsonResult.rows[0]?.geojson || { type: "FeatureCollection", features: [] };

  return {
    summary,
    population_by_ta: populationResult.rows,
    flood_distribution: floodResult.rows,
    map_geojson,
    raw_records_count,
    raw_records,
  };
}

function drawPolyline(doc, points) {
  points.forEach((point, index) => {
    const [x, y] = point;
    if (index === 0) {
      doc.moveTo(x, y);
    } else {
      doc.lineTo(x, y);
    }
  });
}

function drawTaGeometry(doc, geojson, left, top, width, height) {
  const features = (geojson.features || []).filter((feature) => feature.geometry);
  if (!features.length) {
    doc.rect(left, top, width, height).stroke();
    doc.text("TA boundary geometry unavailable", left + 10, top + 20);
    return;
  }

  const coords = [];
  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach((ring) => ring.forEach((point) => coords.push(point)));
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => ring.forEach((point) => coords.push(point))));
    }
  });

  if (!coords.length) {
    doc.rect(left, top, width, height).stroke();
    doc.text("TA boundary geometry unavailable", left + 10, top + 20);
    return;
  }

  const xs = coords.map((c) => c[0]);
  const ys = coords.map((c) => c[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const scale = Math.min(width / Math.max(maxX - minX, 1), height / Math.max(maxY - minY, 1));
  const xOffset = left - minX * scale + (width - (maxX - minX) * scale) / 2;
  const yOffset = top + height + minY * scale - (height - (maxY - minY) * scale) / 2;

  doc.save();
  doc.strokeColor("#1f2937").lineWidth(1);

  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach((ring) => {
        drawPolyline(doc, ring.map(([x, y]) => [x * scale + xOffset, yOffset - y * scale]));
        doc.closePath();
        doc.fillOpacity(0.12).fillAndStroke("#bfdbfe", "#1d4ed8");
      });
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => {
        drawPolyline(doc, ring.map(([x, y]) => [x * scale + xOffset, yOffset - y * scale]));
        doc.closePath();
        doc.fillOpacity(0.12).fillAndStroke("#bfdbfe", "#1d4ed8");
      }));
    }
  });

  doc.restore();
}

async function generateReportPdfBuffer(report) {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const buffers = [];
  doc.on("data", (chunk) => buffers.push(chunk));

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.fontSize(18).text(`TA Report – ${report.summary.ta_name}`, { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Area / District: ${report.summary.district_name || "N/A"}`);
    doc.text(`Date Generated: ${formatDate(new Date())}`);
    doc.text(`Data Period: Latest available`);
    doc.moveDown(1);

    doc.fontSize(14).text("Analysis Summary");
    doc.moveDown(0.5);

    const indicators = [
      ["Indicator", "Current Value", "More Info"],
      ["Estimated Population", String(report.summary.total_population), "See TA population and service planning."],
      ["Schools", String(report.summary.total_schools), "Count of schools in the selected TA."],
      ["Health Facilities", String(report.summary.total_health_facilities), "Count of health facilities in the selected TA."],
      ["Flood-Exposed Population", String(report.summary.flood_exposed_population), "Number of people exposed to flood risk."],
    ];

    const tableTop = doc.y;
    const itemSpacing = 20;
    indicators.forEach((row, index) => {
      const y = tableTop + index * itemSpacing;
      doc.fontSize(10).text(row[0], 40, y);
      doc.text(row[1], 220, y);
      doc.text(row[2], 340, y, { width: 200 });
    });
    doc.moveDown(7);

    doc.fontSize(14).text("Main Resources");
    doc.moveDown(0.5);
    report.resources.forEach((resource) => {
      doc.fontSize(11).text(`• ${resource.title}`, { continued: false });
      doc.fontSize(10).text(`  ${resource.reason}`);
    });

    doc.addPage();
    doc.fontSize(14).text("TA Map");
    drawTaGeometry(doc, report.map_geojson, 40, 120, 512, 340);
    doc.addPage();
    doc.fontSize(14).text("Data Availability");
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Raw records in TA: ${report.raw_records_count}`);
    doc.fontSize(10).text("Full raw record export available in the accompanying Excel file.");
    doc.end();
  });
}

async function generateExcelBuffer(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Analysis");
  sheet.addRow(["Indicator", "Current Value", "Context"]);
  sheet.addRow(["Estimated Population", report.summary.total_population, "Population totals for the TA"]);
  sheet.addRow(["Schools", report.summary.total_schools, "Education service count for the TA"]);
  sheet.addRow(["Health Facilities", report.summary.total_health_facilities, "Health service count for the TA"]);
  sheet.addRow(["Flood-Exposed Population", report.summary.flood_exposed_population, "Flood exposure estimate for the TA"]);

  const rawSheet = workbook.addWorksheet("RawData");
  rawSheet.columns = [
    { header: "Source", key: "source", width: 15 },
    { header: "Record ID", key: "record_id", width: 15 },
    { header: "Name", key: "name", width: 30 },
    { header: "District", key: "district", width: 20 },
    { header: "TA", key: "ta", width: 20 },
    { header: "Status", key: "status", width: 15 },
    { header: "Latitude", key: "latitude", width: 15 },
    { header: "Longitude", key: "longitude", width: 15 },
    { header: "Capacity", key: "capacity_persons", width: 15 },
    { header: "Beds", key: "beds_count", width: 15 },
    { header: "Visits", key: "patient_visits_total", width: 15 },
    { header: "Students", key: "student_enrollment_total", width: 15 },
    { header: "Program Name", key: "program_name", width: 25 },
    { header: "Gender", key: "gender", width: 12 },
  ];

  report.raw_records.forEach((record) => rawSheet.addRow(record));
  return workbook.xlsx.writeBuffer();
}

router.get("/ta-report", async (req, res) => {
  try {
    const { ta, district } = req.query;
    if (!ta) {
      return res.status(400).json({ status: "error", message: "ta query parameter is required" });
    }
    const data = await queryTAReportData(ta, district, { fullRaw: false });
    data.resources = [
      { title: "Administrative boundary dataset", reason: "Verify latest TA boundary and population totals." },
      { title: "Health facility registry", reason: "Review facility counts and capacity for the TA." },
      { title: "Education facility dataset", reason: "Check school coverage and student-facing resources." },
      { title: "Flood exposure summaries", reason: "Understand current flood risk and exposed population." },
    ];
    res.json({ status: "success", data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "Server error generating TA report data." });
  }
});

router.post("/ta-report", async (req, res) => {
  try {
    const { ta, district } = req.query;
    if (!ta) {
      return res.status(400).json({ status: "error", message: "ta query parameter is required" });
    }

    const report = await queryTAReportData(ta, district, { fullRaw: true });
    report.resources = [
      { title: "Administrative boundary dataset", reason: "Verify latest TA boundary and population totals." },
      { title: "Health facility registry", reason: "Review facility counts and capacity for the TA." },
      { title: "Education facility dataset", reason: "Check school coverage and student-facing resources." },
      { title: "Flood exposure summaries", reason: "Understand current flood risk and exposed population." },
    ];

    const zipName = `TA_${sanitizeFileName(report.summary.ta_name)}_${sanitizeFileName(report.summary.district_name || "Area")}_${formatDate(new Date())}.zip`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=\"${zipName}\"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    const pdfBuffer = await generateReportPdfBuffer(report);
    archive.append(pdfBuffer, { name: `TA_${sanitizeFileName(report.summary.ta_name)}_${sanitizeFileName(report.summary.district_name || "Area")}_${formatDate(new Date())}.pdf` });

    const excelBuffer = await generateExcelBuffer(report);
    archive.append(excelBuffer, { name: `TA_${sanitizeFileName(report.summary.ta_name)}_${sanitizeFileName(report.summary.district_name || "Area")}_${formatDate(new Date())}.xlsx` });

    await archive.finalize();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ status: "error", message: "Server error generating TA export." });
    }
  }
});

module.exports = router;
