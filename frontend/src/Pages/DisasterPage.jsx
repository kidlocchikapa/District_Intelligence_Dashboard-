import {
  ShieldAlert,
  Users,
  School,
  Hospital,
  Map as MapIcon,
  Download,
  Lightbulb,
  BookOpen,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import { formatNumber } from "../lib/format";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import { buildDashboardPath } from "../lib/query";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import InteractiveRecommendations from "../components/InteractiveRecommendations";
import Modal from "../components/Modal";

function formatTaAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 14)}...`;
}

function getExposureBarColor(value, maxValue) {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return "#cbd5e1";
  }

  const ratio = value / maxValue;

  if (ratio >= 0.8) return "#dc2626";
  if (ratio >= 0.55) return "#ea580c";
  if (ratio >= 0.3) return "#2563eb";
  return "#22c55e";
}

const DISASTER_EXPOSURE_CHART_LIMITS = [
  { value: 8, label: "Top 8" },
  { value: 12, label: "Top 12" },
  { value: 0, label: "All" },
];

function DisasterPage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const { contentRef, exportDataPdf } = usePdfExport("DisasterRisk_Report.pdf");
  const [exposureChartSearch, setExposureChartSearch] = useState("");
  const [exposureChartLimit, setExposureChartLimit] = useState(12);
  const [exposureChartSort, setExposureChartSort] = useState("exposed_desc");

  useEffect(() => {
    setSelectedTa("");
  }, [selectedDistrict]);

  const disasterDistrictFilter = useMemo(() => {
    const normalized = String(selectedDistrict || "")
      .trim()
      .toLowerCase();

    if (!normalized) {
      return "";
    }

    if (
      normalized === "zomba" ||
      normalized === "zomba city" ||
      normalized === "zomba (all)"
    ) {
      return "";
    }

    return selectedDistrict;
  }, [selectedDistrict]);

  const scopeLabel = selectedDistrict ? selectedDistrict : "Zomba + Zomba City";

  // Summary Aggregates
  const disasterSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/summary", {
      district: disasterDistrictFilter,
      ta: selectedTa,
      admin_type: "District",
    }),
  );

  const educationFacilityExposureSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      ta: selectedTa,
      admin_type: "District",
      facility_type: "education",
    }),
  );

  const healthFacilityExposureSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      ta: selectedTa,
      admin_type: "District",
      facility_type: "health",
    }),
  );
  const educationFacilityExposureDetails = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities", {
      district: disasterDistrictFilter,
      ta: selectedTa,
      facility_type: "education",
      exposed_only: "true",
    }),
  );
  const healthFacilityExposureDetails = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities", {
      district: disasterDistrictFilter,
      ta: selectedTa,
      facility_type: "health",
      exposed_only: "true",
    }),
  );

  // Flood risk GeoJSON source from database
  const floodRiskZones = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood", {
      district: disasterDistrictFilter,
      admin_type: "TA",
    }),
  );
  
  const educationFacilityExposureSummaryTA = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      admin_type: "TA",
      facility_type: "education",
    }),
  );

  const healthFacilityExposureSummaryTA = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      admin_type: "TA",
      facility_type: "health",
    }),
  );
  const taFloodExposure = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/population", {
      district: disasterDistrictFilter,
      admin_type: "TA",
      ta: selectedTa,
    }),
  );
  const taFloodExposureChart = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/population", {
      district: disasterDistrictFilter,
      admin_type: "TA",
    }),
  );
  const disasterIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "District",
    }),
  );

  // Students at risk from flood (education flood-impact endpoint)
  const educationFloodImpact = useDashboardData(
    buildDashboardPath("/dashboard/education/flood-impact", {
      district: disasterDistrictFilter || "Zomba",
    }),
  );

  const augmentedGeojson = useMemo(() => {
    if (!floodRiskZones.data || !floodRiskZones.data.features) {
      return floodRiskZones.data;
    }

    const eduMap = new Map();
    (educationFacilityExposureSummaryTA.data || []).forEach((row) => {
      eduMap.set(row.admin_unit_name, row.exposed_facilities || 0);
    });

    const healthMap = new Map();
    (healthFacilityExposureSummaryTA.data || []).forEach((row) => {
      healthMap.set(row.admin_unit_name, row.exposed_facilities || 0);
    });

    return {
      ...floodRiskZones.data,
      features: floodRiskZones.data.features.map((feature) => {
        const taName = feature.properties?.admin_unit_name;
        return {
          ...feature,
          properties: {
            ...feature.properties,
            exposed_schools: eduMap.get(taName) || 0,
            exposed_health_facilities: healthMap.get(taName) || 0,
          },
        };
      }),
    };
  }, [
    floodRiskZones.data,
    educationFacilityExposureSummaryTA.data,
    healthFacilityExposureSummaryTA.data,
  ]);

  const allExposedTaChartRows = useMemo(
    () =>
      (taFloodExposureChart.data || [])
        .map((row) => ({
          ta: row.admin_unit_name,
          exposedPopulation: Number(row.exposed_population || 0),
          totalPopulation: Number(row.total_population || 0),
          exposedPercent: Number(row.exposed_population_pct || 0),
          riskLevel: row.risk_level,
        }))
        .filter((row) => row.exposedPopulation > 0),
    [taFloodExposureChart.data],
  );
  const exposedTaChartData = useMemo(() => {
    const searchTerm = exposureChartSearch.trim().toLowerCase();
    let rows = [...allExposedTaChartRows];

    if (searchTerm) {
      rows = rows.filter((row) =>
        String(row.ta || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (exposureChartSort === "exposed_asc") {
        return Number(left.exposedPopulation || 0) - Number(right.exposedPopulation || 0);
      }

      if (exposureChartSort === "percent_desc") {
        return Number(right.exposedPercent || 0) - Number(left.exposedPercent || 0);
      }

      if (exposureChartSort === "name_asc") {
        return String(left.ta || "").localeCompare(String(right.ta || ""));
      }

      return Number(right.exposedPopulation || 0) - Number(left.exposedPopulation || 0);
    });

    if (exposureChartLimit > 0) {
      return rows.slice(0, exposureChartLimit);
    }

    return rows;
  }, [
    allExposedTaChartRows,
    exposureChartLimit,
    exposureChartSearch,
    exposureChartSort,
  ]);

  const maxExposedPopulation = Math.max(
    ...exposedTaChartData.map((row) => row.exposedPopulation),
    0,
  );

  const schoolsExposed = (educationFacilityExposureSummary.data || []).reduce(
    (sum, row) => sum + Number(row.exposed_facilities || 0),
    0,
  );
  const schoolsTotal = (educationFacilityExposureSummary.data || []).reduce(
    (sum, row) => sum + Number(row.total_facilities || 0),
    0,
  );

  const healthFacilitiesExposed = (
    healthFacilityExposureSummary.data || []
  ).reduce((sum, row) => sum + Number(row.exposed_facilities || 0), 0);
  const healthFacilitiesTotal = (
    healthFacilityExposureSummary.data || []
  ).reduce((sum, row) => sum + Number(row.total_facilities || 0), 0);

  const beneficiariesAffected = Number(
    disasterIntegration.data?.summary?.flood_affected_count || 0,
  );

  const formatStat = (val, withUnit = "") => {
    const num = Number(val);
    if (!Number.isFinite(num)) return withUnit ? `0 ${withUnit}` : "0";
    const formatted = num.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
    return withUnit ? `${formatted} ${withUnit}` : formatted;
  };

  const handleDownloadReport = async () => {
    const selectedAreaName = selectedTa
      ? `TA: ${selectedTa}`
      : selectedDistrict
        ? `District: ${selectedDistrict}`
        : "National";

    const disasterRows = [
      {
        metric: "Exposed Population",
        value: formatStat(disasterSummary.data?.exposed_population),
      },
      {
        metric: "Area Exposed (sq/km)",
        value: formatStat(disasterSummary.data?.exposed_area_sq_km, "sq/km"),
      },
      {
        metric: "Schools Exposed",
        value: formatStat(schoolsExposed),
      },
      {
        metric: "Health Facilities Exposed",
        value: formatStat(healthFacilitiesExposed),
      },
      {
        metric: "Beneficiaries Affected",
        value: formatStat(beneficiariesAffected),
      },
    ];

    const facilitiesRows = [
      {
        metric: "Exposed Education Facilities",
        value: formatStat(schoolsExposed),
      },
      {
        metric: "Exposed Health Facilities",
        value: formatStat(healthFacilitiesExposed),
      },
    ];

    await exportDataPdf({
      title: "Disaster Risk Area Analysis",
      selectedArea: selectedAreaName,
      sections: [
        {
          title: "Disaster Summary",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: disasterRows,
        },
        {
          title: "Facility Exposure",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: facilitiesRows,
        },
      ],
    });
  };

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
      <div className="h-8 w-24 bg-gray-200 rounded"></div>
    </div>
  );

  const statsLoading =
    disasterSummary.loading ||
    educationFacilityExposureSummary.loading ||
    healthFacilityExposureSummary.loading ||
    disasterIntegration.loading;

  const statCards = [
    {
      label: "Total Population Affected",
      value: formatStat(disasterSummary.data?.exposed_population),
      icon: Users,
    },
    {
      label: "Schools Affected",
      value: formatStat(schoolsExposed),
      icon: School,
    },
    {
      label: "Health Facilities Affected",
      value: formatStat(healthFacilitiesExposed),
      icon: Hospital,
    },
    {
      label: "Area Exposed",
      value: formatStat(disasterSummary.data?.exposed_area_sq_km, "sq/km"),
      icon: MapIcon,
    },
    {
      label: "Beneficiaries Affected",
      value: formatStat(beneficiariesAffected),
      icon: Users,
    },
  ];

  const ChartSkeleton = () => (
    <div className="h-full w-full flex flex-col gap-4 animate-pulse">
      <div className="flex-1 bg-gray-50 rounded-lg relative overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-around px-4 pb-4">
          {[...Array(7)].map((_, index) => (
            <div
              key={index}
              className="w-8 bg-gray-200 rounded-t"
              style={{ height: `${Math.random() * 55 + 25}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={contentRef}
      className="min-h-screen bg-white text-black font-sans pb-10"
    >
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <ShieldAlert className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">
          DISASTER RISK
        </h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Risk analysis for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Risk analysis for ${selectedTa}`
              : "Risk analysis for All Districts"}
        </p>

        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={handleDownloadReport}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <SharedDistrictSelector />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-10">
          {statsLoading
            ? [...Array(statCards.length)].map((_, i) => (
                <StatCardSkeleton key={i} />
              ))
            : statCards.map((stat, i) => (
                <div
                  key={i}
                  className="border border-gray-100 rounded p-4 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[12px] text-gray-500 font-bold group-hover:text-black">
                      {stat.label}
                    </span>
                    <stat.icon className="h-4 w-4 text-gray-300 group-hover:text-black" />
                  </div>
                  <div className="mt-3 text-[26px] font-extrabold tracking-tight">
                    {stat.value}
                  </div>
                </div>
              ))}
        </div>

        <div className="mb-10">
          <IntegrationSummaryPanel
            title="Integrated Disaster Context"
            subtitle="Risk review connected to welfare concentration, school access pressure, and hospital reach so exposed areas can be prioritized across departments."
            loading={disasterIntegration.loading}
            items={[
              {
                label: "Risk Exposure",
                metrics: {
                  flood_affected_beneficiaries:
                    disasterIntegration.data?.summary?.flood_affected_count ||
                    0,
                  flood_affected_pct:
                    disasterIntegration.data?.summary?.flood_affected_pct || 0,
                },
              },
              {
                label: "Education Link",
                metrics: {
                  beneficiaries_with_school_access:
                    disasterIntegration.data?.summary?.school_access_count || 0,
                  school_age_unenrolled:
                    disasterIntegration.data?.summary
                      ?.school_age_population_unenrolled || 0,
                },
              },
              {
                label: "Health Link",
                metrics: {
                  beneficiaries_with_health_access:
                    disasterIntegration.data?.summary?.health_access_count || 0,
                  public_hospital_access:
                    disasterIntegration.data?.summary
                      ?.public_hospital_access_count || 0,
                  private_hospital_access:
                    disasterIntegration.data?.summary
                      ?.private_hospital_access_count || 0,
                },
              },
            ]}
          />
        </div>

        {/* Map Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">
              Flood Risk Zone Mapping
            </h3>
            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
              {floodRiskZones.loading ? (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                  <span className="text-gray-400 font-bold uppercase tracking-widest">
                    Loading Risk Data...
                  </span>
                </div>
              ) : (
                <PopulationRasterPanel
                  geojson={augmentedGeojson}
                  title="High-Resolution Flood Risk Map"
                  subtitle="Rasterized surface detailing flood exposure intensity across the district."
                  heightClass="h-full w-full"
                  metadataUrl={
                    disasterDistrictFilter
                      ? `/worldpop/flood_risk_${disasterDistrictFilter.toLowerCase().replace(/ /g, "_").replace(/[()]/g, "")}.preview.json`
                      : "/worldpop/flood_risk_zomba.preview.json"
                  }
                  loading={
                    floodRiskZones.loading ||
                    educationFacilityExposureSummaryTA.loading ||
                    healthFacilityExposureSummaryTA.loading
                  }
                  selectedFeatureName={selectedTa}
                  onFeatureClick={(feature) => {
                    const nextTa = feature?.properties?.admin_unit_name || "";
                    if (nextTa && nextTa !== selectedTa) {
                      setSelectedTa(nextTa);
                    }
                  }}
                  customTooltipMetrics={[
                    {
                      label: "Total Pop",
                      key: "total_population",
                      format: "number",
                    },
                    {
                      label: "Exposed Pop",
                      key: "exposed_population",
                      format: "number",
                    },
                    {
                      label: "Exposed Area",
                      key: "exposed_area_sq_km",
                      format: "number",
                      suffix: " sq/km",
                    },
                    {
                      label: "Exposed Schools",
                      key: "exposed_schools",
                      format: "number",
                    },
                    {
                      label: "Exposed Health",
                      key: "exposed_health_facilities",
                      format: "number",
                    },
                  ]}
                />
              )}
            </div>
          </div>

          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-2">
              Exposed TAs and Population
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-4">
              Traditional Authorities with flood-exposed population in the
              latest analysis.
            </p>
            <div className="mb-4 rounded border border-gray-100 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                {DISASTER_EXPOSURE_CHART_LIMITS.map((option) => {
                  const isActive = option.value === exposureChartLimit;
                  return (
                    <button
                      key={`disaster-exposure-limit-${option.label}`}
                      type="button"
                      onClick={() => setExposureChartLimit(option.value)}
                      className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                        isActive
                          ? "border-gray-900 bg-gray-900 text-white"
                          : "border-gray-200 bg-white text-gray-500 hover:text-black"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
                <select
                  value={exposureChartSort}
                  onChange={(event) => setExposureChartSort(event.target.value)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
                >
                  <option value="exposed_desc">Highest exposed</option>
                  <option value="exposed_asc">Lowest exposed</option>
                  <option value="percent_desc">Highest % exposed</option>
                  <option value="name_asc">Name A-Z</option>
                </select>
                <input
                  type="search"
                  value={exposureChartSearch}
                  onChange={(event) => setExposureChartSearch(event.target.value)}
                  placeholder="Search TA..."
                  className="min-w-[170px] flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900"
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-gray-500">
                Showing {exposedTaChartData.length} of{" "}
                {allExposedTaChartRows.length} exposed TAs.
              </p>
            </div>
            <div className="min-h-0 flex-1">
              {taFloodExposureChart.loading ? (
                <ChartSkeleton />
              ) : exposedTaChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                  No exposed TA rows match the current filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={exposedTaChartData}
                    margin={{ top: 20, right: 16, left: 12, bottom: 96 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="ta"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 10, fontWeight: 700 }}
                      tickFormatter={formatTaAxisLabel}
                      angle={-90}
                      textAnchor="end"
                      interval={0}
                      height={116}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#64748b", fontSize: 11, fontWeight: 700 }}
                      tickFormatter={(value) =>
                        Number(value) >= 1000000
                          ? `${(value / 1000000).toFixed(1)}M`
                          : Number(value).toLocaleString()
                      }
                    />
                    <Tooltip
                      formatter={(value) => [
                        Number(value).toLocaleString(),
                        "Exposed population",
                      ]}
                      labelFormatter={(label, payload) => {
                        const entry = payload?.[0]?.payload;
                        if (!entry) {
                          return label;
                        }

                        return `${label} | ${entry.exposedPercent.toFixed(1)}% exposed`;
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
                      dataKey="exposedPopulation"
                      radius={[2, 2, 0, 0]}
                      barSize={18}
                      activeBar={<Rectangle fill="#7e22ce" />}
                      onClick={(entry) => setSelectedTa(entry?.ta || "")}
                    >
                      {exposedTaChartData.map((entry) => {
                        const isSelected =
                          selectedTa &&
                          entry.ta.toLowerCase() === selectedTa.toLowerCase();

                        return (
                          <Cell
                            key={`ta-exposure-${entry.ta}`}
                            cursor="pointer"
                            fill={
                              isSelected
                                ? "#7e22ce"
                                : getExposureBarColor(
                                    entry.exposedPopulation,
                                    maxExposedPopulation,
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
        {/* ── Facility Impact Panels ──────────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">

          {/* Schools Impact */}
          <div className="border border-gray-100 rounded p-6 shadow-sm bg-white">
            <div className="flex items-center gap-2 mb-1">
              <School className="h-4 w-4 text-blue-600" />
              <h3 className="text-[15px] font-extrabold">Schools Flood Impact</h3>
            </div>
            <p className="text-xs text-gray-500 font-semibold mb-5">
              Exposed schools vs total, and enrolled students at risk
            </p>

            {educationFacilityExposureSummary.loading || educationFloodImpact.loading ? (
              <div className="h-48 animate-pulse rounded bg-gray-50" />
            ) : (
              <div className="flex flex-col gap-6">
                {/* Donut + numbers row */}
                <div className="flex items-center gap-6">
                  <div className="flex-shrink-0">
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Exposed", value: schoolsExposed, fill: "#dc2626" },
                            { name: "Safe", value: Math.max(schoolsTotal - schoolsExposed, 0), fill: "#e5e7eb" },
                          ]}
                          cx="50%" cy="50%"
                          innerRadius={42} outerRadius={62}
                          paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}
                        >
                          <Cell fill="#dc2626" />
                          <Cell fill="#e5e7eb" />
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [v.toLocaleString(), n]}
                          contentStyle={{ fontSize: 11, borderRadius: 4, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-3 flex-1">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Exposed Schools</p>
                      <p className="text-[28px] font-extrabold text-red-600 leading-none">{formatNumber(schoolsExposed)}</p>
                      <p className="text-xs text-gray-400 font-semibold">of {formatNumber(schoolsTotal)} total</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Students at Risk</p>
                      <p className="text-[28px] font-extrabold text-amber-600 leading-none">
                        {formatNumber(educationFloodImpact.data?.summary?.students_at_risk || 0)}
                      </p>
                      <p className="text-xs text-gray-400 font-semibold">enrolled in exposed schools</p>
                    </div>
                  </div>
                </div>

                {/* Risk breakdown bar */}
                <div className="space-y-2">
                  {[
                    { label: "High Risk Schools",   value: educationFloodImpact.data?.summary?.high_risk_schools   || 0, students: educationFloodImpact.data?.summary?.high_risk_students   || 0, color: "#dc2626" },
                    { label: "Medium Risk Schools", value: educationFloodImpact.data?.summary?.medium_risk_schools || 0, students: educationFloodImpact.data?.summary?.medium_risk_students || 0, color: "#f59e0b" },
                    { label: "Low Risk Schools",    value: educationFloodImpact.data?.summary?.low_risk_schools    || 0, students: educationFloodImpact.data?.summary?.low_risk_students    || 0, color: "#3b82f6" },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                        <span className="text-xs font-bold text-gray-600">{item.label}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-extrabold" style={{ color: item.color }}>{formatNumber(item.value)}</span>
                        <span className="text-[10px] text-gray-400 font-semibold ml-2">({formatNumber(item.students)} students)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Health Facilities Impact */}
          <div className="border border-gray-100 rounded p-6 shadow-sm bg-white">
            <div className="flex items-center gap-2 mb-1">
              <Hospital className="h-4 w-4 text-red-600" />
              <h3 className="text-[15px] font-extrabold">Health Facilities Flood Impact</h3>
            </div>
            <p className="text-xs text-gray-500 font-semibold mb-5">
              Exposed facilities vs total, and population losing health access
            </p>

            {healthFacilityExposureSummary.loading || disasterSummary.loading ? (
              <div className="h-48 animate-pulse rounded bg-gray-50" />
            ) : (
              <div className="flex flex-col gap-6">
                {/* Donut + numbers row */}
                <div className="flex items-center gap-6">
                  <div className="flex-shrink-0">
                    <ResponsiveContainer width={140} height={140}>
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Exposed", value: healthFacilitiesExposed, fill: "#dc2626" },
                            { name: "Safe", value: Math.max(healthFacilitiesTotal - healthFacilitiesExposed, 0), fill: "#e5e7eb" },
                          ]}
                          cx="50%" cy="50%"
                          innerRadius={42} outerRadius={62}
                          paddingAngle={2} dataKey="value" startAngle={90} endAngle={-270}
                        >
                          <Cell fill="#dc2626" />
                          <Cell fill="#e5e7eb" />
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [v.toLocaleString(), n]}
                          contentStyle={{ fontSize: 11, borderRadius: 4, border: "none", boxShadow: "0 2px 8px rgba(0,0,0,.1)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-3 flex-1">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Exposed Facilities</p>
                      <p className="text-[28px] font-extrabold text-red-600 leading-none">{formatNumber(healthFacilitiesExposed)}</p>
                      <p className="text-xs text-gray-400 font-semibold">of {formatNumber(healthFacilitiesTotal)} total</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Population Impacted</p>
                      <p className="text-[28px] font-extrabold text-amber-600 leading-none">
                        {formatNumber(disasterSummary.data?.exposed_population || 0, 0)}
                      </p>
                      <p className="text-xs text-gray-400 font-semibold">
                        {formatNumber(disasterSummary.data?.exposed_population_pct || 0, 1)}% of district population
                      </p>
                    </div>
                  </div>
                </div>

                {/* Risk population breakdown */}
                <div className="space-y-2">
                  {[
                    { label: "High Risk Zone Pop.",   value: disasterSummary.data?.high_risk_population   || 0, color: "#dc2626" },
                    { label: "Medium Risk Zone Pop.", value: disasterSummary.data?.medium_risk_population || 0, color: "#f59e0b" },
                    { label: "Low Risk Zone Pop.",    value: disasterSummary.data?.low_risk_population    || 0, color: "#3b82f6" },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between gap-3 rounded bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: item.color }} />
                        <span className="text-xs font-bold text-gray-600">{item.label}</span>
                      </div>
                      <span className="text-xs font-extrabold" style={{ color: item.color }}>{formatNumber(item.value, 0)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Insights & Recommendations ──────────────────────────────── */}
        <DisasterRecommendations
          disasterSummary={disasterSummary}
          educationFacilityExposureSummary={educationFacilityExposureSummary}
          healthFacilityExposureSummary={healthFacilityExposureSummary}
          educationFacilityExposureDetails={educationFacilityExposureDetails}
          healthFacilityExposureDetails={healthFacilityExposureDetails}
          taFloodExposure={taFloodExposure}
          educationFloodImpact={educationFloodImpact}
          schoolsExposed={schoolsExposed}
          schoolsTotal={schoolsTotal}
          healthFacilitiesExposed={healthFacilitiesExposed}
          healthFacilitiesTotal={healthFacilitiesTotal}
          scopeLabel={scopeLabel}
        />

      </div>
    </div>
  );
}

/* ─── Disaster Recommendations ────────────────────────────────────────── */
function DisasterRecommendations({
  disasterSummary,
  educationFacilityExposureSummary,
  healthFacilityExposureSummary,
  educationFacilityExposureDetails,
  healthFacilityExposureDetails,
  taFloodExposure,
  educationFloodImpact,
  schoolsExposed,
  schoolsTotal,
  healthFacilitiesExposed,
  healthFacilitiesTotal,
  scopeLabel,
}) {
  const [metricPreview, setMetricPreview] = useState(null);
  const loading =
    disasterSummary.loading ||
    educationFacilityExposureSummary.loading ||
    healthFacilityExposureSummary.loading ||
    educationFacilityExposureDetails.loading ||
    healthFacilityExposureDetails.loading ||
    taFloodExposure.loading ||
    educationFloodImpact.loading;

  const summary = disasterSummary.data || {};
  const eduImpact = educationFloodImpact.data?.summary || {};
  const eduImpactTaBreakdown = educationFloodImpact.data?.ta_breakdown || [];
  const exposedPop = Number(summary.exposed_population || 0);
  const totalPop = Number(summary.total_population || 0);
  const exposedPct = Number(summary.exposed_population_pct || 0);
  const studentsAtRisk = Number(eduImpact.students_at_risk || 0);
  const highRiskPop = Number(summary.high_risk_population || 0);

  const riskRank = { high: 3, medium: 2, low: 1 };

  const educationFacilityRows = useMemo(() => {
    const deduped = new Map();

    (educationFacilityExposureDetails.data || []).forEach((row) => {
      const riskClass = String(row.risk_class || "unknown").toLowerCase();
      const facilityName = row.facility_name || "Unnamed School";
      const ta = row.ta_name || "Unknown TA";
      const district = row.district_name || "Unknown District";
      const floodDepth = Number(row.flood_value || 0);
      const keyBase =
        row.facility_id !== null && row.facility_id !== undefined
          ? `id:${row.facility_id}`
          : `name:${facilityName.toLowerCase()}|ta:${ta.toLowerCase()}|district:${district.toLowerCase()}`;
      const key = `edu-${keyBase}`;

      const candidate = {
        id: `edu-facility-${keyBase}`,
        facilityName,
        ta,
        district,
        riskClass,
        floodDepth,
        exposed: row.is_exposed ? "Yes" : "No",
      };
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, candidate);
        return;
      }

      const existingRisk = riskRank[existing.riskClass] || 0;
      const candidateRisk = riskRank[candidate.riskClass] || 0;
      if (
        candidateRisk > existingRisk ||
        (candidateRisk === existingRisk &&
          candidate.floodDepth > existing.floodDepth)
      ) {
        deduped.set(key, candidate);
      }
    });

    return Array.from(deduped.values()).sort((left, right) => {
      const riskDelta =
        (riskRank[right.riskClass] || 0) - (riskRank[left.riskClass] || 0);
      if (riskDelta !== 0) return riskDelta;
      return right.floodDepth - left.floodDepth;
    });
  }, [educationFacilityExposureDetails.data]);

  const highRiskEducationFacilityRows = useMemo(() => {
    return educationFacilityRows.filter((row) => row.riskClass === "high");
  }, [educationFacilityRows]);

  const healthFacilityRows = useMemo(() => {
    const deduped = new Map();

    (healthFacilityExposureDetails.data || []).forEach((row) => {
      const riskClass = String(row.risk_class || "unknown").toLowerCase();
      const facilityName = row.facility_name || "Unnamed Facility";
      const ta = row.ta_name || "Unknown TA";
      const district = row.district_name || "Unknown District";
      const floodDepth = Number(row.flood_value || 0);
      const keyBase =
        row.facility_id !== null && row.facility_id !== undefined
          ? `id:${row.facility_id}`
          : `name:${facilityName.toLowerCase()}|ta:${ta.toLowerCase()}|district:${district.toLowerCase()}`;
      const key = `health-${keyBase}`;

      const candidate = {
        id: `health-facility-${keyBase}`,
        facilityName,
        ta,
        district,
        riskClass,
        floodDepth,
        exposed: row.is_exposed ? "Yes" : "No",
      };
      const existing = deduped.get(key);

      if (!existing) {
        deduped.set(key, candidate);
        return;
      }

      const existingRisk = riskRank[existing.riskClass] || 0;
      const candidateRisk = riskRank[candidate.riskClass] || 0;
      if (
        candidateRisk > existingRisk ||
        (candidateRisk === existingRisk &&
          candidate.floodDepth > existing.floodDepth)
      ) {
        deduped.set(key, candidate);
      }
    });

    return Array.from(deduped.values()).sort((left, right) => {
      const riskDelta =
        (riskRank[right.riskClass] || 0) - (riskRank[left.riskClass] || 0);
      if (riskDelta !== 0) return riskDelta;
      return right.floodDepth - left.floodDepth;
    });
  }, [healthFacilityExposureDetails.data]);

  const taExposureRows = useMemo(() => {
    return (taFloodExposure.data || [])
      .map((row, index) => ({
        id: `ta-exposure-${row.admin_unit_id || row.admin_unit_name || index}`,
        ta: row.admin_unit_name || "Unknown TA",
        district: row.district_name || row.district || "Unknown District",
        exposedPopulation: Number(row.exposed_population || 0),
        totalPopulation: Number(row.total_population || 0),
        exposedPercent: Number(row.exposed_population_pct || 0),
        riskLevel: row.risk_level || "unknown",
      }))
      .sort((left, right) => right.exposedPopulation - left.exposedPopulation);
  }, [taFloodExposure.data]);

  const educationImpactTaRows = useMemo(() => {
    return eduImpactTaBreakdown
      .map((row, index) => ({
        id: `edu-impact-${row.ta_id || row.ta_name || index}`,
        ta: row.ta_name || "Unknown TA",
        district: row.district_name || "Unknown District",
        studentsAtRisk: Number(row.students_at_risk || 0),
        exposedSchools: Number(row.exposed_schools || 0),
        highRiskSchools: Number(row.high_risk_schools || 0),
        mediumRiskSchools: Number(row.medium_risk_schools || 0),
        lowRiskSchools: Number(row.low_risk_schools || 0),
      }))
      .sort((left, right) => right.studentsAtRisk - left.studentsAtRisk);
  }, [eduImpactTaBreakdown]);

  const combinedFacilityRows = useMemo(() => {
    return [
      ...educationFacilityRows.map((row) => ({
        ...row,
        sector: "Education",
      })),
      ...healthFacilityRows.map((row) => ({
        ...row,
        sector: "Health",
      })),
    ].sort((left, right) => {
      const riskDelta =
        (riskRank[right.riskClass] || 0) - (riskRank[left.riskClass] || 0);
      if (riskDelta !== 0) return riskDelta;
      return right.floodDepth - left.floodDepth;
    });
  }, [educationFacilityRows, healthFacilityRows]);

  const summaryRows = [
    { metric: "Scope", value: scopeLabel },
    { metric: "Total Population", value: formatNumber(totalPop, 0) },
    { metric: "Exposed Population", value: formatNumber(exposedPop, 0) },
    { metric: "Exposed Population %", value: `${formatNumber(exposedPct, 1)}%` },
    { metric: "High-Risk Population", value: formatNumber(highRiskPop, 0) },
    { metric: "Exposed Area (sq km)", value: formatNumber(summary.exposed_area_sq_km || 0, 1) },
    { metric: "Exposed Schools", value: formatNumber(schoolsExposed, 0) },
    { metric: "Total Schools", value: formatNumber(schoolsTotal, 0) },
    { metric: "Students at Flood Risk", value: formatNumber(studentsAtRisk, 0) },
    { metric: "Exposed Health Facilities", value: formatNumber(healthFacilitiesExposed, 0) },
    { metric: "Total Health Facilities", value: formatNumber(healthFacilitiesTotal, 0) },
  ];

  const facilityColumns = [
    { key: "facilityName", label: "Facility" },
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "riskClass", label: "Risk" },
    { key: "floodDepth", label: "Flood Value" },
    { key: "exposed", label: "Exposed" },
  ];
  const combinedFacilityColumns = [
    { key: "sector", label: "Sector" },
    ...facilityColumns,
  ];
  const taExposureColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "exposedPopulation", label: "Exposed Population" },
    { key: "totalPopulation", label: "Total Population" },
    { key: "exposedPercent", label: "Exposed %" },
    { key: "riskLevel", label: "Risk Level" },
  ];
  const educationImpactColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "studentsAtRisk", label: "Students at Risk" },
    { key: "exposedSchools", label: "Exposed Schools" },
    { key: "highRiskSchools", label: "High Risk Schools" },
    { key: "mediumRiskSchools", label: "Medium Risk Schools" },
    { key: "lowRiskSchools", label: "Low Risk Schools" },
  ];
  const summaryColumns = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
  ];

  function openMetricPreview({ title, rows, columns }) {
    setMetricPreview({
      title,
      rows: rows || [],
      columns: columns || summaryColumns,
    });
  }

  const priorityConfig = {
    high: { label: "Immediate Action", classes: "bg-red-50 border-red-200 text-red-700", dot: "bg-red-500" },
    medium: { label: "Short-Term Action", classes: "bg-amber-50 border-amber-200 text-amber-700", dot: "bg-amber-500" },
    low: { label: "Planning Note", classes: "bg-blue-50 border-blue-200 text-blue-700", dot: "bg-blue-500" },
  };

  const recommendations = [
    schoolsExposed > 0 && {
      priority: "high",
      icon: School,
      title: "Temporary Learning Spaces for Flood Season",
      body: `${formatNumber(schoolsExposed)} schools are in flood-exposed zones, putting ${formatNumber(studentsAtRisk)} enrolled students at risk of disrupted education. All are currently low-risk but require contingency plans before the rainy season. Identify and pre-position temporary learning spaces in elevated areas within Ta Mwambo.`,
      action: "Pre-position temporary classrooms and establish school closure protocols for flood alerts",
      metricLinks: [
        {
          id: "exposed-schools",
          label: "Exposed Schools",
          value: formatNumber(schoolsExposed, 0),
          onClick: () =>
            openMetricPreview({
              title: "Exposed Schools (Facility List)",
              rows: educationFacilityRows,
              columns: facilityColumns,
            }),
        },
        {
          id: "students-risk-learning",
          label: "Students at Risk",
          value: formatNumber(studentsAtRisk, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Education Impact by TA",
              rows: educationImpactTaRows,
              columns: educationImpactColumns,
            }),
        },
      ],
    },
    studentsAtRisk > 0 && {
      priority: "high",
      icon: BookOpen,
      title: "Student Continuity Plans Required",
      body: `${formatNumber(studentsAtRisk)} students face potential school closure during flood events. Without a continuity plan, this translates directly to learning loss and increased dropout risk, particularly for girls and children from low-income households who are least likely to return after disruption.`,
      action: "Develop and distribute flood-season learning continuity kits to all exposed schools",
      metricLinks: [
        {
          id: "students-at-risk-total",
          label: "Students at Risk",
          value: formatNumber(studentsAtRisk, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Education Impact by TA",
              rows: educationImpactTaRows,
              columns: educationImpactColumns,
            }),
        },
        {
          id: "high-risk-schools",
          label: "High Risk Schools",
          value: formatNumber(highRiskEducationFacilityRows.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "High-Risk Schools (Facility List)",
              rows: highRiskEducationFacilityRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    healthFacilitiesExposed > 0 && {
      priority: "high",
      icon: Hospital,
      title: "Health Service Continuity at Risk",
      body: `${formatNumber(healthFacilitiesExposed)} health facilities are in flood-exposed zones. During flood events, these facilities may become inaccessible, cutting off ${formatNumber(exposedPop, 0)} people from essential health services. Emergency referral pathways to unaffected facilities must be established.`,
      action: "Map alternative health facilities and establish emergency referral routes for flood-affected zones",
      metricLinks: [
        {
          id: "health-facilities-exposed",
          label: "Exposed Health Facilities",
          value: formatNumber(healthFacilitiesExposed, 0),
          onClick: () =>
            openMetricPreview({
              title: "Exposed Health Facilities (Facility List)",
              rows: healthFacilityRows,
              columns: facilityColumns,
            }),
        },
        {
          id: "population-cutoff",
          label: "Exposed Population",
          value: formatNumber(exposedPop, 0),
          onClick: () =>
            openMetricPreview({
              title: "TA Flood Population Exposure",
              rows: taExposureRows,
              columns: taExposureColumns,
            }),
        },
      ],
    },
    highRiskPop > 0 && {
      priority: "high",
      icon: AlertTriangle,
      title: "High-Risk Zone Evacuation Planning",
      body: `${formatNumber(highRiskPop, 0)} people live in high flood-risk zones. These communities need pre-identified evacuation routes, designated assembly points, and early warning system access. Coordination with district civil protection is essential before the next flood season.`,
      action: "Establish community-level early warning systems and evacuation drills in high-risk zones",
      metricLinks: [
        {
          id: "high-risk-population",
          label: "High-Risk Population",
          value: formatNumber(highRiskPop, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Risk Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "high-exposure-tas",
          label: "Most Exposed TAs",
          value: formatNumber(taExposureRows.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "TA Flood Population Exposure",
              rows: taExposureRows,
              columns: taExposureColumns,
            }),
        },
      ],
    },
    exposedPct > 0 && {
      priority: "medium",
      icon: MapIcon,
      title: "Flood-Resilient Infrastructure Investment",
      body: `${formatNumber(exposedPct, 1)}% of the ${scopeLabel} population lives in flood-exposed areas covering ${formatNumber(summary.exposed_area_sq_km, 1)} sq km. New schools and health facilities in these zones must be built to flood-resilient standards - elevated foundations, flood-resistant materials, and drainage systems.`,
      action: "Enforce flood-resilient building codes for all new public infrastructure in exposed zones",
      metricLinks: [
        {
          id: "exposed-population-share",
          label: "Exposed Population %",
          value: `${formatNumber(exposedPct, 1)}%`,
          onClick: () =>
            openMetricPreview({
              title: "Flood Risk Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "exposed-area",
          label: "Exposed Area (sq km)",
          value: formatNumber(summary.exposed_area_sq_km || 0, 1),
          onClick: () =>
            openMetricPreview({
              title: "Flood Risk Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
      ],
    },
    {
      priority: "medium",
      icon: Users,
      title: "Cross-Sector Flood Response Coordination",
      body: `Flood exposure cuts across education, health, and welfare sectors simultaneously. A single flood event in Ta Mwambo can displace students, close health facilities, and cut off welfare beneficiaries at the same time. A unified district flood response plan covering all three sectors is needed.`,
      action: "Establish a multi-sector flood response committee with education, health, and social welfare representation",
      metricLinks: [
        {
          id: "cross-sector-schools",
          label: "Exposed Schools",
          value: formatNumber(schoolsExposed, 0),
          onClick: () =>
            openMetricPreview({
              title: "Combined Facility Exposure",
              rows: combinedFacilityRows,
              columns: combinedFacilityColumns,
            }),
        },
        {
          id: "cross-sector-health",
          label: "Exposed Health Facilities",
          value: formatNumber(healthFacilitiesExposed, 0),
          onClick: () =>
            openMetricPreview({
              title: "Combined Facility Exposure",
              rows: combinedFacilityRows,
              columns: combinedFacilityColumns,
            }),
        },
      ],
    },
    {
      priority: "low",
      icon: Lightbulb,
      title: "Annual Flood Exposure Re-Analysis",
      body: `Flood risk patterns shift with climate variability. The current analysis is based on the latest available flood raster. Annual re-runs of the flood exposure pipeline after each rainy season will ensure the dashboard reflects current risk and that planning decisions are based on up-to-date data.`,
      action: "Schedule annual flood raster updates and re-run the exposure analysis pipeline each May",
      metricLinks: [
        {
          id: "annual-baseline-exposed-pop",
          label: "Current Exposed Pop",
          value: formatNumber(exposedPop, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Risk Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "annual-baseline-students",
          label: "Current Students at Risk",
          value: formatNumber(studentsAtRisk, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Education Impact by TA",
              rows: educationImpactTaRows,
              columns: educationImpactColumns,
            }),
        },
      ],
    },
  ].filter(Boolean);

  if (loading) {
    return (
      <div className="mt-10">
        <div className="h-6 w-64 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-36 animate-pulse rounded border border-gray-100 bg-gray-50" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 mb-10">
      <div className="flex items-center gap-3 mb-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h3 className="text-[16px] font-extrabold">Insights & Recommendations</h3>
      </div>
      <p className="text-sm text-gray-500 font-semibold mb-6">
        Planning actions derived from flood exposure analysis across population, schools, and health facilities in {scopeLabel}.
      </p>
      <InteractiveRecommendations
        recommendations={recommendations}
        priorityConfig={priorityConfig}
        sectionKey={`disaster:${scopeLabel}`}
      />

      <Modal
        isOpen={Boolean(metricPreview)}
        onClose={() => setMetricPreview(null)}
        title={metricPreview?.title || "Metric Preview"}
      >
        <p className="mb-4 text-sm font-semibold text-slate-600">
          Previewing records behind this recommendation metric.
        </p>
        <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                {(metricPreview?.columns || []).map((column) => (
                  <th
                    key={column.key}
                    className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500"
                  >
                    {column.label || column.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {(metricPreview?.rows || []).length ? (
                (metricPreview?.rows || []).map((row, rowIndex) => (
                  <tr key={row.id || `row-${rowIndex}`}>
                    {(metricPreview?.columns || []).map((column) => (
                      <td
                        key={`${row.id || rowIndex}-${column.key}`}
                        className={`px-3 py-2 ${
                          column.key === "facilityName" ||
                          column.key === "adminUnit" ||
                          column.key === "ta" ||
                          column.key === "metric"
                            ? "font-semibold text-slate-900"
                            : "text-slate-700"
                        }`}
                      >
                        {row[column.key] ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={Math.max((metricPreview?.columns || []).length, 1)}
                    className="px-3 py-8 text-center text-sm font-semibold text-slate-400"
                  >
                    No preview records available for this metric.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  );
}
export default DisasterPage;
