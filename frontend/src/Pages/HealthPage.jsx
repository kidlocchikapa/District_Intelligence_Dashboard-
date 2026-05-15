import { useMemo } from "react";
import { Activity, HeartPulse, Bed, Users, Download, Building2, CheckCircle2, AlertCircle, Building, Lightbulb, ArrowRight, AlertTriangle, TrendingUp } from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { buildDashboardPath } from "../lib/query";
import { usePdfExport } from "../hooks/usePdfExport";
import { formatNumber } from "../lib/format";
import MapPanel from "../components/MapPanel";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import GlobalHospitalRegistry from "../components/GlobalHospitalRegistry";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import FacilityBurdenScatter from "../components/Charts/FacilityBurdenScatter.jsx";
import TAAnalyticsTable from "../components/Tables/TAAnalyticsTable.jsx";
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

  const taAnalytics = useDashboardData(
    buildDashboardPath("/dashboard/health/analytics/ta", {
      district: districtScope,
    }),
  );

  const healthDrilldown = useDashboardData(
    buildDashboardPath("/dashboard/health/drilldown", {
      district: districtScope,
      admin_type: "District",
    }),
  );

  const augmentedGeojson = useMemo(() => {
    if (!healthCoverageTaGeojson.data || !taAnalytics.data) {
      return healthCoverageTaGeojson.data;
    }
    
    const geojson = { ...healthCoverageTaGeojson.data };
    geojson.features = geojson.features.map(feature => {
      const name = feature.properties?.admin_unit_name || feature.properties?.name;
      const taData = taAnalytics.data.find(d => String(d.admin_unit_name).toLowerCase() === String(name).toLowerCase());
      
      if (taData) {
        return {
          ...feature,
          properties: {
            ...feature.properties,
            vulnerability_score: taData.vulnerability_score,
            flood_isolation_risk: taData.flood_isolation_risk,
            student_enrolment_affected: taData.student_enrolment_affected,
            avg_distance_to_health: taData.avg_distance_to_health
          }
        };
      }
      return feature;
    });
    return geojson;
  }, [healthCoverageTaGeojson.data, taAnalytics.data]);

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
                title="Access in 8 Km radius"
                subtitle="Population served in 8 Km radius"
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
                title="8 km Road distance "
                subtitle="Beneficiary road-network distance to healthy facility"
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
                title="2SFCA Access Score"
                subtitle="Healthcare staff per 1,000 people (interpolated from TA centroids)."
                metadataUrl={getHealthRasterAsset(
                  healthRasterMetadata.data?.assets,
                  "health_2sfca",
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

        {/* Integrated Insights Section */}
        <div className="mb-8">
          <h2 className="text-[20px] font-extrabold mb-4 text-[#1a365d]">
            Integrated Planning Insights
          </h2>
          <div className="grid grid-cols-1 gap-8">
            <div className="border border-gray-100 rounded p-6 shadow-sm bg-gradient-to-br from-white to-orange-50/30">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                  <h3 className="text-[18px] font-bold mb-3 text-[#78350f]">Health + Welfare Priority Map</h3>
                  <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                    This index identifies <strong>"Double-Vulnerable"</strong> zones by overlapping healthcare staff gaps with poverty density. 
                  </p>
                  <ul className="space-y-2 text-xs text-gray-500 mb-6">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                      <strong>High Priority (Dark Brown):</strong> Areas with high poverty and low health access.
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-yellow-200"></div>
                      <strong>Low Priority (Pale Yellow):</strong> Areas where access meets local demand.
                    </li>
                  </ul>
                  <div className="p-3 bg-orange-100/50 rounded-lg border border-orange-200">
                    <p className="text-xs text-orange-800 font-semibold italic">
                      Strategy: Prioritize these zones for Mobile Clinic deployment or new Health Post construction.
                    </p>
                  </div>
                </div>
                <div className="lg:col-span-2 bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
                  <PopulationRasterPanel
                    geojson={augmentedGeojson}
                    customTooltipMetrics={[
                      { key: "vulnerability_score", label: "Vulnerability", digits: 1 }
                    ]}
                    title="Vulnerability Index (Health x Poverty)"
                    subtitle="Priority zones for healthcare infrastructure investment."
                    metadataUrl={getHealthRasterAsset(
                      healthRasterMetadata.data?.assets,
                      "health_welfare_vulnerability",
                    )}
                    heightClass="h-[400px]"
                    loading={
                      healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                    }
                    selectedFeatureName={selectedTa}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 mt-8">
            <div className="border border-gray-100 rounded p-6 shadow-sm bg-gradient-to-br from-white to-blue-50/30">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                  <h3 className="text-[18px] font-bold mb-3 text-[#1e3a8a]">Flood Isolation Simulation</h3>
                  <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                    This simulation identifies communities that lose access to clinics when local roads become impassable due to flooding.
                  </p>
                  <ul className="space-y-2 text-xs text-gray-500 mb-6">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <strong>High Risk (Red):</strong> &gt;50% reduction in healthcare accessibility during flood events.
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-200"></div>
                      <strong>Resilient (Blue):</strong> Minimal impact on facility accessibility.
                    </li>
                  </ul>
                  <div className="p-3 bg-blue-100/50 rounded-lg border border-blue-200">
                    <p className="text-xs text-blue-800 font-semibold italic">
                      Insight: Use this to plan "Boats for Health" or pre-positioning medicine in high-risk zones.
                    </p>
                  </div>
                </div>
                <div className="lg:col-span-2 bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
                  <PopulationRasterPanel
                    geojson={augmentedGeojson}
                    customTooltipMetrics={[
                      { key: "flood_isolation_risk", label: "Isolation Risk", format: "pct" }
                    ]}
                    title="Simulated Flood Impact (% Access Lost)"
                    subtitle="Communities at risk of physical isolation from healthcare."
                    metadataUrl={getHealthRasterAsset(
                      healthRasterMetadata.data?.assets,
                      "health_flood_isolation",
                    )}
                    heightClass="h-[400px]"
                    loading={
                      healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                    }
                    selectedFeatureName={selectedTa}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 mt-8">
            <div className="border border-gray-100 rounded p-6 shadow-sm bg-gradient-to-br from-white to-green-50/30">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1">
                  <h3 className="text-[18px] font-bold mb-3 text-[#14532d]">School-Health Synergy</h3>
                  <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                    This map shows the <strong>Average Distance</strong> students must travel from their school to reach the nearest health facility.
                  </p>
                  <ul className="space-y-2 text-xs text-gray-500 mb-6">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-700"></div>
                      <strong>Underserved (Dark Green):</strong> Average distance to a clinic exceeds 5km.
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-200"></div>
                      <strong>Well Served (Pale Green):</strong> Schools are within easy reach of health support.
                    </li>
                  </ul>
                  <div className="p-3 bg-green-100/50 rounded-lg border border-green-200">
                    <p className="text-xs text-green-800 font-semibold italic">
                      Strategy: Target these dark green zones for school-based health programs and vaccination drives.
                    </p>
                  </div>
                </div>
                <div className="lg:col-span-2 bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
                  <PopulationRasterPanel
                    geojson={augmentedGeojson}
                    customTooltipMetrics={[
                      { key: "student_enrolment_affected", label: "Affected Students" },
                      { key: "avg_distance_to_health", label: "Avg Distance (km)", digits: 1 }
                    ]}
                    title="School Health Gaps (Avg Dist to Clinic)"
                    subtitle="Accessibility of healthcare services for school populations."
                    metadataUrl={getHealthRasterAsset(
                      healthRasterMetadata.data?.assets,
                      "health_school_gap",
                    )}
                    heightClass="h-[400px]"
                    loading={
                      healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                    }
                    selectedFeatureName={selectedTa}
                  />
                </div>
              </div>
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

        {/* Deep-Dive Analytics Section */}
        <div className="mb-10">
          <div className="flex items-center gap-2 mb-6 border-b pb-2">
            <Building2 className="text-[#1e3a8a]" size={24} />
            <h2 className="text-[20px] font-black tracking-tight text-[#1e3a8a]">
              Deep-Dive Analytics
            </h2>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            <div className="border border-gray-100 rounded-lg p-6 shadow-sm bg-white">
              <h3 className="text-[16px] font-extrabold mb-2 text-gray-800">
                Facility Burden Analysis
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                Identifies critically overloaded facilities. <span className="text-red-500 font-semibold">Red dots</span> indicate high-burden clinics (catchment &gt; 20,000 and staff &lt; 5).
              </p>
              <FacilityBurdenScatter />
            </div>
            <div className="border border-gray-100 rounded-lg p-6 shadow-sm bg-white overflow-hidden flex flex-col">
              <h3 className="text-[16px] font-extrabold mb-2 text-gray-800">
                Integrated Priority Matrix (TA Level)
              </h3>
              <p className="text-sm text-gray-500 mb-6">
                A composite view of vulnerabilities by Traditional Authority.
              </p>
              <div className="flex-1 overflow-hidden">
                <TAAnalyticsTable />
              </div>
            </div>
          </div>
        </div>

        {/* Global Hospital Registry - shown for the default all-district view */}
        {!selectedDistrict && (
          <GlobalHospitalRegistry
            data={healthLocations.data}
            loading={healthLocations.loading}
          />
        )}

        {/* ── Health Insights & Recommendations ──────────────────── */}
        <HealthRecommendations
          healthSummary={healthSummary}
          servedPopulationSummary={servedPopulationSummary}
          healthDrilldown={healthDrilldown}
          healthLocations={healthLocations}
          healthIntegration={healthIntegration}
          districtScope={districtScope}
          accessTotal={accessTotal}
          noAccessTotal={noAccessTotal}
          accessShare={accessShare}
          totalFacilities={totalFacilities}
          functionalFacilities={functionalFacilities}
          nonFunctionalFacilities={nonFunctionalFacilities}
          govFacilities={govFacilities}
          privateFacilities={privateFacilities}
        />
      </div>
    </div>
  );
}

