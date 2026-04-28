import { useMemo, useState } from "react";
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
import { useDistrictOptions } from "../hooks/useDistrictOptions";
import { usePdfExport } from "../hooks/usePdfExport";
import { buildDashboardPath } from "../lib/query";
import DataTable from "../components/DataTable";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
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

function formatDistanceKm(value) {
  return `${Number(value || 0).toFixed(1)} km`;
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
  const { selectedDistrict, setSelectedDistrict } = useDistrict();
  const { contentRef, exportPdf } = usePdfExport("Welfare_Integration_Report.pdf");
  const districts = useDistrictOptions();
  const adminType = "TA";
  const [selectedTa, setSelectedTa] = useState("");
  const [selectedProgram, setSelectedProgram] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [beneficiarySearch, setBeneficiarySearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const programCatalog = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: adminType,
      preview_limit: 1,
    }),
  );

  const programOptions = useMemo(
    () => programCatalog.data?.program_breakdown || [],
    [programCatalog.data],
  );
  const selectedProgramId = useMemo(
    () =>
      programOptions.find((item) => item.program_name === selectedProgram)
        ?.program_id || "",
    [programOptions, selectedProgram],
  );

  const integration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: adminType,
      program_id: selectedProgramId || undefined,
      preview_limit: 15,
    }),
  );

  const summary = integration.data?.summary || {};
  const departmentSummary = integration.data?.department_summary || [];
  const programBreakdown = integration.data?.program_breakdown || [];
  const byArea = integration.data?.by_area || [];
  const beneficiaryPreview = integration.data?.beneficiary_preview || [];
  const decisionSignals = integration.data?.decision_signals || [];
  const notes = integration.data?.notes || [];

  const pieData = programBreakdown.map((item) => ({
    name: item.program_name,
    value: item.beneficiary_count,
  }));

  const taOptions = useMemo(() => {
    const names = new Set();

    byArea.forEach((row) => {
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
  }, [adminType, beneficiaryPreview, byArea]);

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
            ? `Integrated welfare view for ${selectedDistrict}`
            : "Integrated welfare decision-support across linked departments"}
        </p>

        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={exportPdf}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>

          <div className="relative">
            <select
              className="bg-black text-white rounded px-6 py-2 text-[14px] font-bold appearance-none min-w-[180px] cursor-pointer"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
            >
              <option value="">All Districts</option>
              {districts.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="relative">
            <select
              className="bg-white text-gray-700 rounded border border-gray-200 px-4 py-2 text-[13px] font-bold min-w-[220px] cursor-pointer shadow-sm"
              value={selectedProgram}
              onChange={(e) => setSelectedProgram(e.target.value)}
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
          </div>
        </div>

        <div className="mb-8 rounded border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
              Programs
            </span>
            {programOptions.length ? (
              programOptions.map((program) => {
                const isActive = selectedProgram === program.program_name;
                return (
                  <button
                    key={program.program_id || program.program_name}
                    onClick={() =>
                      setSelectedProgram((current) =>
                        current === program.program_name ? "" : program.program_name,
                      )
                    }
                    className={`rounded border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                      isActive
                        ? "border-black bg-black text-white"
                        : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    {program.program_name} ({formatWholeNumber(program.beneficiary_count)})
                  </button>
                );
              })
            ) : (
              <span className="text-[13px] font-semibold text-gray-500">
                No program records available.
              </span>
            )}
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
                    ? selectedProgram
                    : programNamesLabel,
                },
                {
                  label: "Estimated Household Reach",
                  value: formatWholeNumber(summary.estimated_household_population),
                  icon: UserCheck,
                  helper: `${formatWholeNumber(summary.beneficiary_records_under_18)} beneficiary records under 18`,
                },
                {
                  label: "Health Access Coverage",
                  value: formatPercent(summary.health_access_pct),
                  icon: Activity,
                  helper: `${formatWholeNumber(summary.public_hospital_access_count)} within public hospital reach`,
                },
                {
                  label: "Flood-Affected Beneficiaries",
                  value: formatWholeNumber(summary.flood_affected_count),
                  icon: ShieldAlert,
                  helper: `${formatPercent(summary.flood_affected_pct)} of the selected scope`,
                },
              ].map((item) => <StatCard key={item.label} {...item} />)}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">
          {departmentSummary.map((item) => (
            <DepartmentCard key={item.department} item={item} />
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-8 mb-10">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
            <h3 className="text-[16px] font-extrabold mb-6">
              Decision Signals
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
              Showing {formatWholeNumber(filteredByArea.length)} TA records after filtering.
            </p>
          </div>
          <DataTable
            rows={filteredByArea}
            columns={areaColumns}
            title="TA Decision View"
            subtitle="Previewing linked social welfare, education, health, and disaster indicators at TA level."
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
              Showing {formatWholeNumber(filteredBeneficiaryPreview.length)} beneficiary preview records after filtering.
            </p>
          </div>
          <DataTable
            rows={filteredBeneficiaryPreview}
            columns={beneficiaryColumns}
            title="Beneficiary Preview"
            subtitle="A record-level sample showing program membership, residence, nearby services, and flood context."
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
