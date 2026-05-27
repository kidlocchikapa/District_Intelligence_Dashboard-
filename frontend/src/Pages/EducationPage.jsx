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
import { useMemo, useState, useRef } from "react";
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
import MetricPreviewModal from "../components/MetricPreviewModal";
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
  "Teacher Shortage",              // teacher ratio exceeded
  "Classroom Shortage",            // classroom ratio exceeded
  "Teacher & Classroom Shortage",  // both exceeded
  "OK",
];

const SCHOOL_RISK_COLORS = {
  "Teacher Shortage":             "#f59e0b",  // amber
  "Classroom Shortage":           "#dc2626",  // red
  "Teacher & Classroom Shortage": "#7c3aed",  // purple
  "OK":                           "#22c55e",  // green
};

const SCHOOL_RISK_PRIORITY = {
  "OK": 0,
  "Teacher Shortage": 1,
  "Classroom Shortage": 2,
  "Teacher & Classroom Shortage": 3,
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

  if (teacherRisk && classroomRisk) return "Teacher & Classroom Shortage";
  if (classroomRisk)                return "Classroom Shortage";
  if (teacherRisk)                  return "Teacher Shortage";
  return "OK";
}

function getSchoolRiskColor(riskCategory) {
  return SCHOOL_RISK_COLORS[riskCategory] || SCHOOL_RISK_COLORS["OK"];
}

