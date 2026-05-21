import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  School,
  Search,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { fetchJson, patchJson, postJson, deleteJson } from "../lib/api";

const HEALTH_FLOOD_EXPOSED_COLUMNS = [
  "id",
  "analysis_date",
  "facility_id",
  "facility_name",
  "district_name",
  "ta_name",
  "flood_value",
  "risk_class",
  "is_exposed",
  "code",
  "name",
  "common_name",
  "type",
  "ownership",
  "status",
  "zone",
  "district_label",
  "ward_name",
  "doctor_count",
  "nurse_midwife_count",
  "bed_capacity",
  "beds_count",
  "capacity_persons",
  "patient_visits_total",
  "services_offered",
  "latitude",
  "longitude",
  "is_active",
  "exposure_created_at",
  "exposure_updated_at",
  "facility_created_at",
  "facility_updated_at",
];

const HEALTH_ACCESS_METRICS_COLUMNS = [
  "facility_id",
  "coverage_distance_km",
  "worldpop_population_within_buffer",
  "welfare_beneficiaries_within_buffer",
  "welfare_beneficiaries_served_by_8km_network",
  "avg_network_distance_km",
  "avg_travel_time_min",
  "calculated_at",
  "code",
  "name",
  "common_name",
  "type",
  "ownership",
  "status",
  "zone",
  "district_label",
  "district_name",
  "ward_name",
  "doctor_count",
  "nurse_midwife_count",
  "bed_capacity",
  "beds_count",
  "capacity_persons",
  "patient_visits_total",
  "services_offered",
  "latitude",
  "longitude",
  "is_active",
];

const HEALTH_FACILITY_COLUMNS = [
  "id",
  "code",
  "name",
  "common_name",
  "type",
  "ownership",
  "status",
  "zone",
  "district_label",
  "district_name",
  "ward_name",
  "doctor_count",
  "nurse_midwife_count",
  "bed_capacity",
  "beds_count",
  "capacity_persons",
  "patient_visits_total",
  "services_offered",
  "latitude",
  "longitude",
  "is_active",
  "updated_at",
];

const SCHOOL_COLUMNS = [
  "name",
  "status",
  "district_name",
  "ward_name",
  "student_enrollment_total",
  "teacher_count",
  "teacher_distribution",
  "student_classroom_ratio",
  "special_needs_students",
  "blocks_count",
  "toilets_count",
  "water_equipment_facility_count",
  "classroom_pressure",
  "teacher_pressure",
  "operator_type",
];

const DEPARTMENT_TABLES = {
  education: [
    {
      id: "education_facilities",
      label: "Schools",
      icon: School,
      endpoint: "education",
      columns: SCHOOL_COLUMNS,
      editable: true,
      canCreate: true,
    },
    {
      id: "flood_exposed_schools",
      label: "Flood Exposed Schools",
      icon: ShieldAlert,
      endpoint: "education/flood_exposed",
      columns: [
        "facility_name",
        "district_name",
        "ta_name",
        "risk_class",
        "is_exposed",
        "flood_value",
        "student_enrollment_total",
        "teacher_count",
        "school_status",
        "analysis_date",
      ],
    },
    {
      id: "facility_access",
      label: "Facility Access Metrics",
      icon: FileText,
      endpoint: "education/facility_access",
      columns: [
        "name",
        "district_name",
        "ward_name",
        "coverage_distance_km",
        "worldpop_population_within_buffer",
        "welfare_beneficiaries_within_buffer",
        "avg_network_distance_km",
        "avg_travel_time_min",
        "calculated_at",
      ],
    },
  ],
  health: [
    {
      id: "health_facilities",
      label: "Health Facilities",
      icon: Activity,
      endpoint: "health",
      columns: HEALTH_FACILITY_COLUMNS,
      editable: true,
      deletable: true,
      canCreate: true,
      editType: "health_facility",
    },
    {
      id: "flood_exposed_health",
      label: "Flood Exposed Health",
      icon: ShieldAlert,
      endpoint: "health/flood_exposed",
      columns: HEALTH_FLOOD_EXPOSED_COLUMNS,
    },
    {
      id: "health_facility_access",
      label: "Health Access Metrics",
      icon: FileText,
      endpoint: "health/facility_access",
      columns: HEALTH_ACCESS_METRICS_COLUMNS,
    },
  ],
  social_welfare: [
    {
      id: "welfare_beneficiary",
      label: "Beneficiaries",
      icon: Users,
      endpoint: "social_welfare",
      createEndpoint: "social_welfare/beneficiary",
      createType: "welfare_beneficiary",
      canCreate: true,
      editable: true,
      deletable: true,
      editType: "welfare_beneficiary",
      columns: [
        "firstname",
        "lastname",
        "gender",
        "age",
        "household_size",
        "status",
        "program_name",
        "district_name",
        "ta_name",
        "start_date",
        "end_date",
        "latitude",
        "longitude",
      ],
    },
    {
      id: "welfare_beneficiary_indicators",
      label: "Beneficiary Indicators",
      icon: Activity,
      endpoint: "social_welfare/beneficiary_indicators",
      columns: [
        "beneficiary_name",
        "program_name",
        "district_name",
        "ta_name",
        "affected_by_flood",
        "has_school_access",
        "has_health_facility_access",
        "updated_at",
      ],
    },
    {
      id: "beneficiary_facility_travel",
      label: "Facility Travel",
      icon: FileText,
      endpoint: "social_welfare/facility_travel",
      columns: [
        "beneficiary_name",
        "district_name",
        "ta_name",
        "facility_type",
        "facility_name",
        "network_distance_km",
        "travel_time_min",
        "straight_line_distance_km",
        "routing_status",
        "calculated_at",
      ],
    },
    {
      id: "welfare_programs",
      label: "Welfare Programs",
      icon: Database,
      endpoint: "social_welfare/programs",
      createEndpoint: "social_welfare/programs",
      createType: "welfare_program",
      canCreate: true,
      editable: true,
      deletable: true,
      editType: "welfare_program",
      columns: ["program_id", "program_name", "department", "description"],
    },
  ],
  disaster: [
    {
      id: "flood_facility_exposure",
      label: "Flood Facility Exposure",
      icon: Activity,
      endpoint: "disaster/facility_exposure",
      columns: [
        "id",
        "analysis_date",
        "facility_type",
        "facility_id",
        "facility_name",
        "district_name",
        "ta_name",
        "flood_value",
        "risk_class",
        "is_exposed",
        "health_name",
        "health_code",
        "health_type",
        "health_status",
        "school_name",
        "school_status",
        "student_enrollment_total",
        "teacher_count",
        "latitude",
        "longitude",
        "created_at",
        "updated_at",
      ],
    },
    {
      id: "flood_facility_exposure_summary",
      label: "Flood Exposure Summary",
      icon: FileText,
      endpoint: "disaster/exposure_summary",
      columns: [
        "id",
        "analysis_date",
        "district_name",
        "ta_name",
        "facility_type",
        "total_facilities",
        "exposed_facilities",
        "low_risk_count",
        "medium_risk_count",
        "high_risk_count",
        "exposed_percentage",
        "created_at",
        "updated_at",
      ],
    },
    {
      id: "flood_risk_polygons",
      label: "Flood Risk Polygons",
      icon: ShieldAlert,
      endpoint: "disaster/flood_risk_polygons",
      columns: [
        "id",
        "analysis_date",
        "risk_level",
        "source_raster",
        "area_sq_km",
        "latitude",
        "longitude",
        "created_at",
      ],
    },
    {
      id: "flood_zones",
      label: "Flood Zones",
      icon: Database,
      endpoint: "disaster/flood_zones",
      columns: [
        "id",
        "analysis_date",
        "district_name",
        "ta_name",
        "total_population",
        "exposed_population",
        "low_risk_population",
        "medium_risk_population",
        "high_risk_population",
        "exposed_area_sq_km",
        "created_at",
        "updated_at",
      ],
    },
  ],
};

