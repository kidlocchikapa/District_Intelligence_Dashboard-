import { useMemo, useState } from "react";
import { Activity, HeartPulse, Bed, Users, Download, Building2, CheckCircle2, AlertCircle, Building, Lightbulb, AlertTriangle, TrendingUp } from "lucide-react";
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
import PlanningPriorityPanel from "../components/PlanningPriorityPanel";
import MetricPreviewModal from "../components/MetricPreviewModal";
import FacilityBurdenScatter from "../components/Charts/FacilityBurdenScatter.jsx";
import TAAnalyticsTable from "../components/Tables/TAAnalyticsTable.jsx";
import InteractiveRecommendations from "../components/InteractiveRecommendations";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
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

function getCoverageBarColor(value) {
  if (!Number.isFinite(value)) {
    return "#94a3b8";
  }

  return value < 50 ? "#dc2626" : "#2563eb";
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

const HEALTH_RASTER_LAYERS = [
  {
    key: "health_buffer_8km",
    shortLabel: "8 km Coverage",
    title: "Access in 8 Km radius",
    subtitle: "Population served in 8 Km radius",
  },
  {
    key: "health_network_8km",
    shortLabel: "Road Distance",
    title: "8 km Road distance",
    subtitle: "Beneficiary road-network distance to healthy facility",
  },
  {
    key: "health_2sfca",
    shortLabel: "2SFCA Score",
    title: "2SFCA Access Score",
    subtitle:
      "Healthcare staff per 1,000 people (interpolated from TA centroids).",
  },
];

const HEALTH_CHART_LIMITS = [
  { value: 10, label: "Top 10" },
  { value: 20, label: "Top 20" },
  { value: 0, label: "All" },
];

function HealthPage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const [hoveredTa, setHoveredTa] = useState("");
  const [activeHealthRasterKey, setActiveHealthRasterKey] = useState(
    HEALTH_RASTER_LAYERS[0].key,
  );
  const [coverageChartSearch, setCoverageChartSearch] = useState("");
  const [coverageChartLimit, setCoverageChartLimit] = useState(20);
  const [coverageChartSort, setCoverageChartSort] = useState("coverage_asc");
  const [facilityChartSearch, setFacilityChartSearch] = useState("");
  const [facilityChartLimit, setFacilityChartLimit] = useState(20);
  const [facilityChartSort, setFacilityChartSort] = useState("facilities_desc");
  const { contentRef, exportPdf, exportDataPdf } = usePdfExport("Health_Report.pdf");
  const districtScope = selectedDistrict || "Zomba";
  const activeTaPreview = selectedTa || hoveredTa;
  const activeHealthRasterLayer =
    HEALTH_RASTER_LAYERS.find((layer) => layer.key === activeHealthRasterKey) ||
    HEALTH_RASTER_LAYERS[0];

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
  const healthAccessZones = useDashboardData(
    buildDashboardPath("/dashboard/health/access-zones/geojson", {
      district: districtScope,
      buffer_km: 8,
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
  const planningPriorities = useDashboardData(
    buildDashboardPath("/dashboard/planning-priorities", {
      district: districtScope,
      ta: selectedTa,
      admin_type: "TA",
      department: "health",
      limit: selectedTa ? 1 : 5,
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

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
    setHoveredTa("");
  };

  const selectTaFromFeature = (feature) => {
    const properties = feature?.properties || {};
    selectTa(properties.admin_unit_name || properties.name || "");
  };

  const clearTaFocus = () => {
    setSelectedTa("");
    setHoveredTa("");
  };

  const previewTaFromFeature = (feature) => {
    if (selectedTa) {
      return;
    }

    const properties = feature?.properties || {};
    setHoveredTa(properties.admin_unit_name || properties.name || "");
  };

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

  const selectedAreaName = selectedTa
    ? `TA: ${selectedTa}`
    : selectedDistrict
      ? `District: ${selectedDistrict}`
      : "National";

  const handleDownloadReport = async () => {
    const healthRows = Array.isArray(healthSummary.data)
      ? healthSummary.data.map((row) => ({
          metric: row.metric_name,
          value: formatStat(row.metric_value),
        }))
      : [];

    const servedPopulationRows = Array.isArray(servedPopulationSummary.data)
      ? servedPopulationSummary.data.map((row) => ({
          metric: row.metric_name,
          value: formatStat(row.metric_value),
        }))
      : [];

    const welfareRows = Object.entries(healthIntegration.data?.summary || {}).map(
      ([key, value]) => ({
        metric: key.replace(/_/g, " "),
        value: formatStat(value),
      }),
    );
    const planningRows = (planningPriorities.data?.priorities || []).map((row) => ({
      area: row.admin_unit_name,
      priority: row.priority_band,
      score: formatStat(row.planning_priority_score),
      action: row.recommended_actions?.[0] || "Review facility coverage and outreach",
    }));

    await exportDataPdf({
      title: "Health Area Analysis",
      selectedArea: selectedAreaName,
      sections: [
        {
          title: "Health Summary",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: healthRows.length ? healthRows : [
            { metric: "Health summary", value: "No data available" },
          ],
        },
        {
          title: "Served Population",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: servedPopulationRows.length ? servedPopulationRows : [
            { metric: "Served population", value: "No data available" },
          ],
        },
        {
          title: "Welfare Integration",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: welfareRows.length ? welfareRows : [
            { metric: "Integration summary", value: "No data available" },
          ],
        },
        {
          title: "Planning Priorities",
          columns: [
            { key: "area", label: "Area", width: 140 },
            { key: "priority", label: "Priority", width: 90 },
            { key: "score", label: "Score", width: 70 },
            { key: "action", label: "Recommended Action", width: 280 },
          ],
          rows: planningRows.length ? planningRows : [
            {
              area: districtScope,
              priority: "N/A",
              score: "0",
              action: "No ranked health planning priorities are available for this scope yet.",
            },
          ],
        },
      ],
    });
  };

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
  const filteredFacilityChartData = useMemo(() => {
    const searchTerm = facilityChartSearch.trim().toLowerCase();
    let rows = [...facilityChartData];

    if (searchTerm) {
      rows = rows.filter((item) =>
        String(item.district || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (facilityChartSort === "facilities_asc") {
        return Number(left.facilities || 0) - Number(right.facilities || 0);
      }

      if (facilityChartSort === "district_asc") {
        return String(left.district || "").localeCompare(
          String(right.district || ""),
        );
      }

      return Number(right.facilities || 0) - Number(left.facilities || 0);
    });

    if (facilityChartLimit > 0) {
      return rows.slice(0, facilityChartLimit);
    }

    return rows;
  }, [
    facilityChartData,
    facilityChartLimit,
    facilityChartSearch,
    facilityChartSort,
  ]);
  const maxFacilities = Math.max(
    ...filteredFacilityChartData.map((item) => item.facilities || 0),
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
  const servedPopulationTrendLookup = (servedPopulationTrend.data || []).reduce(
    (accumulator, metric) => {
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
    },
    {},
  );
  const servedPopulationTrendData = Object.values(servedPopulationTrendLookup)
    .map((row) => {
      const populationTotal =
        row.served_population_total + row.unserved_population_total;
      const servedPct =
        row.served_population_pct > 0 || populationTotal === 0
          ? row.served_population_pct
          : (row.served_population_total / populationTotal) * 100;

      return {
        ...row,
        served_population_pct: servedPct,
      };
    })
    .sort(
      (left, right) => left.served_population_pct - right.served_population_pct,
    );
  const accessZoneCoverageLookup = (healthAccessZones.data?.features || [])
    .filter((feature) => feature?.properties?.zone_type !== "facility_point")
    .reduce((accumulator, feature) => {
      const area = feature?.properties?.admin_unit_name || "Unknown";
      const coveragePct = Number(feature?.properties?.coverage_pct || 0);

      if (
        selectedTa &&
        area.trim().toLowerCase() !== selectedTa.trim().toLowerCase()
      ) {
        return accumulator;
      }

      if (!accumulator[area] || coveragePct > accumulator[area].coverage_pct) {
        accumulator[area] = {
          area,
          coverage_pct: coveragePct,
        };
      }

      return accumulator;
    }, {});
  const accessZoneCoverageTrendData = Object.values(accessZoneCoverageLookup)
    .map((row) => {
      const populationCoverage = servedPopulationTrendLookup[row.area] || {};

      return {
        ...row,
        served_population_pct: Number(
          populationCoverage.served_population_pct || 0,
        ),
        served_population_total: Number(
          populationCoverage.served_population_total || 0,
        ),
        unserved_population_total: Number(
          populationCoverage.unserved_population_total || 0,
        ),
      };
    })
    .sort((left, right) => left.coverage_pct - right.coverage_pct);
  const coverageTrendData = accessZoneCoverageTrendData.length
    ? accessZoneCoverageTrendData
    : servedPopulationTrendData.map((row) => ({
        ...row,
        coverage_pct: row.served_population_pct,
      }));
  const filteredCoverageTrendData = useMemo(() => {
    const searchTerm = coverageChartSearch.trim().toLowerCase();
    let rows = [...coverageTrendData];

    if (searchTerm) {
      rows = rows.filter((item) =>
        String(item.area || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (coverageChartSort === "coverage_desc") {
        return Number(right.coverage_pct || 0) - Number(left.coverage_pct || 0);
      }

      if (coverageChartSort === "area_asc") {
        return String(left.area || "").localeCompare(String(right.area || ""));
      }

      return Number(left.coverage_pct || 0) - Number(right.coverage_pct || 0);
    });

    if (coverageChartLimit > 0) {
      return rows.slice(0, coverageChartLimit);
    }

    return rows;
  }, [
    coverageChartLimit,
    coverageChartSearch,
    coverageChartSort,
    coverageTrendData,
  ]);
  const hasPopulationCoverageTrend = filteredCoverageTrendData.some(
    (row) => row.served_population_pct > 0,
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
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <Activity className="h-8 w-8 text-black" />
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">HEALTH</h1>
      </div>

      <div className="mt-6 px-4 sm:mt-8 sm:px-6 lg:px-8">
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
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button
            onClick={handleDownloadReport}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 sm:w-auto sm:justify-start sm:py-1.5"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
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

        <PlanningPriorityPanel
          planningPriorities={planningPriorities}
          scopeLabel={selectedTa || districtScope}
          compact
        />

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
              {selectedTa
                ? `Showing the selected health access layer focused on ${selectedTa}. Click another TA boundary to switch the locked area.`
                : activeTaPreview
                  ? `Previewing health details for ${activeTaPreview}. Click to lock this TA.`
                  : "Hover any TA boundary to preview its details on the active layer, or click to lock it."}
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
                heightClass="h-[420px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                customTooltipMetrics={[
                  { key: "health_population_served_total", label: "Within 8 km" },
                  { key: "health_population_unserved_total", label: "Outside 8 km" },
                  {
                    key: "health_population_served_pct",
                    label: "Within 8 km %",
                    format: "pct",
                    digits: 1,
                  },
                  {
                    key: "health_population_unserved_pct",
                    label: "Outside 8 km %",
                    format: "pct",
                    digits: 1,
                  },
                ]}
                selectedFeatureName={selectedTa}
                hoveredFeatureName={selectedTa ? "" : hoveredTa}
                onFeatureHover={previewTaFromFeature}
                onFeatureClick={selectTaFromFeature}
                onPanelLeave={clearTaFocus}
              />
            </div>
            <p className="mt-3 text-xs font-semibold text-gray-500">
              Showing one layer at a time keeps the map readable. Use the layer
              buttons to compare coverage, road distance, and access score.
            </p>
            <div className="mt-4 border border-gray-100 rounded p-3 bg-white">
              <PopulationRasterPanel
                geojson={healthCoverageTaGeojson.data}
                title={activeHealthRasterLayer.title}
                subtitle={activeHealthRasterLayer.subtitle}
                metadataUrl={getHealthRasterAsset(
                  healthRasterMetadata.data?.assets,
                  "health_network_8km",
                )}
                heightClass="h-[420px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                customTooltipMetrics={[
                  {
                    key: "nearest_health_distance_km",
                    label: "Road Distance (km)",
                    digits: 1,
                  },
                  {
                    key: "health_population_served_total",
                    label: "Within 8 km",
                  },
                ]}
                selectedFeatureName={selectedTa}
                hoveredFeatureName={selectedTa ? "" : hoveredTa}
                onFeatureHover={previewTaFromFeature}
                onFeatureClick={selectTaFromFeature}
                onPanelLeave={clearTaFocus}
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
                heightClass="h-[420px]"
                loading={
                  healthCoverageTaGeojson.loading || healthRasterMetadata.loading
                }
                customTooltipMetrics={[
                  {
                    key: "health_2sfca_access_score",
                    label: "2SFCA Score",
                    digits: 2,
                  },
                  {
                    key: "health_2sfca_catchment_minutes",
                    label: "Catchment (min)",
                    digits: 0,
                  },
                ]}
                selectedFeatureName={selectedTa}
                hoveredFeatureName={selectedTa ? "" : hoveredTa}
                onFeatureHover={previewTaFromFeature}
                onFeatureClick={selectTaFromFeature}
                onPanelLeave={clearTaFocus}
              />
            </div>
          </div>
        </div>

        {/* Integrated Insights Section */}
        <div className="mb-8">
          <h2 className="text-[20px] font-extrabold mb-4 text-[#1a365d]">
            Integrated Planning Insights
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-8">
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-gradient-to-br from-white to-orange-50/30">
              <div className="mb-4">
                <h3 className="text-[18px] font-bold mb-3 text-[#78350f]">Health + Welfare Priority Map</h3>
                <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                  This index identifies <strong>"Double-Vulnerable"</strong> zones by overlapping healthcare staff gaps with poverty density.
                </p>
                <ul className="space-y-2 text-xs text-gray-500 mb-4">
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
              <div className="bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
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
                  hoveredFeatureName={selectedTa ? "" : hoveredTa}
                  onFeatureHover={previewTaFromFeature}
                  onFeatureClick={selectTaFromFeature}
                />
              </div>
            </div>

            <div className="border border-gray-100 rounded p-4 shadow-sm bg-gradient-to-br from-white to-blue-50/30">
              <div className="mb-4">
                <h3 className="text-[18px] font-bold mb-3 text-[#1e3a8a]">Flood Isolation Simulation</h3>
                <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                  This simulation identifies communities that lose access to clinics when local roads become impassable due to flooding.
                </p>
                <ul className="space-y-2 text-xs text-gray-500 mb-4">
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
              <div className="bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
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
                  hoveredFeatureName={selectedTa ? "" : hoveredTa}
                  onFeatureHover={previewTaFromFeature}
                  onFeatureClick={selectTaFromFeature}
                />
              </div>
            </div>

            <div className="border border-gray-100 rounded p-4 shadow-sm bg-gradient-to-br from-white to-green-50/30">
              <div className="mb-4">
                <h3 className="text-[18px] font-bold mb-3 text-[#14532d]">School-Health Synergy</h3>
                <p className="text-gray-600 text-sm mb-4 leading-relaxed">
                  This map shows the <strong>Average Distance</strong> students must travel from their school to reach the nearest health facility.
                </p>
                <ul className="space-y-2 text-xs text-gray-500 mb-4">
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
              <div className="bg-white rounded-lg p-2 border border-gray-100 shadow-inner">
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
                  hoveredFeatureName={selectedTa ? "" : hoveredTa}
                  onFeatureHover={previewTaFromFeature}
                  onFeatureClick={selectTaFromFeature}
                />
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
              {selectedTa
                ? `Showing the selected TA coverage for ${selectedTa}.`
                : "Health service coverage by TA. Click a bar to focus the page on that TA."}
            </p>
            <div className="mb-4 rounded border border-gray-100 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                {HEALTH_CHART_LIMITS.map((option) => {
                  const isActive = option.value === coverageChartLimit;
                  return (
                    <button
                      key={`health-coverage-limit-${option.label}`}
                      type="button"
                      onClick={() => setCoverageChartLimit(option.value)}
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
                  value={coverageChartSort}
                  onChange={(event) => setCoverageChartSort(event.target.value)}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
                >
                  <option value="coverage_asc">Lowest coverage</option>
                  <option value="coverage_desc">Highest coverage</option>
                  <option value="area_asc">Name A-Z</option>
                </select>
                <input
                  type="search"
                  value={coverageChartSearch}
                  onChange={(event) => setCoverageChartSearch(event.target.value)}
                  placeholder="Search TA..."
                  className="min-w-[180px] flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900"
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-gray-500">
                Showing {filteredCoverageTrendData.length} of{" "}
                {coverageTrendData.length} TAs.
              </p>
            </div>
            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50 p-4">
              {servedPopulationTrend.loading || healthAccessZones.loading ? (
                <div className="h-full w-full animate-pulse rounded bg-white" />
              ) : filteredCoverageTrendData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                  No TA-level health coverage rows match the current filters.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={filteredCoverageTrendData}
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
                        if (name === "Service coverage") {
                          return [`${Number(value).toFixed(1)}%`, name];
                        }

                        if (name === "Population served") {
                          return [`${Number(value).toFixed(1)}%`, name];
                        }

                        return [
                          Number(value).toLocaleString(),
                          name,
                          item,
                        ];
                      }}
                      labelFormatter={(label) => label}
                      cursor={{ fill: "#eff6ff" }}
                      contentStyle={{
                        borderRadius: "4px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                        fontSize: "12px",
                      }}
                    />
                    <Bar
                      dataKey="coverage_pct"
                      name="Service coverage"
                      radius={[2, 2, 0, 0]}
                      barSize={16}
                      onClick={(entry) => selectTa(entry?.area || "")}
                    >
                      {filteredCoverageTrendData.map((entry) => {
                        const isSelected =
                          selectedTa &&
                          entry.area.toLowerCase() ===
                            selectedTa.toLowerCase();

                        return (
                          <Cell
                            key={`health-coverage-bar-${entry.area}`}
                            cursor="pointer"
                            fill={
                              isSelected
                                ? "#7e22ce"
                                : getCoverageBarColor(entry.coverage_pct)
                            }
                            stroke={isSelected ? "#111827" : "transparent"}
                            strokeWidth={isSelected ? 2 : 0}
                            fillOpacity={selectedTa && !isSelected ? 0.32 : 1}
                          />
                        );
                      })}
                    </Bar>
                    {hasPopulationCoverageTrend ? (
                      <Line
                        type="monotone"
                        dataKey="served_population_pct"
                        name="Population served"
                        stroke="#dc2626"
                        strokeWidth={2}
                        dot={{ r: 3, fill: "#dc2626" }}
                        activeDot={{ r: 5 }}
                      />
                    ) : null}
                  </ComposedChart>
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
                <div className="space-y-3">
                  <div className="rounded border border-gray-100 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {HEALTH_CHART_LIMITS.map((option) => {
                        const isActive = option.value === facilityChartLimit;
                        return (
                          <button
                            key={`health-facility-limit-${option.label}`}
                            type="button"
                            onClick={() => setFacilityChartLimit(option.value)}
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
                        value={facilityChartSort}
                        onChange={(event) => setFacilityChartSort(event.target.value)}
                        className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
                      >
                        <option value="facilities_desc">Highest first</option>
                        <option value="facilities_asc">Lowest first</option>
                        <option value="district_asc">Name A-Z</option>
                      </select>
                      <input
                        type="search"
                        value={facilityChartSearch}
                        onChange={(event) => setFacilityChartSearch(event.target.value)}
                        placeholder="Search district..."
                        className="min-w-[170px] flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900"
                      />
                    </div>
                    <p className="mt-2 text-[11px] font-semibold text-gray-500">
                      Showing {filteredFacilityChartData.length} of{" "}
                      {facilityChartData.length} districts.
                    </p>
                  </div>
                <div className="h-[300px]">
                  {districtHealthSummary.loading ? (
                    <div className="h-full w-full animate-pulse rounded bg-gray-50" />
                  ) : filteredFacilityChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-400">
                      No facility rows match the current filters.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={filteredFacilityChartData}
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
                          {filteredFacilityChartData.map((entry) => (
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
          <div className="mb-8 pt-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-100 bg-blue-50/70">
                <Building2 className="text-[#1e3a8a]" size={20} />
              </span>
              <h2 className="text-[22px] font-black tracking-tight text-[#1e3a8a]">
                Deep-Dive Analytics
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:items-start">
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
                <TAAnalyticsTable
                  data={taAnalytics.data || []}
                  loading={taAnalytics.loading}
                  selectedTa={selectedTa}
                  onSelectTa={selectTa}
                  maxBodyHeightClass="max-h-[460px]"
                />
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
          planningPriorities={planningPriorities}
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
  planningPriorities,
}) {
  const [metricPreview, setMetricPreview] = useState(null);
  const loading = healthSummary.loading || servedPopulationSummary.loading || healthDrilldown.loading || planningPriorities.loading;
  const rankedPriorities = planningPriorities?.data?.priorities || [];

  const drillSummary  = healthDrilldown.data?.summary || {};
  const taBreakdown   = healthDrilldown.data?.ta_breakdown || [];
  const facilities    = healthLocations.data?.features || [];

  const facilityPreviewRows = useMemo(() => {
    return facilities.map((feature, index) => {
      const properties = feature?.properties || {};
      return {
        id:
          feature?.id ||
          properties?.facility_id ||
          properties?.id ||
          `facility-${index}`,
        name:
          properties?.name ||
          properties?.name_en ||
          properties?.facility_name ||
          "Unnamed Facility",
        ownership: properties?.ownership || "Unknown",
        district:
          properties?.district_name ||
          properties?.district ||
          "Unknown District",
        ta:
          properties?.admin_unit_name ||
          properties?.ta_name ||
          properties?.ta ||
          "Unknown TA",
        type: properties?.type || "Facility",
        status: properties?.status || "Unknown",
        doctorCount: Number(properties?.doctor_count || 0),
        nurseCount: Number(properties?.nurse_midwife_count || 0),
        bedsCount: Number(properties?.beds_count || properties?.bed_capacity || 0),
        enrollment: Number(properties?.student_enrollment_total || 0),
        travelMinutes: Number(properties?.avg_travel_time_min || 0),
        floodExposed: Boolean(properties?.flood_is_exposed),
      };
    });
  }, [facilities]);

  const taHealthResourceLookup = useMemo(() => {
    return facilityPreviewRows.reduce((lookup, row) => {
      const key = String(row.ta || "").toLowerCase();

      if (!key || key === "unknown ta") {
        return lookup;
      }

      if (!lookup.has(key)) {
        lookup.set(key, {
          doctorCount: 0,
          nurseCount: 0,
          bedsCount: 0,
        });
      }

      const current = lookup.get(key);
      current.doctorCount += row.doctorCount;
      current.nurseCount += row.nurseCount;
      current.bedsCount += row.bedsCount;

      return lookup;
    }, new Map());
  }, [facilityPreviewRows]);

  const privateFacilityPreviewRows = useMemo(() => {
    return facilityPreviewRows.filter(
      (row) => String(row.ownership).toLowerCase() !== "government",
    );
  }, [facilityPreviewRows]);

  const nonFunctionalFacilityRows = useMemo(() => {
    return facilityPreviewRows.filter((row) =>
      ["non-functional", "closed", "closed (temporary)"].includes(
        String(row.status).toLowerCase(),
      ),
    );
  }, [facilityPreviewRows]);

  const floodExposedFacilityRows = useMemo(() => {
    return facilityPreviewRows.filter((row) => row.floodExposed);
  }, [facilityPreviewRows]);

  const highTravelFacilityRows = useMemo(() => {
    return facilityPreviewRows
      .filter((row) => Number.isFinite(row.travelMinutes) && row.travelMinutes > 30)
      .sort((left, right) => right.travelMinutes - left.travelMinutes);
  }, [facilityPreviewRows]);

  const doctorStaffedFacilityRows = useMemo(() => {
    return facilityPreviewRows
      .filter((row) => row.doctorCount > 0)
      .sort((left, right) => right.doctorCount - left.doctorCount);
  }, [facilityPreviewRows]);

  const taAccessPressureRows = useMemo(() => {
    return taBreakdown
      .map((row) => ({
        id: `ta-${row.ta_id || row.ta_name}`,
        ta: row.ta_name,
        district: row.district_name,
        coveragePct: Number(row.health_population_served_pct || 0),
        populationPerFacility: Number(row.population_per_facility || 0),
        facilityCount: Number(row.facility_count || 0),
      }))
      .sort((left, right) => left.coveragePct - right.coveragePct);
  }, [taBreakdown]);

  // Underserved TAs ranked by population pressure (highest first)
  const allUnderservedTAs = useMemo(() => {
    return [...taBreakdown]
      .filter((row) => Number(row.population_per_facility || 0) > 2000)
      .sort(
        (left, right) =>
          Number(right.population_per_facility || 0) -
          Number(left.population_per_facility || 0),
      );
  }, [taBreakdown]);
  const topPriorityUnderservedTAs = allUnderservedTAs.slice(0, 3);

  const underservedTaRows = useMemo(() => {
    return allUnderservedTAs.map((row) => {
      const resources =
        taHealthResourceLookup.get(String(row.ta_name || "").toLowerCase()) ||
        {};

      return {
        id: `underserved-${row.ta_id || row.ta_name}`,
        ta: row.ta_name,
        district: row.district_name,
        populationPerFacility: Number(row.population_per_facility || 0),
        populationTotal: Number(row.population_total || 0),
        healthFacilities: Number(row.facility_count || 0),
        doctors: Number(resources.doctorCount || 0),
        nursesMidwives: Number(resources.nurseCount || 0),
        beds: Number(resources.bedsCount || 0),
      };
    });
  }, [allUnderservedTAs, taHealthResourceLookup]);

  // Derive key metrics
  const popPerFacility = Number(drillSummary.population_per_facility || 0);
  const totalPop = Number(drillSummary.population_total || 0);

  const worstTA = allUnderservedTAs[0];

  // Workforce
  const doctors = facilities.reduce(
    (sum, feature) => sum + Number(feature.properties?.doctor_count || 0),
    0,
  );
  const nurses = facilities.reduce(
    (sum, feature) => sum + Number(feature.properties?.nurse_midwife_count || 0),
    0,
  );
  const doctorRatio =
    totalPop > 0 && doctors > 0 ? Math.round(totalPop / doctors) : null;
  const nurseRatio =
    totalPop > 0 && nurses > 0 ? Math.round(totalPop / nurses) : null;

  // Flood-exposed facilities
  const floodExposed = facilities.filter(
    (feature) => feature.properties?.flood_is_exposed,
  ).length;

  // Welfare beneficiaries with health access
  const welfareWithAccess = Number(
    healthIntegration.data?.summary?.health_access_count || 0,
  );

  // Avg travel time
  const travelTimes = facilities
    .map((feature) => Number(feature.properties?.avg_travel_time_min || 0))
    .filter((value) => value > 0);
  const medianTravel = travelTimes.length
    ? travelTimes.sort((left, right) => left - right)[
        Math.floor(travelTimes.length / 2)
      ]
    : null;

  const summaryRows = useMemo(() => {
    return [
      { metric: "No access population", value: formatNumber(noAccessTotal, 0) },
      { metric: "Access coverage", value: `${formatNumber(accessShare, 1)}%` },
      { metric: "Facilities", value: formatNumber(totalFacilities, 0) },
      { metric: "Population per facility", value: formatNumber(popPerFacility, 0) },
      { metric: "Doctors", value: formatNumber(doctors, 0) },
      { metric: "Doctor ratio", value: doctorRatio ? `1:${formatNumber(doctorRatio, 0)}` : "N/A" },
      { metric: "Nurses", value: formatNumber(nurses, 0) },
      { metric: "Nurse ratio", value: nurseRatio ? `1:${formatNumber(nurseRatio, 0)}` : "N/A" },
      {
        metric: "Median travel time",
        value: medianTravel !== null ? `${formatNumber(medianTravel, 0)} min` : "N/A",
      },
      {
        metric: "Welfare beneficiaries with health access",
        value: formatNumber(welfareWithAccess, 0),
      },
    ];
  }, [
    accessShare,
    doctorRatio,
    doctors,
    medianTravel,
    noAccessTotal,
    nurseRatio,
    nurses,
    popPerFacility,
    totalFacilities,
    welfareWithAccess,
  ]);

  const facilityColumns = [
    { key: "name", label: "Facility" },
    { key: "ownership", label: "Ownership" },
    { key: "district", label: "District" },
    { key: "ta", label: "TA" },
    { key: "status", label: "Status" },
  ];
  const taColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "populationPerFacility", label: "Pop/Facility" },
    { key: "coveragePct", label: "Coverage %" },
    { key: "facilityCount", label: "Facilities" },
  ];
  const underservedTaColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "populationPerFacility", label: "Pop/Facility" },
    { key: "populationTotal", label: "Population" },
    { key: "healthFacilities", label: "Health Facilities" },
    { key: "doctors", label: "Doctors" },
    { key: "nursesMidwives", label: "Nurses/Midwives" },
    { key: "beds", label: "Beds" },
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
    high:   { label: "Immediate Action",  classes: "bg-red-50 border-red-200 text-red-700",       dot: "bg-red-500"    },
    medium: { label: "Short-Term Action", classes: "bg-amber-50 border-amber-200 text-amber-700",  dot: "bg-amber-500"  },
    low:    { label: "Planning Note",     classes: "bg-blue-50 border-blue-200 text-blue-700",     dot: "bg-blue-500"   },
  };

  const priorityLedRecommendations = rankedPriorities.slice(0, 2).map((row, index) => ({
    priority: index === 0 ? "high" : row.priority_band === "Critical" || row.priority_band === "High" ? "high" : "medium",
    icon: row.health_vulnerability_score >= row.education_vulnerability_score ? HeartPulse : AlertTriangle,
    title: `${row.admin_unit_name} should anchor the next health access response`,
    body: `${row.narrative} Health vulnerability is scored at ${formatNumber(row.health_vulnerability_score, 1)} and flood isolation at ${formatNumber(row.health_flood_isolation_score, 1)}, which signals a need for targeted facility access and continuity planning.`,
    action: row.recommended_actions?.find((action) => /clinic|health|referral|outreach/i.test(action)) || row.recommended_actions?.[0] || "Use the top-ranked TA to guide the next health deployment cycle",
  }));

  const recommendations = [
    ...priorityLedRecommendations,
    // 1 — Access gap
    noAccessTotal > 0 && {
      priority: "high",
      icon: AlertTriangle,
      title: "Critical Health Access Gap",
      body: `${formatNumber(noAccessTotal, 0)} people in ${districtScope} lack access to a health facility within 8 km — ${formatNumber(100 - accessShare, 1)}% of the population. The access coverage map shows the largest unserved pockets in rural TAs. Expanding facility placement or mobile health outreach in these zones is the highest-priority intervention.`,
      action: "Identify top 3 unserved population clusters from the coverage map and plan satellite clinic placement",
      metricLinks: [
        {
          id: "no-access-population",
          label: "No Access Population",
          value: formatNumber(noAccessTotal, 0),
          onClick: () =>
            openMetricPreview({
              title: "Health Access Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "lowest-coverage-tas",
          label: "Lowest-Coverage TAs",
          value: formatNumber(taAccessPressureRows.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "TA Coverage Pressure",
              rows: taAccessPressureRows,
              columns: taColumns,
            }),
        },
      ],
    },
    // 2 — Underserved TAs
    allUnderservedTAs.length > 0 && {
      priority: "high",
      icon: Building,
      title: "Facility Shortage in High-Population TAs",
      body: `${allUnderservedTAs.length} TA${allUnderservedTAs.length > 1 ? "s" : ""} exceed 2,000 people per facility — well above the recommended threshold.${worstTA ? ` ${worstTA.ta_name} is the most underserved with ${formatNumber(worstTA.population_per_facility, 0)} people per facility serving a population of ${formatNumber(worstTA.population_total, 0)}.` : ""}${topPriorityUnderservedTAs.length ? ` Highest-priority TAs are ${topPriorityUnderservedTAs.map((row) => row.ta_name).join(", ")}.` : ""} New facility construction or upgrading existing health posts to full clinics is needed.`,
      action: topPriorityUnderservedTAs.length
        ? `Prioritise new health facility construction in ${topPriorityUnderservedTAs.map((row) => row.ta_name).join(", ")} first, then phase the remaining underserved TAs.`
        : "Prioritise new health facility construction in underserved TAs.",
      metricLinks: [
        {
          id: "underserved-tas",
          label: "Underserved TAs",
          value: formatNumber(allUnderservedTAs.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "Underserved TAs (Ranked)",
              rows: underservedTaRows,
              columns: underservedTaColumns,
            }),
        },
        {
          id: "worst-ta-ratio",
          label: "Worst TA Ratio",
          value: worstTA
            ? formatNumber(worstTA.population_per_facility, 0)
            : "N/A",
          onClick: () =>
            openMetricPreview({
              title: "Underserved TAs (Ranked)",
              rows: underservedTaRows,
              columns: underservedTaColumns,
            }),
        },
      ],
    },
    // 3 — Non-functional facilities
    nonFunctionalFacilities > 0 && {
      priority: "high",
      icon: AlertCircle,
      title: "Non-Functional Facilities Reducing Effective Capacity",
      body: `${formatNumber(nonFunctionalFacilities)} of ${formatNumber(totalFacilities)} facilities are non-functional or closed. These represent lost capacity that could serve existing populations without new construction. Rehabilitation of closed facilities is faster and cheaper than building new ones.`,
      action: "Audit all non-functional facilities and prioritise rehabilitation of those in high-need TAs",
      metricLinks: [
        {
          id: "non-functional-facilities",
          label: "Non-Functional",
          value: formatNumber(nonFunctionalFacilities, 0),
          onClick: () =>
            openMetricPreview({
              title: "Non-Functional Facilities",
              rows: nonFunctionalFacilityRows,
              columns: facilityColumns,
            }),
        },
        {
          id: "all-facilities",
          label: "All Facilities",
          value: formatNumber(totalFacilities, 0),
          onClick: () =>
            openMetricPreview({
              title: "All Health Facilities",
              rows: facilityPreviewRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    // 4 — Workforce
    doctorRatio !== null && doctorRatio > 5000 && {
      priority: "high",
      icon: Users,
      title: "Severe Doctor Shortage",
      body: `The doctor-to-population ratio is 1:${formatNumber(doctorRatio, 0)}, far exceeding the WHO recommended 1:1,000. With only ${formatNumber(doctors, 0)} doctors serving ${formatNumber(totalPop, 0)} people, clinical capacity is severely constrained. Nurse-led care models and community health worker deployment can bridge the gap in the short term.`,
      action: "Deploy community health workers to high-burden TAs and fast-track nurse practitioner training",
      metricLinks: [
        {
          id: "doctor-ratio",
          label: "Doctor Ratio",
          value: `1:${formatNumber(doctorRatio, 0)}`,
          onClick: () =>
            openMetricPreview({
              title: "Workforce Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "doctor-staffed-facilities",
          label: "Doctor-Staffed Facilities",
          value: formatNumber(doctorStaffedFacilityRows.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "Facilities with Doctors",
              rows: doctorStaffedFacilityRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    // 5 — Private sector balance
    privateFacilities > govFacilities && {
      priority: "medium",
      icon: Building2,
      title: "Private Sector Dominance — Equity Risk",
      body: `${formatNumber(privateFacilities)} of ${formatNumber(totalFacilities)} facilities are privately operated, outnumbering government facilities. While private facilities expand coverage, they concentrate in urban and peri-urban areas, leaving rural populations dependent on fewer government facilities. Public-private partnership agreements should include rural service obligations.`,
      action: "Negotiate PPP agreements requiring private facilities to serve a defined rural catchment population",
      metricLinks: [
        {
          id: "private-facilities",
          label: "Private Facilities",
          value: formatNumber(privateFacilities, 0),
          onClick: () =>
            openMetricPreview({
              title: `Private Facilities (${formatNumber(privateFacilityPreviewRows.length, 0)})`,
              rows: privateFacilityPreviewRows,
              columns: facilityColumns,
            }),
        },
        {
          id: "total-facilities",
          label: "Total Facilities",
          value: formatNumber(totalFacilities, 0),
          onClick: () =>
            openMetricPreview({
              title: "All Health Facilities",
              rows: facilityPreviewRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    // 6 — Flood risk
    floodExposed > 0 && {
      priority: "medium",
      icon: AlertTriangle,
      title: "Flood-Exposed Health Facilities",
      body: `${formatNumber(floodExposed)} health facilities are in flood-exposed zones. During flood events these facilities may become inaccessible or damaged, cutting off health services precisely when demand spikes. Emergency referral pathways and pre-positioned medical supplies at unaffected facilities are essential.`,
      action: "Establish flood-season health service continuity plans and pre-position emergency medical supplies",
      metricLinks: [
        {
          id: "flood-exposed-facilities",
          label: "Exposed Facilities",
          value: formatNumber(floodExposed, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood-Exposed Health Facilities",
              rows: floodExposedFacilityRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    // 7 — Travel time
    medianTravel !== null && medianTravel > 30 && {
      priority: "medium",
      icon: TrendingUp,
      title: "Long Travel Times to Facilities",
      body: `The median road travel time to the nearest health facility is ${medianTravel.toFixed(0)} minutes. For emergency obstetric care, stroke, and trauma, this delay is life-threatening. Ambulance pre-positioning and community first-responder training in high-travel-time areas can reduce preventable deaths.`,
      action: "Pre-position ambulances in TAs with median travel times above 30 minutes",
      metricLinks: [
        {
          id: "median-travel-time",
          label: "Median Travel Time",
          value: `${formatNumber(medianTravel, 0)} min`,
          onClick: () =>
            openMetricPreview({
              title: "Travel Time Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "high-travel-facilities",
          label: "Facilities >30 min",
          value: formatNumber(highTravelFacilityRows.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "High Travel-Time Facilities",
              rows: highTravelFacilityRows,
              columns: facilityColumns,
            }),
        },
      ],
    },
    // 8 — Welfare link
    welfareWithAccess > 0 && {
      priority: "low",
      icon: Lightbulb,
      title: "Link Health Access to Social Protection",
      body: `${formatNumber(welfareWithAccess, 0)} welfare beneficiaries have a health facility within 8 km. Integrating health service utilisation data with welfare programme monitoring would allow identification of beneficiaries who are geographically close to facilities but not accessing care — enabling targeted outreach.`,
      action: "Cross-reference welfare beneficiary data with health facility utilisation records to identify non-users",
      metricLinks: [
        {
          id: "welfare-with-access",
          label: "Beneficiaries with Access",
          value: formatNumber(welfareWithAccess, 0),
          onClick: () =>
            openMetricPreview({
              title: "Welfare and Health Access Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
      ],
    },
    // 9 — Interpretation note
    {
      priority: "low",
      icon: Lightbulb,
      title: "Map Interpretation: Coverage vs Utilisation",
      body: `The 8 km buffer coverage maps show geographic proximity to facilities, not actual utilisation. A facility within 8 km may still be inaccessible due to road conditions, cost, or cultural barriers. The road-distance and travel-time rasters provide a more accurate picture of real-world access than straight-line buffers alone.`,
      action: "Supplement coverage analysis with patient visit data and community health surveys to capture utilisation gaps",
      metricLinks: [
        {
          id: "coverage-summary",
          label: "Coverage Summary",
          value: `${formatNumber(accessShare, 1)}%`,
          onClick: () =>
            openMetricPreview({
              title: "Coverage vs Utilisation Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
      ],
    },
  ].filter(Boolean).slice(0, 9);

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
      <InteractiveRecommendations
        recommendations={recommendations}
        priorityConfig={priorityConfig}
        sectionKey={`health:${districtScope}`}
      />

      <MetricPreviewModal
        metricPreview={metricPreview}
        onClose={() => setMetricPreview(null)}
        description="Previewing records referenced by this recommendation."
      />
    </div>
  );
}

export default HealthPage;