function getSchoolRiskBadgeClasses(riskCategory) {
  const map = {
    "Teacher Shortage":             "border border-amber-200 bg-amber-50 text-amber-700",
    "Classroom Shortage":           "border border-red-200 bg-red-50 text-red-700",
    "Teacher & Classroom Shortage": "border border-purple-200 bg-purple-50 text-purple-700",
    "OK":                           "border border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return map[riskCategory] || map["OK"];
}

function normalizeSchoolIdentity(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getSchoolFeatureDedupKey(feature) {
  const properties = feature?.properties || {};
  const name = normalizeSchoolIdentity(properties.school_name || properties.name);

  if (!name) {
    return `id:${properties.school_id ?? feature?.id ?? JSON.stringify(feature?.geometry?.coordinates || "")}`;
  }

  const district = normalizeSchoolIdentity(
    properties.district || properties.district_name,
  );
  const ta = normalizeSchoolIdentity(
    properties.ta_id ?? properties.ward_id ?? properties.ta_name ?? properties.admin_unit_name,
  );

  return `school:${name}|district:${district}|ta:${ta}`;
}

function getSchoolFeaturePriority(feature) {
  const properties = feature?.properties || {};
  const enrollment = Number(properties.student_enrollment_total || 0);
  const teachers = Number(properties.teacher_count ?? properties.teacher_distribution ?? 0);
  const classrooms = Number(properties.blocks_count ?? 0);
  const teacherRatio = teachers > 0 ? enrollment / teachers : enrollment > 0 ? 9999 : 0;
  const classroomRatio = classrooms > 0 ? enrollment / classrooms : enrollment > 0 ? 9999 : 0;

  return [
    SCHOOL_RISK_PRIORITY[properties.risk_category] ?? 0,
    teacherRatio,
    classroomRatio,
    enrollment,
  ];
}

function isHigherPrioritySchool(candidate, current) {
  const candidatePriority = getSchoolFeaturePriority(candidate);
  const currentPriority = getSchoolFeaturePriority(current);

  for (let index = 0; index < candidatePriority.length; index += 1) {
    if (candidatePriority[index] > currentPriority[index]) {
      return true;
    }

    if (candidatePriority[index] < currentPriority[index]) {
      return false;
    }
  }

  return false;
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

const EDUCATION_RASTER_LAYERS = [
  {
    key: "education_buffer_coverage",
    shortLabel: "5 km Coverage",
    title: "School Service Coverage (5 km)",
    subtitle: "Population served within 5 km of the nearest school.",
  },
  {
    key: "education_network_distance",
    shortLabel: "Road Distance",
    title: "Road Distance to Nearest School",
    subtitle: "Average beneficiary road distance (km) by area.",
  },
  {
    key: "education_travel_time",
    shortLabel: "Travel Time",
    title: "Travel Time to Nearest School",
    subtitle: "Average beneficiary travel time (minutes) by area.",
  },
];

const EDUCATION_CHART_LIMITS = [
  { value: 8, label: "Top 8" },
  { value: 12, label: "Top 12" },
  { value: 0, label: "All" },
];

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
  const { selectedDistrict, selectedTa, setSelectedTa } = useDistrict();
  const [selectedSchoolRiskCategories, setSelectedSchoolRiskCategories] = useState(
    SCHOOL_RISK_CATEGORIES,
  );
  const [activeEducationRasterKey, setActiveEducationRasterKey] = useState(
    EDUCATION_RASTER_LAYERS[0].key,
  );
  const [hoveredEducationTa, setHoveredEducationTa] = useState("");
  const [riskTableSort, setRiskTableSort] = useState({ key: "teacher_ratio", dir: "desc" });
  const [schoolRiskPreview, setSchoolRiskPreview] = useState(null);
  const { contentRef, exportDataPdf } = usePdfExport("Education_Report.pdf");
  const mapRef = useRef(null);
  const activeEducationRasterLayer =
    EDUCATION_RASTER_LAYERS.find(
      (layer) => layer.key === activeEducationRasterKey,
    ) || EDUCATION_RASTER_LAYERS[0];
  const activeEducationTaPreview = selectedTa || hoveredEducationTa;

  const educationSummary = useDashboardData(
    buildDashboardPath("/dashboard/education/summary", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
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
      ta: selectedTa,
      admin_type: selectedTa ? "TA" : "District",
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
      district: coverageFocusDistrict,
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
  const planningPriorities = useDashboardData(
    buildDashboardPath("/dashboard/planning-priorities", {
      district: selectedDistrict,
      ta: selectedTa,
      admin_type: "TA",
      department: "education",
      limit: selectedTa ? 1 : 5,
    }),
  );

  const formatStat = (value, digits = 0) => formatNumber(value, digits);
  const selectedAreaName = selectedTa
    ? `TA: ${selectedTa}`
    : selectedDistrict
      ? `District: ${selectedDistrict}`
      : "National";

  const selectTa = (taName) => {
    setSelectedTa(taName || "");
    setHoveredEducationTa("");
  };

  const selectTaFromFeature = (feature) => {
    const properties = feature?.properties || {};
    selectTa(properties.admin_unit_name || properties.name || "");
  };

  const previewTaFromFeature = (feature) => {
    if (selectedTa) {
      return;
    }

    const properties = feature?.properties || {};
    setHoveredEducationTa(properties.admin_unit_name || properties.name || "");
  };

  const handleDownloadReport = async () => {
    const selectedInsightRow = selectedTa ? selectedInsight || {} : {};
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
    const planningRows = (planningPriorities.data?.priorities || []).map((row) => ({
      area: row.admin_unit_name,
      priority: row.priority_band,
      score: formatStat(row.planning_priority_score, 1),
      action: row.recommended_actions?.[0] || "Review service gaps and target investment",
    }));

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
        {
          title: "Planning Priorities",
          columns: [
            { key: "area", label: "Area", width: 140 },
            { key: "priority", label: "Priority", width: 90 },
            { key: "score", label: "Score", width: 70 },
            { key: "action", label: "Recommended Action", width: 280 },
          ],
          rows: planningRows.length > 0 ? planningRows : [
            {
              area: selectedDistrict || "Education overview",
              priority: "N/A",
              score: "0.0",
              action: "No ranked education planning priorities are available for this scope yet.",
            },
          ],
        },
      ],
      mapNode: mapRef.current?.querySelector("[data-map-export]"),
    });
  };

  const allInsightRows = useMemo(
    () => districtInsights.data?.all_districts ?? [],
    [districtInsights.data],
  );
  const insightRows = useMemo(
    () => districtInsights.data?.districts ?? [],
    [districtInsights.data],
  );
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
  const districtSchoolCount = insightRows.reduce(
    (sum, row) => sum + Number(row.school_count || 0),
    0,
  );
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

    sourceInsightRows.forEach((row) => {
      if (row.admin_unit_id === undefined || row.admin_unit_id === null) {
        return;
      }

      lookup.set(
        String(row.admin_unit_id),
        row.insight_label || "Balanced Capacity",
      );
    });

    return lookup;
  }, [sourceInsightRows]);

  const schoolFeaturesWithPressure = useMemo(() => {
    const features = schoolLocations.data?.features || [];
    const uniqueSchools = new Map();

    features.forEach((feature) => {
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

      const enrichedFeature = {
        ...feature,
        properties: {
          ...feature.properties,
          pressure_category: pressureCategory,
          risk_category: riskCategory,
        },
      };

      const schoolKey = getSchoolFeatureDedupKey(enrichedFeature);
      const existingFeature = uniqueSchools.get(schoolKey);

      if (!existingFeature || isHigherPrioritySchool(enrichedFeature, existingFeature)) {
        uniqueSchools.set(schoolKey, enrichedFeature);
      }
    });

    return Array.from(uniqueSchools.values());
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

  const openSchoolRiskPreview = (category) => {
    const matchingSchools = atRiskSchools.filter(
      (school) => school.risk_category === category,
    );
    const rows = matchingSchools
      .sort((left, right) => {
        const leftTeacherRatio = left.teacher_ratio ?? 0;
        const rightTeacherRatio = right.teacher_ratio ?? 0;
        const leftClassRatio = left.classroom_ratio ?? 0;
        const rightClassRatio = right.classroom_ratio ?? 0;

        return (
          rightTeacherRatio + rightClassRatio -
          (leftTeacherRatio + leftClassRatio)
        );
      })
      .map((school, index) => ({
        id: school.school_id || `${category}-${index}`,
        schoolName: school.school_name,
        riskCategory: school.risk_category,
        enrollment: formatNumber(school.enrollment, 0),
        pupilsPerTeacher:
          school.teacher_ratio != null ? `1:${school.teacher_ratio}` : "-",
        pupilsPerClass:
          school.classroom_ratio != null ? `1:${school.classroom_ratio}` : "-",
        operator: school.operator,
      }));

    setSchoolRiskPreview({
      title: `${category} Schools (${formatNumber(matchingSchools.length, 0)})`,
      columns: [
        { key: "schoolName", label: "School" },
        { key: "riskCategory", label: "Shortage Type" },
        { key: "enrollment", label: "Enrollment" },
        { key: "pupilsPerTeacher", label: "Pupils / Teacher" },
        { key: "pupilsPerClass", label: "Pupils / Class" },
        { key: "operator", label: "Operator" },
      ],
      rows,
    });
  };

  const openSingleSchoolPreview = (school) => {
    setSchoolRiskPreview({
      title: school.school_name,
      columns: [
        { key: "schoolName", label: "School" },
        { key: "riskCategory", label: "Shortage Type" },
        { key: "enrollment", label: "Enrollment" },
        { key: "pupilsPerTeacher", label: "Pupils / Teacher" },
        { key: "pupilsPerClass", label: "Pupils / Class" },
        { key: "operator", label: "Operator" },
      ],
      rows: [
        {
          id: school.school_id || school.school_name,
          schoolName: school.school_name,
          riskCategory: school.risk_category,
          enrollment: formatNumber(school.enrollment, 0),
          pupilsPerTeacher:
            school.teacher_ratio != null ? `1:${school.teacher_ratio}` : "-",
          pupilsPerClass:
            school.classroom_ratio != null ? `1:${school.classroom_ratio}` : "-",
          operator: school.operator,
        },
      ],
    });
  };

  const schoolRiskCounts = useMemo(() => {
    const counts = Object.fromEntries(SCHOOL_RISK_CATEGORIES.map(c => [c, 0]));
    schoolFeaturesWithPressure.forEach(f => {
      const cat = f.properties.risk_category;
      if (counts[cat] !== undefined) counts[cat]++;
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
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <GraduationCap className="h-8 w-8 text-black" />
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-[28px]">EDUCATION</h1>
      </div>

      <div className="mt-6 px-4 sm:mt-8 sm:px-6 lg:px-8">
        <p className="text-[14px] font-semibold text-gray-500 mb-6">
          {selectedDistrict
            ? `Education stats for ${selectedTa || selectedDistrict}`
            : selectedTa
              ? `Education stats for ${selectedTa}`
              : "National Education Overview"}
        </p>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <button
            onClick={handleDownloadReport}
            className="flex w-full items-center justify-center gap-2 rounded border border-gray-300 px-3 py-2 text-[13px] font-bold shadow-sm transition-all hover:bg-gray-50 active:scale-95 sm:w-auto sm:justify-start sm:py-1.5"
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
                    selectedTa
                      ? selectedInsight?.school_count || 0
                      : districtSchoolCount ||
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

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.55fr_0.75fr] xl:gap-8 mb-10">
          {districtInsights.loading ? (
            <>
              <div className="h-[620px] animate-pulse rounded border border-gray-100 bg-gray-50" />
              <div className="h-[440px] animate-pulse rounded border border-gray-100 bg-gray-50" />
            </>
          ) : (
            <>
              <div className="space-y-8">
                <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
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

                  <div className="h-[220px] sm:h-[250px]">
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

                <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
                  <div className="h-[220px] sm:h-[250px]">
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

              <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
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

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-8">
          {/* ── School Infrastructure Map ─────────────────────────── */}
          <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8 min-h-[420px] h-[70vh] max-h-[600px] flex flex-col">
            <h3 className="text-[16px] font-extrabold">
              School Infrastructure Mapping
            </h3>
            <p className="mt-1 text-sm text-gray-500 font-semibold">
              Coloured by school shortage type - teacher 1:60 - classroom 1:40
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

            <div ref={mapRef} className="flex-1 rounded overflow-hidden relative border border-gray-50 bg-gray-50">
              {schoolLocations.loading ? (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse">
                  <span className="text-gray-400 font-bold uppercase tracking-widest">
                    Loading Schools...
                  </span>
                </div>
              ) : (
                <MapPanel
                  geojson={schoolLocationsForMap}
                  exportTitle="School Locations and Risk"
                  exportSubtitle="School points coloured by classroom and teacher pressure."
                  pointExportLabel="Schools"
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
          <div className="rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8 min-h-[420px] h-[70vh] max-h-[600px] flex flex-col">
            <div className="flex items-start justify-between gap-4 mb-1">
              <div>
                <h3 className="text-[16px] font-extrabold flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  At-Risk Schools
                </h3>
                <p className="mt-1 text-sm text-gray-500 font-semibold">
                  Schools exceeding teacher or classroom shortage thresholds
                </p>
              </div>
              <span className="flex-shrink-0 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-bold text-red-700">
                {atRiskSchools.length} flagged
              </span>
            </div>

            {/* Summary badges */}
            <div className="mt-3 mb-4 flex flex-wrap gap-2">
              {SCHOOL_RISK_CATEGORIES.filter(c => c !== "OK").map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => openSchoolRiskPreview(cat)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-black/10 ${getSchoolRiskBadgeClasses(cat)}`}
                  title={`Preview ${cat.toLowerCase()} schools`}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: getSchoolRiskColor(cat) }} />
                  {cat}: {schoolRiskCounts[cat] || 0}
                </button>
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
                        onClick={() => openSingleSchoolPreview(school)}
                        className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50"
                        title="Click to preview this school"
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
              <span className="text-amber-600">Pupils/Teacher &gt; {TEACHER_RATIO_THRESHOLD} = Teacher Shortage</span>
              <span className="text-red-600">Pupils/Class &gt; {CLASSROOM_RATIO_THRESHOLD} = Classroom Shortage</span>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="text-[16px] font-extrabold">Education Access Raster</h3>
          <p className="mt-2 text-sm text-gray-500 font-semibold">
            {selectedTa
              ? `Showing the selected education access layer focused on ${selectedTa}. Click another TA boundary to switch the locked area.`
              : activeEducationTaPreview
                ? `Previewing education details for ${activeEducationTaPreview}. Click to lock this TA.`
                : "Hover any TA boundary to preview its details on the active layer, or click to lock it."}
          </p>
          <div className="mt-5 border border-gray-100 rounded p-5 shadow-sm bg-white">
            <div className="flex flex-wrap gap-2">
              {EDUCATION_RASTER_LAYERS.map((layer) => {
                const isActive = layer.key === activeEducationRasterLayer.key;
                return (
                  <button
                    key={layer.key}
                    type="button"
                    onClick={() => setActiveEducationRasterKey(layer.key)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
                      isActive
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-500 hover:text-black"
                    }`}
                  >
                    {layer.shortLabel}
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {EDUCATION_RASTER_LAYERS.map((layer) => {
                const isActive = layer.key === activeEducationRasterLayer.key;
                return (
                  <button
                    key={`education-layer-card-${layer.key}`}
                    type="button"
                    onClick={() => setActiveEducationRasterKey(layer.key)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-100 bg-gray-50 text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em]">
                      {isActive ? "Active Layer" : "Layer"}
                    </p>
                    <p className="mt-1 text-sm font-extrabold">{layer.shortLabel}</p>
                    <p
                      className={`mt-1 text-xs font-semibold ${
                        isActive ? "text-white/75" : "text-gray-500"
                      }`}
                    >
                      {layer.subtitle}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs font-semibold text-gray-500">
              Layer focus keeps the map clean while still letting users compare
              coverage, distance, and travel-time patterns quickly.
            </p>
            <div className="mt-4 border border-gray-100 rounded p-3 bg-white">
              <PopulationRasterPanel
                key={`education-raster-${activeEducationRasterLayer.key}`}
                geojson={educationCoverageTaGeojson.data}
                pointsGeojson={schoolLocations.data}
                pointLayerLabel="Schools"
                title={activeEducationRasterLayer.title}
                subtitle={activeEducationRasterLayer.subtitle}
                metadataUrl={getEducationRasterAsset(
                  educationRasterMetadata.data?.assets,
                  activeEducationRasterLayer.key,
                )}
                heightClass="h-[430px]"
                loading={
                  educationCoverageTaGeojson.loading ||
                  educationRasterMetadata.loading
                }
                selectedFeatureName={selectedTa}
                hoveredFeatureName={selectedTa ? "" : hoveredEducationTa}
                onFeatureHover={previewTaFromFeature}
                onFeatureClick={selectTaFromFeature}
              />
            </div>
          </div>
        </div>

        <div className="mt-8 rounded border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          {districtInsights.loading ? (
            <div className="h-[240px] sm:h-[280px] w-full animate-pulse rounded bg-gray-50" />
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

        {/* ── Flood Impact on Schools ─────────────────────────────────── */}
        <FloodImpactSection
          floodImpact={floodImpact}
          floodImpactGeojson={floodImpactGeojson}
          coverageFocusDistrict={coverageFocusDistrict}
        />

        {/* ── Planning Recommendations ─────────────────────────────── */}
        <PlanningRecommendations
          districtInsights={districtInsights}
          floodImpact={floodImpact}
          educationSummary={educationSummary}
          selectedDistrict={selectedDistrict}
          planningPriorities={planningPriorities}
        />

        <MetricPreviewModal
          metricPreview={schoolRiskPreview}
          onClose={() => setSchoolRiskPreview(null)}
          description="Previewing schools behind this shortage category."
          emptyMessage="No schools are currently in this shortage category."
          emphasisKeys={["schoolName", "riskCategory"]}
        />
      </div>
    </div>
  );
}

/* ─── Planning Recommendations ────────────────────────────────────────── */
function PlanningRecommendations({ districtInsights, floodImpact, educationSummary, selectedDistrict, planningPriorities }) {
  const [metricPreview, setMetricPreview] = useState(null);
  const allRows = useMemo(
    () => districtInsights.data?.all_districts ?? districtInsights.data?.districts ?? [],
    [districtInsights.data],
  );
  const floodSummary = floodImpact.data?.summary || {};
  const eduSummary   = educationSummary.data || {};
  const rankedPriorities = planningPriorities?.data?.priorities || [];

  const loading = districtInsights.loading || floodImpact.loading || educationSummary.loading || planningPriorities.loading;

  // Derive key numbers
  const infraGapTAs = allRows.filter((row) => row.insight === "infrastructure gap");
  const overcrowdingTAs = allRows.filter((row) => row.insight === "overcrowding risk");
  const underutilizedTAs = allRows.filter((row) => row.insight === "underutilized schools");
  const worstInfra       = [...infraGapTAs].sort((a,b) => a.schools_per_10k - b.schools_per_10k)[0];
  const worstCrowd       = [...overcrowdingTAs].sort((a,b) => b.students_per_school - a.students_per_school)[0];
  const teacherTotal     = Number(eduSummary.teacher_count_total || 0);
  const schoolAgeTotal   = Number(eduSummary.school_age_population_total || 0);
  const outOfSchoolTotal = Number(eduSummary.not_in_school_total || 0);
  const teacherRatio     = eduSummary.teacher_count_total > 0
    ? Math.round(eduSummary.student_enrollment_total / eduSummary.teacher_count_total)
    : null;
  const floodTaRows = useMemo(() => {
    return (floodImpact.data?.ta_breakdown || [])
      .map((row, index) => ({
        id: `flood-ta-${row.ta_id || row.ta_name || index}`,
        ta: row.ta_name || "Unknown TA",
        district: row.district_name || selectedDistrict || "Unknown District",
        exposedSchools: Number(row.exposed_schools || 0),
        highRiskStudents: Number(row.high_risk_students || 0),
        mediumRiskStudents: Number(row.medium_risk_students || 0),
        lowRiskStudents: Number(row.low_risk_students || 0),
        studentsAtRisk: Number(row.students_at_risk || 0),
      }))
      .sort((left, right) => right.studentsAtRisk - left.studentsAtRisk);
  }, [floodImpact.data, selectedDistrict]);

  const taRowColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "schoolsPer10k", label: "Schools/10k" },
    { key: "studentsPerSchool", label: "Students/School" },
    { key: "schoolCount", label: "Schools" },
    { key: "population", label: "Population" },
  ];
  const floodRowColumns = [
    { key: "ta", label: "TA" },
    { key: "district", label: "District" },
    { key: "studentsAtRisk", label: "Students at Risk" },
    { key: "exposedSchools", label: "Exposed Schools" },
    { key: "highRiskStudents", label: "High Risk" },
    { key: "mediumRiskStudents", label: "Medium Risk" },
    { key: "lowRiskStudents", label: "Low Risk" },
  ];
  const summaryColumns = [
    { key: "metric", label: "Metric" },
    { key: "value", label: "Value" },
  ];

  const infraGapPreviewRows = infraGapTAs.map((row, index) => ({
    id: `infra-${row.admin_unit_id || row.admin_unit_name || index}`,
    ta: row.admin_unit_name || "Unknown TA",
    district: row.district || selectedDistrict || "Unknown District",
    schoolsPer10k: Number(row.schools_per_10k || 0),
    studentsPerSchool: Number(row.students_per_school || 0),
    schoolCount: Number(row.school_count || 0),
    population: Number(row.population_total || 0),
  }));
  const overcrowdingPreviewRows = overcrowdingTAs.map((row, index) => ({
    id: `crowd-${row.admin_unit_id || row.admin_unit_name || index}`,
    ta: row.admin_unit_name || "Unknown TA",
    district: row.district || selectedDistrict || "Unknown District",
    schoolsPer10k: Number(row.schools_per_10k || 0),
    studentsPerSchool: Number(row.students_per_school || 0),
    schoolCount: Number(row.school_count || 0),
    population: Number(row.population_total || 0),
  }));
  const underutilizedPreviewRows = underutilizedTAs.map((row, index) => ({
    id: `under-${row.admin_unit_id || row.admin_unit_name || index}`,
    ta: row.admin_unit_name || "Unknown TA",
    district: row.district || selectedDistrict || "Unknown District",
    schoolsPer10k: Number(row.schools_per_10k || 0),
    studentsPerSchool: Number(row.students_per_school || 0),
    schoolCount: Number(row.school_count || 0),
    population: Number(row.population_total || 0),
  }));
  const underutilizedSchoolCount = underutilizedPreviewRows.reduce(
    (sum, row) => sum + Number(row.schoolCount || 0),
    0,
  );
  const outOfSchoolRows = allRows
    .map((row, index) => ({
      id: `oos-${row.admin_unit_id || row.admin_unit_name || index}`,
      ta: row.admin_unit_name || "Unknown TA",
      district: row.district || selectedDistrict || "Unknown District",
      outOfSchool: Number(row.not_in_school_total || 0),
      schoolAgePopulation: Number(row.school_age_population_total || 0),
      schoolsPer10k: Number(row.schools_per_10k || 0),
      studentsPerSchool: Number(row.students_per_school || 0),
    }))
    .filter((row) => row.outOfSchool > 0)
    .sort((left, right) => right.outOfSchool - left.outOfSchool);
  const summaryRows = [
    { metric: "Total schools", value: formatNumber(eduSummary.school_count || 0, 0) },
    { metric: "Total teachers", value: formatNumber(teacherTotal, 0) },
    { metric: "Student enrollment", value: formatNumber(eduSummary.student_enrollment_total || 0, 0) },
    { metric: "School-age population", value: formatNumber(schoolAgeTotal, 0) },
    { metric: "Out-of-school population", value: formatNumber(outOfSchoolTotal, 0) },
    { metric: "Teacher ratio", value: teacherRatio ? `1:${formatNumber(teacherRatio, 0)}` : "N/A" },
    { metric: "Infra-gap TAs", value: formatNumber(infraGapTAs.length, 0) },
    { metric: "Overcrowding TAs", value: formatNumber(overcrowdingTAs.length, 0) },
    { metric: "Underutilized TAs", value: formatNumber(underutilizedTAs.length, 0) },
    { metric: "Flood-exposed schools", value: formatNumber(floodSummary.exposed_schools || 0, 0) },
    { metric: "Students at flood risk", value: formatNumber(floodSummary.students_at_risk || 0, 0) },
  ];

  function openMetricPreview({ title, rows, columns }) {
    setMetricPreview({
      title,
      rows: rows || [],
      columns: columns || summaryColumns,
    });
  }

  const priorityLedRecommendations = rankedPriorities.slice(0, 2).map((row, index) => ({
    priority: index === 0 ? "high" : row.priority_band === "Critical" || row.priority_band === "High" ? "high" : "medium",
    icon: row.education_vulnerability_score >= row.health_vulnerability_score ? School : ShieldAlert,
    title: `Start education support in ${row.admin_unit_name}`,
    body: `This area has a high education need score of ${formatNumber(row.education_vulnerability_score, 1)} and may also be hard to reach during floods. It should be reviewed first for classrooms, teachers, school supplies, or learner support.`,
    action: row.recommended_actions?.[0] || "Use this TA as the first place to review for the next education plan",
  }));

  const recommendations = [
    ...priorityLedRecommendations,
    // 1 — Infrastructure gaps
    infraGapTAs.length > 0 && {
      priority: "high",
      icon: School,
      title: "Some Areas Need More Schools",
      body: `${infraGapTAs.length} TA${infraGapTAs.length > 1 ? "s have" : " has"} too few schools for the number of people living there.${worstInfra ? ` ${worstInfra.admin_unit_name} has the lowest school coverage, with ${formatNumber(worstInfra.schools_per_10k, 1)} schools for every 10,000 people.` : ""} These areas should be checked first for new schools or added classrooms.`,
      action: "Review the flagged TAs first when planning school construction funds",
      metricLinks: [
        {
          id: "infra-gap-ta-count",
          label: "Areas Short of Schools",
          value: formatNumber(infraGapTAs.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "Areas Short of Schools",
              rows: infraGapPreviewRows,
              columns: taRowColumns,
            }),
        },
        {
          id: "worst-schools-density",
          label: "Lowest School Coverage",
          value: worstInfra ? formatNumber(worstInfra.schools_per_10k, 1) : "N/A",
          onClick: () =>
            openMetricPreview({
              title: "Areas Short of Schools",
              rows: infraGapPreviewRows,
              columns: taRowColumns,
            }),
        },
      ],
    },
    // 2 - Overcrowding
    overcrowdingTAs.length > 0 && {
      priority: "high",
      icon: Users,
      title: "Some Schools Are Too Crowded",
      body: `${overcrowdingTAs.length} TA${overcrowdingTAs.length > 1 ? "s have" : " has"} too many learners for the available schools.${worstCrowd ? ` ${worstCrowd.admin_unit_name} averages about ${formatNumber(worstCrowd.students_per_school, 0)} learners per school.` : ""} These areas may need more classrooms, extra school blocks, or nearby satellite schools.`,
      action: "Plan extra classrooms first in the most crowded TAs",
      metricLinks: [
        {
          id: "overcrowding-ta-count",
          label: "Crowded TAs",
          value: formatNumber(overcrowdingTAs.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "Crowded TAs",
              rows: overcrowdingPreviewRows,
              columns: taRowColumns,
            }),
        },
        {
          id: "worst-overcrowding-value",
          label: "Most Crowded",
          value: worstCrowd ? formatNumber(worstCrowd.students_per_school, 0) : "N/A",
          onClick: () =>
            openMetricPreview({
              title: "Crowded TAs",
              rows: overcrowdingPreviewRows,
              columns: taRowColumns,
            }),
        },
      ],
    },
    // 3 - Teacher ratio
    teacherRatio !== null && teacherRatio > 60 && {
      priority: "high",
      icon: BookOpen,
      title: "More Teachers Are Needed",
      body: `There is about 1 teacher for every ${teacherRatio} learners. This can make classes hard to manage and reduce learning quality. The busiest schools should receive extra teachers first.`,
      action: "Send new or reassigned teachers to the schools with the biggest classes first",
      metricLinks: [
        {
          id: "teacher-ratio",
          label: "Teacher Ratio",
          value: `1:${formatNumber(teacherRatio, 0)}`,
          onClick: () =>
            openMetricPreview({
              title: "Education Workforce Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
        {
          id: "teacher-total",
          label: "Total Teachers",
          value: formatNumber(teacherTotal, 0),
          onClick: () =>
            openMetricPreview({
              title: "Education Workforce Summary",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
      ],
    },
    // 4 - Underutilized schools
    underutilizedTAs.length > 0 && {
      priority: "medium",
      icon: TrendingUp,
      title: "Some Schools Have Space Available",
      body: `${underutilizedTAs.length} TA${underutilizedTAs.length > 1 ? "s have" : " has"} schools with unused space. Before building nearby, check whether learners can be supported to use these schools or whether the space can support adult learning or skills training.`,
      action: "Compare schools with extra space against nearby crowded schools",
      metricLinks: [
        {
          id: "underutilized-ta-count",
          label: "TAs with Space",
          value: formatNumber(underutilizedTAs.length, 0),
          onClick: () =>
            openMetricPreview({
              title: "TAs with School Space",
              rows: underutilizedPreviewRows,
              columns: taRowColumns,
            }),
        },
        {
          id: "underutilized-school-count",
          label: "Schools in These TAs",
          value: formatNumber(underutilizedSchoolCount, 0),
          onClick: () =>
            openMetricPreview({
              title: "TAs with School Space",
              rows: underutilizedPreviewRows,
              columns: taRowColumns,
            }),
        },
      ],
    },
    // 5 - Flood risk
    floodSummary.exposed_schools > 0 && {
      priority: "high",
      icon: ShieldAlert,
      title: "Protect Schools from Flood Disruption",
      body: `${floodSummary.exposed_schools} schools with ${formatNumber(floodSummary.students_at_risk, 0)} learners are in flood-exposed areas. Even if the current risk level is low, these schools should have safe learning plans before the rainy season.`,
      action: "Prepare safe learning spaces and flood-ready building plans for exposed schools",
      metricLinks: [
        {
          id: "exposed-schools",
          label: "Exposed Schools",
          value: formatNumber(floodSummary.exposed_schools || 0, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Exposure by TA",
              rows: floodTaRows,
              columns: floodRowColumns,
            }),
        },
        {
          id: "students-at-risk",
          label: "Students at Risk",
          value: formatNumber(floodSummary.students_at_risk || 0, 0),
          onClick: () =>
            openMetricPreview({
              title: "Flood Exposure by TA",
              rows: floodTaRows,
              columns: floodRowColumns,
            }),
        },
      ],
    },
    // 6 - Out-of-school children
    outOfSchoolTotal > 0 && {
      priority: "medium",
      icon: UserRoundX,
      title: "Help Children Who Are Not in School",
      body: `About ${formatNumber(outOfSchoolTotal, 0)} school-age children are not enrolled. Many are likely in areas where schools are too far away or too crowded. Outreach should be paired with school construction or classroom expansion.`,
      action: "Run enrolment outreach in the same TAs being reviewed for new classrooms or schools",
      metricLinks: [
        {
          id: "out-of-school-total",
          label: "Out-of-School Children",
          value: formatNumber(outOfSchoolTotal, 0),
          onClick: () =>
            openMetricPreview({
              title: "Out-of-School by TA",
              rows: outOfSchoolRows,
              columns: taRowColumns,
            }),
        },
        {
          id: "school-age-population",
          label: "School-Age Population",
          value: formatNumber(schoolAgeTotal, 0),
          onClick: () =>
            openMetricPreview({
              title: "Education Summary Metrics",
              rows: summaryRows,
              columns: summaryColumns,
            }),
        },
      ],
    },
    // 7 - Cross-sector welfare link
    {
      priority: "low",
      icon: Lightbulb,
      title: "Use Welfare Support to Keep Children in School",
      body: `Some welfare-supported households are also in areas with flood risk or children who are not enrolled. Education and welfare teams should work together so vulnerable households get support that helps children stay in school.`,
      action: "Link school follow-up with welfare support in the most vulnerable TAs",
    },
  ].filter(Boolean).slice(0, 7);

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
        <h3 className="text-[16px] font-extrabold">Insights & Recommendations</h3>
      </div>
      <p className="text-sm text-gray-500 font-semibold mb-6">
        Use these cards to see what needs attention first, which schools or TAs need support, and what action to take next.
        {selectedDistrict ? ` Scoped to ${selectedDistrict}.` : " Covering all districts."}
      </p>

      <InteractiveRecommendations
        recommendations={recommendations}
        priorityConfig={priorityConfig}
        sectionKey={`education:${selectedDistrict || "all"}`}
      />

      <MetricPreviewModal
        metricPreview={metricPreview}
        onClose={() => setMetricPreview(null)}
      />
    </div>
  );
}
/* ─── Risk colour helpers ──────────────────────────────────────────────── */
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
    <div className="h-[320px] overflow-hidden rounded border border-gray-100 sm:h-[420px]">
      <PopulationRasterPanel
        geojson={taGeojson}
        pointsGeojson={schoolGeojson}
        pointLayerLabel="Schools"
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
  const taRows = useMemo(() => floodImpact.data?.ta_breakdown ?? [], [floodImpact.data]);
  const [floodTaSearch, setFloodTaSearch] = useState("");
  const [floodTaLimit, setFloodTaLimit] = useState(12);
  const [floodTaSort, setFloodTaSort] = useState("students_desc");

  const floodTaRows = useMemo(
    () =>
      taRows.map((r) => ({
      ta_name:              r.ta_name,
      district_name:        r.district_name,
      students_at_risk:     Number(r.students_at_risk    || 0),
      high_risk_students:   Number(r.high_risk_students  || 0),
      medium_risk_students: Number(r.medium_risk_students|| 0),
      low_risk_students:    Number(r.low_risk_students   || 0),
      exposed_schools:      Number(r.exposed_schools     || 0),
      high_risk_schools:    Number(r.high_risk_schools   || 0),
      medium_risk_schools:  Number(r.medium_risk_schools || 0),
      low_risk_schools:     Number(r.low_risk_schools    || 0),
      ta_id: r.ta_id,
    })),
    [taRows],
  );
  const chartData = useMemo(() => {
    const searchTerm = floodTaSearch.trim().toLowerCase();
    let rows = [...floodTaRows];

    if (searchTerm) {
      rows = rows.filter((row) =>
        String(row.ta_name || "").toLowerCase().includes(searchTerm),
      );
    }

    rows.sort((left, right) => {
      if (floodTaSort === "students_asc") {
        return Number(left.students_at_risk || 0) - Number(right.students_at_risk || 0);
      }

      if (floodTaSort === "name_asc") {
        return String(left.ta_name || "").localeCompare(String(right.ta_name || ""));
      }

      return Number(right.students_at_risk || 0) - Number(left.students_at_risk || 0);
    });

    if (floodTaLimit > 0) {
      return rows.slice(0, floodTaLimit);
    }

    return rows;
  }, [floodTaLimit, floodTaRows, floodTaSearch, floodTaSort]);
  const topImpactRows = chartData.slice(0, 5);

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
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:gap-6">
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
          <p className="text-[13px] font-extrabold mb-1">Impacted TAs by Students at Risk</p>
          <p className="text-[11px] text-gray-400 font-semibold mb-4">
            Only TAs with flood-exposed schools are shown; stacked by flood risk class.
          </p>
          <div className="mb-4 rounded border border-gray-100 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              {EDUCATION_CHART_LIMITS.map((option) => {
                const isActive = option.value === floodTaLimit;
                return (
                  <button
                    key={`education-flood-limit-${option.label}`}
                    type="button"
                    onClick={() => setFloodTaLimit(option.value)}
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
                value={floodTaSort}
                onChange={(event) => setFloodTaSort(event.target.value)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-gray-600"
              >
                <option value="students_desc">Highest risk</option>
                <option value="students_asc">Lowest risk</option>
                <option value="name_asc">Name A-Z</option>
              </select>
              <input
                type="search"
                value={floodTaSearch}
                onChange={(event) => setFloodTaSearch(event.target.value)}
                placeholder="Search TA..."
                className="w-full flex-1 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 outline-none focus:border-gray-900 sm:min-w-[160px]"
              />
            </div>
            <p className="mt-2 text-[11px] font-semibold text-gray-500">
              Showing {chartData.length} of {floodTaRows.length} TAs.
            </p>
          </div>
          {floodImpact.loading ? (
            <div className="h-[320px] animate-pulse rounded bg-gray-50 sm:h-[380px]" />
          ) : chartData.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center text-sm font-semibold text-gray-400 sm:h-[380px]">
              No flood-impact TA rows match the current filters.
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
          {!floodImpact.loading && topImpactRows.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-3">Highest Impact TAs</p>
              <div className="space-y-2">
                {topImpactRows.map((r, i) => (
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



