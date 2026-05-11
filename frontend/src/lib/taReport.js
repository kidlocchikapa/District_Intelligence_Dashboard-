import JSZip from "jszip";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Chart, registerables } from "chart.js";
import api, { fetchJson } from "./api";

Chart.register(...registerables);

const MAX_CLIENT_ROWS = 10000;

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

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function getTAData(ta, area) {
  if (!ta) {
    throw new Error("selected TA is required to build a report.");
  }

  const query = new URLSearchParams({
    ta,
    district: area || "",
  });

  return fetchJson(`/export/ta-report?${query.toString()}`);
}

function getTrendText(currentValue, previousValue) {
  if (previousValue === null || previousValue === undefined) {
    return "No prior period comparison available.";
  }

  if (previousValue === 0) {
    return currentValue === 0
      ? "No change from the previous period."
      : "New data appeared since the previous period.";
  }

  const change = ((currentValue - previousValue) / previousValue) * 100;
  const rounded = Math.round(change * 10) / 10;

  if (rounded > 5) {
    return `Up ${rounded}% vs previous period.`;
  }
  if (rounded < -5) {
    return `Down ${Math.abs(rounded)}% vs previous period.`;
  }
  return `Stable performance with ${rounded}% change.`;
}

function getStatus(value, thresholds) {
  if (value == null || Number.isNaN(Number(value))) {
    return "Amber";
  }

  if (thresholds.high != null && value >= thresholds.high) {
    return "Green";
  }
  if (thresholds.medium != null && value >= thresholds.medium) {
    return "Amber";
  }
  return "Red";
}

function buildIndicators(summary) {
  const population = Number(summary.total_population || 0);
  const schools = Number(summary.total_schools || 0);
  const healthFacilities = Number(summary.total_health_facilities || 0);
  const exposedPopulation = Number(summary.flood_exposed_population || 0);
  const exposurePct = population > 0 ? (exposedPopulation * 100) / population : 0;

  return [
    {
      indicator: "Estimated Population",
      currentValue: population,
      trend: getTrendText(population, summary.previous_population),
      status: getStatus(population, { high: 25000, medium: 12000 }),
      insight: `This TA has an estimated ${population.toLocaleString()} people, which sets planning priority for service delivery.`,
    },
    {
      indicator: "Schools",
      currentValue: schools,
      trend: getTrendText(schools, summary.previous_schools),
      status: getStatus(schools, { high: 15, medium: 8 }),
      insight: `There are ${schools} schools in the TA; compare with district targets to identify gaps.`,
    },
    {
      indicator: "Health Facilities",
      currentValue: healthFacilities,
      trend: getTrendText(healthFacilities, summary.previous_health_facilities),
      status: getStatus(healthFacilities, { high: 10, medium: 5 }),
      insight: `The count of healthcare facilities indicates local access potential for the population.`,
    },
    {
      indicator: "Flood-Exposed Population",
      currentValue: exposedPopulation,
      trend: getTrendText(exposedPopulation, summary.previous_flood_exposed_population),
      status: getStatus(exposurePct, { high: 5, medium: 2 }),
      insight: `Approximately ${exposurePct.toFixed(1)}% of residents face flood exposure risk.`,
    },
  ];
}

export function getMainResources(ta) {
  const target = ta || "the selected TA";

  return [
    {
      title: "TA boundary and demographics",
      reason: `Verify population totals and boundary extent for ${target}.`,
    },
    {
      title: "Health facility registry",
      reason: `Review the current health facility footprint and capacity within ${target}.`,
    },
    {
      title: "School and education dataset",
      reason: `Validate educational resource coverage used in TA-level decision making.`,
    },
    {
      title: "Flood exposure dataset",
      reason: `Confirm exposure and risk metrics for priority response planning.`,
    },
    {
      title: "TA-level service delivery summary",
      reason: `Use this dataset to compare resources, access, and vulnerability.`,
    },
  ];
}

