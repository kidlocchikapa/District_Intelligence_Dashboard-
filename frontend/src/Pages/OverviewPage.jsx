import {
  useMemo,
  useState,
} from "react";
import {
  Download,
  Map as MapIcon,
  Users,
  School,
  HeartPulse,
  Accessibility,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { buildDashboardPath } from "../lib/query";
import { usePdfExport } from "../hooks/usePdfExport";
import { useImageDownload } from "../hooks/useImageDownload";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
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

const COLORS = ["#4A72E4", "#F4B41A", "#3BB182", "#6974D6"];

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

function formatDistrictAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return value;
  }

  return `${value.slice(0, 8)}…`;
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

  const chartData = (populationDistribution.data || []).map((item) => ({
    admin3Id: item.admin3_id,
    admin3: item.admin3_name,
    district: item.district,
    population: item.population,
  }));
  const selectedTaChartRow = chartData.find(
    (item) =>
      selectedTa &&
      item.admin3.toLowerCase() === selectedTa.toLowerCase(),
  );
  const taFloodLookup = useMemo(() => {
    const lookup = new Map();

    (taFloodExposure.data || []).forEach((row) => {
      if (!row.admin_unit_name) {
        return;
      }

      lookup.set(row.admin_unit_name.toLowerCase(), {
        exposedPopulation: Number(row.exposed_population || 0),
        exposedPopulationPct: Number(row.exposed_population_pct || 0),
        riskLevel: row.risk_level,
      });
    });

    return lookup;
  }, [taFloodExposure.data]);

  const mapGeojson = useMemo(() => {
    if (!densityMap.data) {
      return densityMap.data;
    }

    const features = (densityMap.data.features || [])
      .filter((feature) => {
        const name = feature?.properties?.name || "";
        return !selectedTa || name.toLowerCase() === selectedTa.toLowerCase();
      })
      .map((feature) => {
        const name = feature?.properties?.name || "";
        const floodStats = taFloodLookup.get(name.toLowerCase()) || {};

        return {
          ...feature,
          properties: {
            ...feature.properties,
            admin_unit_name: name,
            exposed_population: floodStats.exposedPopulation || 0,
            exposed_population_pct: floodStats.exposedPopulationPct || 0,
            risk_level: floodStats.riskLevel,
          },
        };
      });

    return {
      ...densityMap.data,
      features,
    };
  }, [densityMap.data, selectedTa, taFloodLookup]);

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
  };

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

  const formatStat = (val) => {
    if (!val && val !== 0) return "0";
    return Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
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

    const educationData = educationSummary.data || {};
    const healthRows = Array.isArray(healthSummary.data)
      ? healthSummary.data.map((row) => ({
          metric: row.metric_name,
          value: row.metric_value,
        }))
      : [];

    const welfareSummary = welfareIntegration.data?.summary || {};
    const welfareRows = Object.entries(welfareSummary).map(([key, value]) => ({
      metric: key.replace(/_/g, " "),
      value: formatStat(value),
    }));

    const disasterRows = [
      { metric: "Flood Exposed Population", value: formatStat(exposedPopulation) },
      { metric: "Not Exposed Population", value: formatStat(notExposedPopulation) },
    ];

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
            metric: "Total Population Density",
            value: formatStat(summary.data?.total_population_density || 0),
          },
          {
            metric: "Flood Exposed Population",
            value: formatStat(exposedPopulation),
          },
          {
            metric: "Not Exposed Population",
            value: formatStat(notExposedPopulation),
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
          { metric: "School Count", value: formatStat(educationData.school_count || 0) },
          { metric: "Student Enrollment", value: formatStat(educationData.student_enrollment_total || 0) },
          { metric: "Teacher Count", value: formatStat(educationData.teacher_count_total || 0) },
          { metric: "School Age Population", value: formatStat(educationData.school_age_population_total || 0) },
          { metric: "Out-of-School Population", value: formatStat(educationData.not_in_school_total || 0) },
        ],
      },
      {
        title: "Health",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: healthRows.length > 0 ? healthRows : [
          { metric: "Health metrics", value: "No data available" },
        ],
      },
      {
        title: "Social Welfare",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: welfareRows.length > 0 ? welfareRows : [
          { metric: "Welfare metrics", value: "No data available" },
        ],
      },
      {
        title: "Disaster Risk",
        columns: [
          { key: "metric", label: "Metric", width: 260 },
          { key: "value", label: "Value", width: 180 },
        ],
        rows: disasterRows,
      },
    ];

    await exportDataPdf({
      title: "Selected Area Sector Analysis",
      selectedArea: selectedAreaName,
      sections,
    });
  };

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white relative animate-pulse">
      <div className="flex justify-between items-start mb-4">
        <div className="h-4 w-32 bg-gray-200 rounded"></div>
        <div className="h-5 w-5 bg-gray-100 rounded-full"></div>
      </div>
      <div className="h-8 w-24 bg-gray-200 rounded mt-2"></div>
    </div>
  );

  const ChartSkeleton = () => (
    <div className="h-full w-full flex flex-col gap-4 animate-pulse">
      <div className="flex-1 bg-gray-50 rounded-lg relative overflow-hidden">
        <div className="absolute inset-0 flex items-end justify-around px-4 pb-4">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className="w-8 bg-gray-200 rounded-t"
              style={{ height: `${Math.random() * 60 + 20}%` }}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-10">
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <h1 className="text-[28px] font-extrabold tracking-tight">OVERVIEW</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedTa
            ? `Showing records for ${selectedTa}`
            : selectedDistrict
              ? `Showing ${selectedDistrict} Records`
              : "Showing All Districts Records"}
        </p>

        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={handleDownloadReport}
            disabled={(!selectedDistrict && !selectedTa) || summary.loading}
            title={selectedDistrict || selectedTa ? "Download analysis for selected area" : "Select a district or TA first"}
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

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
          {summary.loading
            ? [...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)
            : [
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
                  label: "Flood Exposed Population",
                  value: formatStat(exposedPopulation),
                  icon: Accessibility,
                  helper: scopeLabel,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="border border-gray-100 rounded p-6 shadow-md bg-white relative hover:shadow-lg transition-all group active:scale-95 cursor-default"
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

        {/* Middle Row (Map + Bar Chart) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col h-160">
            <h3 className="text-[16px] font-extrabold mb-6">
              {selectedTa ? `${selectedTa} Map Overview` : "TA Map Overview"}
            </h3>
            <div
              ref={mapRef}
              className="w-full flex-1 rounded overflow-hidden relative border border-gray-50 shadow-inner bg-gray-50"
            >
              <PopulationRasterPanel
                geojson={mapGeojson}
                title={null}
                subtitle={null}
                heightClass="h-full min-h-[520px] w-full"
                loading={densityMap.loading}
                metadataUrl="/worldpop/zomba_ppp_2020.preview.json"
                selectedFeatureName={selectedTa}
                onFeatureClick={(feature) =>
                  selectTa(feature?.properties?.name || "")
                }
              />
            </div>
          </div>

          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white flex flex-col min-h-115">
            <h3 className="text-[16px] font-extrabold mb-6">
              {selectedTa ? `Population for ${selectedTa}` : "Population by TA"}
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-3">
              {selectedTa
                ? `${selectedTa} is highlighted; click another bar to sync the map and overview metrics.`
                : "Showing TA-level population totals. Click a bar to sync the map and overview metrics."}
            </p>
            <div className="flex-1">
              {populationDistribution.loading ? (
                <ChartSkeleton />
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
                          selectedTa &&
                          entry.admin3.toLowerCase() ===
                            selectedTa.toLowerCase();

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

        {/* Bottom Row (Pie Chart) */}
        <div className="border border-gray-100 rounded p-10 shadow-sm bg-white">
          <h3 className="text-[16px] font-extrabold mb-10">
            Flood Exposure Distribution for {scopeLabel}
          </h3>
          <div className="w-full flex flex-col md:flex-row items-center justify-start gap-16">
            <div className="h-70 w-full md:w-100">
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
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
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

            {/* Custom Pie Legend */}
            <div className="flex flex-col gap-6">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div
                    className="w-5 h-5 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-[16px] text-gray-700 font-semibold">
                    {entry.name} :
                  </span>
                  <span className="text-[16px] font-extrabold text-black">
                    {entry.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OverviewPage;
