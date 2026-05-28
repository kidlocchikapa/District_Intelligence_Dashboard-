import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { fetchJson, patchJson } from "../lib/api";
import { toast } from "react-hot-toast";
import ReviewChangesModal from "./ReviewChangesModal";

const GLOBAL_TABLES = [
  {
    id: "pending_review_requests",
    label: "Pending Verifications",
    requestPath: "/admin-data/reviews/pending",
    reviewBasePath: "/admin-data/reviews",
    reviewActions: true,
    columns: [
      "id",
      "table_name",
      "record_id",
      "action",
      "changed_by_full_name",
      "changed_by_email",
      "changed_fields",
      "changed_at",
    ],
  },
  {
    id: "admin_data_edits",
    label: "Admin Data Edits",
    endpoint: "admin-data-edits",
    columns: [
      "id",
      "table_name",
      "record_id",
      "action",
      "status",
      "changed_by_email",
      "changed_by_full_name",
      "reviewed_by_full_name",
      "review_notes",
      "changed_at",
    ],
  },
  {
    id: "admin3_units",
    label: "Admin Units",
    endpoint: "admin-units",
    columns: [
      "id",
      "name",
      "code",
      "type",
      "district_name",
      "population_total",
      "population_density",
      "latitude",
      "longitude",
      "updated_at",
    ],
  },
  {
    id: "analysis_results",
    label: "Analysis Results",
    endpoint: "analysis-results",
    supportsAnalysisFilter: true,
    columns: [
      "id",
      "analysis_type",
      "admin_unit_name",
      "admin_unit_type",
      "metric_name",
      "metric_value",
      "metric_unit",
      "calculated_at",
    ],
  },
  {
    id: "data_load_log",
    label: "Data Load Logs",
    endpoint: "data-load-logs",
    columns: [
      "id",
      "source_filename",
      "dataset_type",
      "table_name",
      "status",
      "rows_read",
      "rows_loaded",
      "rows_flagged",
      "started_at",
      "completed_at",
      "error_message",
    ],
  },
  {
    id: "worldpop_age_sex",
    label: "WorldPop Age Sex",
    endpoint: "worldpop-age-sex",
    columns: [
      "id",
      "admin_unit_name",
      "admin_unit_type",
      "worldpop_year",
      "age_class",
      "age_label",
      "male_population",
      "female_population",
      "total_population",
      "created_at",
    ],
  },
  {
    id: "education_facility_access_metrics",
    label: "Education Access Metrics",
    endpoint: "education-access-metrics",
    columns: [
      "facility_id",
      "facility_name",
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
  {
    id: "health_facility_access_metrics",
    label: "Health Access Metrics",
    endpoint: "health-access-metrics",
    columns: [
      "facility_id",
      "facility_name",
      "facility_type",
      "district_name",
      "ward_name",
      "coverage_distance_km",
      "worldpop_population_within_buffer",
      "welfare_beneficiaries_served_by_8km_network",
      "avg_network_distance_km",
      "avg_travel_time_min",
      "calculated_at",
    ],
  },
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
    return value.length ? value.map((item) => displayValue(item)).join(", ") : "-";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export default function GlobalAdminStewardship() {
  const [selectedTableId, setSelectedTableId] = useState(GLOBAL_TABLES[0].id);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [analysisType, setAnalysisType] = useState("");
  const [analysisTypes, setAnalysisTypes] = useState([]);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, total_pages: 0 });
  const [errorMessage, setErrorMessage] = useState("");
  const [previewRecord, setPreviewRecord] = useState(null);

  const selectedTable = useMemo(
    () => GLOBAL_TABLES.find((table) => table.id === selectedTableId) || GLOBAL_TABLES[0],
    [selectedTableId],
  );

  const columns = selectedTable.columns || [];
  const resolveTablePath = useCallback(
    (table) => {
      if (!table) {
        return "";
      }

      if (table.requestPath) {
        return table.requestPath;
      }

      return `/admin-data/global/${table.endpoint}`;
    },
    [],
  );

  useEffect(() => {
    fetchJson("/admin-data/global/tables")
      .then((response) => {
        setAnalysisTypes(response?.analysis_types || []);
      })
      .catch(() => setAnalysisTypes([]));
  }, []);

  const loadTableData = useCallback(async () => {
    if (!selectedTable) {
      return;
    }

    try {
      setLoading(true);
      setErrorMessage("");
      const response = await fetchJson(resolveTablePath(selectedTable), {
        params: {
          page,
          page_size: 25,
          search: searchQuery,
          ...(selectedTable.supportsAnalysisFilter && analysisType
            ? { analysis_type: analysisType }
            : {}),
        },
      });

      setRecords(response.items || []);
      setMeta({
        total: response.total || 0,
        total_pages: response.total_pages || 0,
      });
    } catch (err) {
      console.error("Failed to load global admin table", err);
      setErrorMessage(err?.response?.data?.message || "Unable to load records.");
      setRecords([]);
      setMeta({ total: 0, total_pages: 0 });
    } finally {
      setLoading(false);
    }
  }, [analysisType, page, resolveTablePath, searchQuery, selectedTable]);

  const handleReviewAction = useCallback(
    async (record, decision) => {
      if (!record?.id || !selectedTable?.reviewActions) {
        return false;
      }

      const reviewNotes =
        decision === "reject"
          ? window.prompt("Optional rejection note", "")?.trim() || ""
          : "";

      try {
        setLoading(true);
        await patchJson(
          `${selectedTable.reviewBasePath}/${record.id}/${decision}`,
          decision === "reject" && reviewNotes ? { reviewNotes } : {},
        );
        toast.success(
          decision === "approve"
            ? "Review approved and applied."
            : "Review rejected.",
        );
        await loadTableData();
        return true;
    } catch (err) {
      const message = err?.response?.data?.message || "";
      if (/Only pending reviews can be (approved|rejected)/i.test(message)) {
        toast.error("This review was already processed. Refreshing the list.");
        await loadTableData();
        setPreviewRecord(null);
        return false;
      }

      console.error("Failed to process review action", err);
      toast.error(message || "Unable to process the review.");
      return false;
    } finally {
      setLoading(false);
      }
    },
    [loadTableData, selectedTable],
  );

  const openPreview = useCallback((record) => {
    setPreviewRecord(record);
  }, []);

  const handlePreviewAction = useCallback(
    async (record, decision) => {
      const success = await handleReviewAction(record, decision);
      if (success) {
        setPreviewRecord(null);
      }
    },
    [handleReviewAction],
  );

  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  const fromRecord = meta.total ? (page - 1) * 25 + 1 : 0;
  const toRecord = Math.min(page * 25, meta.total);

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:min-h-[640px]">
      <div className="border-b border-slate-100 bg-white">
        <div className="flex flex-col gap-4 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Database size={16} className="text-slate-500" />
              Global System Tables
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Review pending submissions first, then inspect approved audit logs and platform reference data.
            </p>
          </div>

          <div className="relative w-full xl:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
            <input
              type="search"
              spellCheck="false"
              placeholder={`Search ${selectedTable.label}...`}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setPage(1);
              }}
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 pb-4 pt-1 sm:px-4">
          {GLOBAL_TABLES.map((table) => {
            const isActive = selectedTableId === table.id;
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => {
                  setSelectedTableId(table.id);
                  setPage(1);
                  setAnalysisType("");
                  setPreviewRecord(null);
                }}
                style={{
                  backgroundColor: isActive ? "#000000" : "#f3f4f6",
                  borderColor: isActive ? "#000000" : "#e5e7eb",
                  color: isActive ? "#ffffff" : "#374151",
                }}
                className="flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-xs font-bold transition-all duration-200 hover:brightness-95 active:scale-[0.98] sm:px-4 sm:text-sm"
              >
                <FileText size={15} />
                {table.label}
              </button>
            );
          })}
        </div>

        {selectedTable.supportsAnalysisFilter && (
          <div className="border-t border-slate-100 px-4 py-3">
            <label className="block text-xs font-bold uppercase tracking-widest text-slate-500">
              Analysis type filter
              <select
                value={analysisType}
                onChange={(event) => {
                  setAnalysisType(event.target.value);
                  setPage(1);
                }}
                className="mt-1.5 w-full max-w-md rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-950 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-900/10"
              >
                <option value="">All analysis types</option>
                {analysisTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatLabel(type)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      )}

      <main className="relative flex-1 overflow-auto bg-white">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
            <RefreshCw size={24} className="animate-spin text-slate-500" />
          </div>
        )}

        <table className="min-w-[920px] w-full border-collapse text-left lg:min-w-[1200px] xl:min-w-[1500px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500"
                >
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
              <tr key={record.id || record.facility_id || idx} className="hover:bg-slate-50">
                {columns.map((col) => (
                  <td key={col} className="max-w-[220px] px-4 py-3 align-top">
                    <span
                      className="block truncate text-[13px] font-medium text-slate-700"
                      title={displayValue(record[col])}
                    >
                      {displayValue(record[col])}
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-right">
                  {selectedTable.reviewActions ? (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openPreview(record)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                      >
                        <FileText size={12} />
                        Preview
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && records.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="py-14 text-center text-sm font-semibold text-slate-400"
                >
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
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 disabled:opacity-40"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 text-xs font-bold text-slate-700">
            Page {page} of {meta.total_pages || 1}
          </div>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(meta.total_pages || current, current + 1))
            }
            disabled={page >= (meta.total_pages || 1)}
            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-700 disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>

      <ReviewChangesModal
        review={previewRecord}
        onClose={() => setPreviewRecord(null)}
        title="Pending Review Preview"
        description="Review the proposed change carefully before approving or rejecting it."
        showActions
        onApprove={(record) => handlePreviewAction(record, "approve")}
        onReject={(record) => handlePreviewAction(record, "reject")}
        approveLabel="Approve Change"
        rejectLabel="Reject Change"
      />
    </div>
  );
}