function getChartDescription(title, currentValue, previousValue, status) {
  const direction = previousValue == null
    ? "No prior period reference"
    : currentValue > previousValue
      ? "increased"
      : currentValue < previousValue
        ? "decreased"
        : "remained stable";

  const percentage = previousValue
    ? `${Math.round(((currentValue - previousValue) / previousValue) * 100)}%`
    : "N/A";

  return `${title} ${direction} ${percentage} compared to the previous period. ${status === "Red" ? "This requires urgent review." : status === "Amber" ? "Monitor the trend closely." : "This area is tracking positively."}`;
}

function buildChartConfig(data, title, type = "bar") {
  return {
    type,
    data: {
      labels: data.map((item) => item.label || item.name || item.ta || item.facility_type),
      datasets: [
        {
          label: title,
          data: data.map((item) => Number(item.value ?? item.population ?? item.exposed_population ?? item.total_facilities ?? 0)),
          backgroundColor: data.map((item) => item.color || "#4A72E4"),
          borderColor: "#1f2937",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: title, font: { size: 16 } },
      },
      scales: {
        x: { ticks: { color: "#475569", font: { size: 10 } } },
        y: { ticks: { color: "#475569", font: { size: 10 } }, beginAtZero: true },
      },
    },
  };
}

async function renderChartToPNG({ labels, datasets, title, type = "bar", width = 900, height = 500 }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Unable to create chart canvas.");

  const chart = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: title, font: { size: 18 } },
      },
      scales: {
        x: { ticks: { color: "#1f2937", font: { size: 10 } } },
        y: { beginAtZero: true, ticks: { color: "#1f2937", font: { size: 10 } } },
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 40));
  const dataUrl = canvas.toDataURL("image/png");
  chart.destroy();
  return dataUrl;
}

function normalizeGeoJson(geojson) {
  if (!geojson) {
    return { type: "FeatureCollection", features: [] };
  }
  if (geojson.type === "Feature") {
    return { type: "FeatureCollection", features: [geojson] };
  }
  return geojson;
}

function getGeoJsonBounds(geojson) {
  const features = normalizeGeoJson(geojson).features || [];
  const coords = [];

  features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) {
      return;
    }

    const processCoords = (ring) => {
      ring.forEach(([x, y]) => coords.push([x, y]));
    };

    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach(processCoords);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => polygon.forEach(processCoords));
    }
  });

  if (!coords.length) {
    return null;
  }

  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

async function renderMapToPNG(geojson, width = 900, height = 520) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Unable to render map to PNG.");
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1.5;
  ctx.fillStyle = "#e2e8f0";

  const bounds = getGeoJsonBounds(geojson);
  if (!bounds) {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(40, 40, width - 80, height - 80);
    ctx.fillStyle = "#475569";
    ctx.font = "18px sans-serif";
    ctx.fillText("TA boundary not found in data.", 60, 80);
    return canvas.toDataURL("image/png");
  }

  const padding = 40;
  const scaleX = (width - padding * 2) / Math.max(bounds.maxX - bounds.minX, 1);
  const scaleY = (height - padding * 2) / Math.max(bounds.maxY - bounds.minY, 1);
  const scale = Math.min(scaleX, scaleY);
  const offsetX = padding - bounds.minX * scale + (width - padding * 2 - (bounds.maxX - bounds.minX) * scale) / 2;
  const offsetY = padding + bounds.maxY * scale + (height - padding * 2 - (bounds.maxY - bounds.minY) * scale) / 2;

  normalizeGeoJson(geojson).features.forEach((feature) => {
    const geometry = feature.geometry;
    if (!geometry) return;
    ctx.beginPath();
    const drawRing = (ring) => {
      ring.forEach(([x, y], index) => {
        const canvasX = x * scale + offsetX;
        const canvasY = -y * scale + offsetY;
        if (index === 0) {
          ctx.moveTo(canvasX, canvasY);
        } else {
          ctx.lineTo(canvasX, canvasY);
        }
      });
    };
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach((ring) => drawRing(ring));
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => drawRing(ring)));
    }
    ctx.closePath();
    ctx.fillStyle = "#dbeafe";
    ctx.fill();
    ctx.strokeStyle = "#1e3a8a";
    ctx.stroke();
  });

  ctx.fillStyle = "#0f172a";
  ctx.font = "16px sans-serif";
  ctx.fillText("TA boundary map", padding, height - 18);

  return canvas.toDataURL("image/png");
}

