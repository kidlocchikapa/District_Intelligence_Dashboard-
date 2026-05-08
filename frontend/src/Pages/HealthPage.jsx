import { Activity, HeartPulse, Bed, Users, Download, Building2, CheckCircle2, AlertCircle, Building } from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { buildDashboardPath } from "../lib/query";
import { usePdfExport } from "../hooks/usePdfExport";
import MapPanel from "../components/MapPanel";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import GlobalHospitalRegistry from "../components/GlobalHospitalRegistry";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function getFacilityBarColor(value, maxValue) {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return "#cbd5e1";
  }

  const ratio = value / maxValue;

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

function getHealthRasterAsset(assets, key) {
  return assets?.[key] || "/worldpop/zomba_ppp_2020.preview.json";
}

function HealthPage() {
  const { selectedDistrict, selectedTa } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport("Health_Report.pdf");
  const districtScope = selectedDistrict || "Zomba";

  const servedPopulationSummary = useDashboardData(
    buildDashboardPath("/dashboard/health/served-population", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
    }),
  );

  // Summary Aggregates
  const healthSummary = useDashboardData(
    buildDashboardPath("/dashboard/health/summary", {
      district: districtScope,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
    }),
  );
  const districtHealthSummary = useDashboardData(
    buildDashboardPath("/dashboard/health/summary", {
      district: districtScope,
      admin_type: "District",
    }),
  );
  const healthIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "District",
    }),
  );
  const servedPopulationTrend = useDashboardData(
    buildDashboardPath("/dashboard/health/served-population", {
      district: districtScope,
      admin_type: "TA",
    }),
  );

  // Health Facility GeoJSON for Map
  const healthLocations = useDashboardData(
    buildDashboardPath("/dashboard/health", {
      district: districtScope,
      ta: selectedTa,
    }),
  );
  const healthCoverageTaGeojson = useDashboardData(
    buildDashboardPath("/dashboard/health/served-population/geojson", {
      district: districtScope,
      admin_type: "TA",
    }),
  );
  const healthRasterMetadata = useDashboardData(
    buildDashboardPath("/dashboard/health/raster-metadata", {
      district: districtScope,
    }),
  );

  const healthApiErrors = [
    healthSummary.error,
    districtHealthSummary.error,
    servedPopulationSummary.error,
    healthLocations.error,
    servedPopulationTrend.error,
    healthCoverageTaGeojson.error,
    healthRasterMetadata.error,
  ].filter(Boolean);

  const formatStat = (val) => Number(val).toLocaleString();

  const facilities = healthLocations?.data?.features || [];
  const totalFacilities = facilities.length;
  
  const functionalFacilities = facilities.filter(
    (f) => f?.properties?.status === "Functional"
  ).length;

  const nonFunctionalFacilities = facilities.filter(
    (f) => {
      const status = f?.properties?.status;
      return status === "Non-functional" || status === "Closed" || status === "Closed (Temporary)";
    }
  ).length;

  const govFacilities = facilities.filter(
    (f) => f?.properties?.ownership === "Government"
  ).length;

  const privateFacilities = facilities.filter(
    (f) => f?.properties?.ownership !== "Government"
  ).length;
  const facilityChartData = (districtHealthSummary.data || [])
    .filter((metric) => metric.metric_name === "health_facility_count")
    .map((metric) => ({
      district: metric.admin_unit_name,
      facilities: Number(metric.metric_value || 0),
    }));
  const maxFacilities = Math.max(
    ...facilityChartData.map((item) => item.facilities || 0),
    0,
  );

  const selectedAreaHospitals = (healthLocations.data?.features || [])
    .filter((f) => {
      const type = (f.properties?.type || "").toLowerCase();
      return type.includes("hospital");
    })
    .map((f) => ({
      name: f.properties?.name || f.properties?.name_en || "Unnamed Hospital",
      type: f.properties?.type || "Hospital",
      beds: f.properties?.beds_count || 0,
      visits: f.properties?.patient_visits_total || 0,
    }));

  const getServedPopulationValue = (metricName) =>
    (servedPopulationSummary.data || [])
      .filter((metric) => metric.metric_name === metricName)
      .reduce((sum, metric) => sum + Number(metric.metric_value || 0), 0);
  const accessTotal = Math.max(
    getServedPopulationValue("health_population_served_total"),
    0,
  );
  const noAccessTotal = Math.max(
    getServedPopulationValue("health_population_unserved_total"),
    0,
  );
  const totalPopulationInAccessView = accessTotal + noAccessTotal;
  const accessPieData = [
    { name: "Has access", value: accessTotal, color: "#2563eb" },
    { name: "No access", value: noAccessTotal, color: "#dc2626" },
  ].filter((entry) => entry.value > 0);
  const accessShare = totalPopulationInAccessView
    ? (accessTotal / totalPopulationInAccessView) * 100
    : 0;
  const servedPopulationTrendData = Object.values(
    (servedPopulationTrend.data || []).reduce((accumulator, metric) => {
      const key = metric.admin_unit_name || "Unknown";

      if (!accumulator[key]) {
        accumulator[key] = {
          area: key,
          served_population_pct: 0,
          served_population_total: 0,
          unserved_population_total: 0,
        };
      }

      const numericValue = Number(metric.metric_value || 0);

      if (metric.metric_name === "health_population_served_pct") {
        accumulator[key].served_population_pct = numericValue;
      }

      if (metric.metric_name === "health_population_served_total") {
        accumulator[key].served_population_total = numericValue;
      }

      if (metric.metric_name === "health_population_unserved_total") {
        accumulator[key].unserved_population_total = numericValue;
      }

      return accumulator;
    }, {}),
  ).sort(
    (left, right) => left.served_population_pct - right.served_population_pct,
  );

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4"></div>
      <div className="h-8 w-24 bg-gray-200 rounded"></div>
    </div>
  );

  return (
    <div
      ref={contentRef}
      className="min-h-screen bg-white text-black font-sans pb-10"
    >
      {/* Header Area */}
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <Activity className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">HEALTH</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Health infrastructure for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Health infrastructure for ${selectedTa}`
              : "Health infrastructure overview"}
        </p>

        {healthApiErrors.length ? (
          <div className="mb-6 rounded border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            Unable to load some Health data from the backend APIs.
            {healthApiErrors[0] ? ` ${healthApiErrors[0]}` : ""}
          </div>
        ) : null}

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-10">
          {healthLocations.loading
            ? [...Array(5)].map((_, i) => <StatCardSkeleton key={i} />)
            : [
                {
                  label: "Total Facilities",
                  value: formatStat(totalFacilities),
                  icon: HeartPulse,
                },
                {
                  label: "Functional",
                  value: formatStat(functionalFacilities),
                  icon: CheckCircle2,
                },
                {
                  label: "Non-functional",
                  value: formatStat(nonFunctionalFacilities),
                  icon: AlertCircle,
                },
                {
                  label: "Govt Owned",
                  value: formatStat(govFacilities),
                  icon: Building2,
                },
                {
                  label: "Private / Other",
                  value: formatStat(privateFacilities),
                  icon: Building,
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
            title="Integrated Health Context"
            subtitle="Health planning shown with linked beneficiary access, public and private hospital reach, and flood-sensitive welfare context."
            loading={healthIntegration.loading}
            items={[
              {
                label: "Health Access",
                metrics: {
                  beneficiaries_with_health_access:
                    healthIntegration.data?.summary?.health_access_count || 0,
                  health_access_pct:
                    healthIntegration.data?.summary?.health_access_pct || 0,
                  public_hospital_access:
                    healthIntegration.data?.summary
                      ?.public_hospital_access_count || 0,
                  private_hospital_access:
                    healthIntegration.data?.summary
                      ?.private_hospital_access_count || 0,
                },
              },
              {
                label: "Education Link",
                metrics: {
                  beneficiaries_with_school_access:
                    healthIntegration.data?.summary?.school_access_count || 0,
                  school_age_unenrolled:
                    healthIntegration.data?.summary
                      ?.school_age_population_unenrolled || 0,
                },
              },
              {
                label: "Risk Link",
                metrics: {
                  flood_affected_beneficiaries:
                    healthIntegration.data?.summary?.flood_affected_count || 0,
                  flood_affected_pct:
                    healthIntegration.data?.summary?.flood_affected_pct || 0,
                },
              },
            ]}
          />
        </div>

        <div className="mb-10">
          <div className="mb-4">
            <h3 className="text-[16px] font-extrabold">
              Beneficiary Travel Access Visualizations
            </h3>
            <p className="text-[13px] text-gray-500 font-semibold mt-1">
              Separate views for 8 km facility buffers, 8 km road-network access, and beneficiary travel time to the nearest health facility.
            </p>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={healthCoverageTaGeojson.data}
                title="8 km Buffer"
                subtitle="Continuous 8 km facility-access surface clipped to the combined Zomba and Zomba City geometry."
                metadataUrl={getHealthRasterAsset(
                  healthRasterMetadata.data?.assets,
                  "health_buffer_8km",
                )}
                heightClass="h-[320px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
              />
            </div>
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={healthCoverageTaGeojson.data}
                title="8 km Network"
                subtitle="Smoothed beneficiary road-network distance surface with TA boundaries shown for local context."
                metadataUrl={getHealthRasterAsset(
                  healthRasterMetadata.data?.assets,
                  "health_network_8km",
                )}
                heightClass="h-[320px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
              />
            </div>
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={healthCoverageTaGeojson.data}
                title="Travel Time"
                subtitle="Smoothed beneficiary travel-time surface with TA boundaries and hover labels."
                metadataUrl={getHealthRasterAsset(
                  healthRasterMetadata.data?.assets,
                  "health_travel_time",
                )}
                heightClass="h-[320px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
              />
            </div>
          </div>
        </div>

        {/* Map + Coverage Trend Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">
              Health Services Map
            </h3>
            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
              <MapPanel
                geojson={healthLocations.data}
                pointColor="#c56a3d"
                popupFields={[
                  { key: "type", label: "Type" },
                  { key: "beds_count", label: "Beds" },
                  { key: "patient_visits_total", label: "Patient Visits" },
                ]}
                tooltipFields={[
                  { key: "type", label: "Type" },
                  { key: "beds_count", label: "Beds" },
                  { key: "patient_visits_total", label: "Patient Visits" },
                ]}
                showLegend={false}
                showLabels={false}
                heightClass="h-full w-full"
                loading={healthLocations.loading}
              />
            </div>
          </div>

          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-6">
              Health Service Coverage Trend
            </h3>
            <p className="text-xs text-gray-500 font-semibold mb-4">
              Served population coverage by TA so weaker health access areas stand out in sequence.
            </p>
            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50 p-4">
              {servedPopulationTrend.loading ? (
                <div className="h-full w-full animate-pulse rounded bg-white" />
              ) : servedPopulationTrendData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                  No TA-level health coverage trend is available for this filter yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={servedPopulationTrendData}
                    margin={{ top: 16, right: 20, left: 4, bottom: 84 }}
                  >
                    <CartesianGrid
                      stroke="#f1f5f9"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="area"
                      axisLine={false}
                      tick={{
                        fill: "#64748b",
                        fontSize: 9,
                        fontWeight: 700,
                      }}
                      tickFormatter={formatDistrictAxisLabel}
                      tickLine={false}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      height={72}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{
                        fill: "#64748b",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                      tickLine={false}
                      domain={[0, 100]}
                      tickFormatter={(value) => `${Number(value).toFixed(0)}%`}
                    />
                    <Tooltip
                      formatter={(value, name, item) => {
                        if (name === "Coverage") {
                          return [`${Number(value).toFixed(1)}%`, name];
                        }

                        return [
                          Number(value).toLocaleString(),
                          name,
                          item,
                        ];
                      }}
                      labelFormatter={(label) => label}
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="served_population_pct"
                      name="Coverage"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{ r: 3, fill: "#2563eb" }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="border border-gray-100 rounded p-6 shadow-sm bg-white h-[400px] flex flex-col">
            <h3 className="text-[16px] font-extrabold mb-4">
              {selectedTa
                ? `Hospitals in ${selectedTa}`
                : selectedDistrict
                  ? `Hospitals in ${selectedDistrict}`
                  : "Health Facilities Across Zomba"}
            </h3>

            <div className="flex-1 overflow-hidden">
              {selectedDistrict || selectedTa ? (
                <div className="h-full overflow-y-auto pr-2 custom-scrollbar">
                  {healthLocations.loading ? (
                    <div className="space-y-3">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-white animate-pulse"
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="h-4 bg-gray-100 rounded w-3/4"></div>
                            <div className="h-3 bg-gray-50 rounded w-1/4"></div>
                          </div>
                          <div className="ml-4 w-12 h-8 bg-gray-50 rounded"></div>
                        </div>
                      ))}
                    </div>
                  ) : selectedAreaHospitals.length > 0 ? (
                    <div className="space-y-3">
                      {selectedAreaHospitals.map((hospital, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-3 rounded-xl border border-gray-50 bg-gray-50/50 hover:bg-gray-100 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {hospital.name}
                            </p>
                            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                              {hospital.type}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-black text-blue-600">
                              {hospital.beds || "--"}
                            </p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase">
                              Beds
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center p-4">
                      <HeartPulse className="h-8 w-8 text-gray-200 mb-2" />
                      <p className="text-sm font-bold text-gray-400">
                        {selectedTa
                          ? "No hospitals found in this TA"
                          : "No hospitals found in this district"}
                      </p>
                      <p className="text-[11px] text-gray-300 mt-1">
                        {selectedTa
                          ? "Try selecting another TA or clear the TA filter"
                          : 'Try selecting another district or "All Districts"'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-[300px]">
                  {districtHealthSummary.loading ? (
                    <div className="h-full w-full animate-pulse rounded bg-gray-50" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={facilityChartData}
                        margin={{ top: 8, right: 16, left: 8, bottom: 44 }}
                      >
                        <CartesianGrid
                          stroke="#f1f5f9"
                          strokeDasharray="3 3"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="district"
                          axisLine={false}
                          tick={{
                            fill: "#64748b",
                            fontSize: 9,
                            fontWeight: 700,
                          }}
                          tickFormatter={formatDistrictAxisLabel}
                          tickLine={false}
                          angle={-35}
                          textAnchor="end"
                          interval={0}
                          height={52}
                        />
                        <YAxis
                          axisLine={false}
                          tick={{
                            fill: "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value) =>
                            Number(value).toLocaleString()
                          }
                          labelFormatter={(label) => label}
                          contentStyle={{
                            borderRadius: "4px",
                            border: "none",
                            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                            fontSize: "12px",
                          }}
                          cursor={{ fill: "#f8fafc" }}
                        />
                        <Bar
                          dataKey="facilities"
                          radius={[2, 2, 0, 0]}
                          barSize={14}
                          activeBar={<Rectangle fill="#7e22ce" />}
                        >
                          {facilityChartData.map((entry) => (
                            <Cell
                              key={`health-facility-bar-${entry.district}`}
                              fill={getFacilityBarColor(
                                entry.facilities,
                                maxFacilities,
                              )}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="border border-gray-100 rounded p-6 shadow-sm bg-white h-[400px] flex flex-col">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h3 className="text-[16px] font-extrabold">
                  Population Access to Health Facilities
                </h3>
                <p className="text-[13px] text-gray-500 font-semibold mt-1">
                  {selectedDistrict
                    ? `Estimated access split for ${selectedTa || selectedDistrict}`
                    : selectedTa
                      ? `Estimated access split for ${selectedTa}`
                      : "Estimated access split across Zomba"}
                </p>
              </div>
              <div className="text-right">
                <div className="text-[30px] font-extrabold tracking-tight text-blue-600">
                  {accessShare.toFixed(1)}%
                </div>
                <div className="text-[12px] font-bold uppercase tracking-wide text-gray-400">
                  With access
                </div>
              </div>
            </div>

            {servedPopulationSummary.loading ? (
              <div className="flex-1 animate-pulse rounded bg-gray-50" />
            ) : totalPopulationInAccessView === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 font-semibold">
                No served population data available
              </div>
            ) : (
              <div className="flex-1 min-w-0 flex flex-col xl:flex-row items-center xl:items-stretch gap-6">
                <div className="h-full w-full max-w-[240px] xl:w-[220px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={accessPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={56}
                        outerRadius={84}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {accessPieData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => Number(value).toLocaleString()}
                        contentStyle={{
                          borderRadius: "4px",
                          border: "none",
                          boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                          fontSize: "12px",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="w-full min-w-0 flex-1 flex flex-col gap-4">
                  {accessPieData.map((entry) => {
                    const share = totalPopulationInAccessView
                      ? (entry.value / totalPopulationInAccessView) * 100
                      : 0;

                    return (
                      <div
                        key={entry.name}
                        className="min-w-0 border border-gray-100 rounded px-4 py-3"
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div
                            className="w-3.5 h-3.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-[14px] font-bold text-gray-700">
                            {entry.name}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3 min-w-0">
                          <span className="min-w-0 break-words text-[22px] font-extrabold tracking-tight text-black">
                            {formatStat(entry.value)}
                          </span>
                          <span
                            className="shrink-0 text-[18px] font-black"
                            style={{ color: entry.color }}
                          >
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Global Hospital Registry - shown for the default all-district view */}
        {!selectedDistrict && (
          <GlobalHospitalRegistry
            data={healthLocations.data}
            loading={healthLocations.loading}
          />
        )}
      </div>
    </div>
  );
}

export default HealthPage;
