import {
  GraduationCap,
  Users,
  School,
  BookOpen,
  Download,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import { formatNumber } from "../lib/format";
import { buildDashboardPath } from "../lib/query";
import MapPanel from "../components/MapPanel";
import CoverageShapePanel from "../components/CoverageShapePanel";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import {
  Cell,
  CartesianGrid,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

function getStatusBadgeClasses(value) {
  if (value === "Underserved") {
    return "border border-red-200 bg-red-50 text-red-700";
  }

  if (value === "Overcrowded") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border border-emerald-200 bg-emerald-50 text-emerald-700";
}

function getInsightBadgeClasses(value) {
  if (value === "Infrastructure Gap") {
    return "border border-red-200 bg-red-50 text-red-700";
  }

  if (value === "Overcrowding Risk") {
    return "border border-amber-200 bg-amber-50 text-amber-700";
  }

  if (value === "Underutilized Schools") {
    return "border border-blue-200 bg-blue-50 text-blue-700";
  }

  return "border border-slate-200 bg-slate-50 text-slate-700";
}

function getInsightColor(value) {
  if (value === "Infrastructure Gap") {
    return "#dc2626";
  }

  if (value === "Overcrowding Risk") {
    return "#d97706";
  }

  if (value === "Underutilized Schools") {
    return "#2563eb";
  }

  return "#16a34a";
}

function formatAdminUnitAxisLabel(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 14)}…`;
}

const PRESSURE_FILTER_CATEGORIES = [
  "Infrastructure Gap",
  "Overcrowding Risk",
  "Underutilized Schools",
  "Balanced Capacity",
  "Unmapped",
];

function getPressureCategoryColor(value) {
  if (value === "Unmapped") {
    return "#94a3b8";
  }

  return getInsightColor(value);
}

function normalizeTaName(value) {
  return String(value || "")
    .trim()
    .replace(/^ta\s+/i, "")
    .toLowerCase();
}

function EducationScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;

  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-sm font-extrabold text-black">
        {row.admin_unit_name}
      </div>
      <div className="text-xs text-gray-500">{row.district}</div>
      <div className="mt-2 text-xs text-gray-600">
        Insight: {row.insight_label}
      </div>
      <div className="text-xs text-gray-600">
        Schools / 10k: {formatNumber(row.schools_per_10k, 2)}
      </div>
      <div className="text-xs text-gray-600">
        Students / School: {formatNumber(row.students_per_school, 0)}
      </div>
      <div className="text-xs text-gray-600">
        Schools / Child: {formatNumber(row.schools_per_children, 4)}
      </div>
    </div>
  );
}

function EducationCategoryPieTooltip({ active, payload }) {
  if (!active || !payload?.length) {
    return null;
  }

  const row = payload[0].payload;

  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3 shadow-lg">
      <div className="text-sm font-extrabold text-black">{row.name}</div>
      <div className="mt-2 text-xs text-gray-600">
        TAs: {formatNumber(row.value, 0)}
      </div>
      <div className="text-xs text-gray-600">
        Share: {formatNumber(row.share, 1)}%
      </div>
    </div>
  );
}

function EducationPage() {
  const { selectedDistrict, selectedTa } = useDistrict();
  const [selectedPressureCategories, setSelectedPressureCategories] = useState(
    PRESSURE_FILTER_CATEGORIES,
  );
  const { contentRef, exportDataPdf } = usePdfExport("Education_Report.pdf");

  const educationSummary = useDashboardData(
    buildDashboardPath("/dashboard/education/summary", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "District",
    }),
  );
  const schoolLocations = useDashboardData(
    buildDashboardPath("/dashboard/education", {
      district: selectedDistrict,
    }),
  );
  const districtInsights = useDashboardData(
    buildDashboardPath("/dashboard/education/insights", {
      district: selectedDistrict,
    }),
  );
  const coverageFocusDistrict = selectedDistrict || "Zomba";
  const schoolAccessZones = useDashboardData(
    buildDashboardPath("/dashboard/education/access-zones/geojson", {
      district: coverageFocusDistrict,
      buffer_km: 5,
    }),
  );
  const educationIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: "District",
    }),
  );

  const formatStat = (value, digits = 0) => formatNumber(value, digits);
  const selectedAreaName = selectedTa
    ? `TA: ${selectedTa}`
    : selectedDistrict
      ? `District: ${selectedDistrict}`
      : "National";

  const handleDownloadReport = async () => {
    const selectedInsightRow = selectedInsight || {};
    const rows = [
      {
        metric: "Total Schools",
        value: formatStat(
          selectedInsightRow.school_count || educationSummary.data?.school_count || 0,
        ),
      },
      {
        metric: "Total Students",
        value: formatStat(
          selectedInsightRow.student_enrollment_total || educationSummary.data?.student_enrollment_total || 0,
        ),
      },
      {
        metric: "Total Teachers",
        value: formatStat(
          selectedInsightRow.teacher_count_total || educationSummary.data?.teacher_count_total || 0,
        ),
      },
      {
        metric: "School Age Population",
        value: formatStat(
          selectedInsightRow.school_age_population_total || educationSummary.data?.school_age_population_total || 0,
        ),
      },
      {
        metric: "Out-of-School Population",
        value: formatStat(
          selectedInsightRow.not_in_school_total || educationSummary.data?.not_in_school_total || 0,
        ),
      },
    ];

    await exportDataPdf({
      title: "Education Area Analysis",
      selectedArea: selectedAreaName,
      sections: [
        {
          title: "Education Summary",
          columns: [
            { key: "metric", label: "Metric", width: 260 },
            { key: "value", label: "Value", width: 180 },
          ],
          rows,
        },
      ],
    });
  };

  const allInsightRows = districtInsights.data?.all_districts || [];
  const insightRows = districtInsights.data?.districts || [];
  const benchmarkSummary = districtInsights.data?.summary || {};
  const visibleInsightSummary =
    districtInsights.data?.visible_summary || benchmarkSummary;
  const thresholds = districtInsights.data?.thresholds || {};
  const sourceInsightRows = allInsightRows.length ? allInsightRows : insightRows;
  const selectedInsight =
    selectedTa
      ? sourceInsightRows.find(
          (row) =>
            normalizeTaName(row.admin_unit_name) === normalizeTaName(selectedTa),
        ) || null
      : selectedDistrict
        ? insightRows[0] || null
        : null;
  const chartRows = sourceInsightRows.map(
    (row) => ({
      ...row,
      z: Math.max(Number(row.school_age_population_total || 0), 1),
      fill: getInsightColor(row.insight_label),
      isSelected: selectedTa
        ? normalizeTaName(row.admin_unit_name) === normalizeTaName(selectedTa)
        : selectedDistrict
          ? row.district.toLowerCase() === selectedDistrict.toLowerCase()
          : false,
    }),
  );
  const highlightedRows = selectedTa || selectedDistrict
    ? chartRows.filter((row) => row.isSelected)
    : [];

  const pressureByTaId = useMemo(() => {
    const lookup = new Map();
    const sourceRows = allInsightRows.length ? allInsightRows : insightRows;

    sourceRows.forEach((row) => {
      if (row.admin_unit_id === undefined || row.admin_unit_id === null) {
        return;
      }

      lookup.set(
        String(row.admin_unit_id),
        row.insight_label || "Balanced Capacity",
      );
    });

    return lookup;
  }, [allInsightRows, insightRows]);

  const schoolFeaturesWithPressure = useMemo(() => {
    const features = schoolLocations.data?.features || [];

    return features.map((feature) => {
      const taId =
        feature?.properties?.ta_id !== undefined &&
        feature?.properties?.ta_id !== null
          ? feature.properties.ta_id
          : feature?.properties?.ward_id;

      const pressureCategory =
        taId !== undefined && taId !== null && pressureByTaId.has(String(taId))
          ? pressureByTaId.get(String(taId))
          : "Unmapped";

      return {
        ...feature,
        properties: {
          ...feature.properties,
          pressure_category: pressureCategory,
        },
      };
    });
  }, [schoolLocations.data, pressureByTaId]);

  const pressureCategoryCounts = useMemo(() => {
    const counts = PRESSURE_FILTER_CATEGORIES.reduce(
      (accumulator, category) => {
        accumulator[category] = 0;
        return accumulator;
      },
      {},
    );

    schoolFeaturesWithPressure.forEach((feature) => {
      const category = feature?.properties?.pressure_category || "Unmapped";
      counts[category] = (counts[category] || 0) + 1;
    });

    return counts;
  }, [schoolFeaturesWithPressure]);

  const filteredSchoolFeatures = useMemo(() => {
    const selectedCategories = new Set(selectedPressureCategories);

    return schoolFeaturesWithPressure.filter((feature) =>
      selectedCategories.has(
        feature?.properties?.pressure_category || "Unmapped",
      ),
    );
  }, [schoolFeaturesWithPressure, selectedPressureCategories]);

  const schoolLocationsForMap = useMemo(() => {
    if (!schoolLocations.data) {
      return schoolLocations.data;
    }

    return {
      ...schoolLocations.data,
      features: filteredSchoolFeatures.length
        ? filteredSchoolFeatures
        : schoolFeaturesWithPressure,
    };
  }, [schoolLocations.data, filteredSchoolFeatures, schoolFeaturesWithPressure]);

  const togglePressureCategory = (category) => {
    setSelectedPressureCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };
  const sortedSignals = [...chartRows]
    .sort((left, right) => {
      if (left.insight_label !== right.insight_label) {
        return left.insight_label.localeCompare(right.insight_label);
      }

      if (left.insight_label === "Infrastructure Gap") {
        return left.schools_per_10k - right.schools_per_10k;
      }

      if (left.insight_label === "Overcrowding Risk") {
        return right.students_per_school - left.students_per_school;
      }

      if (left.insight_label === "Underutilized Schools") {
        return left.students_per_school - right.students_per_school;
      }

      return right.schools_per_10k - left.schools_per_10k;
    });
  const rankedSignals = selectedTa
    ? [
        ...highlightedRows,
        ...sortedSignals.filter((row) => !row.isSelected),
      ].slice(0, 6)
    : sortedSignals.slice(0, 6);
  const categoryPieData = [
    {
      name: "Infrastructure Gap",
      value: Number(benchmarkSummary.infrastructure_gap_count || 0),
    },
    {
      name: "Overcrowding Risk",
      value: Number(benchmarkSummary.overcrowding_risk_count || 0),
    },
    {
      name: "Underutilized Schools",
      value: Number(benchmarkSummary.underutilized_count || 0),
    },
    {
      name: "Balanced Capacity",
      value: Math.max(
        Number(benchmarkSummary.total_districts || 0) -
          Number(benchmarkSummary.infrastructure_gap_count || 0) -
          Number(benchmarkSummary.overcrowding_risk_count || 0) -
          Number(benchmarkSummary.underutilized_count || 0),
        0,
      ),
    },
  ]
    .filter((item) => item.value > 0)
    .map((item) => ({
      ...item,
      share: benchmarkSummary.total_districts
        ? (item.value / Number(benchmarkSummary.total_districts)) * 100
        : 0,
      color: getInsightColor(item.name),
    }));
  const insightColumns = [
    { key: "admin_unit_name", label: "TA" },
    { key: "district", label: "District" },
    {
      key: "classification_label",
      label: "Status",
      render: (value) => (
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getStatusBadgeClasses(value)}`}
        >
          {value}
        </span>
      ),
    },
    {
      key: "insight_label",
      label: "Insight",
      render: (value) => (
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${getInsightBadgeClasses(value)}`}
        >
          {value}
        </span>
      ),
    },
    { key: "school_count", label: "Schools", digits: 0 },
    { key: "schools_per_10k", label: "Schools / 10k", digits: 2 },
    { key: "schools_per_children", label: "Schools / Child", digits: 4 },
    { key: "students_per_school", label: "Students / School", digits: 0 },
  ];


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
      <div className="flex items-center gap-4 px-8 py-8 border-b border-gray-200">
        <GraduationCap className="h-8 w-8 text-black" />
        <h1 className="text-[28px] font-extrabold tracking-tight">EDUCATION</h1>
      </div>

      <div className="px-8 mt-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Education stats for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Education stats for ${selectedTa}`
              : "National Education Overview"}
        </p>

        <div className="flex gap-4 mb-6">
          <button
            onClick={handleDownloadReport}
            className="flex items-center gap-2 border border-gray-300 rounded px-3 py-1.5 text-[13px] font-bold hover:bg-gray-50 transition-all shadow-sm active:scale-95"
          >
            <Download className="h-4 w-4" />
            Download Area Analysis
          </button>
          <SharedDistrictSelector />

        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-6 mb-10">
          {educationSummary.loading
            ? [...Array(5)].map((_, index) => <StatCardSkeleton key={index} />)
            : [
                {
                  label: "Total Schools",
                  value: formatStat(
                    selectedInsight?.school_count ||
                      educationSummary.data?.school_count ||
                      0,
                  ),
                  icon: School,
                },
                {
                  label: "Total Enrollment",
                  value: formatStat(
                    selectedInsight?.student_enrollment_total ||
                      educationSummary.data?.student_enrollment_total ||
                      0,
                  ),
                  icon: Users,
                },
                {
                  label: "Teachers",
                  value: formatStat(
                    selectedInsight?.teacher_count_total ||
                      educationSummary.data?.teacher_count_total ||
                      0,
                  ),
                  icon: BookOpen,
                },
                {
                  label: "School-age Population",
                  value: formatStat(
                    selectedInsight?.school_age_population_total ||
                      educationSummary.data?.school_age_population_total ||
                      0,
                  ),
                  icon: UserRoundCheck,
                },
                {
                  label: "Not in School",
                  value: formatStat(
                    selectedInsight?.school_age_population_unenrolled ||
                      selectedInsight?.not_in_school_total ||
                      educationSummary.data?.not_in_school_total ||
                      0,
                  ),
                  icon: UserRoundX,
                },
              ].map((stat, index) => (
                <div
                  key={index}
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
            title="Integrated Education Context"
            subtitle="Education planning shown with linked beneficiary access, health reach, and flood-sensitive welfare context."
            loading={educationIntegration.loading}
            items={[
              {
                label: "Education Access",
                metrics: {
                  beneficiaries_with_school_access:
                    educationIntegration.data?.summary?.school_access_count || 0,
                  school_access_pct:
                    educationIntegration.data?.summary?.school_access_pct || 0,
                  school_age_unenrolled:
                    educationIntegration.data?.summary
                      ?.school_age_population_unenrolled || 0,
                },
              },
              {
                label: "Health Link",
                metrics: {
                  beneficiaries_with_health_access:
                    educationIntegration.data?.summary?.health_access_count || 0,
                  public_hospital_access:
                    educationIntegration.data?.summary
                      ?.public_hospital_access_count || 0,
                  private_hospital_access:
                    educationIntegration.data?.summary
                      ?.private_hospital_access_count || 0,
                },
              },
              {
                label: "Risk Link",
                metrics: {
                  flood_affected_beneficiaries:
                    educationIntegration.data?.summary?.flood_affected_count ||
                    0,
                  flood_affected_pct:
                    educationIntegration.data?.summary?.flood_affected_pct || 0,
                },
              },
            ]}
          />
        </div>

        <div className="mb-10 rounded border border-gray-100 bg-[#f8f8f3] p-6 shadow-sm">
          {selectedInsight ? (
            <p className="text-sm leading-7 text-gray-600">
              <span className="font-extrabold text-black">
                {selectedInsight.admin_unit_name}
              </span>{" "}
              in{" "}
              <span className="font-bold text-black">
                {selectedInsight.district}
              </span>{" "}
              is currently classified as{" "}
              <span className="font-bold text-black">
                {selectedInsight.classification_label}
              </span>
              . The generated insight is{" "}
              <span className="font-bold text-black">
                {selectedInsight.insight_label}
              </span>
              , based on{" "}
              <span className="font-bold text-black">
                {formatStat(selectedInsight.schools_per_10k, 2)}
              </span>{" "}
              schools per 10,000 residents and{" "}
              <span className="font-bold text-black">
                {formatStat(selectedInsight.students_per_school, 0)}
              </span>{" "}
              students per school.
            </p>
          ) : (
            <p className="text-sm leading-7 text-gray-600">
              TAs are benchmarked using schools per 10,000 residents, schools
              per school-age child, and students per school. The chart below
              shows where each TA sits in the pressure landscape so
              infrastructure gaps and overcrowding risks stand out immediately.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.55fr_0.75fr] gap-8 mb-10">
          {districtInsights.loading ? (
            <>
              <div className="h-[620px] animate-pulse rounded border border-gray-100 bg-gray-50" />
              <div className="h-[440px] animate-pulse rounded border border-gray-100 bg-gray-50" />
            </>
          ) : (
            <>
              <div className="space-y-8">
                <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
                  <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-[16px] font-extrabold">
                        TA Pressure Chart
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-gray-500">
                        Left means fewer schools per 10,000 people. Higher means
                        more students packed into each school. Bigger circles
                        indicate larger school-age populations for each TA.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      {[
                        "Infrastructure Gap",
                        "Overcrowding Risk",
                        "Underutilized Schools",
                        "Balanced Capacity",
                      ].map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-gray-600"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: getInsightColor(label) }}
                          />
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart
                        margin={{ top: 16, right: 18, left: 8, bottom: 24 }}
                      >
                        <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" />
                        <XAxis
                          type="number"
                          dataKey="schools_per_10k"
                          name="Schools / 10k"
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                          tickFormatter={(value) => formatNumber(value, 1)}
                        />
                        <YAxis
                          type="number"
                          dataKey="students_per_school"
                          name="Students / School"
                          axisLine={false}
                          tickLine={false}
                          tick={{
                            fill: "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                          tickFormatter={(value) => formatNumber(value, 0)}
                        />
                        <ZAxis type="number" dataKey="z" range={[70, 420]} />
                        <Tooltip
                          content={<EducationScatterTooltip />}
                          cursor={{ strokeDasharray: "4 4" }}
                        />
                        <ReferenceLine
                          x={Number(thresholds.schools_per_10k_low || 0)}
                          stroke="#dc2626"
                          strokeDasharray="5 5"
                        />
                        <ReferenceLine
                          y={Number(thresholds.students_per_school_high || 0)}
                          stroke="#d97706"
                          strokeDasharray="5 5"
                        />
                        <Scatter data={chartRows}>
                          {chartRows.map((row) => (
                            <Cell
                              key={`education-scatter-${row.admin_unit_id}`}
                              fill={row.fill}
                              stroke={row.isSelected ? "#111827" : "#ffffff"}
                              strokeWidth={row.isSelected ? 2.5 : 1}
                              fillOpacity={
                                selectedTa && !row.isSelected
                                  ? 0.24
                                  : row.isSelected
                                    ? 1
                                    : 0.82
                              }
                            />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-semibold text-gray-500">
                    <div className="rounded border border-red-100 bg-red-50 px-3 py-2">
                      Low access threshold:{" "}
                      {formatStat(thresholds.schools_per_10k_low || 0, 2)}{" "}
                      schools / 10k
                    </div>
                    <div className="rounded border border-amber-100 bg-amber-50 px-3 py-2">
                      High crowding threshold:{" "}
                      {formatStat(thresholds.students_per_school_high || 0, 0)}{" "}
                      students / school
                    </div>
                  </div>
                </div>

                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-[16px] font-extrabold">Pressure Mix</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-500">
                      A quick distribution of how TAs are currently classified
                      across the four pressure categories.
                    </p>
                  </div>
                </div>

                <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryPieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={62}
                          outerRadius={96}
                          paddingAngle={4}
                          dataKey="value"
                          nameKey="name"
                        >
                          {categoryPieData.map((row) => (
                            <Cell
                              key={`education-pie-${row.name}`}
                              fill={row.color}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<EducationCategoryPieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {categoryPieData.map((row) => (
                      <div
                        key={`education-pie-legend-${row.name}`}
                        className="rounded border border-gray-100 bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          <span className="text-sm font-bold text-black">
                            {row.name}
                          </span>
                          <span className="ml-auto text-sm font-extrabold text-black">
                            {formatStat(row.value, 0)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-gray-500">
                          {formatStat(row.share, 1)}% of TAs
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="border border-gray-100 rounded p-8 shadow-sm bg-white">
                <h3 className="text-[16px] font-extrabold">Signal Board</h3>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  The strongest flagged TAs from the current benchmark.
                </p>

                <div className="mt-6 space-y-3">
                  {rankedSignals.map((row) => (
                    <div
                      key={`signal-${row.admin_unit_id}`}
                      className={`rounded border px-4 py-4 ${row.isSelected ? "border-black bg-gray-50" : "border-gray-100 bg-white"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-extrabold text-black">
                            {formatAdminUnitAxisLabel(row.admin_unit_name)}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-gray-500">
                            {row.district}
                          </div>
                          <div className="mt-2">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${getInsightBadgeClasses(row.insight_label)}`}
                            >
                              {row.insight_label}
                            </span>
                          </div>
                        </div>
                        {row.isSelected ? (
                          <span className="rounded-full bg-black px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white">
                            Selected
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-gray-400 font-bold uppercase tracking-[0.12em] text-[10px]">
                            Schools / 10k
                          </div>
                          <div className="mt-1 font-extrabold text-black">
                            {formatStat(row.schools_per_10k, 2)}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-400 font-bold uppercase tracking-[0.12em] text-[10px]">
                            Students / School
                          </div>
                          <div className="mt-1 font-extrabold text-black">
                            {formatStat(row.students_per_school, 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="rounded border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-500">
                    National mix:{" "}
                    {formatStat(
                      benchmarkSummary.infrastructure_gap_count || 0,
                      0,
                    )}{" "}
                    infrastructure gap,{" "}
                    {formatStat(
                      benchmarkSummary.overcrowding_risk_count || 0,
                      0,
                    )}{" "}
                    overcrowding risk,{" "}
                    {formatStat(benchmarkSummary.underutilized_count || 0, 0)}{" "}
                    underutilized,{" "}
                    {formatStat(benchmarkSummary.adequate_count || 0, 0)}{" "}
                    adequate.
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold">
              School Infrastructure Mapping
            </h3>
            <p className="mt-2 text-sm text-gray-500 font-semibold">
              Filter schools by TA pressure category
            </p>

            <div className="mt-4 mb-5 flex flex-wrap gap-2">
              {PRESSURE_FILTER_CATEGORIES.map((category) => {
                const isSelected =
                  selectedPressureCategories.includes(category);
                return (
                  <label
                    key={`pressure-filter-${category}`}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => togglePressureCategory(category)}
                      className="sr-only"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        backgroundColor: getPressureCategoryColor(category),
                      }}
                    />
                    <span>{category}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                        isSelected ? "bg-white/20" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {pressureCategoryCounts[category] || 0}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
              {schoolLocations.loading ? (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                  <span className="text-gray-400 font-bold uppercase tracking-widest">
                    Loading Schools...
                  </span>
                </div>
              ) : (
                <MapPanel
                  geojson={schoolLocationsForMap}
                  loading={schoolLocations.loading}
                  pointColor="#2563eb"
                  pointColorResolver={(feature) =>
                    getPressureCategoryColor(
                      feature?.properties?.pressure_category,
                    )
                  }
                  popupFields={[
                    { key: "student_enrollment", label: "Enrollment" },
                    { key: "teacher_distribution", label: "Teachers" },
                    { key: "operator_type", label: "Operator" },
                    { key: "pressure_category", label: "Pressure Category" },
                  ]}
                  tooltipFields={[
                    { key: "student_enrollment", label: "Enrollment" },
                    { key: "teacher_distribution", label: "Teachers" },
                    { key: "pressure_category", label: "Pressure" },
                  ]}
                  showLegend={false}
                  showLabels={false}
                  heightClass="h-full w-full"
                />
              )}
            </div>
          </div>

          <div className="h-[600px] rounded border border-gray-100 bg-white p-8 shadow-sm flex flex-col">
            <h3 className="text-[16px] font-extrabold">
              School Access Zones (within 5km)
            </h3>
            <p className="mt-2 text-sm text-gray-500 font-semibold">
              Actual {coverageFocusDistrict} district shape with schools
              overlaid. Green areas are within 5km of a school; red areas
              indicate no access.
            </p>

            {schoolAccessZones.error ? (
              <div className="mt-4 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                Could not load coverage map data: {schoolAccessZones.error}
              </div>
            ) : null}

            <div className="mt-5 flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
              <CoverageShapePanel
                geojson={schoolAccessZones.data}
                heightClass="h-full w-full"
                loading={schoolAccessZones.loading}
                pointLabel="School Point"
              />
            </div>
          </div>
        </div>

        <div className="mt-8 border border-gray-100 rounded p-8 shadow-sm bg-white">
          {districtInsights.loading ? (
            <div className="h-[280px] w-full animate-pulse rounded bg-gray-50" />
          ) : (
            <DataTable
              title={
                selectedDistrict
                  ? `${selectedDistrict} TA education insights`
                  : "TA education insights"
              }
              subtitle={
                selectedDistrict
                  ? "Showing current TA classifications inside the selected district against the same benchmark."
                  : `Underserved: ${visibleInsightSummary.underserved_count || 0}, Overcrowded: ${visibleInsightSummary.overcrowded_count || 0}, Underutilized: ${visibleInsightSummary.underutilized_count || 0}.`
              }
              rows={insightRows}
              columns={insightColumns}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default EducationPage;