function buildAnalysisTable(report) {
  const indicators = buildIndicators(report.summary);
  return indicators.map((row) => [
    row.indicator,
    row.currentValue?.toLocaleString?.() ?? row.currentValue,
    row.trend,
    row.status,
    row.insight,
  ]);
}

async function buildPdfBlob(report, chartImages, mapImage) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const margin = 40;
  const titleY = 60;

  pdf.setFontSize(18);
  pdf.text(`TA Report – ${report.ta_name}`, margin, titleY);
  pdf.setFontSize(12);
  pdf.text(`Area / District: ${report.district_name || "N/A"}`, margin, titleY + 26);
  pdf.text(`Date Generated: ${formatDate(new Date())}`, margin, titleY + 42);
  pdf.text(`Data Period: ${report.data_period || "Latest available"}`, margin, titleY + 58);

  pdf.setFontSize(14);
  pdf.text("Analysis Summary", margin, titleY + 96);

  autoTable(pdf, {
    startY: titleY + 108,
    head: [["Indicator", "Current Value", "Trend vs Previous Period", "Status", "Interpretation / Insight"]],
    body: buildAnalysisTable(report),
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
  });

  pdf.addPage();
  pdf.setFontSize(16);
  pdf.text("Main Resources", margin, 50);
  pdf.setFontSize(11);
  report.resources.forEach((item, index) => {
    const y = 75 + index * 28;
    pdf.text(`• ${item.title}`, margin, y);
    pdf.setFontSize(10);
    pdf.text(item.reason, margin + 14, y + 14, { maxWidth: 500 });
    pdf.setFontSize(11);
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  let currentY = 50;

  for (const chartEntry of chartImages) {
    if (currentY + 280 > pdf.internal.pageSize.getHeight()) {
      pdf.addPage();
      currentY = 50;
    }
    pdf.setFontSize(14);
    pdf.text(chartEntry.title, margin, currentY);
    currentY += 18;
    pdf.addImage(chartEntry.image, "PNG", margin, currentY, pageWidth - margin * 2, 200);
    currentY += 210;
    pdf.setFontSize(10);
    pdf.text(chartEntry.analysis, margin, currentY, { maxWidth: pageWidth - margin * 2 });
    currentY += 34;
  }

  pdf.addPage();
  pdf.setFontSize(16);
  pdf.text("Raw Records", margin, 50);
  const rawRows = (report.raw_records || []).slice(0, 16).map((row) => [
    row.source,
    row.record_id,
    row.name || row.program_name || "",
    row.district || "",
    row.ta || "",
    row.latitude || "",
    row.longitude || "",
  ]);

  autoTable(pdf, {
    startY: 70,
    head: [["Source", "Record ID", "Name", "District", "TA", "Lat", "Lon"]],
    body: rawRows,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
  });

  pdf.addPage();
  pdf.setFontSize(16);
  pdf.text("TA Map", margin, 50);
  if (mapImage) {
    pdf.addImage(mapImage, "PNG", margin, 70, pageWidth - margin * 2, 320);
    pdf.setFontSize(10);
    pdf.text("TA boundary visualization generated from TA geometry data.", margin, 405);
  } else {
    pdf.setFontSize(11);
    pdf.text("No map geometry available for the selected TA.", margin, 80);
  }

  return pdf.output("blob");
}

function buildExcelWorkbook(report) {
  const workbook = XLSX.utils.book_new();

  const indicators = buildIndicators(report.summary).map((row) => ({
    Indicator: row.indicator,
    "Current Value": row.currentValue,
    "Trend vs Previous Period": row.trend,
    Status: row.status,
    Insight: row.insight,
  }));
  const analysisSheet = XLSX.utils.json_to_sheet(indicators);
  XLSX.utils.book_append_sheet(workbook, analysisSheet, "Analysis");

  const rawRows = (report.raw_records || []).map((row) => ({
    Source: row.source,
    RecordID: row.record_id,
    Name: row.name || row.program_name || "",
    District: row.district,
    TA: row.ta,
    Status: row.status,
    Latitude: row.latitude,
    Longitude: row.longitude,
    Capacity: row.capacity_persons,
    Beds: row.beds_count,
    Visits: row.patient_visits_total,
    Students: row.student_enrollment_total,
    ProgramName: row.program_name,
    Gender: row.gender,
  }));
  const rawSheet = XLSX.utils.json_to_sheet(rawRows);
  XLSX.utils.book_append_sheet(workbook, rawSheet, "RawData");

  return workbook;
}

async function createZipBlob(report, chartImages, mapImage) {
  const pdfBlob = await buildPdfBlob(report, chartImages, mapImage);
  const workbook = buildExcelWorkbook(report);
  const excelArrayBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });

  const zip = new JSZip();
  zip.file(`TA_${sanitizeFileName(report.ta_name)}_${sanitizeFileName(report.district_name || "Area")}_${formatDate(new Date())}.pdf`, pdfBlob);
  zip.file(`TA_${sanitizeFileName(report.ta_name)}_${sanitizeFileName(report.district_name || "Area")}_${formatDate(new Date())}.xlsx`, excelArrayBuffer);
  const content = await zip.generateAsync({ type: "blob" });
  return content;
}

