import {
  GraduationCap,
  Users,
  School,
  BookOpen,
  Download,
  UserRoundCheck,
  UserRoundX,
  Flame,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  TrendingUp,
  ShieldAlert,
  Lightbulb,
} from "lucide-react";
import { useMemo, useState } from "react";
import DataTable from "../components/DataTable";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDistrict } from "../context/DistrictContext";
import { usePdfExport } from "../hooks/usePdfExport";
import { formatNumber } from "../lib/format";
import { buildDashboardPath } from "../lib/query";
import MapPanel from "../components/MapPanel";
import IntegrationSummaryPanel from "../components/IntegrationSummaryPanel";
import SharedDistrictSelector from "../components/SharedDistrictSelector";
import PopulationRasterPanel from "../components/PopulationRasterPanel";
import InteractiveRecommendations from "../components/InteractiveRecommendations";
import {
  Bar,
  BarChart,
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

// ── School-level risk thresholds (national standards) ──────────────────
// Teacher : student  1 : 60  → teacher_ratio > 60 = overcrowding
// Classroom : student 1 : 40 → classroom_ratio > 40 = infrastructure gap
const TEACHER_RATIO_THRESHOLD   = 60;
const CLASSROOM_RATIO_THRESHOLD = 40;

// Per-school risk categories (distinct from TA-level pressure categories)
const SCHOOL_RISK_CATEGORIES = [
  "Overcrowding Risk",   // teacher ratio exceeded
  "Infrastructure Gap",  // classroom ratio exceeded
  "Both Risks",          // both exceeded
  "OK",
];

const SCHOOL_RISK_COLORS = {
  "Overcrowding Risk":  "#f59e0b",  // amber
  "Infrastructure Gap": "#dc2626",  // red
  "Both Risks":         "#7c3aed",  // purple
  "OK":                 "#22c55e",  // green
};

function classifySchoolRisk(properties) {
  const enrollment = Number(properties?.student_enrollment_total || 0);
  const teachers   = Number(properties?.teacher_count ?? properties?.teacher_distribution ?? 0);
  const classrooms = Number(properties?.blocks_count ?? 0);

  if (enrollment === 0) return "OK";

  const teacherRatio   = teachers   > 0 ? enrollment / teachers   : Infinity;
  const classroomRatio = classrooms > 0 ? enrollment / classrooms : Infinity;

  const teacherRisk   = teacherRatio   > TEACHER_RATIO_THRESHOLD;
  const classroomRisk = classroomRatio > CLASSROOM_RATIO_THRESHOLD;

  if (teacherRisk && classroomRisk) return "Both Risks";
  if (classroomRisk)                return "Infrastructure Gap";
  if (teacherRisk)                  return "Overcrowding Risk";
  return "OK";
}

function getSchoolRiskColor(riskCategory) {
  return SCHOOL_RISK_COLORS[riskCategory] || SCHOOL_RISK_COLORS["OK"];
}

function getSchoolRiskBadgeClasses(riskCategory) {
  const map = {
    "Overcrowding Risk":  "border border-amber-200 bg-amber-50 text-amber-700",
    "Infrastructure Gap": "border border-red-200 bg-red-50 text-red-700",
    "Both Risks":         "border border-purple-200 bg-purple-50 text-purple-700",
    "OK":                 "border border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return map[riskCategory] || map["OK"];
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

function getEducationRasterAsset(assets, key) {
  return assets?.[key] || "/worldpop/zomba_ppp_2020.preview.json";
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
  const [selectedSchoolRiskCategories, setSelectedSchoolRiskCategories] = useState(
    SCHOOL_RISK_CATEGORIES,
  );
  const [riskTableSort, setRiskTableSort] = useState({ key: "teacher_ratio", dir: "desc" });
  const { contentRef, exportPdf } = usePdfExport("Education_Report.pdf");

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
  const educationIntegration = useDashboardData(
    buildDashboardPath("/dashboard/welfare/integration", {
      district: selectedDistrict,
      admin_type: "District",
    }),
  );
  const educationRasterMetadata = useDashboardData(
    buildDashboardPath("/dashboard/education/raster-metadata", {
      district: coverageFocusDistrict,
    }),
  );
  const educationCoverageTaGeojson = useDashboardData(
    buildDashboardPath("/dashboard/analysis/geojson", {
      analysis_type: "education_summary",
      admin_type: "TA",
      metric_name: "school_age_population_total",
      district: selectedDistrict,
    }),
  );

  const floodImpact = useDashboardData(
    buildDashboardPath("/dashboard/education/flood-impact", {
      district: coverageFocusDistrict,
    }),
  );
  const floodImpactGeojson = useDashboardData(
    buildDashboardPath("/dashboard/education/flood-impact/geojson", {
      district: coverageFocusDistrict,
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

      // Per-school risk classification using national thresholds
      const riskCategory = classifySchoolRisk(feature?.properties);

      return {
        ...feature,
        properties: {
          ...feature.properties,
          pressure_category: pressureCategory,
          risk_category: riskCategory,
        },
      };
    });
  }, [schoolLocations.data, pressureByTaId]);

  // At-risk schools for the table (all except "OK")
  const atRiskSchools = useMemo(() => {
    return schoolFeaturesWithPressure
      .filter(f => f.properties.risk_category !== "OK")
      .map(f => {
        const p = f.properties;
        const enrollment  = Number(p.student_enrollment_total || 0);
        const teachers    = Number(p.teacher_count ?? p.teacher_distribution ?? 0);
        const classrooms  = Number(p.blocks_count ?? 0);
        return {
          school_id:      p.school_id,
          school_name:    p.school_name || "Unknown",
          risk_category:  p.risk_category,
          enrollment,
          teacher_ratio:  teachers   > 0 ? Math.round(enrollment / teachers)   : null,
          classroom_ratio: classrooms > 0 ? Math.round(enrollment / classrooms) : null,
          operator:       p.operator_type || p.operator || "—",
        };
      });
  }, [schoolFeaturesWithPressure]);

  const sortedAtRiskSchools = useMemo(() => {
    const { key, dir } = riskTableSort;
    return [...atRiskSchools].sort((a, b) => {
      const av = a[key] ?? -Infinity;
      const bv = b[key] ?? -Infinity;
      if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === "asc" ? av - bv : bv - av;
    });
  }, [atRiskSchools, riskTableSort]);

  const schoolRiskCounts = useMemo(() => {
    const counts = Object.fromEntries(SCHOOL_RISK_CATEGORIES.map(c => [c, 0]));
    schoolFeaturesWithPressure.forEach(f => {
      const cat = f.properties.risk_category;
      if (counts[cat] !== undefined) counts[cat]++;
    });
    return counts;
  }, [schoolFeaturesWithPressure]);

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
    const selectedCategories = new Set(selectedSchoolRiskCategories);
    return schoolFeaturesWithPressure.filter((feature) =>
      selectedCategories.has(feature?.properties?.risk_category || "OK"),
    );
  }, [schoolFeaturesWithPressure, selectedSchoolRiskCategories]);

  const schoolLocationsForMap = useMemo(() => {
    if (!schoolLocations.data) return schoolLocations.data;
    return {
      ...schoolLocations.data,
      features: filteredSchoolFeatures.length
        ? filteredSchoolFeatures
        : schoolFeaturesWithPressure,
    };
  }, [schoolLocations.data, filteredSchoolFeatures, schoolFeaturesWithPressure]);

  const toggleSchoolRiskCategory = (category) => {
    setSelectedSchoolRiskCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const handleRiskTableSort = (key) => {
    setRiskTableSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" }
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
          {/* ── School Infrastructure Map ─────────────────────────── */}
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold">
              School Infrastructure Mapping
            </h3>
            <p className="mt-1 text-sm text-gray-500 font-semibold">
              Coloured by per-school risk · teacher 1:60 · classroom 1:40
            </p>

            {/* Risk filter chips */}
            <div className="mt-4 mb-4 flex flex-wrap gap-2">
              {SCHOOL_RISK_CATEGORIES.map((category) => {
                const isSelected = selectedSchoolRiskCategories.includes(category);
                return (
                  <label
                    key={`risk-filter-${category}`}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSchoolRiskCategory(category)}
                      className="sr-only"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getSchoolRiskColor(category) }}
                    />
                    <span>{category}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isSelected ? "bg-white/20" : "bg-gray-100 text-gray-500"}`}>
                      {schoolRiskCounts[category] || 0}
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
                  pointColor={SCHOOL_RISK_COLORS["OK"]}
                  pointColorResolver={(feature) =>
                    getSchoolRiskColor(feature?.properties?.risk_category)
                  }
                  popupFields={[
                    { key: "student_enrollment_total", label: "Enrollment" },
                    { key: "teacher_count", label: "Teachers" },
                    { key: "blocks_count", label: "Classrooms" },
                    { key: "risk_category", label: "Risk" },
                    { key: "operator_type", label: "Operator" },
                  ]}
                  tooltipFields={[
                    { key: "student_enrollment_total", label: "Enrollment" },
                    { key: "risk_category", label: "Risk" },
                  ]}
                  showLegend={false}
                  showLabels={false}
                  heightClass="h-full"
                />
              )}
            </div>
          </div>

          {/* ── At-Risk Schools Table ─────────────────────────────── */}
          <div className="border border-gray-100 rounded p-8 shadow-sm bg-white h-[600px] flex flex-col">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h3 className="text-[16px] font-extrabold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  At-Risk Schools
                </h3>
                <p className="mt-1 text-sm text-gray-500 font-semibold">
                  Schools exceeding national teacher or classroom thresholds
                </p>
              </div>
              <span className="flex-shrink-0 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-bold text-red-700">
                {atRiskSchools.length} flagged
              </span>
            </div>

            {/* Summary badges */}
            <div className="mt-3 mb-4 flex flex-wrap gap-2">
              {SCHOOL_RISK_CATEGORIES.filter(c => c !== "OK").map(cat => (
                <span
                  key={cat}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${getSchoolRiskBadgeClasses(cat)}`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getSchoolRiskColor(cat) }} />
                  {cat}: {schoolRiskCounts[cat] || 0}
                </span>
              ))}
            </div>

            {/* Sortable table */}
            <div className="flex-1 overflow-auto">
              {schoolLocations.loading ? (
                <div className="h-full flex items-center justify-center animate-pulse">
                  <span className="text-gray-400 font-bold uppercase tracking-widest text-xs">Loading...</span>
                </div>
              ) : atRiskSchools.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-gray-400 font-semibold">
                  No at-risk schools found for this filter.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="border-b border-gray-100">
                      {[
                        { key: "school_name",    label: "School" },
                        { key: "risk_category",  label: "Risk" },
                        { key: "enrollment",     label: "Enroll." },
                        { key: "teacher_ratio",  label: "Pupils/Teacher" },
                        { key: "classroom_ratio",label: "Pupils/Class" },
                      ].map(col => (
                        <th
                          key={col.key}
                          onClick={() => handleRiskTableSort(col.key)}
                          className="py-2 px-2 text-left font-bold text-gray-400 uppercase tracking-wide cursor-pointer hover:text-black select-none whitespace-nowrap"
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {riskTableSort.key === col.key
                              ? riskTableSort.dir === "asc"
                                ? <ChevronUp className="h-3 w-3" />
                                : <ChevronDown className="h-3 w-3" />
                              : <ChevronDown className="h-3 w-3 opacity-20" />}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAtRiskSchools.map((school, i) => (
                      <tr
                        key={school.school_id ?? i}
                        className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-2 px-2 font-semibold text-black max-w-[140px] truncate" title={school.school_name}>
                          {school.school_name}
                        </td>
                        <td className="py-2 px-2">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${getSchoolRiskBadgeClasses(school.risk_category)}`}>
                            {school.risk_category}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-gray-600 font-semibold">
                          {school.enrollment > 0 ? school.enrollment.toLocaleString() : "—"}
                        </td>
                        <td className={`py-2 px-2 font-bold ${school.teacher_ratio > TEACHER_RATIO_THRESHOLD ? "text-amber-600" : "text-gray-500"}`}>
                          {school.teacher_ratio != null ? `1:${school.teacher_ratio}` : "—"}
                        </td>
                        <td className={`py-2 px-2 font-bold ${school.classroom_ratio > CLASSROOM_RATIO_THRESHOLD ? "text-red-600" : "text-gray-500"}`}>
                          {school.classroom_ratio != null ? `1:${school.classroom_ratio}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Threshold legend */}
            <div className="mt-3 pt-3 border-t border-gray-100 flex gap-4 text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              <span className="text-amber-600">Pupils/Teacher &gt; {TEACHER_RATIO_THRESHOLD} = Overcrowding</span>
              <span className="text-red-600">Pupils/Class &gt; {CLASSROOM_RATIO_THRESHOLD} = Infra Gap</span>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-[16px] font-extrabold">Education Access Raster</h3>
          <p className="mt-2 text-sm text-gray-500 font-semibold">
            High-resolution service coverage and travel-distance surfaces derived from school locations and beneficiary routing.
          </p>
          <div className="mt-5 grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={educationCoverageTaGeojson.data}
                pointsGeojson={schoolLocations.data}
                title="School Service Coverage (5 km)"
                subtitle="Population served within 5 km of the nearest school."
                metadataUrl={getEducationRasterAsset(
                  educationRasterMetadata.data?.assets,
                  "education_buffer_coverage",
                )}
                heightClass="h-[320px]"
                loading={
                  educationCoverageTaGeojson.loading ||
                  educationRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
              />
            </div>
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={educationCoverageTaGeojson.data}
                pointsGeojson={schoolLocations.data}
                title="Road Distance to Nearest School"
                subtitle="Average beneficiary road distance (km) by area."
                metadataUrl={getEducationRasterAsset(
                  educationRasterMetadata.data?.assets,
                  "education_network_distance",
                )}
                heightClass="h-[320px]"
                loading={
                  educationCoverageTaGeojson.loading ||
                  educationRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
              />
            </div>
            <div className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <PopulationRasterPanel
                geojson={educationCoverageTaGeojson.data}
                pointsGeojson={schoolLocations.data}
                title="Travel Time to Nearest School"
                subtitle="Average beneficiary travel time (minutes) by area."
                metadataUrl={getEducationRasterAsset(
                  educationRasterMetadata.data?.assets,
                  "education_travel_time",
                )}
                heightClass="h-[320px]"
                loading={
                  educationCoverageTaGeojson.loading ||
                  educationRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
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

        {/* ── Planning Recommendations ─────────────────────────────── */}
        <PlanningRecommendations
          districtInsights={districtInsights}
          floodImpact={floodImpact}
          educationSummary={educationSummary}
          selectedDistrict={selectedDistrict}
        />

        {/* ── Flood Impact on Schools ─────────────────────────────────── */}
        <FloodImpactSection
          floodImpact={floodImpact}
          floodImpactGeojson={floodImpactGeojson}
          coverageFocusDistrict={coverageFocusDistrict}
        />
      </div>
    </div>
  );
}

/* ─── Planning Recommendations ────────────────────────────────────────── */
function PlanningRecommendations({ districtInsights, floodImpact, educationSummary, selectedDistrict }) {
  const summary      = districtInsights.data?.summary || {};
  const thresholds   = districtInsights.data?.thresholds || {};
  const allRows      = districtInsights.data?.all_districts || districtInsights.data?.districts || [];
  const floodSummary = floodImpact.data?.summary || {};
  const eduSummary   = educationSummary.data || {};

  const loading = districtInsights.loading || floodImpact.loading || educationSummary.loading;

  // Derive key numbers
  const infraGapTAs      = allRows.filter(r => r.insight === "infrastructure gap");
  const overcrowdingTAs  = allRows.filter(r => r.insight === "overcrowding risk");
  const underutilizedTAs = allRows.filter(r => r.insight === "underutilized schools");
  const worstInfra       = [...infraGapTAs].sort((a,b) => a.schools_per_10k - b.schools_per_10k)[0];
  const worstCrowd       = [...overcrowdingTAs].sort((a,b) => b.students_per_school - a.students_per_school)[0];
  const teacherRatio     = eduSummary.teacher_count_total > 0
    ? Math.round(eduSummary.student_enrollment_total / eduSummary.teacher_count_total)
    : null;
  const classroomRatio   = null; // not in summary endpoint, derived from school-level

  const recommendations = [
    // 1 — Infrastructure gaps
    infraGapTAs.length > 0 && {
      priority: "high",
      icon: School,
      title: "New School Construction Needed",
      body: `${infraGapTAs.length} TA${infraGapTAs.length > 1 ? "s" : ""} fall below the minimum school density threshold of ${formatNumber(thresholds.schools_per_10k_low, 1)} schools per 10,000 residents.${worstInfra ? ` ${worstInfra.admin_unit_name} is the most underserved at ${formatNumber(worstInfra.schools_per_10k, 1)} schools/10k with a population of ${formatNumber(worstInfra.population_total, 0)}.` : ""} Prioritise capital investment in these areas.`,
      action: "Target capital budget for school construction in flagged TAs",
    },
    // 2 — Overcrowding
    overcrowdingTAs.length > 0 && {
      priority: "high",
      icon: Users,
      title: "Classroom Expansion Required",
      body: `${overcrowdingTAs.length} TA${overcrowdingTAs.length > 1 ? "s" : ""} exceed the overcrowding threshold of ${formatNumber(thresholds.students_per_school_high, 0)} students per school.${worstCrowd ? ` ${worstCrowd.admin_unit_name} averages ${formatNumber(worstCrowd.students_per_school, 0)} students per school.` : ""} Additional classrooms or satellite schools are needed to reduce pressure.`,
      action: "Commission classroom block additions in overcrowded TAs",
    },
    // 3 — Teacher ratio
    teacherRatio !== null && teacherRatio > 60 && {
      priority: "high",
      icon: BookOpen,
      title: "Teacher Recruitment Urgently Needed",
      body: `The district-wide teacher-to-student ratio is 1:${teacherRatio}, exceeding the national standard of 1:60. This affects learning quality across all schools. Targeted recruitment and deployment to high-pressure TAs should be prioritised.`,
      action: "Increase teacher recruitment and redistribute existing staff to high-ratio schools",
    },
    // 4 — Underutilised schools
    underutilizedTAs.length > 0 && {
      priority: "medium",
      icon: TrendingUp,
      title: "Optimise Underutilised School Capacity",
      body: `${underutilizedTAs.length} TA${underutilizedTAs.length > 1 ? "s" : ""} have schools operating well below capacity. Before building new schools, consider redistribution of students from overcrowded neighbouring TAs or repurposing spare capacity for adult literacy or vocational programmes.`,
      action: "Map underutilised schools against overcrowded neighbours for redistribution planning",
    },
    // 5 — Flood risk
    floodSummary.exposed_schools > 0 && {
      priority: "high",
      icon: ShieldAlert,
      title: "Flood-Resilient School Infrastructure",
      body: `${floodSummary.exposed_schools} schools with ${formatNumber(floodSummary.students_at_risk, 0)} enrolled students sit within flood-exposed zones. All are currently classified as low-risk, but infrastructure investment in these schools should include flood-resilient design standards and contingency relocation plans.`,
      action: "Integrate flood-resilient construction standards for all schools in Ta Mwambo and adjacent flood zones",
    },
    // 6 — Out-of-school children
    eduSummary.not_in_school_total > 0 && {
      priority: "medium",
      icon: UserRoundX,
      title: "Address Out-of-School Children",
      body: `An estimated ${formatNumber(eduSummary.not_in_school_total, 0)} school-age children are not enrolled. This gap is largest in TAs with infrastructure deficits, suggesting access barriers rather than demand issues. Community outreach combined with school construction will be most effective.`,
      action: "Combine school construction with targeted enrolment drives in underserved TAs",
    },
    // 7 — Cross-sector welfare link
    {
      priority: "low",
      icon: Lightbulb,
      title: "Link Education Planning to Welfare Data",
      body: `The integrated welfare context shows flood-affected beneficiaries and school-age unenrolled populations overlap significantly. Social cash transfer programmes should include school attendance conditionality to improve enrolment in high-poverty, low-access TAs.`,
      action: "Introduce school attendance conditionality in social protection programmes for targeted TAs",
    },
  ].filter(Boolean);

  const priorityConfig = {
    high:   { label: "High Priority",   classes: "bg-red-50 border-red-200 text-red-700",    dot: "bg-red-500"    },
    medium: { label: "Medium Priority", classes: "bg-amber-50 border-amber-200 text-amber-700", dot: "bg-amber-500" },
    low:    { label: "Planning Note",   classes: "bg-blue-50 border-blue-200 text-blue-700",  dot: "bg-blue-500"   },
  };

  if (loading) {
    return (
      <div className="mt-10">
        <div className="h-6 w-64 bg-gray-100 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded border border-gray-100 bg-gray-50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 relative z-10">
      <div className="flex items-center gap-3 mb-2">
        <Lightbulb className="h-5 w-5 text-amber-500" />
        <h3 className="text-[16px] font-extrabold">Planning Recommendations</h3>
      </div>
      <p className="text-sm text-gray-500 font-semibold mb-6">
        Data-driven actions derived from the infrastructure mapping, pressure analysis, and flood exposure above.
        {selectedDistrict ? ` Scoped to ${selectedDistrict}.` : " Covering all districts."}
      </p>

      <InteractiveRecommendations
        recommendations={recommendations}
        priorityConfig={priorityConfig}
        sectionKey={`education:${selectedDistrict || "all"}`}
      />
    </div>
  );
}

/* ─── Risk colour helpers ──────────────────────────────────────────────── */
const RISK_COLORS = { high: "#dc2626", medium: "#f59e0b", low: "#3b82f6", none: "#94a3b8" };
function riskColor(cls) { return RISK_COLORS[cls] || RISK_COLORS.none; }

function riskBadge(cls) {
  const map = {
    high:   "bg-red-50 text-red-700 border-red-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low:    "bg-blue-50 text-blue-700 border-blue-200",
  };
  return map[cls] || "bg-gray-50 text-gray-600 border-gray-200";
}

/* ─── Custom tooltip for the bar chart ────────────────────────────────── */
function FloodBarTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-gray-200 bg-white px-4 py-3 shadow-lg text-xs">
      <p className="font-extrabold text-black mb-1">{d.ta_name}</p>
      <p className="text-gray-500">{d.district_name}</p>
      <div className="mt-2 space-y-1">
        <p><span className="font-bold text-red-600">{formatNumber(d.high_risk_students, 0)}</span> high-risk students</p>
        <p><span className="font-bold text-amber-500">{formatNumber(d.medium_risk_students, 0)}</span> medium-risk students</p>
        <p><span className="font-bold text-blue-500">{formatNumber(d.low_risk_students, 0)}</span> low-risk students</p>
        <p className="pt-1 border-t border-gray-100 font-bold text-black">{formatNumber(d.students_at_risk, 0)} total at risk</p>
        <p className="text-gray-400">{formatNumber(d.exposed_schools, 0)} exposed schools</p>
      </div>
    </div>
  );
}

/* ─── Flood map: raster base + coloured school points ─────────────────── */
function FloodImpactMap({ geojson, loading, coverageFocusDistrict }) {
  const taGeojson = useMemo(() => {
    const features = (geojson?.features || []).filter(
      f => f.properties?.feature_kind === "ta"
    );
    return { type: "FeatureCollection", features };
  }, [geojson]);

  const schoolGeojson = useMemo(() => {
    const features = (geojson?.features || []).filter(
      f => f.properties?.feature_kind === "school"
    );
    return { type: "FeatureCollection", features };
  }, [geojson]);

  const districtSlug = (coverageFocusDistrict || "zomba")
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/[()]/g, "");

  const rasterMetadataUrl = `/worldpop/flood_risk_${districtSlug}.preview.json`;

  return (
    <div className="h-[420px] rounded overflow-hidden border border-gray-100">
      <PopulationRasterPanel
        geojson={taGeojson}
        pointsGeojson={schoolGeojson}
        metadataUrl={rasterMetadataUrl}
        heightClass="h-full w-full"
        loading={loading}
        featureNameResolver={f => f?.properties?.ta_name || null}
        customTooltipMetrics={[
          { label: "Students at Risk", key: "students_at_risk", format: "number" },
          { label: "Exposed Schools",  key: "exposed_schools",  format: "number" },
        ]}
      />
    </div>
  );
}

/* ─── Main flood section ───────────────────────────────────────────────── */
function FloodImpactSection({ floodImpact, floodImpactGeojson, coverageFocusDistrict }) {
  const summary = floodImpact.data?.summary || {};
  const taRows  = floodImpact.data?.ta_breakdown || [];

  // Top 12 TAs for the bar chart, stacked by risk class
  const chartData = useMemo(() =>
    taRows.slice(0, 12).map(r => ({
      ta_name:              r.ta_name,
      district_name:        r.district_name,
      students_at_risk:     Number(r.students_at_risk    || 0),
      high_risk_students:   Number(r.high_risk_students  || 0),
      medium_risk_students: Number(r.medium_risk_students|| 0),
      low_risk_students:    Number(r.low_risk_students   || 0),
      exposed_schools:      Number(r.exposed_schools     || 0),
    })),
  [taRows]);

  const kpis = [
    { label: "Number Exposed",         value: formatNumber(summary.exposed_schools  || 0, 0), color: "text-red-600"  },
    { label: "Total Students Impacted", value: formatNumber(summary.students_at_risk || 0, 0), color: "text-blue-600" },
  ];

  const hasFloodData =
    Number(summary.exposed_schools || 0) > 0 ||
    Number(summary.students_at_risk || 0) > 0 ||
    taRows.length > 0 ||
    (Array.isArray(floodImpactGeojson.data?.features) &&
      floodImpactGeojson.data.features.length > 0);

  if (!floodImpact.loading && !floodImpactGeojson.loading && !hasFloodData) {
    return (
      <div className="mt-10 relative z-0 rounded border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Flame className="h-5 w-5 text-red-500" />
          <h3 className="text-[16px] font-extrabold">Flood Impact on Schools</h3>
        </div>
        <p className="mt-3 text-sm font-semibold text-gray-500">
          No flood-impact records are available for the current district filter.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10 relative z-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Flame className="h-5 w-5 text-red-500" />
        <h3 className="text-[16px] font-extrabold">Flood Impact on Schools</h3>
      </div>
      <p className="text-sm text-gray-500 font-semibold mb-6">
        Schools and enrolled students at risk from flood exposure in{" "}
        <span className="text-black">{coverageFocusDistrict}</span>. Points show
        individual exposed schools coloured by risk class; TAs are shaded by
        total students at risk.
      </p>

      {/* KPI strip */}
      {floodImpact.loading ? (
        <div className="grid grid-cols-2 gap-4 mb-8">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded border border-gray-100 bg-gray-50" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 mb-8">
          {kpis.map(kpi => (
            <div key={kpi.label} className="border border-gray-100 rounded p-4 shadow-sm bg-white">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{kpi.label}</p>
              <p className={`mt-2 text-[26px] font-extrabold tracking-tight ${kpi.color}`}>{kpi.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Map + chart split */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        {/* Map */}
        <div className="relative isolate border border-gray-100 rounded p-4 shadow-sm bg-white">
          <p className="text-[13px] font-extrabold mb-3">Flood Exposure Map</p>
          <div className="flex gap-4 mb-3 flex-wrap">
            {[["high","High Risk","#dc2626"],["medium","Medium Risk","#f59e0b"],["low","Low Risk","#3b82f6"]].map(([,label,color]) => (
              <span key={label} className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-sm" style={{ background: color }} />
                {label}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500">
              <span className="inline-block h-3 w-5 rounded-sm" style={{ background: "linear-gradient(90deg,#f3f4f6,#b91c1c)" }} />
              Students at risk (TA shade)
            </span>
          </div>
          <FloodImpactMap
            geojson={floodImpactGeojson.data}
            loading={floodImpactGeojson.loading}
            coverageFocusDistrict={coverageFocusDistrict}
          />
        </div>

        {/* Stacked bar chart */}
        <div className="relative isolate border border-gray-100 rounded p-4 shadow-sm bg-white">
          <p className="text-[13px] font-extrabold mb-1">Top TAs by Students at Risk</p>
          <p className="text-[11px] text-gray-400 font-semibold mb-4">Stacked by flood risk class</p>
          {floodImpact.loading ? (
            <div className="h-[380px] animate-pulse rounded bg-gray-50" />
          ) : chartData.length === 0 ? (
            <div className="h-[380px] flex items-center justify-center text-sm text-gray-400 font-semibold">
              No data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={380}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 10, fontWeight: 700 }}
                  tickFormatter={v => formatNumber(v, 0)}
                />
                <YAxis
                  type="category"
                  dataKey="ta_name"
                  width={90}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#374151", fontSize: 10, fontWeight: 700 }}
                  tickFormatter={(value) => {
                    const label = String(value || "");
                    return label.length > 12 ? `${label.slice(0, 12)}...` : label;
                  }}
                />
                <Tooltip content={<FloodBarTooltip />} cursor={{ fill: "#f9fafb" }} />
                <Bar dataKey="high_risk_students"   stackId="a" fill="#dc2626" name="High"   radius={[0,0,0,0]} />
                <Bar dataKey="medium_risk_students" stackId="a" fill="#f59e0b" name="Medium" radius={[0,0,0,0]} />
                <Bar dataKey="low_risk_students"    stackId="a" fill="#3b82f6" name="Low"    radius={[0,2,2,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}

          {/* Top 5 table */}
          {!floodImpact.loading && taRows.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Highest Impact TAs</p>
              <div className="space-y-2">
                {taRows.slice(0, 5).map((r, i) => (
                  <div key={r.ta_id || i} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-extrabold text-gray-300 w-4 flex-shrink-0">{i + 1}</span>
                      <span className="font-bold text-black truncate">{r.ta_name}</span>
                      <span
                        className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskBadge(Number(r.high_risk_schools) > 0 ? "high" : Number(r.medium_risk_schools) > 0 ? "medium" : "low")}`}
                      >
                        {Number(r.high_risk_schools) > 0 ? "high" : Number(r.medium_risk_schools) > 0 ? "medium" : "low"}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span className="font-extrabold text-red-600">{formatNumber(r.students_at_risk, 0)}</span>
                      <span className="text-gray-400 ml-1">students</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EducationPage;