const SCHOOL_EDIT_FIELDS = [
  { key: "name", label: "School name", type: "text", payloadKey: "name" },
  { key: "status", label: "Status", type: "text", payloadKey: "status" },
  { key: "operator_type", label: "Operator", type: "text", payloadKey: "operatorType" },
  { key: "student_enrollment_total", label: "Student enrollment", type: "number", payloadKey: "studentEnrollmentTotal" },
  { key: "teacher_count", label: "Number of teachers", type: "number", payloadKey: "teacherCount" },
  { key: "teacher_distribution", label: "Teacher distribution", type: "number", payloadKey: "teacherDistribution" },
  { key: "student_classroom_ratio", label: "Student classroom ratio", type: "number", payloadKey: "studentClassroomRatio" },
  { key: "special_needs_students", label: "Special needs students", type: "number", payloadKey: "specialNeedsStudents" },
  { key: "blocks_count", label: "Blocks", type: "number", payloadKey: "blocksCount" },
  { key: "toilets_count", label: "Toilets", type: "number", payloadKey: "toiletsCount" },
  { key: "water_equipment_facility_count", label: "Water equipment facilities", type: "number", payloadKey: "waterEquipmentFacilityCount" },
  { key: "classroom_pressure", label: "Classroom pressure", type: "number", payloadKey: "classroomPressure" },
  { key: "teacher_pressure", label: "Teacher pressure", type: "number", payloadKey: "teacherPressure" },
  { key: "latitude", label: "Latitude", type: "number", payloadKey: "latitude" },
  { key: "longitude", label: "Longitude", type: "number", payloadKey: "longitude" },
  { key: "district_id", label: "District ID", type: "number", payloadKey: "districtId" },
  { key: "ward_id", label: "TA ID", type: "number", payloadKey: "wardId" },
  { key: "is_active", label: "Active", type: "checkbox", payloadKey: "isActive" },
];

const HEALTH_EDIT_FIELDS = [
  { key: "code", label: "Facility code", type: "text", payloadKey: "code" },
  { key: "name", label: "Facility name", type: "text", payloadKey: "name" },
  { key: "common_name", label: "Common name", type: "text", payloadKey: "commonName" },
  { key: "type", label: "Facility type", type: "text", payloadKey: "type" },
  { key: "ownership", label: "Ownership", type: "text", payloadKey: "ownership" },
  { key: "status", label: "Status", type: "text", payloadKey: "status" },
  { key: "zone", label: "Zone", type: "text", payloadKey: "zone" },
  { key: "district_label", label: "District label", type: "text", payloadKey: "districtLabel" },
  { key: "doctor_count", label: "Doctor count", type: "number", payloadKey: "doctorCount" },
  { key: "nurse_midwife_count", label: "Nurse / midwife count", type: "number", payloadKey: "nurseMidwifeCount" },
  { key: "bed_capacity", label: "Bed capacity", type: "number", payloadKey: "bedCapacity" },
  { key: "beds_count", label: "Beds count", type: "number", payloadKey: "bedsCount" },
  { key: "capacity_persons", label: "Capacity (persons)", type: "number", payloadKey: "capacityPersons" },
  { key: "patient_visits_total", label: "Patient visits total", type: "number", payloadKey: "patientVisitsTotal" },
  { key: "services_offered", label: "Services offered", type: "text", payloadKey: "servicesOffered" },
  { key: "latitude", label: "Latitude", type: "number", payloadKey: "latitude" },
  { key: "longitude", label: "Longitude", type: "number", payloadKey: "longitude" },
  { key: "district_id", label: "District ID", type: "number", payloadKey: "districtId" },
  { key: "ward_id", label: "TA ID", type: "number", payloadKey: "wardId" },
  { key: "is_active", label: "Active", type: "checkbox", payloadKey: "isActive" },
];