/* ─── Health Recommendations ───────────────────────────────────────────── */
function HealthRecommendations({
  healthSummary, servedPopulationSummary, healthDrilldown, healthLocations,
  healthIntegration, districtScope, accessTotal, noAccessTotal, accessShare,
  totalFacilities, functionalFacilities, nonFunctionalFacilities,
  govFacilities, privateFacilities,
}) {
  const loading = healthSummary.loading || servedPopulationSummary.loading || healthDrilldown.loading;

  const drillSummary  = healthDrilldown.data?.summary || {};
  const taBreakdown   = healthDrilldown.data?.ta_breakdown || [];
  const facilities    = healthLocations.data?.features || [];

  // Derive key metrics
  const popPerFacility   = Number(drillSummary.population_per_facility || 0);
  const totalPop         = Number(drillSummary.population_total || 0);
  const facilityCount    = Number(drillSummary.facility_count || 0);

  // Underserved TAs: top 3 by population per facility
  const underservedTAs = [...taBreakdown]
    .filter(r => Number(r.population_per_facility || 0) > 2000)
    .sort((a, b) => Number(b.population_per_facility || 0) - Number(a.population_per_facility || 0))
    .slice(0, 3);
  const worstTA = underservedTAs[0];

  // Workforce
  const doctors = facilities.reduce((s, f) => s + Number(f.properties?.doctor_count || 0), 0);
  const nurses  = facilities.reduce((s, f) => s + Number(f.properties?.nurse_midwife_count || 0), 0);
  const doctorRatio = totalPop > 0 && doctors > 0 ? Math.round(totalPop / doctors) : null;
  const nurseRatio  = totalPop > 0 && nurses  > 0 ? Math.round(totalPop / nurses)  : null;

  // Flood-exposed facilities
  const floodExposed = facilities.filter(f => f.properties?.flood_is_exposed).length;

  // Welfare beneficiaries with health access
  const welfareWithAccess = Number(healthIntegration.data?.summary?.health_access_count || 0);
  const welfareTotal      = Number(healthIntegration.data?.summary?.total_beneficiaries || 0);

  // Avg travel time
  const travelTimes = facilities
    .map(f => Number(f.properties?.avg_travel_time_min || 0))
    .filter(v => v > 0);
  const medianTravel = travelTimes.length
    ? travelTimes.sort((a,b)=>a-b)[Math.floor(travelTimes.length/2)]
    : null;

  const priorityConfig = {
    high:   { label: "Immediate Action",  classes: "bg-red-50 border-red-200 text-red-700",       dot: "bg-red-500"    },
    medium: { label: "Short-Term Action", classes: "bg-amber-50 border-amber-200 text-amber-700",  dot: "bg-amber-500"  },
    low:    { label: "Planning Note",     classes: "bg-blue-50 border-blue-200 text-blue-700",     dot: "bg-blue-500"   },
  };

  const recommendations = [
    // 1 — Access gap
    noAccessTotal > 0 && {
      priority: "high",
      icon: AlertTriangle,
      title: "Critical Health Access Gap",
      body: `${formatNumber(noAccessTotal, 0)} people in ${districtScope} lack access to a health facility within 8 km — ${formatNumber(100 - accessShare, 1)}% of the population. The access coverage map shows the largest unserved pockets in rural TAs. Expanding facility placement or mobile health outreach in these zones is the highest-priority intervention.`,
      action: "Identify top 3 unserved population clusters from the coverage map and plan satellite clinic placement",
    },
    // 2 — Underserved TAs
    underservedTAs.length > 0 && {
      priority: "high",
      icon: Building,
      title: "Facility Shortage in High-Population TAs",
      body: `${underservedTAs.length} TA${underservedTAs.length > 1 ? "s" : ""} exceed 2,000 people per facility — well above the recommended threshold.${worstTA ? ` ${worstTA.ta_name} is the most underserved with ${formatNumber(worstTA.population_per_facility, 0)} people per facility serving a population of ${formatNumber(worstTA.population_total, 0)}.` : ""} New facility construction or upgrading existing health posts to full clinics is needed.`,
      action: `Prioritise new health facility construction in ${underservedTAs.map(t => t.ta_name).join(", ")}`,
    },
    // 3 — Non-functional facilities
    nonFunctionalFacilities > 0 && {
      priority: "high",
      icon: AlertCircle,
      title: "Non-Functional Facilities Reducing Effective Capacity",
      body: `${formatNumber(nonFunctionalFacilities)} of ${formatNumber(totalFacilities)} facilities are non-functional or closed. These represent lost capacity that could serve existing populations without new construction. Rehabilitation of closed facilities is faster and cheaper than building new ones.`,
      action: "Audit all non-functional facilities and prioritise rehabilitation of those in high-need TAs",
    },
    // 4 — Workforce
    doctorRatio !== null && doctorRatio > 5000 && {
      priority: "high",
      icon: Users,
      title: "Severe Doctor Shortage",
      body: `The doctor-to-population ratio is 1:${formatNumber(doctorRatio, 0)}, far exceeding the WHO recommended 1:1,000. With only ${formatNumber(doctors, 0)} doctors serving ${formatNumber(totalPop, 0)} people, clinical capacity is severely constrained. Nurse-led care models and community health worker deployment can bridge the gap in the short term.`,
      action: "Deploy community health workers to high-burden TAs and fast-track nurse practitioner training",
    },
    // 5 — Private sector balance
    privateFacilities > govFacilities && {
      priority: "medium",
      icon: Building2,
      title: "Private Sector Dominance — Equity Risk",
      body: `${formatNumber(privateFacilities)} of ${formatNumber(totalFacilities)} facilities are privately operated, outnumbering government facilities. While private facilities expand coverage, they concentrate in urban and peri-urban areas, leaving rural populations dependent on fewer government facilities. Public-private partnership agreements should include rural service obligations.`,
      action: "Negotiate PPP agreements requiring private facilities to serve a defined rural catchment population",
    },
    // 6 — Flood risk
    floodExposed > 0 && {
      priority: "medium",
      icon: AlertTriangle,
      title: "Flood-Exposed Health Facilities",
      body: `${formatNumber(floodExposed)} health facilities are in flood-exposed zones. During flood events these facilities may become inaccessible or damaged, cutting off health services precisely when demand spikes. Emergency referral pathways and pre-positioned medical supplies at unaffected facilities are essential.`,
      action: "Establish flood-season health service continuity plans and pre-position emergency medical supplies",
    },
    // 7 — Travel time
    medianTravel !== null && medianTravel > 30 && {
      priority: "medium",
      icon: TrendingUp,
      title: "Long Travel Times to Facilities",
      body: `The median road travel time to the nearest health facility is ${medianTravel.toFixed(0)} minutes. For emergency obstetric care, stroke, and trauma, this delay is life-threatening. Ambulance pre-positioning and community first-responder training in high-travel-time areas can reduce preventable deaths.`,
      action: "Pre-position ambulances in TAs with median travel times above 30 minutes",
    },
    // 8 — Welfare link
    welfareWithAccess > 0 && {
      priority: "low",
      icon: Lightbulb,
      title: "Link Health Access to Social Protection",
      body: `${formatNumber(welfareWithAccess, 0)} welfare beneficiaries have a health facility within 8 km. Integrating health service utilisation data with welfare programme monitoring would allow identification of beneficiaries who are geographically close to facilities but not accessing care — enabling targeted outreach.`,
      action: "Cross-reference welfare beneficiary data with health facility utilisation records to identify non-users",
    },
    // 9 — Interpretation note
    {
      priority: "low",
      icon: Lightbulb,
      title: "Map Interpretation: Coverage vs Utilisation",
      body: `The 8 km buffer coverage maps show geographic proximity to facilities, not actual utilisation. A facility within 8 km may still be inaccessible due to road conditions, cost, or cultural barriers. The road-distance and travel-time rasters provide a more accurate picture of real-world access than straight-line buffers alone.`,
      action: "Supplement coverage analysis with patient visit data and community health surveys to capture utilisation gaps",
    },
  ].filter(Boolean);

  if (loading) {
    return (
      <div className="mt-10 mb-10">
        <div className="h-6 w-64 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-36 animate-pulse rounded border border-gray-100 bg-gray-50" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 mb-10">
      <div className="flex items-center gap-3 mb-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h3 className="text-[16px] font-extrabold">Insights & Recommendations</h3>
      </div>
      <p className="text-sm text-gray-500 font-semibold mb-6">
        Data-driven planning actions derived from facility coverage maps, access analysis, workforce data, and flood exposure for {districtScope}.
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {recommendations.map((rec, i) => {
          const cfg = priorityConfig[rec.priority];
          const Icon = rec.icon;
          return (
            <div key={i} className="rounded border border-gray-100 bg-white p-5 shadow-sm flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex-shrink-0 rounded-lg bg-gray-50 p-2">
                    <Icon className="h-4 w-4 text-gray-600" />
                  </div>
                  <p className="text-[14px] font-extrabold text-black leading-tight">{rec.title}</p>
                </div>
                <span className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${cfg.classes}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>
              <p className="text-[13px] text-gray-600 leading-6">{rec.body}</p>
              <div className="flex items-start gap-2 rounded bg-gray-50 px-3 py-2 mt-auto">
                <ArrowRight className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide leading-5">{rec.action}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HealthPage;
