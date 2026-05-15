import { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import {
  UserCheck,
  Heart,
  ShieldAlert,
  Activity,
  GraduationCap,
  Download,
} from "lucide-react";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import { buildDashboardPath } from "../lib/query";
import { formatNumber } from "../lib/format";
import DataTable from "../components/DataTable";
import MapPanel from "../components/MapPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";

function formatMinutes(value) {
  const mins = Number(value);
  if (!Number.isFinite(mins) || mins <= 0) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatDistanceKm(value) {
  const km = Number(value);
  if (!Number.isFinite(km) || km <= 0) return "—";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${formatNumber(km, 1)} km`;
}
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

function formatWholeNumber(value) {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
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

function renderBooleanPill(value, yesLabel = "Yes", noLabel = "No") {
  const isTrue = Boolean(value);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${
        isTrue
          ? "bg-green-50 text-green-700 border border-green-100"
          : "bg-gray-50 text-gray-500 border border-gray-100"
      }`}
    >
      {isTrue ? yesLabel : noLabel}
    </span>
  );
}

function DepartmentCard({ item }) {
  const metrics = Object.entries(item.metrics || {});

  return (
    <div className="border border-gray-100 rounded p-6 shadow-sm bg-white">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-[15px] font-extrabold tracking-tight text-black">
          {item.label}
        </h3>
        <span className="text-[10px] uppercase tracking-[0.18em] font-bold text-gray-400">
          Department
        </span>
      </div>
      <div className="space-y-3">
        {metrics.map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-[12px] font-semibold text-gray-500">
              {key.replace(/_/g, " ")}
            </span>
            <span className="text-[14px] font-black text-black">
              {key.includes("pct") ? formatPercent(value) : formatWholeNumber(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, helper }) {
  return (
    <div className="border border-gray-100 rounded p-6 shadow-md bg-white group hover:shadow-lg transition-all active:scale-95">
      <div className="flex justify-between items-start">
        <span className="text-[14px] text-gray-500 font-bold group-hover:text-black transition-colors">
          {label}
        </span>
        <Icon className="h-5 w-5 text-gray-300 group-hover:text-black transition-colors" />
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

function WelfarePage() {
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const { contentRef, exportDataPdf } = usePdfExport("Welfare_Integration_Report.pdf");
  const [adminType, setAdminType] = useState("TA");
  const [areaSearch, setAreaSearch] = useState("");
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
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
      admin_type: adminType,
      ta: selectedTa,
      program_id: selectedProgramId || undefined,
      preview_limit: 15,
    }),
  );

  const taBoundaries = useDashboardData(
    buildDashboardPath("/dashboard/admin-units", {
      type: "TA",
      district: selectedDistrict,
    }),
  );

  const summary = integration.data?.summary || {};
  const departmentSummary = integration.data?.department_summary || [];
  const programBreakdown = integration.data?.program_breakdown || [];
  const byArea = integration.data?.by_area || [];
  const beneficiaryPreview = integration.data?.beneficiary_preview || [];
  const decisionSignals = integration.data?.decision_signals || [];
  const notes = integration.data?.notes || [];
  const baseByArea = baseIntegration.data?.by_area || [];
  const programOptions = baseProgramBreakdown;
  const scopeLabel = selectedTa
    ? selectedTa
    : selectedDistrict
      ? selectedDistrict
      : "all TAs";

  const handleDownloadReport = async () => {
    const currentSummary = summary || {};
    const rows = Object.entries(currentSummary).map(([key, value]) => ({
      metric: key.replace(/_/g, " "),
      value: formatNumber(value, 0),
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

  const taChartData = useMemo(
    () =>
      baseByArea
        .filter((row) => row.admin_unit_name)
        .map((row) => ({
          ta: row.admin_unit_name,
          beneficiaries: Number(row.beneficiary_count || 0),
          householdReach: Number(row.estimated_household_population || 0),
          healthAccess: Number(row.health_access_count || 0),
          schoolAccess: Number(row.school_access_count || 0),
          floodAffected: Number(row.flood_affected_count || 0),
        }))
        .sort((left, right) => right.beneficiaries - left.beneficiaries),
    [baseByArea],
  );

  const maxTaBeneficiaries = Math.max(
    ...taChartData.map((row) => row.beneficiaries),
    0,
  );

  const taMetricLookup = useMemo(() => {
    const lookup = new Map();

    taChartData.forEach((row) => {
      lookup.set(row.ta.toLowerCase(), row);
    });

    return lookup;
  }, [taChartData]);

  const taMapGeojson = useMemo(() => {
    if (!taBoundaries.data) {
      return taBoundaries.data;
    }

    const features = (taBoundaries.data.features || [])
      .filter((feature) => {
        const name = feature?.properties?.name || "";
        return (
          !selectedTa ||
          name.toLowerCase() === selectedTa.toLowerCase()
        );
      })
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
            health_access_count: metrics.healthAccess || 0,
            school_access_count: metrics.schoolAccess || 0,
            flood_affected_count: metrics.floodAffected || 0,
          },
        };
      });

    return {
      ...taBoundaries.data,
      features,
    };
  }, [selectedTa, taBoundaries.data, taMetricLookup]);

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
    setAreaSearch("");
    setBeneficiarySearch("");
  };

  const programNamesLabel = useMemo(() => {
    const names = programBreakdown
      .map((item) => item.program_name)
      .filter(Boolean);

    if (!names.length) {
      return "No program names available";
    }

    return names.join(", ");
  }, [programBreakdown]);

  const filteredByArea = useMemo(() => {
    return byArea.filter((row) => {
      const areaName = String(row.admin_unit_name || "").toLowerCase();
      const districtName = String(row.district_name || "").toLowerCase();
      const searchValue = areaSearch.trim().toLowerCase();
      const matchesSearch =
        !searchValue ||
        areaName.includes(searchValue) ||
        districtName.includes(searchValue);
      const matchesTa =
        !selectedTa ||
        String(row.admin_unit_name || "").toLowerCase() ===
          selectedTa.toLowerCase();
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "flood_only" &&
          Number(row.flood_affected_count || 0) > 0) ||
        (riskFilter === "clear_only" &&
          Number(row.flood_affected_count || 0) === 0);
      const matchesService =
        serviceFilter === "all" ||
        (serviceFilter === "school_limited" &&
          Number(row.school_access_count || 0) <
            Number(row.beneficiary_count || 0)) ||
        (serviceFilter === "health_limited" &&
          Number(row.health_access_count || 0) <
            Number(row.beneficiary_count || 0));

      return matchesSearch && matchesTa && matchesRisk && matchesService;
    });
  }, [adminType, areaSearch, byArea, riskFilter, selectedTa, serviceFilter]);

  const filteredBeneficiaryPreview = useMemo(() => {
    return beneficiaryPreview.filter((row) => {
      const fullName = `${row.firstname || ""} ${row.lastname || ""}`
        .trim()
        .toLowerCase();
      const taName = String(row.ta_name || "").toLowerCase();
      const districtName = String(row.district_name || "").toLowerCase();
      const programName = String(row.program_name || "").toLowerCase();
      const searchValue = beneficiarySearch.trim().toLowerCase();
      const matchesSearch =
        !searchValue ||
        fullName.includes(searchValue) ||
        taName.includes(searchValue) ||
        districtName.includes(searchValue) ||
        programName.includes(searchValue);
      const matchesTa =
        !selectedTa || taName === selectedTa.toLowerCase();
      const matchesProgram =
        !selectedProgram || programName === selectedProgram.toLowerCase();
      const matchesRisk =
        riskFilter === "all" ||
        (riskFilter === "flood_only" && Boolean(row.affected_by_flood)) ||
        (riskFilter === "clear_only" && !Boolean(row.affected_by_flood));
      const matchesService =
        serviceFilter === "all" ||
        (serviceFilter === "school_limited" &&
          !Boolean(row.has_school_access)) ||
        (serviceFilter === "health_limited" &&
          !Boolean(row.has_health_facility_access));

      return (
        matchesSearch &&
        matchesTa &&
        matchesProgram &&
        matchesRisk &&
        matchesService
      );
    });
  }, [
    beneficiaryPreview,
    beneficiarySearch,
    riskFilter,
    selectedProgram,
    selectedTa,
    serviceFilter,
  ]);

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
    {
      key: "school_access_count",
      label: "School Access",
      digits: 0,
    },
    {
      key: "school_age_population_unenrolled",
      label: "Area Unenrolled",
      digits: 0,
    },
    {
      key: "health_access_count",
      label: "Health Access",
      digits: 0,
    },
    {
      key: "public_hospital_access_count",
      label: "Public Hospital Reach",
      digits: 0,
    },
    {
      key: "private_hospital_access_count",
      label: "Private Hospital Reach",
      digits: 0,
    },
    {
      key: "flood_affected_count",
      label: "Flood Affected",
      digits: 0,
    },
  ];

  const beneficiaryColumns = [
    {
      key: "beneficiary_name",
      label: "Beneficiary",
      render: (_, row) => `${row.firstname || ""} ${row.lastname || ""}`.trim(),
    },
    {
      key: "program_name",
      label: "Program",
    },
    {
      key: "ta_name",
      label: "TA",
    },
    {
      key: "district_name",
      label: "District",
    },
    {
      key: "affected_by_flood",
      label: "Flood",
      render: (value) => renderBooleanPill(value, "Affected", "Clear"),
    },
    {
      key: "has_school_access",
      label: "School Access",
      render: (value) => renderBooleanPill(value, "Nearby", "Limited"),
    },
    {
      key: "has_health_facility_access",
      label: "Health Access",
      render: (value) => renderBooleanPill(value, "Nearby", "Limited"),
    },
    {
      key: "nearest_facility_name",
      label: "Nearest Facility",
      render: (value, row) =>
        value
          ? `${value} (${formatDistanceKm(row.nearest_facility_distance_km)})`
          : "N/A",
    },
    {
      key: "nearest_health_travel_time_min",
      label: "Health Road Travel",
      render: (value, row) =>
        row.nearest_health_routing_status === "routed"
          ? `${formatMinutes(value)} (${formatDistanceKm(row.nearest_health_network_distance_km)})`
          : "N/A",
    },
    {
      key: "nearest_school_travel_time_min",
      label: "School Road Travel",
      render: (value, row) =>
        row.nearest_school_routing_status === "routed"
          ? `${formatMinutes(value)} (${formatDistanceKm(row.nearest_school_network_distance_km)})`
          : "N/A",
    },
    {
      key: "nearest_hospital_name",
      label: "Nearest Hospital",
      render: (value, row) =>
        value
          ? `${value} (${formatDistanceKm(row.nearest_hospital_distance_km)})`
          : "N/A",
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
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <UserCheck className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">
          SOCIAL WELFARE INTEGRATION
        </h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Integrated welfare view for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Integrated welfare view for ${selectedTa}`
              : "Integrated welfare decision-support across linked departments"}
        </p>

        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={handleDownloadReport}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <SharedDistrictSelector />

          <div className="inline-flex rounded border border-gray-200 bg-white p-1 shadow-sm">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
          {integration.loading
            ? [...Array(4)].map((_, index) => <StatCardSkeleton key={index} />)
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
                  label: "Health Access Coverage",
                  value: formatPercent(summary.health_access_pct),
                  icon: Activity,
                  helper: `${formatWholeNumber(summary.public_hospital_access_count)} within public hospital reach in ${scopeLabel}`,
                },
                {
                  label: "Flood-Affected Beneficiaries",
                  value: formatWholeNumber(summary.flood_affected_count),
                  icon: ShieldAlert,
                  helper: `${formatPercent(summary.flood_affected_pct)} of ${scopeLabel}`,
                },
              ].map((item) => <StatCard key={item.label} {...item} />)}
        </div>

        {adminType === "TA" ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 mb-10">
            <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[560px] flex flex-col">
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
              <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
                <MapPanel
                  geojson={taMapGeojson}
                  metricName="beneficiary_count"
                  title=""
                  pointColor="#2563eb"
                  popupFields={[
                    { key: "beneficiary_count", label: "Beneficiaries" },
                    {
                      key: "estimated_household_population",
                      label: "Household Reach",
                    },
                    { key: "school_access_count", label: "School Access" },
                    { key: "health_access_count", label: "Health Access" },
                    { key: "flood_affected_count", label: "Flood Affected" },
                  ]}
                  tooltipFields={[
                    { key: "beneficiary_count", label: "Beneficiaries" },
                    { key: "health_access_count", label: "Health Access" },
                    { key: "flood_affected_count", label: "Flood Affected" },
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

            <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[560px] flex flex-col">
              <h3 className="text-[16px] font-extrabold mb-2">
                Beneficiaries by TA
              </h3>
              <p className="text-sm text-gray-500 font-semibold mb-4">
                {selectedTa
                  ? `${selectedTa} is highlighted; click another bar to sync the map, records, and insights.`
                  : "Click a TA bar to focus the map, records, and insights."}
              </p>
              <div className="flex-1">
                {baseIntegration.loading ? (
                  <div className="h-full w-full animate-pulse rounded bg-gray-50" />
                ) : !taChartData.length ? (
                  <div className="h-full flex items-center justify-center text-center text-sm text-gray-500 px-6">
                    No TA-level welfare records are available for this filter yet.
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

        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-8 mb-10">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
            <h3 className="text-[16px] font-extrabold mb-6">
              Decision Signals for {scopeLabel}
            </h3>
            <div className="space-y-4">
              {integration.loading ? (
                [...Array(3)].map((_, index) => (
                  <div
                    key={index}
                    className="h-20 rounded border border-gray-100 bg-gray-50 animate-pulse"
                  />
                ))
              ) : (
                decisionSignals.map((signal, index) => (
                  <div
                    key={`${signal.title}-${index}`}
                    className={`rounded border px-5 py-4 ${
                      signal.severity === "high"
                        ? "border-red-100 bg-red-50"
                        : signal.severity === "medium"
                          ? "border-amber-100 bg-amber-50"
                          : "border-blue-100 bg-blue-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
                        {signal.severity}
                      </span>
                      <ShieldAlert className="h-4 w-4 text-gray-400" />
                    </div>
                    <h4 className="mt-2 text-[15px] font-extrabold text-black">
                      {signal.title}
                    </h4>
                    <p className="mt-2 text-[13px] leading-6 text-gray-600">
                      {signal.description}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
            <h3 className="text-[16px] font-extrabold mb-6">
              Program Participation Breakdown
            </h3>
            <div className="h-[280px]">
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
                className="min-w-[220px] flex-1 rounded border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 outline-none focus:border-black"
              />
              <select
                value={selectedTa}
                onChange={(event) => setSelectedTa(event.target.value)}
                className="min-w-[180px] rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700"
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
                className="min-w-[170px] rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700"
              >
                <option value="all">All Risk States</option>
                <option value="flood_only">Flood Affected Only</option>
                <option value="clear_only">Not Flood Affected</option>
              </select>
              <select
                value={serviceFilter}
                onChange={(event) => setServiceFilter(event.target.value)}
                className="min-w-[190px] rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700"
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
            title={selectedTa ? `${selectedTa} Decision View` : "TA Decision View"}
            subtitle={`Previewing linked social welfare, education, health, and disaster indicators for ${scopeLabel}.`}
          />
        </div>

        <div className="mb-10">
          <div className="mb-5 rounded border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={beneficiarySearch}
                onChange={(event) => setBeneficiarySearch(event.target.value)}
                placeholder="Search beneficiary, TA, district, or program"
                className="min-w-[240px] flex-1 rounded border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 outline-none focus:border-black"
              />
              <select
                value={selectedProgram}
                onChange={(event) => setSelectedProgram(event.target.value)}
                className="min-w-[210px] rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700"
              >
                <option value="">All Programs</option>
                {programOptions.map((option) => (
                  <option
                    key={option.program_id || option.program_name}
                    value={option.program_name}
                  >
                    {option.program_name}
                  </option>
                ))}
              </select>
              <select
                value={selectedTa}
                onChange={(event) => setSelectedTa(event.target.value)}
                className="min-w-[180px] rounded border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700"
              >
                <option value="">All TAs</option>
                {taOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-3 text-[12px] font-semibold text-gray-500">
              Showing {formatWholeNumber(filteredBeneficiaryPreview.length)} beneficiary preview records for {scopeLabel} after filtering.
            </p>
          </div>
          <DataTable
            rows={filteredBeneficiaryPreview}
            columns={beneficiaryColumns}
            title={selectedTa ? `Beneficiary Preview for ${selectedTa}` : "Beneficiary Preview"}
            subtitle={`A record-level sample showing program membership, residence, nearby services, and flood context for ${scopeLabel}.`}
          />
        </div>

        <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
          <h3 className="text-[16px] font-extrabold mb-5 flex items-center gap-3">
            <GraduationCap className="h-5 w-5 text-black" />
            Integration Notes
          </h3>
          <div className="space-y-3">
            {notes.map((note, index) => (
              <p key={index} className="text-[13px] leading-6 text-gray-600">
                {note}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelfarePage;