const READ_ONLY_HEALTH_FIELDS = [
  ["id", "Facility ID"],
  ["district_name", "District"],
  ["ward_name", "TA"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
];

const READ_ONLY_SCHOOL_FIELDS = [
  ["school_id", "School ID"],
  ["district_name", "District"],
  ["ward_name", "TA"],
  ["x_coordinate", "X coordinate"],
  ["y_coordinate", "Y coordinate"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
];

const WELFARE_BENEFICIARY_EDIT_FIELDS = [
  { key: "program_id", label: "Program", type: "program-select", payloadKey: "programId" },
  { key: "firstname", label: "First name", type: "text", payloadKey: "firstname" },
  { key: "lastname", label: "Last name", type: "text", payloadKey: "lastname" },
  { key: "gender", label: "Gender", type: "text", payloadKey: "gender" },
  { key: "age", label: "Age", type: "number", payloadKey: "age" },
  { key: "household_size", label: "Household size", type: "number", payloadKey: "householdSize" },
  { key: "status", label: "Status", type: "text", payloadKey: "status" },
  { key: "start_date", label: "Start date", type: "date", payloadKey: "startDate" },
  { key: "end_date", label: "End date", type: "date", payloadKey: "endDate" },
  { key: "district_id", label: "District ID", type: "number", payloadKey: "districtId" },
  { key: "ta_id", label: "TA ID", type: "number", payloadKey: "taId" },
  { key: "latitude", label: "Latitude", type: "number", payloadKey: "latitude" },
  { key: "longitude", label: "Longitude", type: "number", payloadKey: "longitude" },
];

const WELFARE_PROGRAM_EDIT_FIELDS = [
  { key: "program_name", label: "Program name", type: "text", payloadKey: "program_name" },
  { key: "department", label: "Department", type: "text", payloadKey: "department" },
  { key: "description", label: "Description", type: "text", payloadKey: "description" },
];

const READ_ONLY_WELFARE_BENEFICIARY_FIELDS = [
  ["id", "Beneficiary ID"],
  ["program_name", "Program"],
  ["district_name", "District"],
  ["ta_name", "TA"],
  ["created_at", "Created"],
  ["updated_at", "Updated"],
];

const READ_ONLY_WELFARE_PROGRAM_FIELDS = [
  ["program_id", "Program ID"],
  ["updated_at", "Updated"],
];

function formatLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(", ") : "-";
  }

  return String(value);
}

function servicesOfferedForInput(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value === null || value === undefined ? "" : String(value);
}

function valueForInput(value, type) {
  if (type === "checkbox") {
    return Boolean(value);
  }

  return value === null || value === undefined ? "" : String(value);
}

function toPayloadValue(value, type) {
  if (type === "checkbox") {
    return Boolean(value);
  }

  if (type === "program-select") {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }

  if (type === "number") {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }

  return value === "" ? null : value;
}

function hasSamePayloadValue(left, right) {
  if (left === right) {
    return true;
  }

  return Number.isNaN(left) && Number.isNaN(right);
}

function getTableRecordId(record, table) {
  if (!record || !table) {
    return null;
  }

  if (table.editType === "welfare_beneficiary") {
    return record.id ?? null;
  }

  if (table.editType === "welfare_program") {
    return record.program_id ?? null;
  }

  if (table.editType === "health_facility") {
    return record.id ?? null;
  }

  return record.school_id ?? null;
}

