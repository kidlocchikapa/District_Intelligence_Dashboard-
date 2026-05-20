import { useMemo } from "react";
import {
  Download,
  Map as MapIcon,
  Users,
  School,
  HeartPulse,
  ShieldAlert,
  Layers3,
  Waves,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { buildDashboardPath } from "../lib/query";
import { usePdfExport } from "../hooks/usePdfExport";
import { useImageDownload } from "../hooks/useImageDownload";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import MapPanel from "../components/MapPanel";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Rectangle,
  Cell,
} from "recharts";

const PIE_COLORS = ["#e85d3f", "#f4c95d", "#2667ff", "#56ab91"];
const PRIORITY_BAND_CLASSES = {
  Critical: "border-red-200 bg-red-50 text-red-700",
  High: "border-amber-200 bg-amber-50 text-amber-700",
  Moderate: "border-blue-200 bg-blue-50 text-blue-700",
  Watch: "border-slate-200 bg-slate-50 text-slate-700",
};
const COMPARISON_COLORS = ["#c2410c", "#2563eb", "#7c3aed", "#0f766e"];

function getPopulationBarColor(value, maxPopulation) {
  if (!Number.isFinite(value) || maxPopulation <= 0) {
    return "#cbd5e1";
  }

  const ratio = value / maxPopulation;
  if (ratio >= 0.8) return "#dc2626";
  if (ratio >= 0.55) return "#8b5e3c";
  if (ratio >= 0.3) return "#2563eb";
  return "#22c55e";
}

function formatTaAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 16) {
    return value;
  }

  return `${value.slice(0, 16)}…`;
}

