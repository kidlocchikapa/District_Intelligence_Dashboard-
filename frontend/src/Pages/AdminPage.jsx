import { useEffect, useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import {
  AUTH_EVENT_NAME,
  fetchJson,
  hydrateAuthToken,
  patchJson,
  postJson,
  uploadForm,
} from "../lib/api";

const datasetTypes = [
  "boundaries",
  "education",
  "health",
  "social_welfare",
  "disaster",
  "flood",
];

const taskDescriptions = {
  worldpop_totals: {
    badge: "Population",
    title: "Refresh district population",
    description:
      "Updates district population totals in the background using WorldPop.",
  },
  worldpop_age_sex: {
    badge: "Education input",
    title: "Refresh children and school-age population",
    description:
      "Updates the age-sex counts used to estimate school demand by district.",
  },
  education_insights: {
    badge: "Education",
    title: "Recalculate education insights",
    description:
      "Refreshes school summary, service coverage, and nearest-school analyses.",
  },
  health_insights: {
    badge: "Health",
    title: "Recalculate health insights",
    description:
      "Refreshes facility counts, coverage, served population, and access metrics.",
  },
  disaster_insights: {
    badge: "Disaster",
    title: "Recalculate disaster insights",
    description: "Refreshes district-level disaster vulnerability outputs.",
  },
  planning_refresh: {
    badge: "Full refresh",
    title: "Run full planning refresh",
    description:
      "Refreshes population inputs first, then recalculates education, health, and disaster views.",
  },
};

const departmentConfig = {
  education: {
    label: "Education",
    endpoint: "education",
    idKey: "school_id",
    recomputeSupported: true,
    columns: ["name", "status", "district_name", "ward_name"],
    editableFields: [
      {
        apiKey: "name",
        recordKey: "name",
        label: "Name",
        type: "text",
        requiredCreate: true,
      },
      { apiKey: "status", recordKey: "status", label: "Status", type: "text" },
      {
        apiKey: "studentEnrollmentTotal",
        recordKey: "student_enrollment_total",
        label: "Student Enrollment Total",
        type: "number",
      },
      {
        apiKey: "teacherCount",
        recordKey: "teacher_count",
        label: "Teacher Count",
        type: "number",
      },
      {
        apiKey: "districtId",
        recordKey: "district_id",
        label: "District ID",
        type: "number",
      },
      {
        apiKey: "wardId",
        recordKey: "ward_id",
        label: "Ward ID",
        type: "number",
      },
      {
        apiKey: "comments",
        recordKey: "comments",
        label: "Comments",
        type: "textarea",
      },
      {
        apiKey: "latitude",
        recordKey: "latitude",
        label: "Latitude",
        type: "number",
        requiredCreate: true,
      },
      {
        apiKey: "longitude",
        recordKey: "longitude",
        label: "Longitude",
        type: "number",
        requiredCreate: true,
      },
    ],
  },
  health: {
    label: "Health",
    endpoint: "health",
    idKey: "id",
    recomputeSupported: true,
    columns: ["name", "type", "healthcare", "district_name"],
    editableFields: [
      {
        apiKey: "name",
        recordKey: "name",
        label: "Name",
        type: "text",
        requiredCreate: true,
      },
      { apiKey: "type", recordKey: "type", label: "Type", type: "text" },
      {
        apiKey: "healthcare",
        recordKey: "healthcare",
        label: "Healthcare",
        type: "text",
      },
      {
        apiKey: "bedsCount",
        recordKey: "beds_count",
        label: "Beds Count",
        type: "number",
      },
      {
        apiKey: "patientVisitsTotal",
        recordKey: "patient_visits_total",
        label: "Patient Visits Total",
        type: "number",
      },
      {
        apiKey: "servicesOffered",
        recordKey: "services_offered",
        label: "Services Offered (comma separated)",
        type: "text",
      },
      {
        apiKey: "districtId",
        recordKey: "district_id",
        label: "District ID",
        type: "number",
      },
      {
        apiKey: "wardId",
        recordKey: "ward_id",
        label: "Ward ID",
        type: "number",
      },
      {
        apiKey: "latitude",
        recordKey: "latitude",
        label: "Latitude",
        type: "number",
        requiredCreate: true,
      },
      {
        apiKey: "longitude",
        recordKey: "longitude",
        label: "Longitude",
        type: "number",
        requiredCreate: true,
      },
    ],
  },
  social_welfare: {
    label: "Social Welfare",
    endpoint: "social_welfare",
    idKey: "id",
    recomputeSupported: false,
    columns: [
      "program_name",
      "beneficiary_count",
      "district_name",
      "ward_name",
    ],
    editableFields: [
      {
        apiKey: "programName",
        recordKey: "program_name",
        label: "Program Name",
        type: "text",
        requiredCreate: true,
      },
      {
        apiKey: "beneficiaryCount",
        recordKey: "beneficiary_count",
        label: "Beneficiary Count",
        type: "number",
      },
      {
        apiKey: "wardId",
        recordKey: "ward_id",
        label: "Ward ID",
        type: "number",
        requiredCreate: true,
      },
      {
        apiKey: "latitude",
        recordKey: "latitude",
        label: "Latitude",
        type: "number",
        requiredCreate: true,
      },
      {
        apiKey: "longitude",
        recordKey: "longitude",
        label: "Longitude",
        type: "number",
        requiredCreate: true,
      },
    ],
  },
  disaster: {
    label: "Disaster",
    endpoint: "disaster",
    idKey: "id",
    recomputeSupported: true,
    columns: ["event_type", "risk_level", "population_at_risk"],
    editableFields: [
      {
        apiKey: "eventType",
        recordKey: "event_type",
        label: "Event Type",
        type: "text",
        requiredCreate: true,
      },
      {
        apiKey: "riskLevel",
        recordKey: "risk_level",
        label: "Risk Level",
        type: "select",
        options: ["Low", "Medium", "High", "Critical"],
        requiredCreate: true,
      },
      {
        apiKey: "populationAtRisk",
        recordKey: "population_at_risk",
        label: "Population At Risk",
        type: "number",
      },
      {
        apiKey: "geometryGeoJson",
        recordKey: "geometry",
        label: "Geometry GeoJSON",
        type: "textarea",
        requiredCreate: true,
      },
    ],
  },
};

function formatJobStatus(status) {
  if (!status) {
    return "Idle";
  }

  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value) {
  if (!value) {
    return "Not started yet";
  }

  return new Date(value).toLocaleString();
}

function toInputValue(value, type) {
  if (value === null || value === undefined) {
    return "";
  }

  if (type === "textarea" && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value);
}

function buildPayload(config, values, mode) {
  const payload = {};

  config.editableFields.forEach((field) => {
    const rawValue = values[field.apiKey];
    const hasValue =
      rawValue !== undefined &&
      rawValue !== null &&
      String(rawValue).trim() !== "";

    if (mode === "create" && field.requiredCreate && !hasValue) {
      throw new Error(`${field.label} is required`);
    }

    if (!hasValue) {
      return;
    }

    if (field.type === "number") {
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) {
        throw new Error(`${field.label} must be a valid number`);
      }
      payload[field.apiKey] = parsed;
      return;
    }

    if (field.apiKey === "servicesOffered") {
      payload[field.apiKey] = String(rawValue)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return;
    }

    if (field.apiKey === "geometryGeoJson") {
      try {
        payload[field.apiKey] = JSON.parse(rawValue);
      } catch {
        throw new Error("Geometry GeoJSON must be valid JSON");
      }
      return;
    }

    payload[field.apiKey] = rawValue;
  });

  if (mode === "update" && !Object.keys(payload).length) {
    throw new Error("Provide at least one field to update");
  }

  return payload;
}

