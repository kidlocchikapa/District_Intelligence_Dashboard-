import { useMemo, useState } from "react";
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
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import {
  createSvgProjector,
  geometryToSvgPath,
  getFeatureLabelPosition,
  getGeoBounds,
} from "../lib/geo";
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
const COMPARISON_COLORS = ["#c2410c", "#2563eb", "#7c3aed", "#0f766e"];
const OVERVIEW_CHART_SKELETON_HEIGHTS = [24, 36, 41, 58, 49, 65, 33, 45];
const OVERVIEW_POPULATION_CHART_LIMITS = [
  { value: 8, label: "Top 8" },
  { value: 12, label: "Top 12" },
  { value: 0, label: "All" },
];

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

function DistrictBoundaryMap({
  geojson,
  loading,
  selectedFeatureName,
  onFeatureClick,
  scopeLabel,
}) {
  const [hoveredFeature, setHoveredFeature] = useState(null);
  const [showTaNames, setShowTaNames] = useState(true);
  const features = useMemo(() => geojson?.features || [], [geojson]);
  const width = 1000;
  const height = 620;
  const bounds = useMemo(() => getGeoBounds(features), [features]);
  const project = useMemo(
    () => createSvgProjector(bounds, width, height, 36),
    [bounds],
  );
  const hoveredName =
    hoveredFeature?.properties?.admin_unit_name ||
    hoveredFeature?.properties?.name ||
    "";

  if (loading) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded border border-gray-100 bg-gray-50 text-[12px] font-bold uppercase tracking-[0.16em] text-gray-400 sm:h-[520px]">
        Loading district map...
      </div>
    );
  }

  if (!features.length) {
    return (
      <div className="flex h-[360px] items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-400 sm:h-[520px]">
        No TA boundaries available for this district.
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
      <div
        className="relative h-[360px] overflow-hidden rounded border border-gray-100 bg-[#f8faf7] sm:h-[520px]"
        onMouseLeave={() => setHoveredFeature(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`TA boundary map for ${scopeLabel}`}
          className="h-full w-full"
        >
          <rect width={width} height={height} fill="#f8faf7" />
          {features.map((feature, index) => {
            const properties = feature?.properties || {};
            const name = properties.admin_unit_name || properties.name || "";
            const path = geometryToSvgPath(feature.geometry, project);
            const labelPosition = getFeatureLabelPosition(feature, project);
            const isSelected =
              selectedFeatureName &&
              name &&
              normalizeName(name) === normalizeName(selectedFeatureName);
            const isHovered =
              hoveredName &&
              name &&
              normalizeName(name) === normalizeName(hoveredName);
            const fillColor = isSelected
              ? "#111827"
              : isHovered
                ? "#dbeafe"
                : index % 2 === 0
                  ? "#eef7ee"
                  : "#f7fbf4";

            if (!path) {
              return null;
            }

            return (
              <g key={feature.id || name}>
                <path
                  d={path}
                  fill={fillColor}
                  stroke={isSelected ? "#111827" : "#64745f"}
                  strokeWidth={isSelected ? 3.2 : isHovered ? 2.4 : 1.4}
                  opacity={isSelected ? 0.94 : 0.9}
                  className="cursor-pointer transition"
                  onMouseEnter={() => setHoveredFeature(feature)}
                  onFocus={() => setHoveredFeature(feature)}
                  onClick={() => onFeatureClick?.(feature)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Select ${name}`}
                />
                {showTaNames && labelPosition ? (
                  <text
                    x={labelPosition.x}
                    y={labelPosition.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isSelected ? "#ffffff" : "#111827"}
                    stroke={isSelected ? "#1f2937" : "none"}
                    strokeWidth={isSelected ? 1.8 : 0}
                    paintOrder={isSelected ? "stroke" : undefined}
                    className="pointer-events-none select-none text-[13px] font-extrabold"
                  >
                    {name.replace(/^Ta\s+/i, "TA ")}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {hoveredName || selectedFeatureName ? (
          <div className="absolute left-4 top-4 max-w-[260px] rounded border border-white/80 bg-white/95 px-4 py-3 shadow-md backdrop-blur">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
              {hoveredName ? "Hovering" : "Selected TA"}
            </p>
            <p className="mt-1 text-[15px] font-extrabold text-gray-900">
              {hoveredName || selectedFeatureName}
            </p>
          </div>
        ) : null}
      </div>

      <aside className="rounded border border-gray-100 bg-white p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
          Map Legend
        </p>
        <h4 className="mt-2 text-[16px] font-extrabold text-gray-900">
          TA Boundaries
        </h4>
        <div className="mt-4 space-y-3 text-[12px] font-semibold text-gray-600">
          <div className="flex items-center gap-3">
            <span className="h-4 w-7 rounded-sm border-2 border-[#64745f] bg-[#eef7ee]" />
            <span>Traditional Authority area</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-4 w-7 rounded-sm border-2 border-[#111827] bg-[#111827]" />
            <span>Selected TA</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-4 w-7 rounded-sm border-2 border-[#64745f] bg-[#dbeafe]" />
            <span>Hovered TA</span>
          </div>
        </div>
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
            Label Visibility
          </p>
          <button
            type="button"
            onClick={() => setShowTaNames((current) => !current)}
            className="mt-2 w-full rounded border border-gray-300 bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-700 transition hover:bg-gray-100"
            aria-pressed={showTaNames}
          >
            {showTaNames ? "Hide TA names" : "Show TA names"}
          </button>
        </div>
        <div className="mt-5 rounded bg-gray-50 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
            Current Scope
          </p>
          <p className="mt-1 text-[14px] font-extrabold text-gray-900">
            {scopeLabel}
          </p>
          <p className="mt-2 text-[12px] font-semibold leading-5 text-gray-500">
            {features.length} TA boundary{features.length === 1 ? "" : "ies"}{" "}
            visible. Click a TA to sync the overview.
          </p>
        </div>
      </aside>
    </div>
  );
}

function OverviewPage() {
  const { selectedDistrict, selectedTa, setSelectedDistrict, setSelectedTa } =
    useDistrict();
  const [populationChartSearch, setPopulationChartSearch] = useState("");
  const [populationChartLimit, setPopulationChartLimit] = useState(12);
  const [populationChartSort, setPopulationChartSort] =
    useState("population_desc");
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
  const educationInsights = useDashboardData(
    buildDashboardPath("/dashboard/education/insights", {
      district: districtScope,
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
  const filteredChartData = useMemo(() => {
    const searchTerm = populationChartSearch.trim().toLowerCase();
    let rows = [...chartData];

    if (searchTerm) {
      rows = rows.filter((row) => {
        const taName = String(row.admin3 || "").toLowerCase();
        const districtName = String(row.district || "").toLowerCase();
        return taName.includes(searchTerm) || districtName.includes(searchTerm);
      });
    }

    rows.sort((left, right) => {
      if (populationChartSort === "population_asc") {
        return Number(left.population || 0) - Number(right.population || 0);
      }

      if (populationChartSort === "name_asc") {
        return String(left.admin3 || "").localeCompare(
          String(right.admin3 || ""),
        );
      }

      if (populationChartSort === "district_asc") {
        const districtCompare = String(left.district || "").localeCompare(
          String(right.district || ""),
        );
        if (districtCompare !== 0) {
          return districtCompare;
        }

        return String(left.admin3 || "").localeCompare(
          String(right.admin3 || ""),
        );
      }

      return Number(right.population || 0) - Number(left.population || 0);
    });

    if (populationChartLimit > 0) {
      rows = rows.slice(0, populationChartLimit);
    }

    return rows;
  }, [
    chartData,
    populationChartLimit,
    populationChartSearch,
    populationChartSort,
  ]);

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

  const priorityRows = useMemo(
    () =>
      planningPriorities.data?.all_priorities ??
      planningPriorities.data?.priorities ??
      [],
    [planningPriorities.data],
  );

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
          district_name:
            priority?.district_name || properties.district_name || "",
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

    const features = (densityMap.data.features || []).map((feature) => {
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
          non_hospital_providers_count: Math.max(
            Number(serviceStats.health_facilities_count || 0) -
              Number(serviceStats.hospitals_count || 0),
            0,
          ),
          beneficiaries_count: Number(serviceStats.beneficiaries_count || 0),
          district_name: serviceStats.district_name || "",
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
  }, [densityMap.data, taFloodLookup, taServiceLookup]);

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
    ...filteredChartData.map((item) => Number(item.population) || 0),
    0,
  );

  const healthRows = Array.isArray(healthSummary.data)
    ? healthSummary.data
    : [];
  const welfareSummary = welfareIntegration.data?.summary || {};
  const educationData = educationSummary.data || {};
  const educationInsightRows = useMemo(
    () => educationInsights.data?.districts ?? [],
    [educationInsights.data],
  );
  const selectedEducationInsight = selectedTa
    ? educationInsightRows.find(
        (row) =>
          normalizeName(row.admin_unit_name) === normalizeName(selectedTa),
      ) || null
    : null;
  const districtEducationSchoolCount = educationInsightRows.reduce(
    (sum, row) => sum + Number(row.school_count || 0),
    0,
  );

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
  const selectedTaServiceStats = selectedTa
    ? taServiceLookup.get(`name:${normalizeName(selectedTa)}`) || null
    : null;
  const overviewSchoolCount = selectedTa
    ? Number(selectedEducationInsight?.school_count || 0)
    : districtEducationSchoolCount || Number(educationData.school_count || 0);
  const overviewHealthProviderCount = selectedTaServiceStats
    ? Number(selectedTaServiceStats.health_facilities_count || 0)
    : (taServiceStats.data || []).reduce(
        (sum, row) => sum + Number(row.health_facilities_count || 0),
        0,
      ) || healthFacilityCount || Number(summary.data?.total_health_facilities || 0);
  const overviewHospitalCount = selectedTaServiceStats
    ? Number(selectedTaServiceStats.hospitals_count || 0)
    : (taServiceStats.data || []).reduce(
        (sum, row) => sum + Number(row.hospitals_count || 0),
        0,
      );
  const healthCoveragePct = metricFromRows(healthRows, [
    "health_service_coverage_pct",
    "service_coverage_pct",
  ]);

  const snapshotCards = [
    {
      title: "Education",
      primary: `${formatStat(overviewSchoolCount)} schools`,
      secondary: `${formatStat(educationData.not_in_school_total || 0)} learners likely out of school`,
      surfaceClass: "border-amber-100 bg-amber-50/45",
      titleClass: "text-amber-700",
      valueClass: "text-amber-800",
      metaClass: "text-amber-700/80",
    },
    {
      title: "Health",
      primary: `${formatStat(overviewHealthProviderCount)} providers`,
      secondary: healthCoveragePct
        ? `${formatPercent(healthCoveragePct)} service coverage`
        : `${formatStat(overviewHospitalCount)} hospitals classified`,
      surfaceClass: "border-sky-100 bg-sky-50/45",
      titleClass: "text-sky-700",
      valueClass: "text-sky-800",
      metaClass: "text-sky-700/80",
    },
    {
      title: "Welfare",
      primary: `${formatStat(welfareSummary.total_beneficiaries || 0)} beneficiaries`,
      secondary: `${formatPercent(welfareSummary.health_access_pct || 0)} health-access linked`,
      surfaceClass: "border-indigo-100 bg-indigo-50/45",
      titleClass: "text-indigo-700",
      valueClass: "text-indigo-800",
      metaClass: "text-indigo-700/80",
    },
    {
      title: "Disaster",
      primary: `${formatStat(exposedPopulation)} exposed residents`,
      secondary: `${formatPercent(floodSummary.data?.exposed_population_pct || 0)} of current scope`,
      surfaceClass: "border-emerald-100 bg-emerald-50/45",
      titleClass: "text-emerald-700",
      valueClass: "text-emerald-800",
      metaClass: "text-emerald-700/80",
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
      value: formatStat(overviewSchoolCount),
      icon: School,
      helper: scopeLabel,
    },
    {
      label: "Health Providers",
      value: formatStat(overviewHealthProviderCount),
      icon: HeartPulse,
      helper: `${scopeLabel} - includes ${formatStat(overviewHospitalCount)} hospitals`,
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

  const selectTa = (taName, districtName = "") => {
    if (districtName && districtName !== selectedDistrict) {
      setSelectedDistrict(districtName);
    }
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
      mapNode: mapRef.current?.querySelector("[data-map-export]"),
    });
  };

  const loadingAnyTopCard =
    summary.loading ||
    welfareIntegration.loading ||
    educationInsights.loading ||
    taServiceStats.loading ||
    floodSummary.loading ||
    planningPriorities.loading;

  return (
    <div className="min-h-screen bg-white text-black font-sans pb-10">
      <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">
            OVERVIEW
          </h1>
          <p className="mt-2 max-w-3xl text-[14px] font-medium leading-6 text-gray-500">
            Cross-department planning view for population, service access,
            welfare pressure, and flood exposure across the current scope.
          </p>
        </div>
      </div>

      <div className="mt-6 px-4 sm:mt-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button
            onClick={handleDownloadReport}
            disabled={(!selectedDistrict && !selectedTa) || summary.loading}
            title={
              selectedDistrict || selectedTa
                ? "Download analysis for selected area"
                : "Select a district or TA first"
            }
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:justify-start sm:py-1.5"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <button
            onClick={downloadImage}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 sm:w-auto sm:justify-start sm:py-1.5"
          >
            <MapIcon className="h-4 w-4" />
            Download Map
          </button>
          <SharedDistrictSelector />
        </div>

        <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:gap-6">
          {loadingAnyTopCard
            ? [...Array(6)].map((_, index) => (
                <div
                  key={index}
                  className="rounded border border-gray-100 bg-white p-4 shadow-md animate-pulse sm:p-6"
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
                  className="group rounded border border-gray-100 bg-white p-4 shadow-md transition-all hover:shadow-lg sm:p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[14px] text-gray-500 font-bold group-hover:text-black transition-colors">
                      {stat.label}
                    </span>
                    <stat.icon className="h-5 w-5 text-gray-300 group-hover:text-black transition-colors" />
                  </div>
                  <div className="mt-4 break-words text-[26px] font-extrabold tracking-tight sm:text-[32px]">
                    {stat.value}
                  </div>
                  <p className="mt-2 text-[12px] font-semibold text-gray-400">
                    {stat.helper}
                  </p>
                </div>
              ))}
        </div>

        <div className="mb-10">
          <IntegrationSummaryPanel
            title="Integrated Overview Context"
            subtitle="Cross-department context combining population, services, welfare pressure, and flood-priority signals for the selected scope."
            loading={
              summary.loading ||
              welfareIntegration.loading ||
              floodSummary.loading ||
              educationSummary.loading ||
              healthSummary.loading ||
              planningPriorities.loading
            }
            items={[
              {
                label: "Population & Education",
                metrics: {
                  total_population:
                    selectedTaChartRow?.population ||
                    summary.data?.total_estimated_population ||
                    0,
                  schools: overviewSchoolCount,
                  not_in_school: educationData.not_in_school_total || 0,
                },
              },
              {
                label: "Health & Welfare",
                metrics: {
                  health_providers: overviewHealthProviderCount,
                  hospitals: overviewHospitalCount,
                  welfare_beneficiaries:
                    welfareSummary.total_beneficiaries || 0,
                  health_access_pct: welfareSummary.health_access_pct || 0,
                },
              },
              {
                label: "Flood & Priority",
                metrics: {
                  flood_exposed_population: exposedPopulation,
                  flood_exposed_pct:
                    floodSummary.data?.exposed_population_pct || 0,
                  highest_priority_score:
                    selectedPriorityRow?.planning_priority_score ||
                    planningPriorities.data?.summary?.highest_priority_score ||
                    0,
                },
              },
            ]}
          />
        </div>

        <div className="mb-10">
          <div className="flex min-w-0 flex-col rounded border border-gray-100 bg-white p-4 shadow-sm sm:min-h-[560px] sm:p-6 lg:min-h-[640px] lg:p-8">
            <div className="mb-6">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">
                <MapIcon className="h-4 w-4" />
                District Geography
              </div>
              <h3 className="mt-2 text-[20px] font-extrabold tracking-tight text-black">
                District Map For {selectedDistrict || "All Districts"}
              </h3>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                TA areas and their respective boundaries. Click a TA to sync the
                rest of the overview.
              </p>
            </div>
            <DistrictBoundaryMap
              geojson={priorityMapGeojson}
              loading={densityMap.loading}
              selectedFeatureName={selectedTa}
              scopeLabel={selectedDistrict || "All Districts"}
              onFeatureClick={(feature) =>
                selectTa(
                  feature?.properties?.admin_unit_name ||
                    feature?.properties?.name ||
                    "",
                  feature?.properties?.district_name || "",
                )
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr] xl:gap-8 mb-10">
          <section className="min-w-0 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
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
            <div className="h-[260px] sm:h-[320px]">
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

          <section className="min-w-0 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <div className="mb-6">
              <h3 className="text-[18px] font-extrabold text-black">
                Department Snapshots
              </h3>
              <p className="mt-1 text-[13px] font-medium text-gray-500">
                Compact cross-sector signals for{" "}
                <span className="font-bold text-gray-700">{scopeLabel}</span>.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {snapshotCards.map((card) => (
                <article
                  key={card.title}
                  className={`rounded-2xl border px-4 py-5 ${card.surfaceClass}`}
                >
                  <div
                    className={`text-[11px] font-bold uppercase tracking-[0.18em] ${card.titleClass}`}
                  >
                    {card.title}
                  </div>
                  <div
                    className={`mt-3 text-[24px] font-extrabold tracking-tight ${card.valueClass}`}
                  >
                    {card.primary}
                  </div>
                  <p
                    className={`mt-2 text-[13px] font-semibold leading-6 ${card.metaClass}`}
                  >
                    {card.secondary}
                  </p>
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-8 mb-10">
          <div className="flex min-w-0 flex-col rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <h3 className="text-[16px] font-extrabold mb-2">
              {selectedTa
                ? `${selectedTa} Population Context Map`
                : "Population per Grid Cell"}
            </h3>
            <p className="text-[13px] font-medium text-gray-500 mb-6">
              Existing population raster view with flood and service tooltips.
            </p>
            <div
              ref={mapRef}
              className="relative h-[380px] w-full rounded border border-gray-50 bg-gray-50 shadow-inner sm:h-[520px] lg:h-[640px]"
            >
              <PopulationRasterPanel
                geojson={populationMapGeojson}
                title={null}
                subtitle={null}
                exportTitle="Population Context Map"
                exportSubtitle="Population raster with TA boundaries, service indicators, and flood exposure context."
                heightClass="h-full w-full"
                loading={densityMap.loading}
                metadataUrl="/worldpop/zomba_ppp_2020.preview.json"
                legendPositionClass="right-2 top-2 sm:right-4 sm:top-auto sm:bottom-4"
                selectedFeatureName={selectedTa}
                customTooltipMetrics={[
                  { key: "schools_count", label: "Schools" },
                  {
                    key: "health_facilities_count",
                    label: "Health Providers",
                  },
                  { key: "hospitals_count", label: "Hospitals" },
                  { key: "non_hospital_providers_count", label: "Non-Hospital Providers" },
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
                  selectTa(
                    feature?.properties?.admin_unit_name ||
                      feature?.properties?.name ||
                      "",
                    feature?.properties?.district_name || "",
                  )
                }
              />
            </div>
          </div>

          <div className="min-w-0 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8 flex flex-col min-h-[440px] sm:min-h-[640px]">
            <h3 className="text-[16px] font-extrabold mb-2">
              {selectedTa ? `Population for ${selectedTa}` : "Population by TA"}
            </h3>
            <p className="text-[13px] font-medium text-gray-500 mb-3">
              Click a bar to sync the selected TA across the overview.
            </p>
            <div className="mb-4 rounded border border-gray-100 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                {OVERVIEW_POPULATION_CHART_LIMITS.map((option) => {
                  const isActive = option.value === populationChartLimit;
                  return (
                    <button
                      key={`overview-pop-limit-${option.label}`}
                      type="button"
                      onClick={() => setPopulationChartLimit(option.value)}
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
                  value={populationChartSort}
                  onChange={(event) =>
                    setPopulationChartSort(event.target.value)
                  }
                  className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
                >
                  <option value="population_desc">Highest population</option>
                  <option value="population_asc">Lowest population</option>
                  <option value="name_asc">Name A-Z</option>
                  <option value="district_asc">District A-Z</option>
                </select>
                <input
                  type="search"
                  value={populationChartSearch}
                  onChange={(event) =>
                    setPopulationChartSearch(event.target.value)
                  }
                  placeholder="Search TA or district..."
                  className="w-full flex-1 sm:min-w-[180px] rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900"
                />
                {selectedTa ? (
                  <button
                    type="button"
                    onClick={() => selectTa("")}
                    className="rounded-full border border-gray-300 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600 transition hover:text-black"
                  >
                    Clear TA
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] font-semibold text-gray-500">
                Showing {filteredChartData.length} of {chartData.length} TAs.
              </p>
            </div>
            <div className="min-h-[340px] flex-1 overflow-x-auto">
              {populationDistribution.loading ? (
                <div className="h-full w-full flex flex-col gap-4 animate-pulse">
                  <div className="flex-1 bg-gray-50 rounded-lg relative overflow-hidden">
                    <div className="absolute inset-0 flex items-end justify-around px-4 pb-4">
                      {OVERVIEW_CHART_SKELETON_HEIGHTS.map((height, index) => (
                        <div
                          key={index}
                          className="w-8 bg-gray-200 rounded-t"
                          style={{ height: `${height}%` }}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : filteredChartData.length > 0 ? (
                <div className="h-full min-w-[560px] sm:min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={filteredChartData}
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
                        minPointSize={2}
                        activeBar={<Rectangle fill="#7e22ce" />}
                        onClick={(entry) =>
                          selectTa(entry?.admin3 || "", entry?.district || "")
                        }
                      >
                        {filteredChartData.map((entry) => {
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
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-400">
                  No rows match the current chart filters.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.85fr_1.15fr] xl:gap-8 mb-10">
          <section className="min-w-0 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <h3 className="text-[16px] font-extrabold mb-6">
              Flood Exposure Distribution for {scopeLabel}
            </h3>
            <div className="h-[260px] sm:h-[320px]">
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
                      innerRadius="45%"
                      outerRadius="68%"
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

          <section className="min-w-0 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
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