function formatStat(value, digits = 0) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 1) {
  return `${formatStat(value, digits)}%`;
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function averageOf(items, field) {
  if (!items.length) {
    return 0;
  }

  const total = items.reduce(
    (sum, item) => sum + Number(item?.[field] || 0),
    0,
  );
  return total / items.length;
}

function metricFromRows(rows, keys) {
  if (!Array.isArray(rows)) {
    return 0;
  }

  for (const key of keys) {
    const match = rows.find(
      (row) => normalizeName(row?.metric_name) === normalizeName(key),
    );
    if (match) {
      return Number(match.metric_value || 0);
    }
  }

  return 0;
}

function getPriorityBandClass(band) {
  return PRIORITY_BAND_CLASSES[band] || PRIORITY_BAND_CLASSES.Watch;
}

function OverviewPage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const districtScope = selectedDistrict || "";
  const scopeLabel = selectedTa
    ? selectedTa
    : selectedDistrict
      ? selectedDistrict
      : "All Districts";

  const summary = useDashboardData(
    buildDashboardPath("/dashboard/summary", {
      district: districtScope,
      ta: selectedTa,
    }),
  );
  const densityMap = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      district: districtScope,
      type: "TA",
    }),
  );
  const populationDistribution = useDashboardData(
    buildDashboardPath("/dashboard/population-by-admin3", {
      district: districtScope,
      type: "TA",
    }),
  );
  const floodSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/summary", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
    }),
  );
  const taFloodExposure = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/population", {
      district: districtScope,
      admin_type: "TA",
    }),
  );
  const taServiceStats = useDashboardData(
    buildDashboardPath("/dashboard/ta-service-stats", {
      district: districtScope,
      type: "TA",
    }),
  );
  const educationSummary = useDashboardData(
    buildDashboardPath("/dashboard/education/summary", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
    }),
  );
  const healthSummary = useDashboardData(
    buildDashboardPath("/dashboard/health/summary", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
    }),
  );
  const welfareIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
      preview_limit: 0,
    }),
  );
  const planningPriorities = useDashboardData(
    buildDashboardPath("/dashboard/planning-priorities", {
      district: districtScope,
      ta: selectedTa,
      admin_type: "TA",
      department: "overview",
      limit: 5,
    }),
  );
  const dataFreshness = useDashboardData(
    buildDashboardPath("/dashboard/data-freshness"),
  );

  const chartData = (populationDistribution.data || []).map((item) => ({
    admin3Id: item.admin3_id,
    admin3: item.admin3_name,
    district: item.district,
    population: item.population,
  }));

  const selectedTaChartRow = chartData.find(
    (item) => normalizeName(item.admin3) === normalizeName(selectedTa),
  );

  const taFloodLookup = useMemo(() => {
    const lookup = new Map();

    (taFloodExposure.data || []).forEach((row) => {
      if (!row.admin_unit_name) {
        return;
      }

      lookup.set(normalizeName(row.admin_unit_name), {
        exposedPopulation: Number(row.exposed_population || 0),
        exposedPopulationPct: Number(row.exposed_population_pct || 0),
        riskLevel: row.risk_level,
      });
    });

    return lookup;
  }, [taFloodExposure.data]);

  const taServiceLookup = useMemo(() => {
    const lookup = new Map();

    (taServiceStats.data || []).forEach((row) => {
      const taId = Number(row.ta_id);
      if (Number.isFinite(taId)) {
        lookup.set(taId, row);
      }

      if (row.ta_name) {
        lookup.set(`name:${normalizeName(row.ta_name)}`, row);
      }
    });

    return lookup;
  }, [taServiceStats.data]);

  const priorityRows =
    planningPriorities.data?.all_priorities ||
    planningPriorities.data?.priorities ||
    [];

  const priorityLookup = useMemo(() => {
    const lookup = new Map();

    priorityRows.forEach((row) => {
      const unitId = Number(row.admin_unit_id);
      if (Number.isFinite(unitId)) {
        lookup.set(unitId, row);
      }

      if (row.admin_unit_name) {
        lookup.set(`name:${normalizeName(row.admin_unit_name)}`, row);
      }
    });

    return lookup;
  }, [priorityRows]);

  const selectedPriorityRow = useMemo(() => {
    if (!selectedTa) {
      return null;
    }

    return (
      priorityRows.find(
        (row) =>
          normalizeName(row.admin_unit_name) === normalizeName(selectedTa),
      ) || null
    );
  }, [priorityRows, selectedTa]);

  const priorityMapGeojson = useMemo(() => {
    if (!densityMap.data) {
      return densityMap.data;
    }

    const features = (densityMap.data.features || []).map((feature) => {
      const properties = feature?.properties || {};
      const featureId = Number(feature?.id);
      const featureName = properties.name || properties.admin_unit_name || "";
      const priority =
        (Number.isFinite(featureId) && priorityLookup.get(featureId)) ||
        priorityLookup.get(`name:${normalizeName(featureName)}`) ||
        null;

      return {
        ...feature,
        properties: {
          ...properties,
          admin_unit_name: featureName,
          planning_priority_score: Number(
            priority?.planning_priority_score || 0,
          ),
          priority_band: priority?.priority_band || "Watch",
          flood_risk_score: Number(priority?.flood_risk_score || 0),
          service_gap_score: Number(priority?.service_gap_score || 0),
          beneficiary_density_score: Number(
            priority?.beneficiary_density_score || 0,
          ),
          education_vulnerability_score: Number(
            priority?.education_vulnerability_score || 0,
          ),
          health_vulnerability_score: Number(
            priority?.health_vulnerability_score || 0,
          ),
          beneficiaries_count: Number(priority?.beneficiary_count || 0),
          schools_count: Number(priority?.schools_count || 0),
          health_facilities_count: Number(
            priority?.health_facilities_count || 0,
          ),
          flood_exposed_population_pct: Number(
            priority?.flood_exposed_population_pct || 0,
          ),
        },
      };
    });

    return { ...densityMap.data, features };
  }, [densityMap.data, priorityLookup]);

  const populationMapGeojson = useMemo(() => {
    if (!densityMap.data) {
      return densityMap.data;
    }

    const features = (densityMap.data.features || [])
      .filter((feature) => {
        const name = feature?.properties?.name || "";
        return !selectedTa || normalizeName(name) === normalizeName(selectedTa);
      })
      .map((feature) => {
        const name = feature?.properties?.name || "";
        const floodStats = taFloodLookup.get(normalizeName(name)) || {};
        const featureId = Number(feature?.id);
        const serviceStats =
          (Number.isFinite(featureId) && taServiceLookup.get(featureId)) ||
          taServiceLookup.get(`name:${normalizeName(name)}`) ||
          {};

        return {
          ...feature,
          properties: {
            ...feature.properties,
            admin_unit_name: name,
            exposed_population: floodStats.exposedPopulation || 0,
            exposed_population_pct: floodStats.exposedPopulationPct || 0,
            risk_level: floodStats.riskLevel,
            schools_count: Number(serviceStats.schools_count || 0),
            hospitals_count: Number(serviceStats.hospitals_count || 0),
            beneficiaries_count: Number(serviceStats.beneficiaries_count || 0),
            health_facilities_count: Number(
              serviceStats.health_facilities_count || 0,
            ),
          },
        };
      });

    return {
      ...densityMap.data,
      features,
    };
  }, [densityMap.data, selectedTa, taFloodLookup, taServiceLookup]);

  const exposedPopulation = Math.max(
    Math.round(Number(floodSummary.data?.exposed_population || 0)),
    0,
  );
  const notExposedPopulation = Math.max(
    Math.round(Number(floodSummary.data?.not_exposed_population || 0)),
    0,
  );
  const pieData = [
    { name: "Exposed", value: exposedPopulation },
    { name: "Not Exposed", value: notExposedPopulation },
  ].filter((entry) => entry.value > 0);

  const maxPopulation = Math.max(
    ...chartData.map((item) => Number(item.population) || 0),
    0,
  );

  const healthRows = Array.isArray(healthSummary.data)
    ? healthSummary.data
    : [];
  const welfareSummary = welfareIntegration.data?.summary || {};
  const educationData = educationSummary.data || {};

  const comparisonSource = selectedPriorityRow
    ? [selectedPriorityRow]
    : priorityRows;
  const comparisonData = [
    {
      name: "Education",
      score: averageOf(comparisonSource, "education_vulnerability_score"),
      color: COMPARISON_COLORS[0],
    },
    {
      name: "Health",
      score: averageOf(comparisonSource, "health_vulnerability_score"),
      color: COMPARISON_COLORS[1],
    },
    {
      name: "Welfare",
      score: averageOf(comparisonSource, "beneficiary_density_score"),
      color: COMPARISON_COLORS[2],
    },
    {
      name: "Disaster",
      score: averageOf(comparisonSource, "flood_risk_score"),
      color: COMPARISON_COLORS[3],
    },
  ];

  const healthFacilityCount = metricFromRows(healthRows, [
    "health_facilities_count",
    "facility_count",
    "health_facility_count",
  ]);
  const healthServedPopulation = metricFromRows(healthRows, [
    "population_served",
    "population_served_total",
    "served_population_total",
  ]);
  const healthCoveragePct = metricFromRows(healthRows, [
    "health_service_coverage_pct",
    "service_coverage_pct",
  ]);

  const snapshotCards = [
    {
      title: "Education",
      primary: `${formatStat(educationData.school_count || 0)} schools`,
      secondary: `${formatStat(educationData.not_in_school_total || 0)} learners likely out of school`,
      accent: "bg-amber-50 text-amber-700 border-amber-100",
    },
    {
      title: "Health",
      primary: `${formatStat(healthFacilityCount || summary.data?.total_health_facilities || 0)} facilities`,
      secondary: healthCoveragePct
        ? `${formatPercent(healthCoveragePct)} service coverage`
        : `${formatStat(healthServedPopulation)} served population`,
      accent: "bg-blue-50 text-blue-700 border-blue-100",
    },
    {
      title: "Welfare",
      primary: `${formatStat(welfareSummary.total_beneficiaries || 0)} beneficiaries`,
      secondary: `${formatPercent(welfareSummary.health_access_pct || 0)} health-access linked`,
      accent: "bg-violet-50 text-violet-700 border-violet-100",
    },
    {
      title: "Disaster",
      primary: `${formatStat(exposedPopulation)} exposed residents`,
      secondary: `${formatPercent(floodSummary.data?.exposed_population_pct || 0)} of current scope`,
      accent: "bg-emerald-50 text-emerald-700 border-emerald-100",
    },
  ];

  const overviewStats = [
    {
      label: "Total Population",
      value: formatStat(
        selectedTaChartRow?.population ||
          summary.data?.total_estimated_population ||
          0,
      ),
      icon: Users,
      helper: scopeLabel,
    },
    {
      label: "Schools",
      value: formatStat(summary.data?.total_schools || 0),
      icon: School,
      helper: scopeLabel,
    },
    {
      label: "Health Facilities",
      value: formatStat(summary.data?.total_health_facilities || 0),
      icon: HeartPulse,
      helper: scopeLabel,
    },
    {
      label: "Welfare Beneficiaries",
      value: formatStat(welfareSummary.total_beneficiaries || 0),
      icon: Layers3,
      helper: scopeLabel,
    },
    {
      label: "Flood Exposed Population",
      value: formatStat(exposedPopulation),
      icon: Waves,
      helper: scopeLabel,
    },
    {
      label: "Highest Priority Score",
      value: formatStat(
        selectedPriorityRow?.planning_priority_score ||
          planningPriorities.data?.summary?.highest_priority_score ||
          0,
        1,
      ),
      icon: ShieldAlert,
      helper:
        selectedPriorityRow?.admin_unit_name ||
        planningPriorities.data?.summary?.highest_priority_area ||
        scopeLabel,
    },
  ];

  const freshnessRows = (dataFreshness.data || []).map((item) => ({
    ...item,
    label: String(item.dataset || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  }));

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
  };

  const { exportDataPdf } = usePdfExport("Overview_AreaAnalysis.pdf");
  const { targetRef: mapRef, downloadImage } = useImageDownload(
    "Zomba_Overview_Map.png",
  );

  const handleDownloadReport = async () => {
    if (!selectedDistrict && !selectedTa) {
      toast.error("Select a district or TA first to download area analysis.");
      return;
    }

    const selectedAreaName = selectedTa
      ? `TA: ${selectedTa}`
      : `District: ${selectedDistrict}`;

    const welfareRows = Object.entries(welfareSummary).map(([key, value]) => ({
      metric: key.replace(/_/g, " "),
      value: formatStat(value),
    }));

    const disasterRows = [
      {
        metric: "Flood Exposed Population",
        value: formatStat(exposedPopulation),
      },
      {
        metric: "Not Exposed Population",
        value: formatStat(notExposedPopulation),
      },
    ];
    const planningRows = (planningPriorities.data?.priorities || []).map(
      (row) => ({
        area: row.admin_unit_name,
        band: row.priority_band,
        score: formatStat(row.planning_priority_score, 1),
        action:
          row.recommended_actions?.[0] ||
          "Monitor and compare with adjacent areas",
      }),
    );

    const sections = [
      {
        title: "Population",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: [
          {
            metric: "Estimated Population",
            value: formatStat(summary.data?.total_estimated_population || 0),
          },
          {
            metric: "Flood Exposed Population",
            value: formatStat(exposedPopulation),
          },
          {
            metric: "Highest Priority Score",
            value: formatStat(
              planningPriorities.data?.summary?.highest_priority_score || 0,
              1,
            ),
          },
        ],
      },
      {
        title: "Education",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: [
          {
            metric: "School Count",
            value: formatStat(educationData.school_count || 0),
          },
          {
            metric: "Student Enrollment",
            value: formatStat(educationData.student_enrollment_total || 0),
          },
          {
            metric: "Teacher Count",
            value: formatStat(educationData.teacher_count_total || 0),
          },
          {
            metric: "School Age Population",
            value: formatStat(educationData.school_age_population_total || 0),
          },
          {
            metric: "Out-of-School Population",
            value: formatStat(educationData.not_in_school_total || 0),
          },
        ],
      },
      {
        title: "Health",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows:
          healthRows.length > 0
            ? healthRows.map((row) => ({
                metric: row.metric_name,
                value: formatStat(row.metric_value),
              }))
            : [{ metric: "Health metrics", value: "No data available" }],
      },
      {
        title: "Social Welfare",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows:
          welfareRows.length > 0
            ? welfareRows
            : [{ metric: "Welfare metrics", value: "No data available" }],
      },
      {
        title: "Disaster Risk",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: disasterRows,
      },
      {
        title: "Planning Priorities",
        columns: [
          { key: "area", label: "Area", width: 140 },
          { key: "band", label: "Priority", width: 80 },
          { key: "score", label: "Score", width: 70 },
          { key: "action", label: "Recommended Action", width: 290 },
        ],
        rows:
          planningRows.length > 0
            ? planningRows
            : [
                {
                  area: scopeLabel,
                  band: "N/A",
                  score: "0.0",
                  action:
                    "No ranked planning priorities are available for this scope yet.",
                },
              ],
      },
    ];

    await exportDataPdf({
      title: "Selected Area Sector Analysis",
      selectedArea: selectedAreaName,
      sections,
    });
  };

  const loadingAnyTopCard =
    summary.loading ||
    welfareIntegration.loading ||
    floodSummary.loading ||
    planningPriorities.loading;

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-10">
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight">
            OVERVIEW
          </h1>
          <p className="mt-2 max-w-3xl text-[14px] font-medium leading-6 text-gray-500">
            Cross-department planning view for population, service access,
            welfare pressure, and flood exposure across the current scope.
          </p>
        </div>
      </div>

      <div className="px-8 mt-8">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-[12px] font-bold uppercase tracking-[0.18em] text-gray-500">
            Scope
          </span>
          <span className="inline-flex items-center rounded-full bg-black px-4 py-1.5 text-[13px] font-bold text-white">
            {scopeLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={handleDownloadReport}
            disabled={(!selectedDistrict && !selectedTa) || summary.loading}
            title={
              selectedDistrict || selectedTa
                ? "Download analysis for selected area"
                : "Select a district or TA first"
            }
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <button
            onClick={downloadImage}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <MapIcon className="h-4 w-4" />
            Download Map
          </button>
          <SharedDistrictSelector />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 mb-10">
          {loadingAnyTopCard
            ? [...Array(6)].map((_, index) => (
                <div
                  key={index}
                  className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="h-4 w-32 bg-gray-200 rounded"></div>
                    <div className="h-5 w-5 bg-gray-100 rounded-full"></div>
                  </div>
                  <div className="h-8 w-24 bg-gray-200 rounded mt-2"></div>
                </div>
              ))
            : overviewStats.map((stat) => (
                <div
                  key={stat.label}
                  className="border border-gray-100 rounded p-6 shadow-md bg-white hover:shadow-lg transition-all group"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[14px] text-gray-500 font-bold group-hover:text-black transition-colors">
                      {stat.label}
                    </span>
                    <stat.icon className="h-5 w-5 text-gray-300 group-hover:text-black transition-colors" />
                  </div>
                  <div className="mt-4 text-[32px] font-extrabold tracking-tight">
                    {stat.value}
                  </div>
                  <p className="mt-2 text-[12px] font-semibold text-gray-400">
                    {stat.helper}
                  </p>
                </div>
              ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-8 mb-10">
          <div className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col min-h-[640px]">
            <div className="mb-6">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                <ShieldAlert className="h-4 w-4" />
                Planning Intelligence
              </div>
              <h3 className="mt-2 text-[20px] font-extrabold tracking-tight text-black">
                Priority Map For {selectedDistrict || "All Districts"}
              </h3>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                TA areas are shaded by planning priority score. Click an area to
                sync the rest of the overview.
              </p>
            </div>
            <MapPanel
              geojson={priorityMapGeojson}
              metricName="planning_priority_score"
              colorByField="priority_band"
              palette="priority-bands"
              title={null}
              subtitle={null}
              heightClass="min-h-[520px]"
              loading={densityMap.loading || planningPriorities.loading}
              showLegend
              legendTitle="Planning Priority Bands"
              selectedFeatureName={selectedTa}
              onFeatureClick={(feature) =>
                selectTa(
                  feature?.properties?.admin_unit_name ||
                    feature?.properties?.name ||
                    "",
                )
              }
              tooltipFields={[
                { key: "priority_band", label: "Priority Band" },
                { key: "beneficiaries_count", label: "Beneficiaries" },
                { key: "schools_count", label: "Schools" },
                { key: "health_facilities_count", label: "Health Facilities" },
                {
                  key: "flood_exposed_population_pct",
                  label: "Flood Exposed %",
                },
              ]}
            />
          </div>

          <section className="min-w-0 border border-gray-100 rounded p-6 shadow-sm bg-white">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                  <ShieldAlert className="h-4 w-4" />
                  Ranked Actions
                </div>
                <h3 className="mt-2 text-[20px] font-extrabold tracking-tight text-black">
                  Top Priority Areas
                </h3>
                <p className="mt-1 text-[13px] font-medium text-gray-500">
                  Highest-need areas according to the current cross-sector
                  score.
                </p>
              </div>
              {planningPriorities.data?.summary?.highest_priority_area ? (
                <div className="text-right">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
                    Highest Priority
                  </div>
                  <div className="mt-1 text-[15px] font-extrabold text-black">
                    {planningPriorities.data.summary.highest_priority_area}
                  </div>
                </div>
              ) : null}
            </div>

            {planningPriorities.loading ? (
              <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
                Loading planning priorities...
              </div>
            ) : (planningPriorities.data?.priorities || []).length === 0 ? (
              <div className="rounded border border-dashed border-gray-200 px-4 py-8 text-sm font-medium text-gray-500">
                No ranked planning priorities are available for this scope yet.
              </div>
            ) : (
              <div className="space-y-4">
                {(planningPriorities.data?.priorities || []).map((item) => {
                  const selected =
                    normalizeName(item.admin_unit_name) ===
                    normalizeName(selectedTa);

                  return (
                    <button
                      key={`${item.admin_unit_type}-${item.admin_unit_id}`}
                      type="button"
                      onClick={() => selectTa(item.admin_unit_name)}
                      className={`w-full rounded-xl border px-4 py-4 text-left transition-all ${
                        selected
                          ? "border-black bg-black text-white shadow-lg"
                          : "border-gray-100 bg-gray-50/70 hover:border-gray-200 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-extrabold ${
                                selected
                                  ? "bg-white text-black"
                                  : "bg-black text-white"
                              }`}
                            >
                              {item.rank}
                            </span>
                            <span className="text-[15px] font-extrabold">
                              {item.admin_unit_name}
                            </span>
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                                selected
                                  ? "border-white/30 bg-white/10 text-white"
                                  : getPriorityBandClass(item.priority_band)
                              }`}
                            >
                              {item.priority_band}
                            </span>
                          </div>
                          <p
                            className={`mt-2 text-[13px] leading-6 ${selected ? "text-white/80" : "text-gray-600"}`}
                          >
                            {item.narrative}
                          </p>
                        </div>
                        <div className="text-right min-w-[96px]">
                          <div
                            className={`text-[11px] font-bold uppercase tracking-[0.18em] ${selected ? "text-white/60" : "text-gray-400"}`}
                          >
                            Score
                          </div>
                          <div className="mt-1 text-[24px] font-extrabold tracking-tight">
                            {formatStat(item.planning_priority_score, 1)}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-8 mb-10">
          <section className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white">
            <div className="mb-6">
              <h3 className="text-[18px] font-extrabold text-black">
                Cross-Department Pressure Profile
              </h3>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                {selectedTa
                  ? `Normalized planning signals for ${selectedTa}.`
                  : "Average normalized planning signals across the current TA scope."}
              </p>
            </div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={comparisonData}
                  margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
                  layout="vertical"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#f1f5f9"
                  />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#111827", fontSize: 12, fontWeight: 800 }}
                    width={88}
                  />
                  <Tooltip
                    formatter={(value) => `${formatStat(value, 1)} / 100`}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 10px 20px -10px rgb(0 0 0 / 0.25)",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="score" radius={[0, 8, 8, 0]} barSize={26}>
                    {comparisonData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white">
            <div className="mb-6">
              <h3 className="text-[18px] font-extrabold text-black">
                Department Snapshots
              </h3>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                Compact cross-sector signals for the selected area.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {snapshotCards.map((card) => (
                <article
                  key={card.title}
                  className={`rounded-2xl border px-4 py-5 ${card.accent}`}
                >
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em]">
                    {card.title}
                  </div>
                  <div className="mt-3 text-[24px] font-extrabold tracking-tight">
                    {card.primary}
                  </div>
                  <p className="mt-2 text-[13px] font-semibold leading-6 opacity-85">
                    {card.secondary}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          <div className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col h-[640px]">
            <h3 className="text-[16px] font-extrabold mb-2">
              {selectedTa
                ? `${selectedTa} Population Context Map`
                : "Population Raster Map"}
            </h3>
            <p className="text-[13px] font-medium text-gray-500 mb-6">
              Existing population raster view with flood and service tooltips.
            </p>
            <div
              ref={mapRef}
              className="w-full flex-1 rounded overflow-hidden relative border border-gray-50 shadow-inner bg-gray-50"
            >
              <PopulationRasterPanel
                geojson={populationMapGeojson}
                title={null}
                subtitle={null}
                heightClass="h-full min-h-[520px] w-full"
                loading={densityMap.loading}
                metadataUrl="/worldpop/zomba_ppp_2020.preview.json"
                selectedFeatureName={selectedTa}
                customTooltipMetrics={[
                  { key: "schools_count", label: "Schools" },
                  { key: "hospitals_count", label: "Hospitals" },
                  { key: "beneficiaries_count", label: "Beneficiaries" },
                  { key: "exposed_population", label: "Flood Exposed" },
                  {
                    key: "exposed_population_pct",
                    label: "Exposure %",
                    format: "pct",
                    digits: 1,
                  },
                ]}
                onFeatureClick={(feature) =>
                  selectTa(feature?.properties?.name || "")
                }
              />
            </div>
          </div>

          <div className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col min-h-[640px]">
            <h3 className="text-[16px] font-extrabold mb-2">
              {selectedTa ? `Population for ${selectedTa}` : "Population by TA"}
            </h3>
            <p className="text-[13px] font-medium text-gray-500 mb-4">
              Click a bar to sync the selected TA across the overview.
            </p>
            <div className="flex-1">
              {populationDistribution.loading ? (
                <div className="h-full w-full flex flex-col gap-4 animate-pulse">
                  <div className="flex-1 bg-gray-50 rounded-lg relative overflow-hidden">
                    <div className="absolute inset-0 flex items-end justify-around px-4 pb-4">
                      {[...Array(8)].map((_, index) => (
                        <div
                          key={index}
                          className="w-8 bg-gray-200 rounded-t"
                          style={{ height: `${Math.random() * 60 + 20}%` }}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    margin={{ top: 20, right: 20, left: 12, bottom: 92 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="admin3"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 9, fontWeight: 700 }}
                      tickFormatter={formatTaAxisLabel}
                      angle={-90}
                      textAnchor="end"
                      interval={0}
                      height={112}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                      tickFormatter={(value) =>
                        Number(value) >= 1000000
                          ? `${(value / 1000000).toFixed(1)}M`
                          : value
                      }
                    />
                    <Tooltip
                      formatter={(value) => Number(value).toLocaleString()}
                      labelFormatter={(label, payload) => {
                        const entry = payload?.[0]?.payload;
                        if (entry?.district) {
                          return `${label} (${entry.district})`;
                        }
                        return label;
                      }}
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                      cursor={{ fill: "#f8fafc" }}
                    />
                    <Bar
                      dataKey="population"
                      radius={[2, 2, 0, 0]}
                      barSize={14}
                      activeBar={<Rectangle fill="#7e22ce" />}
                      onClick={(entry) => selectTa(entry?.admin3 || "")}
                    >
                      {chartData.map((entry) => {
                        const isSelected =
                          normalizeName(entry.admin3) ===
                          normalizeName(selectedTa);

                        return (
                          <Cell
                            key={`population-bar-${entry.admin3}`}
                            cursor="pointer"
                            fill={
                              isSelected
                                ? "#7e22ce"
                                : getPopulationBarColor(
                                    Number(entry.population),
                                    maxPopulation,
                                  )
                            }
                            stroke={isSelected ? "#111827" : "transparent"}
                            strokeWidth={isSelected ? 2 : 0}
                            fillOpacity={selectedTa && !isSelected ? 0.28 : 1}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[0.85fr_1.15fr] gap-8 mb-10">
          <section className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white">
            <h3 className="text-[16px] font-extrabold mb-6">
              Flood Exposure Distribution for {scopeLabel}
            </h3>
            <div className="h-[320px]">
              {floodSummary.loading ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  Loading flood exposure data...
                </div>
              ) : pieData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  No data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={72}
                      outerRadius={102}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-4 space-y-3">
              {pieData.map((entry, index) => (
                <div key={entry.name} className="flex items-center gap-4">
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{
                      backgroundColor: PIE_COLORS[index % PIE_COLORS.length],
                    }}
                  />
                  <span className="text-[14px] text-gray-700 font-semibold">
                    {entry.name}
                  </span>
                  <span className="text-[14px] font-extrabold text-black">
                    {formatStat(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="min-w-0 border border-gray-100 rounded p-8 shadow-sm bg-white">
            <h3 className="text-[16px] font-extrabold mb-2">Data Freshness</h3>
            <p className="text-[13px] font-medium text-gray-500 mb-6">
              Latest available update timestamps across the main overview
              datasets.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {freshnessRows.map((item) => (
                <div
                  key={item.dataset}
                  className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4"
                >
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
                    {item.label}
                  </div>
                  <div className="mt-2 text-[14px] font-extrabold text-black">
                    {item.last_updated
                      ? new Date(item.last_updated).toLocaleString()
                      : "No data"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default OverviewPage;