function AdminPage() {
  const [token, setTokenState] = useState(() => hydrateAuthToken());
  const [uploadFormState, setUploadFormState] = useState({
    type: "education",
    gazetteerPath: "sample_data/master_gazetteer.csv",
    programId: "",
    districtGroup: "zomba_all",
    analysisDate: new Date().toISOString().split('T')[0],
    file: null,
  });
  const [welfarePrograms, setWelfarePrograms] = useState([]);
  const [status, setStatus] = useState("");
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);

  const [selectedDepartment, setSelectedDepartment] = useState("education");
  const [stewardshipFilters, setStewardshipFilters] = useState({
    search: "",
    district_id: "",
    ward_id: "",
    include_archived: false,
    is_active: "",
  });
  const [stewardshipRecords, setStewardshipRecords] = useState([]);
  const [stewardshipMeta, setStewardshipMeta] = useState({
    total: 0,
    page: 1,
    page_size: 25,
    total_pages: 0,
  });
  const [stewardshipLoading, setStewardshipLoading] = useState(false);
  const [stewardshipStatus, setStewardshipStatus] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [editorMode, setEditorMode] = useState("update");
  const [editorValues, setEditorValues] = useState({});
  const [editorBusy, setEditorBusy] = useState(false);
  const [recomputeStatus, setRecomputeStatus] = useState({});
  const [recomputeBusy, setRecomputeBusy] = useState(false);
  
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [userFormBusy, setUserFormBusy] = useState(false);
  const [authProfile, setAuthProfile] = useState(null);

  const isAuthenticated = useMemo(() => Boolean(token), [token]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0] || null,
    [jobs, selectedJobId],
  );

  const selectedDeptConfig = useMemo(
    () => departmentConfig[selectedDepartment],
    [selectedDepartment],
  );

  useEffect(() => {
    function syncAuthState(event) {
      const nextToken = event?.detail?.token || null;
      setTokenState(nextToken);
    }

    window.addEventListener(AUTH_EVENT_NAME, syncAuthState);
    return () => window.removeEventListener(AUTH_EVENT_NAME, syncAuthState);
  }, []);

  async function loadJobs() {
    if (!isAuthenticated) {
      return;
    }

    try {
      setIsRefreshingJobs(true);
      const response = await fetchJson("/admin/jobs");
      const nextJobs = response.jobs || [];
      setJobs(nextJobs);
      setSelectedJobId((current) => current || nextJobs[0]?.id || "");
    } catch (error) {
      setStatus(
        error.response?.data?.message || "Unable to refresh background jobs.",
      );
    } finally {
      setIsRefreshingJobs(false);
    }
  }

  async function loadAuthProfile() {
    try {
      const response = await fetchJson("/auth/me");
      const profile = response.data?.user?.access || null;
      setAuthProfile(profile);
      
      if (response.data?.user?.role === "super_admin") {
        loadUsers();
      }
    } catch (error) {
      console.error("Load auth profile error:", error);
    }
  }

  async function loadUsers() {
    try {
      const response = await fetchJson("/admin/users");
      setUsers(response.data || []);
    } catch (error) {
      console.error("Load users error:", error);
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    
    try {
      setUserFormBusy(true);
      await postJson("/admin/users", data);
      setStatus("User created successfully");
      loadUsers();
      event.target.reset();
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to create user");
    } finally {
      setUserFormBusy(false);
    }
  }

  async function handleDeleteUser(userId) {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    
    try {
      await fetchJson(`/admin/users/${userId}`, { method: 'DELETE' });
      setStatus("User deleted successfully");
      loadUsers();
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to delete user");
    }
  }

  async function loadRecomputeStatus() {
    if (!isAuthenticated) {
      setRecomputeStatus({});
      return;
    }

    try {
      const response = await fetchJson("/admin-data/recompute/status");
      setRecomputeStatus(response.departments || {});
    } catch {
      setRecomputeStatus({});
    }
  }

  function resetEditorState() {
    setSelectedRecordId("");
    setSelectedRecord(null);
    setHistoryRows([]);
    setEditorValues({});
    setEditorMode("update");
  }

  async function loadStewardshipList() {
    if (!isAuthenticated) {
      setStewardshipRecords([]);
      setStewardshipMeta({ total: 0, page: 1, page_size: 25, total_pages: 0 });
      return;
    }

    try {
      setStewardshipLoading(true);
      const params = {
        page: 1,
        page_size: 25,
      };

      if (stewardshipFilters.search.trim()) {
        params.search = stewardshipFilters.search.trim();
      }

      if (stewardshipFilters.district_id.trim()) {
        params.district_id = stewardshipFilters.district_id.trim();
      }

      if (stewardshipFilters.ward_id.trim()) {
        params.ward_id = stewardshipFilters.ward_id.trim();
      }

      if (stewardshipFilters.include_archived) {
        params.include_archived = true;
      }

      if (stewardshipFilters.is_active !== "") {
        params.is_active = stewardshipFilters.is_active;
      }

      const response = await fetchJson(
        `/admin-data/${selectedDeptConfig.endpoint}`,
        { params },
      );
      setStewardshipRecords(response.items || []);
      setStewardshipMeta({
        total: response.total || 0,
        page: response.page || 1,
        page_size: response.page_size || 25,
        total_pages: response.total_pages || 0,
      });
      setStewardshipStatus("");
    } catch (error) {
      setStewardshipStatus(
        error.response?.data?.message || "Unable to load stewardship records.",
      );
    } finally {
      setStewardshipLoading(false);
    }
  }

  async function loadRecordDetailAndHistory(recordId) {
    if (!recordId) {
      return;
    }

    try {
      const [detailResponse, historyResponse] = await Promise.all([
        fetchJson(`/admin-data/${selectedDeptConfig.endpoint}/${recordId}`),
        fetchJson(
          `/admin-data/${selectedDeptConfig.endpoint}/${recordId}/history`,
        ),
      ]);

      const record = detailResponse.record || null;
      setSelectedRecord(record);
      setHistoryRows(historyResponse.items || []);

      if (record) {
        const nextValues = {};
        selectedDeptConfig.editableFields.forEach((field) => {
          nextValues[field.apiKey] = toInputValue(
            record[field.recordKey],
            field.type,
          );
        });
        setEditorValues(nextValues);
      }
    } catch (error) {
      setStewardshipStatus(
        error.response?.data?.message ||
          "Unable to load selected record details.",
      );
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setJobs([]);
      setSelectedJobId("");
      setStatus(
        "Sign in from the sidebar to enable admin uploads and background refresh actions.",
      );
      setStewardshipRecords([]);
      resetEditorState();
      return undefined;
    }

    loadJobs();
    loadStewardshipList();
    loadRecomputeStatus();
    loadAuthProfile();

    const intervalId = window.setInterval(loadJobs, 2500);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setWelfarePrograms([]);
      return;
    }

    let ignore = false;

    async function loadWelfarePrograms() {
      try {
        const response = await fetchJson("/admin-data/welfare/programs");
        if (!ignore) {
          setWelfarePrograms(response.items || []);
        }
      } catch {
        if (!ignore) {
          setWelfarePrograms([]);
        }
      }
    }

    loadWelfarePrograms();

    return () => {
      ignore = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    resetEditorState();
    loadStewardshipList();
    loadRecomputeStatus();
  }, [selectedDepartment]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!isAuthenticated) {
      setStatus("Sign in from the sidebar before starting an upload.");
      return;
    }

    if (!uploadFormState.file) {
      setStatus("Choose a file before starting the upload.");
      return;
    }

    if (
      uploadFormState.type === "welfare_beneficiary" &&
      !String(uploadFormState.programId || "").trim()
    ) {
      setStatus("Select a welfare program before starting the beneficiary upload.");
      return;
    }

    const formData = new FormData();
    formData.append("type", uploadFormState.type);
    formData.append("gazetteerPath", uploadFormState.gazetteerPath);
    if (uploadFormState.type === "welfare_beneficiary" || uploadFormState.type === "social_welfare") {
      formData.append("programId", uploadFormState.programId);
    }
    if (uploadFormState.type === "flood") {
      formData.append("districtGroup", uploadFormState.districtGroup || "");
      formData.append("analysisDate", uploadFormState.analysisDate || "");
    }
    formData.append("file", uploadFormState.file);

    setStatus(`Starting ${uploadFormState.type} upload in the background...`);

    try {
      const response = await uploadForm("/admin/upload", formData);
      setStatus(response.message || "Dataset upload started.");
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
      }
      await loadJobs();
    } catch (error) {
      setStatus(error.response?.data?.message || "Upload failed");
    }
  }

  async function runPresetTask(taskKey) {
    if (!isAuthenticated) {
      setStatus("Sign in from the sidebar before running a background task.");
      return;
    }

    setStatus(
      `Starting ${taskDescriptions[taskKey]?.title || "background task"}...`,
    );

    try {
      const response = await postJson("/admin/run-task", { task: taskKey });
      setStatus(response.message || "Background task started.");
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
      }
      await loadJobs();
    } catch (error) {
      setStatus(
        error.response?.data?.message || "Could not start the background task.",
      );
    }
  }

  async function pingApi() {
    setStatus("Checking backend availability...");
    try {
      const response = await fetchJson("/");
      setStatus(response.message || "API is reachable.");
    } catch (error) {
      setStatus(error.response?.data?.message || "API check failed");
    }
  }

  async function triggerRecompute() {
    if (!selectedDeptConfig.recomputeSupported) {
      setStewardshipStatus(
        "Recompute is not available for this department yet.",
      );
      return;
    }

    if (!isAuthenticated) {
      setStewardshipStatus(
        "Sign in from the sidebar before running recompute.",
      );
      return;
    }

    try {
      setRecomputeBusy(true);
      const response = await postJson(
        `/admin-data/recompute/${selectedDeptConfig.endpoint}`,
        {},
      );
      setStewardshipStatus(
        response.message || "Recompute has started in the background.",
      );
      await loadRecomputeStatus();
    } catch (error) {
      setStewardshipStatus(
        error.response?.data?.message || "Unable to start recompute.",
      );
    } finally {
      setRecomputeBusy(false);
    }
  }

  async function submitEditor(event) {
    event.preventDefault();

    if (!isAuthenticated) {
      setStewardshipStatus("Sign in from the sidebar before editing records.");
      return;
    }

    try {
      setEditorBusy(true);
      const payload = buildPayload(
        selectedDeptConfig,
        editorValues,
        editorMode,
      );

      if (editorMode === "create") {
        const response = await postJson(
          `/admin-data/${selectedDeptConfig.endpoint}`,
          payload,
        );
        setStewardshipStatus(
          response.message || "Record created successfully.",
        );
      } else {
        if (!selectedRecordId) {
          throw new Error("Select a record first to update");
        }

        const response = await patchJson(
          `/admin-data/${selectedDeptConfig.endpoint}/${selectedRecordId}`,
          payload,
        );
        setStewardshipStatus(
          response.message || "Record updated successfully.",
        );
      }

      await loadStewardshipList();
      await loadRecomputeStatus();

      if (editorMode === "update" && selectedRecordId) {
        await loadRecordDetailAndHistory(selectedRecordId);
      } else {
        resetEditorState();
      }
    } catch (error) {
      setStewardshipStatus(
        error.response?.data?.message ||
          error.message ||
          "Unable to save record.",
      );
    } finally {
      setEditorBusy(false);
    }
  }

  async function archiveSelected() {
    if (!selectedRecordId) {
      setStewardshipStatus("Select a record first to archive.");
      return;
    }

    if (!isAuthenticated) {
      setStewardshipStatus(
        "Sign in from the sidebar before archiving records.",
      );
      return;
    }

    try {
      setEditorBusy(true);
      const response = await postJson(
        `/admin-data/${selectedDeptConfig.endpoint}/${selectedRecordId}/archive`,
        {},
      );
      setStewardshipStatus(response.message || "Record archived successfully.");
      await loadStewardshipList();
      await loadRecordDetailAndHistory(selectedRecordId);
      await loadRecomputeStatus();
    } catch (error) {
      setStewardshipStatus(
        error.response?.data?.message || "Unable to archive record.",
      );
    } finally {
      setEditorBusy(false);
    }
  }

  const currentRecomputeState =
    recomputeStatus[selectedDeptConfig.endpoint] || null;

  return (
    <div className="relative isolate z-10 space-y-6 bg-white text-slate-900 opacity-100 [filter:none]">
      <PageHeader
        eyebrow="Admin portal"
        title="Simple background data operations"
        description="Upload new datasets, run refresh actions, and follow ETL progress from one simple control room."
        surface="solid"
        className="border-slate-200 bg-white text-slate-900 shadow-sm"
        actions={[
          <button
            key="ping"
            type="button"
            onClick={pingApi}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition-all shadow-sm hover:border-slate-400 hover:bg-slate-50 active:scale-95"
          >
            Check API
          </button>,
        ]}
      />

      <Panel
        title="Data stewardship editor"
        subtitle="Search, inspect, create, update, archive, and review change history for source records by department."
        surface="solid"
        className="border-slate-200 bg-white text-slate-900 shadow-sm"
      >
        {!isAuthenticated ? (
          <EmptyState
            title="Admin session required"
            description="Sign in from the sidebar to manage department records and run insight recomputes."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-6">
              <label className="text-sm text-slate-700 lg:col-span-1">
                Department
                <select
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={selectedDepartment}
                  onChange={(event) =>
                    setSelectedDepartment(event.target.value)
                  }
                >
                  {Object.entries(departmentConfig)
                    .filter(([key]) => !authProfile || authProfile.departments.includes(key))
                    .map(([key, config]) => (
                    <option key={key} value={key}>
                      {config.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-700 lg:col-span-2">
                Search
                <input
                  type="text"
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={stewardshipFilters.search}
                  onChange={(event) =>
                    setStewardshipFilters((state) => ({
                      ...state,
                      search: event.target.value,
                    }))
                  }
                  placeholder="Search current department"
                />
              </label>

              <label className="text-sm text-slate-700">
                District ID
                <input
                  type="text"
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={stewardshipFilters.district_id}
                  onChange={(event) =>
                    setStewardshipFilters((state) => ({
                      ...state,
                      district_id: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>

              <label className="text-sm text-slate-700">
                Ward ID
                <input
                  type="text"
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={stewardshipFilters.ward_id}
                  onChange={(event) =>
                    setStewardshipFilters((state) => ({
                      ...state,
                      ward_id: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </label>

              <label className="text-sm text-slate-700">
                Active filter
                <select
                  className="mt-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={stewardshipFilters.is_active}
                  onChange={(event) =>
                    setStewardshipFilters((state) => ({
                      ...state,
                      is_active: event.target.value,
                    }))
                  }
                >
                  <option value="">All</option>
                  <option value="true">Active</option>
                  <option value="false">Archived</option>
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={stewardshipFilters.include_archived}
                  onChange={(event) =>
                    setStewardshipFilters((state) => ({
                      ...state,
                      include_archived: event.target.checked,
                    }))
                  }
                />
                Include archived
              </label>
              <button
                type="button"
                onClick={loadStewardshipList}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
              >
                {stewardshipLoading ? "Loading..." : "Refresh records"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditorMode("create");
                  setSelectedRecordId("");
                  setSelectedRecord(null);
                  setHistoryRows([]);
                  setEditorValues({});
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
              >
                New record
              </button>
              <button
                type="button"
                onClick={triggerRecompute}
                disabled={
                  !selectedDeptConfig.recomputeSupported || recomputeBusy
                }
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {recomputeBusy
                  ? "Starting recompute..."
                  : `Recompute ${selectedDeptConfig.label}`}
              </button>
              {currentRecomputeState ? (
                <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                  Recompute: {formatJobStatus(currentRecomputeState.status)}
                  {currentRecomputeState.stale ? " (stale)" : ""}
                </span>
              ) : null}
            </div>

            {stewardshipStatus ? (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {stewardshipStatus}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                  <h4 className="text-sm font-semibold text-slate-900">
                    {selectedDeptConfig.label} records
                  </h4>
                  <span className="text-xs text-slate-500">
                    {stewardshipMeta.total} total
                  </span>
                </div>
                <div className="max-h-[26rem] overflow-auto">
                  {stewardshipRecords.length ? (
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          {selectedDeptConfig.columns.map((column) => (
                            <th
                              key={column}
                              className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700"
                            >
                              {column.replace(/_/g, " ")}
                            </th>
                          ))}
                          <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">
                            Active
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {stewardshipRecords.map((row) => {
                          const rowId = row[selectedDeptConfig.idKey];
                          const isSelected =
                            String(selectedRecordId) === String(rowId);

                          return (
                            <tr
                              key={rowId}
                              className={`cursor-pointer border-b border-slate-100 ${
                                isSelected
                                  ? "bg-slate-100"
                                  : "hover:bg-slate-50"
                              }`}
                              onClick={async () => {
                                setSelectedRecordId(String(rowId));
                                setEditorMode("update");
                                await loadRecordDetailAndHistory(rowId);
                              }}
                            >
                              {selectedDeptConfig.columns.map((column) => (
                                <td
                                  key={`${rowId}-${column}`}
                                  className="px-3 py-2 text-slate-700"
                                >
                                  {row[column] ?? "—"}
                                </td>
                              ))}
                              <td className="px-3 py-2 text-slate-700">
                                {row.is_active ? "Yes" : "No"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4">
                      <EmptyState
                        title="No records found"
                        description="Adjust filters or create a new record for this department."
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">
                      {editorMode === "create"
                        ? `Create ${selectedDeptConfig.label}`
                        : `Edit ${selectedDeptConfig.label}`}
                    </h4>
                    {editorMode === "update" && selectedRecordId ? (
                      <span className="text-xs text-slate-500">
                        ID: {selectedRecordId}
                      </span>
                    ) : null}
                  </div>

                  <form className="grid gap-3" onSubmit={submitEditor}>
                    {selectedDeptConfig.editableFields.map((field) => (
                      <label
                        key={field.apiKey}
                        className="text-xs font-medium uppercase tracking-[0.08em] text-slate-600"
                      >
                        {field.label}
                        {field.type === "textarea" ? (
                          <textarea
                            rows={field.apiKey === "geometryGeoJson" ? 4 : 2}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900"
                            value={editorValues[field.apiKey] ?? ""}
                            onChange={(event) =>
                              setEditorValues((state) => ({
                                ...state,
                                [field.apiKey]: event.target.value,
                              }))
                            }
                          />
                        ) : field.type === "select" ? (
                          <select
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900"
                            value={editorValues[field.apiKey] ?? ""}
                            onChange={(event) =>
                              setEditorValues((state) => ({
                                ...state,
                                [field.apiKey]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Select value</option>
                            {field.options?.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type === "number" ? "number" : "text"}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm normal-case tracking-normal text-slate-900"
                            value={editorValues[field.apiKey] ?? ""}
                            onChange={(event) =>
                              setEditorValues((state) => ({
                                ...state,
                                [field.apiKey]: event.target.value,
                              }))
                            }
                          />
                        )}
                      </label>
                    ))}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={editorBusy}
                        className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {editorBusy
                          ? "Saving..."
                          : editorMode === "create"
                            ? `Create ${selectedDeptConfig.label}`
                            : `Update ${selectedDeptConfig.label}`}
                      </button>

                      {editorMode === "update" ? (
                        <button
                          type="button"
                          onClick={archiveSelected}
                          disabled={editorBusy || !selectedRecordId}
                          className="rounded border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Archive record
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => {
                          setEditorMode("update");
                          if (selectedRecord) {
                            const nextValues = {};
                            selectedDeptConfig.editableFields.forEach(
                              (field) => {
                                nextValues[field.apiKey] = toInputValue(
                                  selectedRecord[field.recordKey],
                                  field.type,
                                );
                              },
                            );
                            setEditorValues(nextValues);
                          } else {
                            setEditorValues({});
                          }
                        }}
                        className="rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                      >
                        Reset fields
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded border border-slate-200 bg-white p-4">
                  <h4 className="mb-2 text-sm font-semibold text-slate-900">
                    Change history
                  </h4>
                  {historyRows.length ? (
                    <div className="max-h-60 space-y-2 overflow-auto">
                      {historyRows.map((item) => (
                        <div
                          key={item.id}
                          className="rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
                        >
                          <div className="font-semibold text-slate-900">
                            {String(item.action || "").toUpperCase()} •{" "}
                            {formatTimestamp(item.changed_at)}
                          </div>
                          <div>
                            By:{" "}
                            {item.changed_by_full_name ||
                              item.changed_by_email ||
                              "Unknown user"}
                          </div>
                          <div>
                            Fields:{" "}
                            {Array.isArray(item.changed_fields)
                              ? item.changed_fields.join(", ") || "n/a"
                              : "n/a"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600">
                      Select a record to view its audit history.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {authProfile?.role === "super_admin" && (
        <Panel
          title="User Management"
          subtitle="Manage portal access, assign roles, and delete accounts."
          surface="solid"
          className="border-slate-200 bg-white text-slate-900 shadow-sm"
        >
          <div className="grid gap-6 lg:grid-cols-[0.4fr_0.6fr]">
            {/* Create User Form */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Create New User</h3>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <label className="block text-sm text-slate-700">
                  Full Name
                  <input name="fullName" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                </label>
                <label className="block text-sm text-slate-700">
                  Email
                  <input name="email" type="email" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                </label>
                <label className="block text-sm text-slate-700">
                  Password
                  <input name="password" type="password" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                </label>
                <label className="block text-sm text-slate-700">
                  Role
                  <select name="role" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                    <option value="user">User</option>
                    <option value="education_admin">Education Admin</option>
                    <option value="health_admin">Health Admin</option>
                    <option value="disaster_admin">Disaster Admin</option>
                    <option value="welfare_admin">Welfare Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </label>
                <button disabled={userFormBusy} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {userFormBusy ? "Creating..." : "Create User"}
                </button>
              </form>
            </div>

            {/* User List */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Existing Users ({users.length})</h3>
              <div className="max-h-[300px] overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left border-b border-slate-200">Name</th>
                      <th className="px-3 py-2 text-left border-b border-slate-200">Role</th>
                      <th className="px-3 py-2 text-right border-b border-slate-200">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-900">{user.fullName}</div>
                          <div className="text-xs text-slate-500">{user.email}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                            {user.role.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button 
                            type="button"
                            onClick={() => handleDeleteUser(user.id)} 
                            className="text-rose-600 hover:text-rose-800 text-xs font-bold"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-6">
        <Panel
          title="Background activity"
          subtitle={
            isAuthenticated
              ? "Every upload or refresh runs in the background and writes its progress here."
              : "Use the sidebar to sign in, then return here to manage uploads and background jobs."
          }
          surface="solid"
          className="border-slate-200 bg-white text-slate-900 shadow-sm"
        >
          <div className="grid gap-4 lg:grid-cols-[0.38fr_0.62fr]">
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {status || "No admin action has been triggered yet."}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Recent jobs
                  </h3>
                  <button
                    type="button"
                    onClick={loadJobs}
                    className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    {isRefreshingJobs ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <div className="space-y-2">
                  {jobs.length ? (
                    jobs.map((job) => (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedJobId(job.id)}
                        className={`w-full rounded border px-3 py-3 text-left transition ${
                          selectedJob?.id === job.id
                            ? "border-slate-900 bg-slate-100"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          {job.label}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                          {formatJobStatus(job.status)}
                        </div>
                      </button>
                    ))
                  ) : (
                    <EmptyState
                      title="No jobs yet"
                      description="Once an upload or refresh starts, it will appear here automatically."
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="rounded border border-slate/15 bg-[#0b1220] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.26em] text-emerald-300/70">
                    Pipeline console
                  </div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {selectedJob?.label || "Waiting for a background job"}
                  </div>
                </div>
                <div className="rounded border border-white/10 px-3 py-1 text-xs text-emerald-200/80">
                  {formatJobStatus(selectedJob?.status)}
                </div>
              </div>

              <div className="grid gap-3 border-b border-white/10 px-5 py-3 text-xs text-slate-300 md:grid-cols-2">
                <div>Started: {formatTimestamp(selectedJob?.startedAt)}</div>
                <div>Finished: {formatTimestamp(selectedJob?.finishedAt)}</div>
              </div>

              <div className="h-[22rem] overflow-y-auto px-5 py-4 font-mono text-xs leading-6 text-emerald-200">
                {selectedJob?.logs?.length ? (
                  selectedJob.logs.map((entry, index) => (
                    <div
                      key={`${entry.at}-${index}`}
                      className="whitespace-pre-wrap break-words"
                    >
                      <span className="text-slate-400">
                        [{new Date(entry.at).toLocaleTimeString()}]
                      </span>{" "}
                      <span
                        className={
                          entry.level === "error"
                            ? "text-rose-300"
                            : entry.level === "stderr"
                              ? "text-amber-300"
                              : "text-emerald-200"
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400">
                    Start an upload or refresh action to see ETL logs here.
                  </div>
                )}
              </div>
            </div>
          </div>

          {!isAuthenticated ? (
            <div className="mt-4">
              <EmptyState
                title="Admin session required"
                description="Sign in from the sidebar to unlock uploads, pipeline refresh tasks, and live job monitoring."
              />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <Panel
          title="Upload a dataset"
          subtitle="Choose what you are uploading, select the file, and let the pipeline handle the rest in the background."
          surface="solid"
          className="border-slate-200 bg-white text-slate-900 shadow-sm"
        >
          <form className="grid gap-4" onSubmit={handleUpload}>
            <label className="text-sm text-slate-700">
              Dataset type
              <select
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                value={uploadFormState.type}
                disabled={!isAuthenticated}
                onChange={(event) =>
                  setUploadFormState((state) => ({
                    ...state,
                    type: event.target.value,
                  }))
                }
              >
                {datasetTypes
                  .filter((type) => {
                    if (!authProfile) return true;
                    if (authProfile.is_global_admin) return true;
                    // Map upload types to departments
                    const uploadToDept = {
                      education: "education",
                      health: "health",
                      social_welfare: "social_welfare",
                      disaster: "disaster",
                      flood: "disaster",
                    };
                    return authProfile.departments.includes(uploadToDept[type]);
                  })
                  .map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </option>
                  ))}
              </select>
            </label>

            {(uploadFormState.type === "welfare_beneficiary" || uploadFormState.type === "social_welfare") ? (
              <label className="text-sm text-slate-700">
                Welfare program
                <select
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                  value={uploadFormState.programId}
                  disabled={!isAuthenticated || welfarePrograms.length === 0}
                  onChange={(event) =>
                    setUploadFormState((state) => ({
                      ...state,
                      programId: event.target.value,
                    }))
                  }
                >
                  <option value="">Select a program</option>
                  {welfarePrograms.map((program) => (
                    <option key={program.program_id} value={program.program_id}>
                      {program.program_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {uploadFormState.type === "flood" ? (
              <>
                <label className="text-sm text-slate-700">
                  District group
                  <input
                    type="text"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                    value={uploadFormState.districtGroup}
                    placeholder="e.g. zomba_all"
                    onChange={(event) =>
                      setUploadFormState((state) => ({
                        ...state,
                        districtGroup: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Analysis date
                  <input
                    type="date"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                    value={uploadFormState.analysisDate}
                    onChange={(event) =>
                      setUploadFormState((state) => ({
                        ...state,
                        analysisDate: event.target.value,
                      }))
                    }
                  />
                </label>
              </>
            ) : null}

            <label className="text-sm text-slate-700">
              File
              <input
                type="file"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                disabled={!isAuthenticated}
                onChange={(event) =>
                  setUploadFormState((state) => ({
                    ...state,
                    file: event.target.files?.[0] || null,
                  }))
                }
              />
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              Upload CSV, Excel, GeoJSON, GeoPackage, or a zipped shapefile
              bundle. The pipeline will process it in the background and write
              progress to the console above.
            </div>

            <button
              disabled={!isAuthenticated}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Start upload
            </button>
          </form>
        </Panel>

        <Panel
          title="Refresh data in one click"
          subtitle="Use friendly background actions instead of ETL parameters."
          surface="solid"
          className="border-slate-200 bg-white text-slate-900 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(taskDescriptions).map(([taskKey, task]) => (
              <div
                key={taskKey}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {task.badge}
                </div>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {task.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {task.description}
                </p>
                <button
                  type="button"
                  onClick={() => runPresetTask(taskKey)}
                  disabled={!isAuthenticated}
                  className="mt-4 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Run in background
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default AdminPage;