async function downloadServerZip(ta, area) {
  const query = new URLSearchParams({ ta, district: area || "" }).toString();
  const response = await api.post(
    `/export/ta-report?${query}`,
    { format: "zip" },
    { responseType: "blob" },
  );
  const filename = `TA_${sanitizeFileName(ta)}_${sanitizeFileName(area || "Area")}_${formatDate(new Date())}.zip`;
  downloadBlob(response.data, filename);
}

export async function downloadTAReport(ta, area, currentView = {}) {
  const report = await getTAData(ta, area);
  if (!report || report.raw_records_count === 0) {
    throw new Error(`No data available for ${ta} to export.`);
  }

  if (report.raw_records_count > MAX_CLIENT_ROWS) {
    await downloadServerZip(ta, area);
    return;
  }

  const populationData = currentView.populationData || report.population_by_ta || [];
  const floodData = currentView.floodData || report.flood_distribution || [];

  const chartImages = [];

  if (populationData.length > 0) {
    chartImages.push({
      title: "Population by TA",
      image: await renderChartToPNG({
        labels: populationData.map((item) => item.admin3_name || item.ta || item.label),
        datasets: [
          {
            label: "Population",
            data: populationData.map((item) => Number(item.population || item.value || 0)),
            backgroundColor: populationData.map(() => "#4A72E4"),
          },
        ],
        width: 900,
        height: 420,
      }),
      analysis: getChartDescription(
        "Population by TA",
        report.summary.total_population,
        report.summary.previous_population,
        getStatus(report.summary.total_population, { high: 25000, medium: 12000 }),
      ),
    });
  }

  if (floodData.length > 0) {
    chartImages.push({
      title: "Flood Exposure by Category",
      image: await renderChartToPNG({
        labels: floodData.map((item) => item.facility_type || item.label),
        datasets: [
          {
            label: "Exposed",
            data: floodData.map((item) => Number(item.exposed_facilities || item.value || 0)),
            backgroundColor: floodData.map(() => "#f97316"),
          },
        ],
        type: "bar",
        width: 900,
        height: 420,
      }),
      analysis: getChartDescription(
        "Flood exposure distribution",
        Number(report.summary.flood_exposed_population || 0),
        report.summary.previous_flood_exposed_population || null,
        getStatus(report.summary.flood_exposed_population || 0, { high: 5, medium: 2 }),
      ),
    });
  }

  const mapImage = await renderMapToPNG(report.map_geojson || {});
  const zipBlob = await createZipBlob(report, chartImages, mapImage);
  const filename = `TA_${sanitizeFileName(ta)}_${sanitizeFileName(area || "Area")}_${formatDate(new Date())}.zip`;
  downloadBlob(zipBlob, filename);
}

export async function fetchServerReportZip(ta, area) {
  await downloadServerZip(ta, area);
}
