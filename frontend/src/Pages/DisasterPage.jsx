import {
  ShieldAlert,
  Users,
  School,
  Hospital,
  Map as MapIcon,
  Download,
} from "lucide-react";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import { buildDashboardPath } from "../lib/query";
import FloodRiskRasterPanel from "../components/FloodRiskRasterPanel";

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

function DisasterPage() {
  const { selectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport("DisasterRisk_Report.pdf");

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

  // Summary Aggregates
  const disasterSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/summary", {
      district: disasterDistrictFilter,
      admin_type: "District",
    }),
  );

  const educationFacilityExposureSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      admin_type: "District",
      facility_type: "education",
    }),
  );

  const healthFacilityExposureSummary = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/facilities/summary", {
      district: disasterDistrictFilter,
      admin_type: "District",
      facility_type: "health",
    }),
  );

  // Flood risk GeoJSON source from database
  const floodRiskZones = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood", {
      district: disasterDistrictFilter,
      admin_type: "TA",
    }),
  );
  const taFloodExposure = useDashboardData(
    buildDashboardPath("/dashboard/disaster/flood/population", {
      district: disasterDistrictFilter,
      admin_type: "TA",
    }),
  );
  const disasterIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: "District",
    }),
  );

  const exposedTaChartData = useMemo(
    () =>
      (taFloodExposure.data || [])
        .map((row) => ({
          ta: row.admin_unit_name,
          exposedPopulation: Number(row.exposed_population || 0),
          totalPopulation: Number(row.total_population || 0),
          exposedPercent: Number(row.exposed_population_pct || 0),
          riskLevel: row.risk_level,
        }))
        .filter((row) => row.exposedPopulation > 0)
        .sort((left, right) => right.exposedPopulation - left.exposedPopulation),
    [taFloodExposure.data],
  );

  const maxExposedPopulation = Math.max(
    ...exposedTaChartData.map((row) => row.exposedPopulation),
    0,
  );

  const schoolsExposed = (educationFacilityExposureSummary.data || []).reduce(
    (sum, row) => sum + Number(row.exposed_facilities || 0),
    0,
  );

  const healthFacilitiesExposed = (
    healthFacilityExposureSummary.data || []
  ).reduce((sum, row) => sum + Number(row.exposed_facilities || 0), 0);

  const formatStat = (val, withUnit = "") => {
    const num = Number(val);
    if (!Number.isFinite(num)) return withUnit ? `0 ${withUnit}` : "0";
    const formatted = num.toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
    return withUnit ? `${formatted} ${withUnit}` : formatted;
  };

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
      <div className="h-8 w-24 bg-gray-200 rounded"></div>
    </div>
  );

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
            ? `Risk analysis for ${selectedDistrict}`
            : "Risk analysis for Zomba + Zomba City"}
        </p>

        {/* Actions Row */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={exportPdf}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>
          <SharedDistrictSelector />

        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
          {disasterSummary.loading
            ? [...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)
            : [
                {
                  label: "Total Population Exposed",
                  value: formatStat(disasterSummary.data?.exposed_population),
                  icon: Users,
                },
                {
                  label: "Schools Exposed",
                  value: formatStat(schoolsExposed),
                  icon: School,
                },
                {
                  label: "Health Facilities Exposed",
                  value: formatStat(healthFacilitiesExposed),
                  icon: Hospital,
                },
                {
                  label: "Area Exposed",
                  value: formatStat(
                    disasterSummary.data?.exposed_area_sq_km,
                    "sq/km",
                  ),
                  icon: MapIcon,
                },
              ].map((stat, i) => (
                <div
                  key={i}
                  className="border border-gray-100 rounded p-6 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95"
                >
                  <div className="flex justify-between items-start">
                    <span className="text-[14px] text-gray-500 font-bold group-hover:text-black">
                      {stat.label}
                    </span>
                    <stat.icon className="h-5 w-5 text-gray-300 group-hover:text-black" />
                  </div>
                  <div className="mt-4 text-[32px] font-extrabold tracking-tight">
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
                <FloodRiskRasterPanel
                  geojson={floodRiskZones.data}
                  title="Flood Risk Raster Surface"
                  subtitle="Rasterized directly from database flood risk classes (low, medium, high)."
                  heightClass="h-full w-full"
                  loading={floodRiskZones.loading}
                />
              )}
            </div>
          </div>
          
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-2">
              Exposed TAs and Population
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-4">
              Traditional Authorities with flood-exposed population in the latest analysis.
            </p>
            <div className="flex-1">
              {taFloodExposure.loading ? (
                <ChartSkeleton />
              ) : exposedTaChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                  No TA-level flood exposure records are available for this filter yet.
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
                    >
                      {exposedTaChartData.map((entry) => (
                        <Cell
                          key={`ta-exposure-${entry.ta}`}
                          fill={getExposureBarColor(
                            entry.exposedPopulation,
                            maxExposedPopulation,
                          )}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DisasterPage;
