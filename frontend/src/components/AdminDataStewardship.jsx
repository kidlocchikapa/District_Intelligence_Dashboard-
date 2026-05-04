import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  RefreshCw,
  Save,
  School,
  Search,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";
import { fetchJson, patchJson } from "../lib/api";

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
    },
    {
      id: "flood_exposed_schools",
      label: "Flood Exposed Schools",
      icon: ShieldAlert,
      endpoint: "education?filter=flood_exposed",
      columns: SCHOOL_COLUMNS,
      editable: true,
    },
    {
      id: "flood_exposure_summary",
      label: "Flood Exposure Summary",
      icon: FileText,
      endpoint: "education/flood_summary",
      columns: ["admin_unit_name", "metric_name", "metric_value", "metric_unit"],
    },
  ],
  health: [
    {
      id: "health_facilities",
      label: "Health Facilities",
      icon: Activity,
      endpoint: "health",
      columns: ["name", "type", "healthcare", "district_name", "ward_name", "beds_count", "patient_visits_total"],
    },
    {
      id: "flood_exposed_health",
      label: "Flood Exposed Health",
      icon: ShieldAlert,
      endpoint: "health?filter=flood_exposed",
      columns: ["name", "type", "healthcare", "district_name", "ward_name"],
    },
    {
      id: "health_summary",
      label: "Health Summary",
      icon: FileText,
      endpoint: "health/summary",
      columns: ["admin_unit_name", "facility_count", "beds_total"],
    },
  ],
  social_welfare: [
    {
      id: "welfare_beneficiary",
      label: "Welfare Beneficiary",
      icon: Users,
      endpoint: "social_welfare",
      columns: ["program_name", "beneficiary_count", "district_name", "ward_name"],
    },
    {
      id: "welfare_indicator",
      label: "Beneficiary Indicators",
      icon: Activity,
      endpoint: "social_welfare/indicators",
      columns: ["beneficiary_id", "indicator_name", "indicator_value", "last_updated"],
    },
    {
      id: "welfare_programs",
      label: "Welfare Programs",
      icon: FileText,
      endpoint: "social_welfare/programs",
      columns: ["program_id", "program_name", "description"],
    },
  ],
  disaster: [
    {
      id: "flood_facility_exposure",
      label: "Flood Facility Exposure",
      icon: Activity,
      endpoint: "disaster/facility_exposure",
      columns: ["name", "type", "risk_level", "flood_depth"],
    },
    {
      id: "flood_exposure_summary",
      label: "Exposure Summary",
      icon: FileText,
      endpoint: "disaster/exposure_summary",
      columns: ["admin_unit_name", "total_facilities", "at_risk_count", "risk_percentage"],
    },
    {
      id: "flood_zones",
      label: "Flood Zones",
      icon: ShieldAlert,
      endpoint: "disaster",
      columns: ["event_type", "risk_level", "population_at_risk"],
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
  { key: "district_id", label: "District ID", type: "number", payloadKey: "districtId" },
  { key: "ward_id", label: "TA ID", type: "number", payloadKey: "wardId" },
  { key: "is_active", label: "Active", type: "checkbox", payloadKey: "isActive" },
];

const READ_ONLY_SCHOOL_FIELDS = [
  ["school_id", "School ID"],
  ["district_name", "District"],
  ["ward_name", "TA"],
  ["latitude", "Latitude"],
  ["longitude", "Longitude"],
  ["x_coordinate", "X coordinate"],
  ["y_coordinate", "Y coordinate"],
  ["created_at", "Created"],
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

  return String(value);
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

  if (type === "number") {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }

  return value === "" ? null : value;
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
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedTable = useMemo(
    () => tables.find((table) => table.id === selectedTableId) || tables[0],
    [selectedTableId, tables],
  );

  const columns = selectedTable?.columns || deptConfig.columns || [];

  useEffect(() => {
    setSelectedTableId(tables[0]?.id || "");
    setSearchQuery("");
    setPage(1);
    setEditingRecord(null);
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

  async function saveSchoolRecord(event) {
    event.preventDefault();
    if (!editingRecord?.school_id) {
      return;
    }

    const payload = {};
    SCHOOL_EDIT_FIELDS.forEach((field) => {
      payload[field.payloadKey] = toPayloadValue(editValues[field.key], field.type);
    });

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
    } catch (err) {
      console.error("Failed to update school record", err);
      setErrorMessage(err?.response?.data?.message || "Unable to update this school record.");
    } finally {
      setSaving(false);
    }
  }

  const fromRecord = meta.total ? (page - 1) * 25 + 1 : 0;
  const toRecord = Math.min(page * 25, meta.total);

  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden rounded border border-slate-200 !bg-white shadow-none">
      <header className="!bg-white">
        <div className="flex flex-col gap-4 !bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Database size={16} className="text-slate-500" />
              {department.replace("_", " ")} Tables
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
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

        <div className="flex gap-2 overflow-x-auto !bg-white px-4 pb-4 pt-1">
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
      </header>

      {errorMessage && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      )}

      <main className="relative flex-1 overflow-auto !bg-white">
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
              <th className="w-28 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((record, idx) => (
              <tr key={record[deptConfig.idKey] || record.school_id || idx} className="group hover:bg-slate-50">
                {columns.map((col) => (
                  <td key={col} className="max-w-[220px] px-4 py-3 align-top">
                    <span className="block truncate text-[13px] font-medium text-slate-700" title={displayValue(record[col])}>
                      {displayValue(record[col])}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  {selectedTable?.editable ? (
                    <button
                      type="button"
                      onClick={() => openSchoolEditor(record)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                    >
                      Edit
                    </button>
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

      <footer className="flex flex-col gap-3 border-t border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs font-medium text-slate-600">
          Showing <span className="font-bold text-slate-900">{fromRecord}</span> to{" "}
          <span className="font-bold text-slate-900">{toRecord}</span> of{" "}
          <span className="font-bold text-slate-900">{meta.total}</span> records
        </div>
        <div className="flex items-center gap-2">
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
          <form
            onSubmit={saveSchoolRecord}
            className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <h3 className="text-xl font-bold text-slate-950">{displayValue(editingRecord.name)}</h3>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Update school record details. Coordinates are read-only.
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
        </div>
      )}
    </div>
  );
}
