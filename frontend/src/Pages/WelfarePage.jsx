import { useMemo, useState, useRef } from "react";
import {
  Activity,
  Download,
  GraduationCap,
  Heart,
  Lightbulb,
  Activity,
  ShieldAlert,
  GraduationCap,
} from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import { buildDashboardPath } from "../lib/query";
import { formatNumber } from "../lib/format";
import DataTable from "../components/DataTable";
import MapPanel from "../components/MapPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import InteractiveRecommendations from "../components/InteractiveRecommendations";

import {
  Bar,
  BarChart,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Rectangle,
  Tooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = ["#4A72E4", "#F4B41A", "#3BB182", "#6974D6", "#D96459"];
const WELFARE_TA_CHART_LIMITS = [
  { value: 8, label: "Top 8" },
  { value: 12, label: "Top 12" },
  { value: 0, label: "All" },
];
const WELFARE_SUMMARY_KEYS = [
  "total_beneficiaries",
  "beneficiary_count",
  "total_households",
  "estimated_household_population",
  "beneficiary_records_under_18",
];
const EMPTY_ROWS = [];
const DEPARTMENT_METRIC_LABELS = {
  total_beneficiaries: "Total Beneficiaries",
  active_programs: "Active Programs",
  estimated_household_population: "Household Reach",
  beneficiaries_with_school_access: "School Access",
  student_enrollment_total: "Student Enrollment",
  school_age_population_total: "School-Age Population",
  school_age_population_unenrolled: "School-Age Not Enrolled",
  beneficiaries_with_health_access: "Health Access",
  public_facility_access_count: "Public Facility Access",
  private_facility_access_count: "Private Facility Access",
  public_hospital_access_count: "Public Hospital Access",
  private_hospital_access_count: "Private Hospital Access",
  flood_affected_count: "Flood Affected",
  flood_affected_pct: "Flood Affected %",
};

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatTaAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 14)}...`;
}

function simplifyWelfareSignal(signal) {
  const title = String(signal?.title || "");

  if (/flood-sensitive welfare footprint/i.test(title)) {
    return {
      ...signal,
      title: "Many Welfare Households May Face Flood Risk",
      description:
        "A large share of supported households are in flood-prone places. Cash support, shelter plans, and service follow-up should be ready before flood season.",
      action:
        "Prepare flood-season support plans for the most exposed welfare households.",
    };
  }

  if (/health access gap/i.test(title)) {
    return {
      ...signal,
      title: "Some Welfare Households Are Far from Health Care",
      description:
        "Many supported households may not be close enough to health services. Outreach visits, transport help, or better referral routes may be needed.",
      action:
        "Plan outreach visits or transport support for households far from health services.",
    };
  }

  if (/education vulnerability/i.test(title)) {
    return {
      ...signal,
      title: "Some Supported Children May Struggle to Reach School",
      description:
        "Welfare-supported areas may have weak school access or many school-age children not enrolled. Welfare and education teams should follow up together.",
      action:
        "Coordinate welfare follow-up with school enrolment checks in these areas.",
    };
  }

  if (/nearby public hospital coverage/i.test(title)) {
    return {
      ...signal,
      title: "No Nearby Public Hospital Is Showing for This Area",
      description:
        "The selected area does not show welfare households within public hospital reach. Referral routes and transport support should be checked.",
      action:
        "Check referral routes and transport options to the nearest public hospital.",
    };
  }

  if (/integrated baseline/i.test(title)) {
    return {
      ...signal,
      title: "Enough Linked Data Is Available for Planning",
      description:
        "This view has welfare, school, health, and flood information joined together, so areas can be compared for support planning.",
      action:
        "Use this linked view to compare areas before deciding where to focus support.",
    };
  }

  return signal;
}

function getTaBarColor(value, maxValue) {
  if (!Number.isFinite(value) || maxValue <= 0) {
    return "#cbd5e1";
  }

  const ratio = value / maxValue;

  if (ratio >= 0.8) return "#dc2626";
  if (ratio >= 0.55) return "#8b5e3c";
  if (ratio >= 0.3) return "#2563eb";
  return "#22c55e";
}

function StatCard({ label, value, icon, helper }) {
  const IconComponent = icon;

  return (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95">
      <div className="flex justify-between items-start">
        <span className="text-[14px] text-gray-500 font-bold group-hover:text-black transition-colors">
          {label}
        </span>
        {IconComponent ? (
          <IconComponent className="h-5 w-5 text-gray-300 group-hover:text-black transition-colors" />
        ) : null}
      </div>
      <div className="mt-4 text-[32px] font-extrabold tracking-tight">
        {value}
      </div>
      {helper ? (
        <p className="mt-2 text-[12px] font-semibold text-gray-400">{helper}</p>
      ) : null}
    </div>
  );
}

function DepartmentCard({ item }) {
  const metricEntries = Object.entries(item?.metrics || {});

  return (
    <div className="border border-gray-100 rounded p-5 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400 group-hover:text-gray-500 transition-colors">
            {(item?.department || "").replace(/_/g, " ")}
          </p>
          <h4 className="mt-1 text-[16px] font-extrabold text-black">
            {item?.label || item?.department || "Department"}
          </h4>
        </div>
        <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
          {metricEntries.length} metrics
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {metricEntries.length > 0 ? (
          metricEntries.map(([key, value]) => {
            const label =
              DEPARTMENT_METRIC_LABELS[key] || key.replace(/_/g, " ");
            const isPercent = key.endsWith("_pct");

            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 border-t border-gray-50 pt-3 first:border-t-0 first:pt-0"
              >
                <span className="text-[12px] font-semibold text-gray-500">
                  {label}
                </span>
                <span className="text-[14px] font-extrabold text-black">
                  {formatNumber(value, isPercent ? 1 : 0)}
                </span>
              </div>
            );
          })
        ) : (
          <p className="rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm font-semibold text-gray-500">
            No department metrics are available for this view.
          </p>
        )}
      </div>
    </div>
  );
}

function WelfarePage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const { contentRef, exportDataPdf } = usePdfExport("Welfare_Report.pdf");
  const mapRef = useRef(null);
  const [adminType, setAdminType] = useState("TA");
  const [areaSearch, setAreaSearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [taChartSearch, setTaChartSearch] = useState("");
  const [taChartLimit, setTaChartLimit] = useState(12);
  const [taChartSort, setTaChartSort] = useState("beneficiaries_desc");
  const [riskFilter, setRiskFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");

  const baseIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: adminType,
      preview_limit: 15,
    }),
  );

  const baseProgramBreakdown =
    baseIntegration.data?.program_breakdown || [];
  const selectedProgramId =
    baseProgramBreakdown.find(
      (item) => item.program_name === selectedProgram,
    )?.program_id || "";

  const integration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: selectedTa ? "TA" : adminType,
      ta: selectedTa,
      program_id: selectedProgramId || undefined,
      preview_limit: 15,
    }),
  );
  const planningPriorities = useDashboardData(
    buildDashboardPath("/dashboard/planning-priorities", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
      department: "welfare",
      limit: selectedTa ? 1 : 5,
    }),
  );

  const taBoundaries = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      type: "TA",
      district: selectedDistrict,
    }),
  );
  const planningPriorities = useDashboardData(
    buildDashboardPath("/dashboard/planning-priorities", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "TA",
      department: "welfare",
      limit: selectedTa ? 1 : 5,
    }),
  );
  const summary = integration.data?.summary || {};
  const programBreakdown = useMemo(
    () => integration.data?.program_breakdown ?? EMPTY_ROWS,
    [integration.data],
  );
  const byArea = useMemo(
    () => integration.data?.by_area ?? EMPTY_ROWS,
    [integration.data],
  );
  const beneficiaryPreview = useMemo(
    () => integration.data?.beneficiary_preview ?? EMPTY_ROWS,
    [integration.data],
  );
  const departmentSummary = useMemo(
    () => integration.data?.department_summary ?? EMPTY_ROWS,
    [integration.data],
  );
  const planningPrioritySignals = (planningPriorities.data?.priorities || [])
    .slice(0, 3)
    .map((item) => ({
      severity:
        item.priority_band === "Critical"
          ? "high"
          : item.priority_band === "High"
            ? "medium"
            : "info",
      title: `Review welfare support in ${item.admin_unit_name}`,
      description:
        "This area should be reviewed first because welfare needs overlap with health, school, flood, or population pressures.",
      action:
        "Review welfare records together with health, school, flood, and population indicators.",
    }));
  const decisionSignals = [
    ...(integration.data?.decision_signals || []),
    ...planningPrioritySignals,
  ].map(simplifyWelfareSignal).slice(0, 6);
  const welfareRecommendations = decisionSignals.map((signal, index) => ({
    id: `welfare-signal-${index}`,
    priority:
      signal.severity === "high"
        ? "high"
        : signal.severity === "medium"
          ? "medium"
          : "low",
    icon:
      signal.severity === "high"
        ? ShieldAlert
        : signal.severity === "medium"
          ? Activity
          : Heart,
    title: signal.title,
    body: signal.description,
    action:
      signal.action ||
      "Review the linked welfare, health, education, and flood records for this area.",
  }));
  const welfarePriorityConfig = {
    high: {
      label: "Immediate Action",
      classes: "bg-red-50 border-red-200 text-red-700",
      dot: "bg-red-500",
    },
    medium: {
      label: "Short-Term Action",
      classes: "bg-amber-50 border-amber-200 text-amber-700",
      dot: "bg-amber-500",
    },
    low: {
      label: "Planning Note",
      classes: "bg-blue-50 border-blue-200 text-blue-700",
      dot: "bg-blue-500",
    },
  };
  const notes = integration.data?.notes || [];
  const baseByArea = useMemo(
    () => baseIntegration.data?.by_area ?? EMPTY_ROWS,
    [baseIntegration.data],
  );
  const programOptions = baseProgramBreakdown;
  const scopeLabel = selectedTa
    ? selectedTa
    : selectedDistrict
      ? selectedDistrict
      : "all TAs";

  const handleDownloadReport = async () => {
    const currentSummary = summary || {};
    const rows = WELFARE_SUMMARY_KEYS
      .filter((key) => Object.prototype.hasOwnProperty.call(currentSummary, key))
      .map((key) => ({
        metric: key.replace(/_/g, " "),
        value: formatNumber(currentSummary[key], 0),
      }));

    await exportDataPdf({
      title: "Social Welfare Area Analysis",
      selectedArea: selectedTa
        ? `TA: ${selectedTa}`
        : selectedDistrict
          ? `District: ${selectedDistrict}`
          : "National",
      sections: [
        {
          title: "Welfare Summary",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows: rows.length > 0 ? rows : [
            { metric: "Welfare summary", value: "No data available" },
          ],
        },
      ],
      mapNode: mapRef.current?.querySelector("[data-map-export]"),
    });
  };

  const pieData = programBreakdown.map((item) => ({
    name: item.program_name,
    value: item.beneficiary_count,
  }));

  const taOptions = useMemo(() => {
    const names = new Set();

    baseByArea.forEach((row) => {
      if (row.admin_unit_name && adminType === "TA") {
        names.add(row.admin_unit_name);
      }
    });

    beneficiaryPreview.forEach((row) => {
      if (row.ta_name) {
        names.add(row.ta_name);
      }
    });

    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [adminType, baseByArea, beneficiaryPreview]);

  const allTaChartRows = useMemo(
    () =>
      baseByArea
        .filter((row) => row.admin_unit_name)
        .map((row) => ({
          ta: row.admin_unit_name,
          beneficiaries: Number(row.beneficiary_count || 0),
          householdReach: Number(row.estimated_household_population || 0),
        }))
        .sort((left, right) => right.beneficiaries - left.beneficiaries),
    [baseByArea],
  );
  const taChartData = useMemo(() => {
    const searchTerm = taChartSearch.trim().toLowerCase();
    let rows = [...allTaChartRows];

    if (searchTerm) {
      rows = rows.filter((row) =>
        String(row.ta || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (taChartSort === "beneficiaries_asc") {
        return Number(left.beneficiaries || 0) - Number(right.beneficiaries || 0);
      }

      if (taChartSort === "name_asc") {
        return String(left.ta || "").localeCompare(String(right.ta || ""));
      }

      return Number(right.beneficiaries || 0) - Number(left.beneficiaries || 0);
    });

    if (taChartLimit > 0) {
      return rows.slice(0, taChartLimit);
    }

    return rows;
  }, [allTaChartRows, taChartLimit, taChartSearch, taChartSort]);

  const maxTaBeneficiaries = Math.max(
    ...taChartData.map((row) => row.beneficiaries),
    0,
  );

  const taMetricLookup = useMemo(() => {
    const lookup = new Map();

    allTaChartRows.forEach((row) => {
      lookup.set(row.ta.toLowerCase(), row);
    });

    return lookup;
  }, [allTaChartRows]);

  const taMapGeojson = useMemo(() => {
    if (!taBoundaries.data) {
      return taBoundaries.data;
    }

    const features = (taBoundaries.data.features || [])
      .map((feature) => {
        const name = feature?.properties?.name || "";
        const metrics = taMetricLookup.get(name.toLowerCase()) || {};

        return {
          ...feature,
          properties: {
            ...feature.properties,
            admin_unit_name: name,
            beneficiary_count: metrics.beneficiaries || 0,
            estimated_household_population: metrics.householdReach || 0,
          },
        };
      });

    return {
      ...taBoundaries.data,
      features,
    };
  }, [taBoundaries.data, taMetricLookup]);

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
    setAreaSearch("");
  };

  const programNamesLabel = (() => {
    const names = programBreakdown.map((item) => item.program_name).filter(Boolean);
    if (!names.length) {
      return "No program names available";
    }
    return names.join(", ");
  })();

  const filteredByArea = useMemo(() => {
    return byArea.filter((row) => {
      const areaName = String(row.admin_unit_name || "").toLowerCase();
      const districtName = String(row.district_name || "").toLowerCase();
      const beneficiaryCount = Number(row.beneficiary_count || 0);
      const schoolAccessCount = Number(row.school_access_count || 0);
      const healthAccessCount = Number(row.health_access_count || 0);
      const floodAffectedCount = Number(row.flood_affected_count || 0);
      const searchValue = areaSearch.trim().toLowerCase();
      const matchesSearch =
        !searchValue ||
        areaName.includes(searchValue) ||
        districtName.includes(searchValue);
      const matchesTa =
        !selectedTa ||
        String(row.admin_unit_name || "").toLowerCase() ===
          selectedTa.toLowerCase();
      const matchesRiskFilter =
        riskFilter === "all" ||
        (riskFilter === "flood_only" && floodAffectedCount > 0) ||
        (riskFilter === "clear_only" && floodAffectedCount === 0);
      const matchesServiceFilter =
        serviceFilter === "all" ||
        (serviceFilter === "school_limited" &&
          schoolAccessCount < beneficiaryCount) ||
        (serviceFilter === "health_limited" &&
          healthAccessCount < beneficiaryCount);

      return (
        matchesSearch &&
        matchesTa &&
        matchesRiskFilter &&
        matchesServiceFilter
      );
    });
  }, [areaSearch, byArea, riskFilter, selectedTa, serviceFilter]);

  const areaColumns = [
    {
      key: "admin_unit_name",
      label: adminType === "TA" ? "TA" : "District",
    },
    {
      key: "district_name",
      label: "District",
    },
    {
      key: "beneficiary_count",
      label: "Beneficiaries",
      digits: 0,
    },
    {
      key: "estimated_household_population",
      label: "Household Reach",
      digits: 0,
    },
  ];

  const StatCardSkeleton = () => (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white animate-pulse">
      <div className="flex justify-between items-start mb-4">
        <div className="h-4 w-32 bg-gray-200 rounded"></div>
        <div className="h-5 w-5 bg-gray-100 rounded-full"></div>
      </div>
      <div className="h-8 w-24 bg-gray-200 rounded"></div>
    </div>
  );

  return (
    <div ref={contentRef} className="min-h-screen bg-white text-black font-sans pb-10">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <UserCheck className="h-8 w-8 text-black" />
        <h1 className="text-xl font-extrabold tracking-tight sm:text-[28px]">
          SOCIAL WELFARE
        </h1>
      </div>

      <div className="mt-6 px-4 sm:mt-8 sm:px-6 lg:px-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Social welfare view for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Social welfare view for ${selectedTa}`
              : "Social welfare beneficiaries and program participation"}
        </p>

        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button
            onClick={handleDownloadReport}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 sm:w-auto sm:justify-start sm:py-1.5"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <SharedDistrictSelector />

          <div className="inline-flex w-full rounded border border-gray-200 bg-white p-1 shadow-sm sm:w-auto">
            {["TA", "District"].map((value) => (
              <button
                key={value}
                onClick={() => setAdminType(value)}
                className={`px-4 py-2 text-[12px] font-bold rounded transition-all ${
                  adminType === value
                    ? "bg-black text-white"
                    : "text-gray-500 hover:text-black"
                }`}
              >
                {value} Basis
              </button>
            ))}
          </div>

        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 mb-10">
          {integration.loading
            ? [...Array(3)].map((_, index) => <StatCardSkeleton key={index} />)
            : [
                {
                  label: "Total Beneficiaries",
                  value: formatWholeNumber(summary.total_beneficiaries),
                  icon: Heart,
                  helper: selectedProgram
                    ? `${selectedProgram} in ${scopeLabel}`
                    : `${programNamesLabel} in ${scopeLabel}`,
                },
                {
                  label: "Estimated Household Reach",
                  value: formatWholeNumber(summary.estimated_household_population),
                  icon: UserCheck,
                  helper: `${formatWholeNumber(summary.beneficiary_records_under_18)} beneficiary records under 18 in ${scopeLabel}`,
                },
                {
                  label: "Programs",
                  value: formatWholeNumber(programBreakdown.length),
                  icon: Heart,
                  helper: programNamesLabel,
                },
              ].map((item) => <StatCard key={item.label} {...item} />)}
        </div>

        <div className="mb-10 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          <h3 className="text-[16px] font-extrabold mb-5 flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-black" />
            Integration Notes
          </h3>
          <div className="space-y-3">
            {notes.length ? (
              notes.map((note, index) => (
                <p key={index} className="text-[13px] leading-6 text-gray-600">
                  {note}
                </p>
              ))
            ) : (
              <p className="rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-4 text-sm font-semibold text-gray-500">
                No integration notes are available for the current filters.
              </p>
            )}
          </div>
        </div>

        {adminType === "TA" ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-8 mb-10">
            <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8 min-h-[420px] h-[68vh] max-h-[560px] flex flex-col">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-[16px] font-extrabold">
                    Welfare TA Map
                  </h3>
                  <p className="mt-2 text-sm text-gray-500 font-semibold">
                    {selectedTa
                      ? `Showing welfare indicators for ${selectedTa}.`
                      : "Click a TA boundary to focus every welfare indicator on that TA."}
                  </p>
                </div>
              </div>
              <div ref={mapRef} className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
                <MapPanel
                  geojson={taMapGeojson}
                  metricName="beneficiary_count"
                  title=""
                  exportTitle="Welfare Beneficiaries by TA"
                  exportSubtitle="TA areas shaded by welfare beneficiary count for the selected scope."
                  pointColor="#2563eb"
                  popupFields={[
                    { key: "beneficiary_count", label: "Beneficiaries" },
                    {
                      key: "estimated_household_population",
                      label: "Household Reach",
                    },
                  ]}
                  tooltipFields={[
                    { key: "beneficiary_count", label: "Beneficiaries" },
                    {
                      key: "estimated_household_population",
                      label: "Household Reach",
                    },
                  ]}
                  selectedFeatureName={selectedTa}
                  onFeatureClick={(feature) =>
                    selectTa(feature?.properties?.name || "")
                  }
                  showLegend
                  legendTitle="Beneficiaries by TA"
                  heightClass="h-full w-full"
                  loading={taBoundaries.loading || baseIntegration.loading}
                />
              </div>
            </div>

            <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8 min-h-[420px] h-[68vh] max-h-[560px] flex flex-col">
              <h3 className="text-[16px] font-extrabold mb-2">
                Beneficiaries by TA
              </h3>
              <p className="text-sm text-gray-500 font-semibold mb-4">
                {selectedTa
                  ? `${selectedTa} is highlighted; click another bar to sync the map, records, and insights.`
                  : "Click a TA bar to focus the map, records, and insights."}
              </p>
              <div className="mb-4 rounded border border-gray-100 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {WELFARE_TA_CHART_LIMITS.map((option) => {
                    const isActive = option.value === taChartLimit;
                    return (
                      <button
                        key={`welfare-ta-limit-${option.label}`}
                        type="button"
                        onClick={() => setTaChartLimit(option.value)}
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
                    value={taChartSort}
                    onChange={(event) => setTaChartSort(event.target.value)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
                  >
                    <option value="beneficiaries_desc">Highest beneficiaries</option>
                    <option value="beneficiaries_asc">Lowest beneficiaries</option>
                    <option value="name_asc">Name A-Z</option>
                  </select>
                  <input
                    type="search"
                    value={taChartSearch}
                    onChange={(event) => setTaChartSearch(event.target.value)}
                    placeholder="Search TA..."
                    className="w-full flex-1 sm:min-w-[170px] rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900"
                  />
                </div>
                <p className="mt-2 text-[11px] font-semibold text-gray-500">
                  Showing {formatWholeNumber(taChartData.length)} of{" "}
                  {formatWholeNumber(allTaChartRows.length)} TAs.
                </p>
              </div>
              <div className="min-h-0 flex-1">
                {baseIntegration.loading ? (
                  <div className="h-full w-full animate-pulse rounded bg-gray-50" />
                ) : !taChartData.length ? (
                  <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                    No TA-level welfare rows match the current filters.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={taChartData}
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
                        tick={{
                          fill: "#64748b",
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                        tickFormatter={formatTaAxisLabel}
                        angle={-90}
                        textAnchor="end"
                        interval={0}
                        height={116}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{
                          fill: "#64748b",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                        tickFormatter={(value) =>
                          Number(value).toLocaleString()
                        }
                      />
                      <Tooltip
                        formatter={(value) => [
                          Number(value).toLocaleString(),
                          "Beneficiaries",
                        ]}
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
                        dataKey="beneficiaries"
                        radius={[2, 2, 0, 0]}
                        barSize={18}
                        activeBar={<Rectangle fill="#7e22ce" />}
                        onClick={(entry) => selectTa(entry?.ta || "")}
                      >
                        {taChartData.map((entry) => {
                          const isSelected =
                            selectedTa &&
                            entry.ta.toLowerCase() ===
                              selectedTa.toLowerCase();

                          return (
                            <Cell
                              key={`welfare-ta-bar-${entry.ta}`}
                              cursor="pointer"
                              fill={
                                isSelected
                                  ? "#7e22ce"
                                  : getTaBarColor(
                                      entry.beneficiaries,
                                      maxTaBeneficiaries,
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
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
          {departmentSummary.map((item) => (
            <DepartmentCard key={item.department} item={item} />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-8 mb-10">
          <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
            <h3 className="text-[16px] font-extrabold mb-6">
              Program Participation Breakdown
            </h3>
            <div className="h-[240px] sm:h-[280px]">
              {integration.loading ? (
                <div className="h-full w-full bg-gray-50 rounded-full animate-pulse flex items-center justify-center">
                  <div className="w-2/3 h-2/3 bg-white rounded-full"></div>
                </div>
              ) : pieData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-400">
                  No welfare program data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={95}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell
                          key={`${entry.name}-${index}`}
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
            <div className="mt-6 space-y-3">
              {programBreakdown.map((entry, index) => (
                <div
                  key={entry.program_id || entry.program_name}
                  className="flex items-center gap-3"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-[13px] font-semibold text-gray-600">
                    {entry.program_name}
                  </span>
                  <span className="ml-auto text-[13px] font-black text-black">
                    {formatWholeNumber(entry.beneficiary_count)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-10">
          <div className="mb-5 rounded border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={areaSearch}
                onChange={(event) => setAreaSearch(event.target.value)}
                placeholder="Search TAs or districts"
                className="w-full flex-1 rounded border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 outline-none focus:border-black sm:min-w-[220px]"
              />
              <select
                value={selectedTa}
                onChange={(event) => setSelectedTa(event.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 sm:w-auto sm:min-w-[180px]"
              >
                <option value="">All TAs</option>
                {taOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <select
                value={riskFilter}
                onChange={(event) => setRiskFilter(event.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 sm:w-auto sm:min-w-[170px]"
              >
                <option value="all">All Risk States</option>
                <option value="flood_only">Flood Affected Only</option>
                <option value="clear_only">Not Flood Affected</option>
              </select>
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                className="w-full rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 sm:w-auto sm:min-w-[190px]"
              >
                <option value="all">All Service States</option>
                <option value="school_limited">Limited School Access</option>
                <option value="health_limited">Limited Health Access</option>
              </select>
            </div>
            <p className="mt-3 text-[12px] font-semibold text-gray-500">
              Showing {formatWholeNumber(filteredByArea.length)} {selectedTa ? `record for ${selectedTa}` : "TA records"} after filtering.
            </p>
          </div>
          <DataTable
            rows={filteredByArea}
            columns={areaColumns}
            title={selectedTa ? `${selectedTa} Welfare View` : "TA Welfare View"}
            subtitle={`Social welfare beneficiary totals for ${scopeLabel}.`}
          />
        </div>

        <div className="mb-10">
          <div className="mb-2 flex items-center gap-3">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            <h3 className="text-[16px] font-extrabold">
              Insights & Recommendations
            </h3>
          </div>
          <p className="mb-6 text-sm font-semibold text-gray-500">
            Use these cards to see which households or areas need attention
            first, what support may be missing, and what action to take next for
            {scopeLabel}.
          </p>
          {integration.loading || planningPriorities.loading ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {[...Array(4)].map((_, index) => (
                <div
                  key={index}
                  className="h-36 animate-pulse rounded border border-gray-100 bg-gray-50"
                />
              ))}
            </div>
          ) : (
            <InteractiveRecommendations
              recommendations={welfareRecommendations}
              priorityConfig={welfarePriorityConfig}
              sectionKey={`welfare:${scopeLabel}`}
            />
          )}
        </div>

      </div>
    </div>
  );
}

export default WelfarePage;