export default function AdminDataStewardship({ department, deptConfig }) {
  const tables = useMemo(() => DEPARTMENT_TABLES[department] || [], [department]);
  const [selectedTableId, setSelectedTableId] = useState(tables[0]?.id || "");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, total_pages: 0 });
  const [editingRecord, setEditingRecord] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [createValues, setCreateValues] = useState({});
  const [welfarePrograms, setWelfarePrograms] = useState([]);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || tables[0],
    [selectedTableId, tables],
  );

  const columns = selectedTable?.columns || deptConfig.columns || [];
  const mobileColumns = useMemo(
    () => columns.slice(0, Math.min(columns.length, 6)),
    [columns],
  );

  useEffect(() => {
    setSelectedTableId(tables[0]?.id || "");
    setSearchQuery("");
    setPage(1);
    setEditingRecord(null);
    setCreatingRecord(false);
  }, [department, tables]);

  const loadTableData = useCallback(async () => {
    if (!selectedTable) {
      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");
      const response = await fetchJson(`/admin-data/${selectedTable.endpoint}`, {
        params: {
          page,
          page_size: 25,
          search: searchQuery,
          ...(selectedTable.fixedParams || {}),
        },
      });

      setRecords(response.items || []);
      setMeta({
        total: response.total || 0,
        total_pages: response.total_pages || 0,
      });
    } catch (err) {
      console.error("Failed to load table data", err);
      setErrorMessage(err?.response?.data?.message || "Unable to load records.");
      setRecords([]);
      setMeta({ total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, selectedTable]);

  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  const loadWelfarePrograms = useCallback(async () => {
    setLoadingPrograms(true);
    try {
      const data = await fetchJson("/admin-data/social_welfare/programs");
      setWelfarePrograms(data?.items || []);
    } catch (err) {
      console.error("Failed to load welfare programs", err);
      setWelfarePrograms([]);
    } finally {
      setLoadingPrograms(false);
    }
  }, []);

  function openSchoolEditor(record) {
    if (!selectedTable?.editable || !record?.school_id) {
      return;
    }

    const nextValues = {};
    SCHOOL_EDIT_FIELDS.forEach((field) => {
      nextValues[field.key] = valueForInput(record[field.key], field.type);
    });

    setEditingRecord(record);
    setEditValues(nextValues);
  }

  function openWelfareEditor(record) {
    if (!selectedTable?.editable) {
      return;
    }

    if (selectedTable.editType === "welfare_beneficiary" && !record?.id) {
      return;
    }

    if (selectedTable.editType === "welfare_program" && !record?.program_id) {
      return;
    }

    const nextValues = {};
    const fields =
      selectedTable.editType === "welfare_beneficiary"
        ? WELFARE_BENEFICIARY_EDIT_FIELDS
        : WELFARE_PROGRAM_EDIT_FIELDS;

    fields.forEach((field) => {
      nextValues[field.key] = valueForInput(record[field.key], field.type);
    });

    setEditingRecord(record);
    setEditValues(nextValues);
    setErrorMessage("");

    if (selectedTable.editType === "welfare_beneficiary") {
      loadWelfarePrograms();
    }
  }

  function openHealthEditor(record) {
    if (!selectedTable?.editable || !record?.id) {
      return;
    }

    const nextValues = {};
    HEALTH_EDIT_FIELDS.forEach((field) => {
      if (field.key === "services_offered") {
        nextValues[field.key] = servicesOfferedForInput(record[field.key]);
        return;
      }

      if (field.key === "ward_id") {
        nextValues[field.key] = valueForInput(record.ward_id ?? record.ta_id, field.type);
        return;
      }

      nextValues[field.key] = valueForInput(record[field.key], field.type);
    });

    setEditingRecord(record);
    setEditValues(nextValues);
    setErrorMessage("");
  }

  function openEditor(record) {
    if (department === "education") {
      openSchoolEditor(record);
    } else if (department === "health") {
      openHealthEditor(record);
    } else {
      openWelfareEditor(record);
    }
  }

  function openSchoolCreator() {
    if (!selectedTable?.canCreate) return;
    const nextValues = {};
    SCHOOL_EDIT_FIELDS.forEach((field) => {
      nextValues[field.key] = field.type === "checkbox" ? false : "";
    });
    setCreateValues(nextValues);
    setCreatingRecord(true);
    setErrorMessage("");
  }

  function openWelfareCreator() {
    if (!selectedTable?.canCreate) return;
    setCreateValues({});
    setCreatingRecord(true);
    setErrorMessage("");

    // Pre-load programs list for the beneficiary dropdown
    if (selectedTable.createType === "welfare_beneficiary") {
      loadWelfarePrograms();
    }
  }

  function openHealthCreator() {
    if (!selectedTable?.canCreate) {
      return;
    }

    const nextValues = {};
    HEALTH_EDIT_FIELDS.forEach((field) => {
      nextValues[field.key] = field.type === "checkbox" ? true : "";
    });
    setCreateValues(nextValues);
    setCreatingRecord(true);
    setErrorMessage("");
  }

  function handleOpenCreator() {
    if (department === "education") {
      openSchoolCreator();
    } else if (department === "health") {
      openHealthCreator();
    } else {
      openWelfareCreator();
    }
  }

  async function triggerEducationRecompute() {
    try {
      await postJson("/admin/run-task", { task: "education_insights" });
      toast.success("Analysis recomputation queued.", { duration: 3000 });
    } catch (err) {
      console.warn("Recompute trigger failed (non-blocking):", err?.message);
    }
  }

  async function triggerWelfareRecompute() {
    try {
      await postJson("/admin/run-task", { task: "welfare_insights" });
      toast.success("Welfare analysis recomputation queued.", { duration: 3000 });
    } catch (err) {
      console.warn("Welfare recompute trigger failed (non-blocking):", err?.message);
    }
  }

  async function triggerHealthRecompute() {
    try {
      await postJson("/admin/run-task", { task: "health_insights" });
      toast.success("Health analysis recomputation queued.", { duration: 3000 });
    } catch (err) {
      console.warn("Health recompute trigger failed (non-blocking):", err?.message);
    }
  }

  async function saveSchoolRecord(event) {
    event.preventDefault();
    if (!editingRecord?.school_id) {
      return;
    }

    const payload = {};
    const nextPayloadValues = {};
    SCHOOL_EDIT_FIELDS.forEach((field) => {
      const nextValue = toPayloadValue(editValues[field.key], field.type);
      const currentValue = toPayloadValue(editingRecord[field.key], field.type);
      nextPayloadValues[field.payloadKey] = nextValue;

      if (!hasSamePayloadValue(nextValue, currentValue)) {
        payload[field.payloadKey] = nextValue;
      }
    });

    const hasLatitudeChange = Object.prototype.hasOwnProperty.call(payload, "latitude");
    const hasLongitudeChange = Object.prototype.hasOwnProperty.call(payload, "longitude");

    if (hasLatitudeChange || hasLongitudeChange) {
      const nextLatitude = nextPayloadValues.latitude;
      const nextLongitude = nextPayloadValues.longitude;

      if (
        nextLatitude === null ||
        nextLongitude === null ||
        Number.isNaN(nextLatitude) ||
        Number.isNaN(nextLongitude)
      ) {
        setErrorMessage("Latitude and longitude must both be valid numbers.");
        return;
      }

      payload.latitude = nextLatitude;
      payload.longitude = nextLongitude;
    }

    if (Object.keys(payload).length === 0) {
      setEditingRecord(null);
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      const response = await patchJson(`/admin-data/education/${editingRecord.school_id}`, payload);
      const updatedRecord = response?.data?.record;
      if (updatedRecord) {
        setRecords((items) =>
          items.map((item) => (item.school_id === updatedRecord.school_id ? updatedRecord : item)),
        );
      } else {
        await loadTableData();
      }
      setEditingRecord(null);
      toast.success("School record updated. Recomputing analysis…");
      triggerEducationRecompute();
    } catch (err) {
      console.error("Failed to update school record", err);
      const message = err?.response?.data?.message || "Unable to update this school record.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveWelfareRecord(event) {
    event.preventDefault();
    if (!selectedTable?.editType || !editingRecord) {
      return;
    }

    const fields =
      selectedTable.editType === "welfare_beneficiary"
        ? WELFARE_BENEFICIARY_EDIT_FIELDS
        : WELFARE_PROGRAM_EDIT_FIELDS;
    const payload = {};
    const nextPayloadValues = {};

    fields.forEach((field) => {
      const nextValue = toPayloadValue(editValues[field.key], field.type);
      const currentValue = toPayloadValue(editingRecord[field.key], field.type);
      nextPayloadValues[field.payloadKey] = nextValue;

      if (!hasSamePayloadValue(nextValue, currentValue)) {
        payload[field.payloadKey] = nextValue;
      }
    });

    if (selectedTable.editType === "welfare_beneficiary") {
      const hasLatitudeChange = Object.prototype.hasOwnProperty.call(payload, "latitude");
      const hasLongitudeChange = Object.prototype.hasOwnProperty.call(payload, "longitude");

      if (hasLatitudeChange || hasLongitudeChange) {
        const nextLatitude = nextPayloadValues.latitude;
        const nextLongitude = nextPayloadValues.longitude;

        if (
          nextLatitude === null ||
          nextLongitude === null ||
          Number.isNaN(nextLatitude) ||
          Number.isNaN(nextLongitude)
        ) {
          setErrorMessage("Latitude and longitude must both be valid numbers.");
          return;
        }

        payload.latitude = nextLatitude;
        payload.longitude = nextLongitude;
      }
    }

    if (Object.keys(payload).length === 0) {
      setEditingRecord(null);
      return;
    }

    const recordId = getTableRecordId(editingRecord, selectedTable);
    if (!recordId) {
      return;
    }

    const endpoint =
      selectedTable.editType === "welfare_beneficiary"
        ? `/admin-data/social_welfare/beneficiary/${recordId}`
        : `/admin-data/social_welfare/programs/${recordId}`;

    try {
      setSaving(true);
      setErrorMessage("");
      const response = await patchJson(endpoint, payload);
      const updatedRecord = response?.data?.record;

      if (updatedRecord) {
        setRecords((items) =>
          items.map((item) =>
            getTableRecordId(item, selectedTable) === recordId ? { ...item, ...updatedRecord } : item,
          ),
        );
      } else {
        await loadTableData();
      }

      setEditingRecord(null);
      if (selectedTable.editType === "welfare_beneficiary") {
        toast.success("Beneficiary updated. Recomputing welfare analysis…");
        triggerWelfareRecompute();
      } else {
        toast.success("Welfare program updated.");
      }
    } catch (err) {
      console.error("Failed to update welfare record", err);
      const message = err?.response?.data?.message || "Unable to update this record.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function createSchoolRecord(event) {
    event.preventDefault();

    const payload = {};
    SCHOOL_EDIT_FIELDS.forEach((field) => {
      const value = toPayloadValue(createValues[field.key], field.type);
      if (value !== null && value !== undefined && value !== "") {
        payload[field.payloadKey] = value;
      }
    });

    const hasLatitude = Object.prototype.hasOwnProperty.call(payload, "latitude");
    const hasLongitude = Object.prototype.hasOwnProperty.call(payload, "longitude");

    if (hasLatitude !== hasLongitude) {
      setErrorMessage("Latitude and longitude must both be provided together.");
      return;
    }

    if (hasLatitude && hasLongitude) {
      if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
        setErrorMessage("Latitude and longitude must be valid numbers.");
        return;
      }
    }

    try {
      setSaving(true);
      setErrorMessage("");
      await postJson("/admin-data/education", payload);
      setCreatingRecord(false);
      await loadTableData();
      toast.success("School record created. Recomputing analysis…");
      triggerEducationRecompute();
    } catch (err) {
      console.error("Failed to create school record", err);
      const message = err?.response?.data?.message || "Unable to create this school record.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function createWelfareRecord(event) {
    event.preventDefault();
    const createType = selectedTable?.createType;
    const endpoint = selectedTable?.createEndpoint;
    if (!endpoint) return;

    try {
      setSaving(true);
      setErrorMessage("");

      if (createType === "welfare_program") {
        if (!createValues.program_name?.trim()) {
          setErrorMessage("Program name is required.");
          setSaving(false);
          return;
        }
        await postJson(`/admin-data/${endpoint}`, {
          program_name: createValues.program_name,
          department: createValues.department || null,
          description: createValues.description || null,
        });
        toast.success("Welfare program created.");
      } else if (createType === "welfare_beneficiary") {
        if (!createValues.programId) {
          setErrorMessage("Program ID is required.");
          setSaving(false);
          return;
        }
        if (!createValues.firstname?.trim() || !createValues.lastname?.trim()) {
          setErrorMessage("First name and last name are required.");
          setSaving(false);
          return;
        }
        if (!createValues.latitude || !createValues.longitude) {
          setErrorMessage("Latitude and longitude are required.");
          setSaving(false);
          return;
        }
        await postJson(`/admin-data/${endpoint}`, {
          programId: Number(createValues.programId),
          firstname: createValues.firstname,
          lastname: createValues.lastname,
          gender: createValues.gender || null,
          age: createValues.age !== "" ? Number(createValues.age) : null,
          householdSize: createValues.householdSize !== "" ? Number(createValues.householdSize) : null,
          status: createValues.status || null,
          startDate: createValues.startDate || null,
          endDate: createValues.endDate || null,
          districtId: createValues.districtId !== "" ? Number(createValues.districtId) : null,
          taId: createValues.taId !== "" ? Number(createValues.taId) : null,
          latitude: Number(createValues.latitude),
          longitude: Number(createValues.longitude),
        });
        toast.success("Beneficiary created. Recomputing welfare analysis…");
      }

      setCreatingRecord(false);
      await loadTableData();
      if (createType === "welfare_beneficiary") {
        triggerWelfareRecompute();
      }
    } catch (err) {
      console.error("Failed to create welfare record", err);
      const message = err?.response?.data?.message || "Unable to create record.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function saveHealthRecord(event) {
    event.preventDefault();
    if (!editingRecord?.id) {
      return;
    }

    const payload = {};
    const nextPayloadValues = {};
    HEALTH_EDIT_FIELDS.forEach((field) => {
      const nextValue =
        field.key === "services_offered"
          ? servicesOfferedForInput(editValues[field.key])
          : toPayloadValue(editValues[field.key], field.type);
      const currentValue =
        field.key === "services_offered"
          ? servicesOfferedForInput(editingRecord[field.key])
          : toPayloadValue(
              field.key === "ward_id"
                ? editingRecord.ward_id ?? editingRecord.ta_id
                : editingRecord[field.key],
              field.type,
            );
      nextPayloadValues[field.payloadKey] = nextValue;

      if (!hasSamePayloadValue(nextValue, currentValue)) {
        payload[field.payloadKey] = nextValue;
      }
    });

    const hasLatitudeChange = Object.prototype.hasOwnProperty.call(payload, "latitude");
    const hasLongitudeChange = Object.prototype.hasOwnProperty.call(payload, "longitude");

    if (hasLatitudeChange || hasLongitudeChange) {
      const nextLatitude = nextPayloadValues.latitude;
      const nextLongitude = nextPayloadValues.longitude;

      if (
        nextLatitude === null ||
        nextLongitude === null ||
        Number.isNaN(nextLatitude) ||
        Number.isNaN(nextLongitude)
      ) {
        setErrorMessage("Latitude and longitude must both be valid numbers.");
        return;
      }

      payload.latitude = nextLatitude;
      payload.longitude = nextLongitude;
    }

    if (Object.keys(payload).length === 0) {
      setEditingRecord(null);
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      const response = await patchJson(`/admin-data/health/${editingRecord.id}`, payload);
      const updatedRecord = response?.data?.record;
      if (updatedRecord) {
        setRecords((items) =>
          items.map((item) => (item.id === updatedRecord.id ? updatedRecord : item)),
        );
      } else {
        await loadTableData();
      }
      setEditingRecord(null);
      toast.success("Health facility updated. Recomputing analysis…");
      triggerHealthRecompute();
    } catch (err) {
      console.error("Failed to update health facility", err);
      const message = err?.response?.data?.message || "Unable to update this health facility.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function createHealthRecord(event) {
    event.preventDefault();

    const payload = {};
    HEALTH_EDIT_FIELDS.forEach((field) => {
      const value =
        field.key === "services_offered"
          ? servicesOfferedForInput(createValues[field.key])
          : toPayloadValue(createValues[field.key], field.type);
      if (value !== null && value !== undefined && value !== "") {
        payload[field.payloadKey] = value;
      }
    });

    if (!payload.name) {
      setErrorMessage("Facility name is required.");
      return;
    }

    if (payload.latitude === undefined || payload.longitude === undefined) {
      setErrorMessage("Latitude and longitude are required.");
      return;
    }

    if (Number.isNaN(payload.latitude) || Number.isNaN(payload.longitude)) {
      setErrorMessage("Latitude and longitude must be valid numbers.");
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      await postJson("/admin-data/health", payload);
      setCreatingRecord(false);
      await loadTableData();
      toast.success("Health facility created. Recomputing analysis…");
      triggerHealthRecompute();
    } catch (err) {
      console.error("Failed to create health facility", err);
      const message = err?.response?.data?.message || "Unable to create this health facility.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteHealthRecord(record) {
    if (!selectedTable?.deletable || !record?.id) {
      return;
    }

    const label = record.name || `facility #${record.id}`;
    if (!window.confirm(`Archive ${label}? It will be marked inactive and hidden from active lists.`)) {
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      await postJson(`/admin-data/health/${record.id}/archive`);
      setRecords((items) => items.filter((item) => item.id !== record.id));
      setMeta((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
        total_pages: Math.max(0, Math.ceil(Math.max(0, current.total - 1) / 25)),
      }));
      toast.success("Health facility archived. Recomputing analysis…");
      triggerHealthRecompute();
    } catch (err) {
      console.error("Failed to archive health facility", err);
      const message = err?.response?.data?.message || "Unable to archive this health facility.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteWelfareRecord(record) {
    if (!selectedTable?.deletable) {
      return;
    }

    const recordId = getTableRecordId(record, selectedTable);
    if (!recordId) {
      return;
    }

    const isBeneficiary = selectedTable.editType === "welfare_beneficiary";
    const label = isBeneficiary
      ? `${record.firstname || ""} ${record.lastname || ""}`.trim() || `beneficiary #${recordId}`
      : record.program_name || `program #${recordId}`;

    if (!window.confirm(`Delete ${label}? This action cannot be undone.`)) {
      return;
    }

    const endpoint = isBeneficiary
      ? `/admin-data/social_welfare/beneficiary/${recordId}`
      : `/admin-data/social_welfare/programs/${recordId}`;

    try {
      setSaving(true);
      setErrorMessage("");
      await deleteJson(endpoint);
      setRecords((items) => items.filter((item) => getTableRecordId(item, selectedTable) !== recordId));
      setMeta((current) => ({
        ...current,
        total: Math.max(0, current.total - 1),
        total_pages: Math.max(0, Math.ceil(Math.max(0, current.total - 1) / 25)),
      }));
      if (isBeneficiary) {
        toast.success("Beneficiary deleted. Recomputing welfare analysis…");
        triggerWelfareRecompute();
      } else {
        toast.success("Welfare program deleted.");
      }
    } catch (err) {
      console.error("Failed to delete welfare record", err);
      const message = err?.response?.data?.message || "Unable to delete this record.";
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteRecord(record) {
    if (department === "health") {
      deleteHealthRecord(record);
      return;
    }

    deleteWelfareRecord(record);
  }

  const fromRecord = meta.total ? (page - 1) * 25 + 1 : 0;
  const toRecord = Math.min(page * 25, meta.total);

  return (
    <div className="flex h-full min-h-[520px] flex-col overflow-hidden rounded border border-slate-200 !bg-white shadow-none md:min-h-[640px]">
      <div className="!bg-white">
        <div className="flex flex-col gap-4 !bg-white p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Database size={16} className="text-slate-500" />
              {department.replace("_", " ")} Tables
            </div>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
              Select a dataset, search once, then open a row to inspect or update details.
            </p>
          </div>

          <div className="relative w-full xl:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
            <input
              type="search"
              spellCheck="false"
              placeholder={`Search ${selectedTable?.label || "records"}...`}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-950 caret-slate-950 outline-none transition-all placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto !bg-white px-4 pb-4 pt-1">
          {selectedTable?.canCreate && (
            <button
              type="button"
              onClick={handleOpenCreator}
              className="flex shrink-0 items-center gap-2 rounded border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition-all duration-200 ease-out hover:bg-emerald-700"
            >
              <Plus size={15} />
              {selectedTable.createType === "welfare_program"
                ? "Add Program"
                : selectedTable.createType === "welfare_beneficiary"
                ? "Add Beneficiary"
                : department === "health"
                ? "Add Facility"
                : "Add School"}
            </button>
          )}
          {tables.map((table) => {
            const isActive = selectedTableId === table.id;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => {
                  setSelectedTableId(table.id);
                  setPage(1);
                  setEditingRecord(null);
                }}
                style={{
                  backgroundColor: isActive ? "#000000" : "#f3f4f6",
                  borderColor: isActive ? "#000000" : "#e5e7eb",
                  color: isActive ? "#ffffff" : "#374151",
                }}
                className="flex shrink-0 items-center gap-2 rounded border px-4 py-2 text-sm font-bold transition-all duration-200 ease-out hover:brightness-95"
              >
                <table.icon size={15} style={{ color: isActive ? "#ffffff" : "#4b5563" }} />
                {table.label}
              </button>
            );
          })}
        </div>
      </div>

      {errorMessage && (
        <div className="border-b border-red-100 bg-red-50 px-3 py-3 text-sm font-semibold text-red-700 sm:px-4">
          {errorMessage}
        </div>
      )}

      <main className="relative flex-1 !bg-white">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <RefreshCw size={24} className="animate-spin text-slate-500" />
          </div>
        )}

        <table className="w-full min-w-[1500px] border-collapse !bg-white text-left">
          <thead className="sticky top-0 z-10 !bg-white">
            <tr>
              {columns.map((col) => (
                <th key={col} className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  <div className="flex items-center gap-2">
                    {formatLabel(col)}
                    <ArrowUpDown size={12} className="text-slate-300" />
                  </div>
                </th>
              ))}
              <th className="w-40 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record, idx) => (
              <tr
                key={record[deptConfig.idKey] || getTableRecordId(record, selectedTable) || idx}
                className="group hover:bg-slate-50"
              >
                {columns.map((col) => (
                  <td key={col} className="max-w-[220px] px-4 py-3 align-top">
                    <span className="block truncate text-[13px] font-medium text-slate-700" title={displayValue(record[col])}>
                      {displayValue(record[col])}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  {selectedTable?.editable || selectedTable?.deletable ? (
                    <div className="flex justify-end gap-2">
                      {selectedTable?.editable && (
                        <button
                          type="button"
                          onClick={() => openEditor(record)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Pencil size={12} />
                            Edit
                          </span>
                        </button>
                      )}
                      {selectedTable?.deletable && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(record)}
                          disabled={saving}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700 transition-all hover:border-red-700 hover:bg-red-700 hover:text-white disabled:opacity-60"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Trash2 size={12} />
                            Delete
                          </span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="py-14 text-center text-sm font-semibold text-slate-400">
                  No records found for this table.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </main>

      <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
        <div className="text-xs font-medium text-slate-600">
          Showing <span className="font-bold text-slate-900">{fromRecord}</span> to{" "}
          <span className="font-bold text-slate-900">{toRecord}</span> of{" "}
          <span className="font-bold text-slate-900">{meta.total}</span> records
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 text-xs font-bold text-slate-700">
            Page {page} of {meta.total_pages || 1}
          </div>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(meta.total_pages || current, current + 1))}
            disabled={page >= (meta.total_pages || 1)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 transition-all hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>

      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          {department === "health" ? (
            <form
              onSubmit={saveHealthRecord}
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">{displayValue(editingRecord.name)}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Update health facility details, including coordinates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_280px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  {HEALTH_EDIT_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === "name" ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
                        {field.label}
                      </span>
                      {field.type === "checkbox" ? (
                        <div className="flex h-11 items-center rounded-xl border border-slate-300 px-3">
                          <input
                            type="checkbox"
                            checked={Boolean(editValues[field.key])}
                            onChange={(event) =>
                              setEditValues((current) => ({ ...current, [field.key]: event.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                          />
                          <span className="ml-2 text-sm font-semibold text-slate-800">Record is active</span>
                        </div>
                      ) : (
                        <input
                          type={field.type}
                          step={field.type === "number" ? "any" : undefined}
                          value={editValues[field.key] ?? ""}
                          onChange={(event) =>
                            setEditValues((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 caret-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                        />
                      )}
                    </label>
                  ))}
                </div>

                <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-bold text-slate-900">Record details</h4>
                  <dl className="mt-4 space-y-3">
                    {READ_ONLY_HEALTH_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold text-slate-800">
                          {displayValue(editingRecord[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save changes
                </button>
              </div>
            </form>
          ) : department === "education" ? (
            <form
              onSubmit={saveSchoolRecord}
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">{displayValue(editingRecord.name)}</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Update school record details, including coordinates.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_280px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  {SCHOOL_EDIT_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === "name" ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
                        {field.label}
                      </span>
                      {field.type === "checkbox" ? (
                        <div className="flex h-11 items-center rounded-xl border border-slate-300 px-3">
                          <input
                            type="checkbox"
                            checked={Boolean(editValues[field.key])}
                            onChange={(event) =>
                              setEditValues((current) => ({ ...current, [field.key]: event.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20"
                          />
                          <span className="ml-2 text-sm font-semibold text-slate-800">Record is active</span>
                        </div>
                      ) : (
                        <input
                          type={field.type}
                          step={field.type === "number" ? "any" : undefined}
                          value={editValues[field.key] ?? ""}
                          onChange={(event) =>
                            setEditValues((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 caret-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                        />
                      )}
                    </label>
                  ))}
                </div>

                <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-bold text-slate-900">Record details</h4>
                  <dl className="mt-4 space-y-3">
                    {READ_ONLY_SCHOOL_FIELDS.map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold text-slate-800">
                          {displayValue(editingRecord[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save changes
                </button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={saveWelfareRecord}
              className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">
                    {selectedTable?.editType === "welfare_beneficiary"
                      ? `${displayValue(editingRecord.firstname)} ${displayValue(editingRecord.lastname)}`
                      : displayValue(editingRecord.program_name)}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    {selectedTable?.editType === "welfare_beneficiary"
                      ? "Update beneficiary details, including program and coordinates."
                      : "Update welfare program details."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[1fr_280px]">
                <div className="grid gap-4 sm:grid-cols-2">
                  {(selectedTable?.editType === "welfare_beneficiary"
                    ? WELFARE_BENEFICIARY_EDIT_FIELDS
                    : WELFARE_PROGRAM_EDIT_FIELDS
                  ).map((field) => (
                    <label key={field.key} className={field.key === "description" || field.key === "program_id" ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
                        {field.label}
                      </span>
                      {field.type === "program-select" ? (
                        <select
                          value={editValues[field.key] ?? ""}
                          onChange={(event) =>
                            setEditValues((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                        >
                          <option value="">Select a program</option>
                          {welfarePrograms.map((program) => (
                            <option key={program.program_id} value={program.program_id}>
                              {program.program_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type}
                          step={field.type === "number" ? "any" : undefined}
                          value={editValues[field.key] ?? ""}
                          onChange={(event) =>
                            setEditValues((current) => ({ ...current, [field.key]: event.target.value }))
                          }
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 caret-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                        />
                      )}
                    </label>
                  ))}
                </div>

                <aside className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-bold text-slate-900">Record details</h4>
                  <dl className="mt-4 space-y-3">
                    {(selectedTable?.editType === "welfare_beneficiary"
                      ? READ_ONLY_WELFARE_BENEFICIARY_FIELDS
                      : READ_ONLY_WELFARE_PROGRAM_FIELDS
                    ).map(([key, label]) => (
                      <div key={key}>
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</dt>
                        <dd className="mt-0.5 break-words text-sm font-semibold text-slate-800">
                          {displayValue(editingRecord[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </aside>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-slate-900/10 hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
                  Save changes
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {creatingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          {/* ── Health facility create form ── */}
          {department === "health" && selectedTable?.canCreate && (
            <form
              onSubmit={createHealthRecord}
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Add Health Facility</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Fill in facility details. Latitude and longitude are required to place the facility on the map.
                  </p>
                </div>
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
              </div>
              {errorMessage && <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{errorMessage}</div>}
              <div className="overflow-y-auto p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {HEALTH_EDIT_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === "name" ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">{field.label}</span>
                      {field.type === "checkbox" ? (
                        <div className="flex h-11 items-center rounded-xl border border-slate-300 px-3">
                          <input type="checkbox" checked={Boolean(createValues[field.key])} onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                          <span className="ml-2 text-sm font-semibold text-slate-800">Record is active</span>
                        </div>
                      ) : (
                        <input type={field.type} step={field.type === "number" ? "any" : undefined} value={createValues[field.key] ?? ""} onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10" />
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create facility
                </button>
              </div>
            </form>
          )}

          {/* ── School create form ── */}
          {department === "education" && (!selectedTable?.createType || selectedTable.createType === "school") && (
            <form
              onSubmit={createSchoolRecord}
              className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Add New School</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Fill in the school details. Latitude and longitude are required to place the school on the map.
                  </p>
                </div>
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
              </div>
              {errorMessage && <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{errorMessage}</div>}
              <div className="overflow-y-auto p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {SCHOOL_EDIT_FIELDS.map((field) => (
                    <label key={field.key} className={field.key === "name" ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">{field.label}</span>
                      {field.type === "checkbox" ? (
                        <div className="flex h-11 items-center rounded-xl border border-slate-300 px-3">
                          <input type="checkbox" checked={Boolean(createValues[field.key])} onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
                          <span className="ml-2 text-sm font-semibold text-slate-800">Record is active</span>
                        </div>
                      ) : (
                        <input type={field.type} step={field.type === "number" ? "any" : undefined} value={createValues[field.key] ?? ""} onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10" />
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create school
                </button>
              </div>
            </form>
          )}

          {/* ── Welfare Program create form ── */}
          {selectedTable?.createType === "welfare_program" && (
            <form
              onSubmit={createWelfareRecord}
              className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Add Welfare Program</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">Create a new welfare program that beneficiaries can be linked to.</p>
                </div>
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
              </div>
              {errorMessage && <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{errorMessage}</div>}
              <div className="overflow-y-auto p-5">
                <div className="grid gap-4">
                  {[
                    { key: "program_name", label: "Program name *", type: "text" },
                    { key: "department", label: "Department", type: "text" },
                    { key: "description", label: "Description", type: "text" },
                  ].map((field) => (
                    <label key={field.key}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">{field.label}</span>
                      <input type={field.type} value={createValues[field.key] ?? ""} onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.value }))} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10" />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create program
                </button>
              </div>
            </form>
          )}

          {/* ── Welfare Beneficiary create form ── */}
          {selectedTable?.createType === "welfare_beneficiary" && (
            <form
              onSubmit={createWelfareRecord}
              className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Add Beneficiary</h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Register a new individual beneficiary. Latitude and longitude are required to place them on the map.
                  </p>
                </div>
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X size={18} /></button>
              </div>
              {errorMessage && <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{errorMessage}</div>}
              <div className="overflow-y-auto p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Program dropdown */}
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
                      Program *
                    </span>
                    {loadingPrograms ? (
                      <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm text-slate-400">
                        <RefreshCw size={14} className="animate-spin" /> Loading programs…
                      </div>
                    ) : (
                      <select
                        value={createValues.programId ?? ""}
                        onChange={(e) => setCreateValues((c) => ({ ...c, programId: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                      >
                        <option value="">— Select a program —</option>
                        {welfarePrograms.map((p) => (
                          <option key={p.program_id} value={p.program_id}>
                            {p.program_name}
                          </option>
                        ))}
                      </select>
                    )}
                  </label>

                  {/* Remaining fields */}
                  {[
                    { key: "firstname", label: "First name *", type: "text", span: false },
                    { key: "lastname", label: "Last name *", type: "text", span: false },
                    { key: "gender", label: "Gender", type: "text", span: false, hint: "Male / Female / Other" },
                    { key: "age", label: "Age", type: "number", span: false },
                    { key: "householdSize", label: "Household size", type: "number", span: false },
                    { key: "status", label: "Status", type: "text", span: false },
                    { key: "startDate", label: "Start date", type: "date", span: false },
                    { key: "endDate", label: "End date", type: "date", span: false },
                    { key: "districtId", label: "District ID", type: "number", span: false },
                    { key: "taId", label: "TA ID", type: "number", span: false },
                    { key: "latitude", label: "Latitude *", type: "number", span: false },
                    { key: "longitude", label: "Longitude *", type: "number", span: false },
                  ].map((field) => (
                    <label key={field.key} className={field.span ? "sm:col-span-2" : ""}>
                      <span className="mb-1.5 block text-xs font-bold uppercase tracking-widest text-slate-500">
                        {field.label}
                        {field.hint && <span className="ml-1 normal-case font-normal text-slate-400">({field.hint})</span>}
                      </span>
                      <input
                        type={field.type}
                        step={field.type === "number" ? "any" : undefined}
                        value={createValues[field.key] ?? ""}
                        onChange={(e) => setCreateValues((c) => ({ ...c, [field.key]: e.target.value }))}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 p-4">
                <button type="button" onClick={() => { setCreatingRecord(false); setErrorMessage(""); }} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60">
                  {saving ? <RefreshCw size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create beneficiary
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
