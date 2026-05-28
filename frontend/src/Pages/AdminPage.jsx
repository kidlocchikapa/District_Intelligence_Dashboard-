import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import Panel from "../components/Panel";
import AdminDataStewardship from "../components/AdminDataStewardship";
import GlobalAdminStewardship from "../components/GlobalAdminStewardship";
import GlobalAdminOperations from "../components/GlobalAdminOperations";
import {
  AUTH_EVENT_NAME,
  deleteJson,
  fetchJson,
  hydrateAuthToken,
  setAuthToken,
  postJson,
  uploadForm,
} from "../lib/api";
import {
  Database,
  UploadCloud,
  Activity,
  Terminal,
  AlertCircle,
  LayoutDashboard,
  ChevronRight,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";

const datasetTypes = [
  "boundaries",
  "education",
  "health",
  "roads",
  "social_welfare",
  "disaster",
  "flood",
];

const departmentDatasetTypes = {
  education: ["education"],
  health: ["health"],
  social_welfare: ["welfare_beneficiary", "roads"],
  disaster: ["disaster", "flood"],
};

const uploadTemplateFiles = {
  education: {
    url: "/upload-templates/education_template.csv",
    filename: "education_template.csv",
    description: "School records template (CSV).",
  },
  health: {
    url: "/upload-templates/health_template.csv",
    filename: "health_template.csv",
    description: "Health facility records template (CSV).",
  },
  welfare_beneficiary: {
    url: "/upload-templates/welfare_beneficiary_template.csv",
    filename: "welfare_beneficiary_template.csv",
    description: "Individual welfare beneficiary records template (CSV).",
  },
  roads: {
    url: "/upload-templates/roads_template.geojson",
    filename: "roads_template.geojson",
    description: "Road network template (GeoJSON LineString).",
  },
  disaster: {
    url: "/upload-templates/disaster_template.csv",
    filename: "disaster_template.csv",
    description: "Disaster exposure sample template (CSV).",
  },
  flood: {
    url: "/upload-templates/flood_template.txt",
    filename: "flood_template.txt",
    description: "Flood raster upload guide template.",
  },
};

function resolveDepartmentDatasetTypes(department) {
  if (!department) {
    return [];
  }
  return departmentDatasetTypes[department] || datasetTypes;
}

const taskDescriptions = {
  worldpop_totals: {
    badge: "Population",
    department: "global",
    title: "Refresh district population",
    description:
      "Updates district population totals in the background using WorldPop.",
  },
  worldpop_age_sex: {
    badge: "Education input",
    department: "education",
    title: "Refresh children and school-age population",
    description:
      "Updates the age-sex counts used to estimate school demand by district.",
  },
  education_insights: {
    badge: "Education",
    department: "education",
    title: "Recalculate education insights",
    description:
      "Refreshes school summary, service coverage, and nearest-school analyses.",
  },
  health_insights: {
    badge: "Health",
    department: "health",
    title: "Recalculate health insights",
    description:
      "Refreshes facility counts, coverage, served population, and access metrics.",
  },
  disaster_insights: {
    badge: "Disaster",
    department: "disaster",
    title: "Recalculate disaster insights",
    description: "Refreshes district-level disaster vulnerability outputs.",
  },
  planning_refresh: {
    badge: "Full refresh",
    department: "global",
    title: "Run full planning refresh",
    description:
      "Refreshes population inputs first, then recalculates education, health, and disaster views.",
  },
  welfare_insights: {
    badge: "Social Welfare",
    department: "social_welfare",
    title: "Recalculate welfare insights",
    description: "Refreshes beneficiary coverage and indicator summaries.",
  },
  road_travel_access: {
    badge: "Road Network",
    department: "social_welfare",
    title: "Recalculate road travel access",
    description:
      "Updates road travel distance and time from beneficiaries to health and education facilities.",
  },
  roads_overpass_sync: {
    badge: "Road Network",
    department: "social_welfare",
    title: "Sync roads from Overpass",
    description:
      "Fetches OpenStreetMap road data and refreshes the road network for routing.",
  },
};

const departmentConfig = {
  education: {
    label: "Education",
    endpoint: "education",
    idKey: "school_id",
    columns: ["name", "status", "district_name", "ward_name"],
  },
  health: {
    label: "Health",
    endpoint: "health",
    idKey: "id",
    columns: ["name", "type", "district_name", "ward_name", "latitude", "longitude"],
  },
  social_welfare: {
    label: "Social Welfare",
    endpoint: "social_welfare",
    idKey: "id",
    columns: [
      "program_name",
      "beneficiary_count",
      "district_name",
      "ward_name",
    ],
  },
  disaster: {
    label: "Disaster",
    endpoint: "disaster/facility_exposure",
    idKey: "id",
    columns: ["facility_name", "facility_type", "district_name", "risk_class"],
  },
};

function isErrorLogEntry(log) {
  if (!log) {
    return false;
  }

  if (log.level === "error") {
    return true;
  }

  const message = String(log.message || "").toLowerCase();
  return /\b(error|failed|failure|exception|traceback|fatal)\b/.test(message);
}

function buildRecomputeConsoleJobs(departments = {}) {
  return Object.entries(departments)
    .filter(([, state]) => {
      if (!state || state.status === "not_supported") {
        return false;
      }

      return Boolean(
        state.status !== "idle" ||
          state.stale ||
          state.lastStartedAt ||
          state.lastFinishedAt ||
          state.lastError,
      );
    })
    .map(([department, state]) => {
      const label = department.replaceAll("_", " ");
      const createdAt =
        state.lastStartedAt || state.lastFinishedAt || new Date().toISOString();
      const startedAt = state.lastStartedAt || createdAt;
      const finishedAt = state.lastFinishedAt || null;
      const stageLabel = state.task || `${label} recompute`;
      const logs = [];

      if (state.lastStartedAt) {
        logs.push({
          at: state.lastStartedAt,
          level: "info",
          message: `${label} recompute started.`,
        });
      }

      if (state.status === "running") {
        logs.push({
          at: state.lastStartedAt || createdAt,
          level: "stdout",
          message: `Pipeline running for ${stageLabel}.`,
        });
      } else if (state.status === "completed") {
        logs.push({
          at: state.lastFinishedAt || createdAt,
          level: "info",
          message: `${label} recompute completed.`,
        });
      } else if (state.status === "failed") {
        logs.push({
          at: state.lastFinishedAt || createdAt,
          level: "error",
          message:
            state.lastError || `${label} recompute failed unexpectedly.`,
        });
      } else if (state.stale) {
        logs.push({
          at: createdAt,
          level: "stderr",
          message: `${label} data is marked stale and awaiting recompute.`,
        });
      }

      if (!logs.length) {
        logs.push({
          at: createdAt,
          level: "info",
          message: `${label} recompute status: ${state.status}.`,
        });
      }

      return {
        id: `recompute-${department}`,
        label: `${label} recompute`,
        kind: "recompute",
        source: "recompute",
        meta: {
          department,
          task: state.task || null,
          stale: Boolean(state.stale),
        },
        status: state.status,
        createdAt,
        startedAt,
        finishedAt,
        currentStage: state.task || null,
        terminatedAt: null,
        terminateRequested: false,
        canTerminate: false,
        logCount: logs.length,
        logs,
      };
    });
}

function AdminPage() {
  const [token, setTokenState] = useState(() => hydrateAuthToken());
  const [activeTab, setActiveTab] = useState("stewardship");
  const [uploadFormState, setUploadFormState] = useState({
    type: "education",
    gazetteerPath: "sample_data/master_gazetteer.csv",
    programId: "",
    districtGroup: "zomba_all",
    analysisDate: new Date().toISOString().split("T")[0],
    file: null,
  });
  const [status, setStatus] = useState("");
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [authProfile, setAuthProfile] = useState(null);

  const isAuthenticated = useMemo(() => Boolean(token), [token]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0] || null,
    [jobs, selectedJobId],
  );
  const availableDepartments = useMemo(
    () => Object.keys(departmentConfig),
    [],
  );
  const availableDatasetTypes = useMemo(
    () => resolveDepartmentDatasetTypes(selectedDepartment),
    [selectedDepartment],
  );
  const selectedTemplate = useMemo(
    () => uploadTemplateFiles[uploadFormState.type] || null,
    [uploadFormState.type],
  );
  const isReadOnlyConsoleEntry = selectedJob?.source === "recompute";
  const isGlobalAdmin = useMemo(
    () =>
      Boolean(
        authProfile?.is_global_admin ||
          authProfile?.role === "super_admin" ||
          authProfile?.role === "admin",
      ),
    [authProfile],
  );

  const allowedDepartments = useMemo(() => {
    if (!authProfile) {
      return [];
    }

    if (isGlobalAdmin) {
      return availableDepartments;
    }

    const profileDepartments = Array.isArray(authProfile.departments)
      ? authProfile.departments
      : [];

    return profileDepartments.filter((department) =>
      availableDepartments.includes(department),
    );
  }, [authProfile, availableDepartments, isGlobalAdmin]);

  useEffect(() => {
    if (!authProfile) {
      return;
    }

    if (isGlobalAdmin) {
      setActiveTab((current) =>
        ["system", "operations", "departments", "logs"].includes(current)
          ? current
          : "system",
      );
    } else if (!["stewardship", "operations", "logs"].includes(activeTab)) {
      setActiveTab("stewardship");
    }
  }, [activeTab, authProfile, isGlobalAdmin]);

  useEffect(() => {
    function syncAuthState(event) {
      const nextToken = event?.detail?.token || null;
      setTokenState(nextToken);
    }
    window.addEventListener(AUTH_EVENT_NAME, syncAuthState);
    return () => window.removeEventListener(AUTH_EVENT_NAME, syncAuthState);
  }, []);

  const loadJobs = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setIsRefreshingJobs(true);
      const [adminJobsResponse, recomputeStatusResponse] = await Promise.all([
        fetchJson("/admin/jobs"),
        fetchJson("/admin-data/recompute/status").catch((error) => {
          const statusCode = error?.response?.status;
          if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
            return { departments: {} };
          }
          throw error;
        }),
      ]);

      const adminJobs = (adminJobsResponse.jobs || []).map((job) => ({
        ...job,
        source: job.source || "admin",
      }));
      const recomputeJobs = buildRecomputeConsoleJobs(
        recomputeStatusResponse.departments || {},
      );
      const nextJobs = [...adminJobs, ...recomputeJobs].sort(
        (left, right) =>
          new Date(right.createdAt || 0).getTime() -
          new Date(left.createdAt || 0).getTime(),
      );
      setJobs(nextJobs);
      setSelectedJobId((current) =>
        nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id || "",
      );
    } catch (error) {
      console.error("Load jobs error", error);
    } finally {
      setIsRefreshingJobs(false);
    }
  }, [isAuthenticated]);

  async function loadAuthProfile() {
    try {
      const response = await fetchJson("/auth/me");
      const user = response?.user || {};
      const profile = user?.access || {};
      setAuthProfile({ ...profile, role: user?.role });
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
        setAuthToken(null);
        setAuthProfile(null);
        return;
      }

      console.error("Load auth profile error:", error);
    }
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    loadJobs();
    loadAuthProfile();
    const intervalId = window.setInterval(loadJobs, 5000);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated, loadJobs]);

  useEffect(() => {
    if (!authProfile) {
      return;
    }

    if (!allowedDepartments.length) {
      setSelectedDepartment("");
      return;
    }

    setSelectedDepartment((current) =>
      allowedDepartments.includes(current) ? current : allowedDepartments[0],
    );
  }, [allowedDepartments, authProfile]);

  useEffect(() => {
    if (!selectedDepartment) {
      return;
    }

    if (selectedDepartment === "education") {
      setUploadFormState((s) => ({ ...s, type: "education" }));
    } else if (selectedDepartment === "social_welfare") {
      setUploadFormState((s) => ({ ...s, type: "welfare_beneficiary" }));
    } else if (selectedDepartment === "disaster") {
      setUploadFormState((s) => ({ ...s, type: "flood" }));
    } else if (selectedDepartment === "health") {
      setUploadFormState((s) => ({ ...s, type: "health" }));
    }
  }, [selectedDepartment]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedDepartment) {
      setStatus("No department access is assigned to this account.");
      return;
    }

    if (!uploadFormState.file) {
      setStatus("Please select a file first");
      return;
    }
    const formData = new FormData();
    formData.append("type", uploadFormState.type);
    formData.append("file", uploadFormState.file);
    try {
      setStatus(`Starting ${uploadFormState.type} upload...`);
      const response = await uploadForm("/admin/upload", formData);
      const activeFloodRasterPath = response.data?.active_flood_raster_path;
      setStatus(
        activeFloodRasterPath
          ? `${response.message || "Upload started."} Active flood raster: ${activeFloodRasterPath}`
          : response.message || "Upload started.",
      );
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
        setActiveTab("logs");
      }
      loadJobs();
    } catch (error) {
      setStatus(
        "Upload failed: " + (error.response?.data?.message || error.message),
      );
    }
  }

  function handleDownloadTemplate() {
    if (!selectedTemplate) {
      setStatus(
        `No template is configured for dataset type "${uploadFormState.type}".`,
      );
      return;
    }

    const link = document.createElement("a");
    link.href = selectedTemplate.url;
    link.download = selectedTemplate.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatus(`Template downloaded: ${selectedTemplate.filename}`);
  }

  async function handleRunTask(task) {
    if (!selectedDepartment) {
      setStatus("No department access is assigned to this account.");
      return;
    }

    try {
      setStatus(`Starting ${taskDescriptions[task]?.title || task}...`);
      const response = await postJson("/admin/run-task", { task });
      setStatus(response.message || "Task queued.");
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
        setActiveTab("logs");
      }
      loadJobs();
    } catch (error) {
      setStatus(
        "Task failed: " + (error.response?.data?.message || error.message),
      );
    }
  }

  async function handleClearConsole() {
    if (!selectedJob?.id) {
      setStatus("Select a job before clearing the console.");
      return;
    }

    if (isReadOnlyConsoleEntry) {
      setStatus("Recompute console entries are read-only.");
      return;
    }

    try {
      const response = await deleteJson(`/admin/jobs/${selectedJob.id}/logs`);
      setStatus(response.message || "Console cleared.");
      await loadJobs();
    } catch (error) {
      setStatus(
        "Unable to clear console: " +
          (error.response?.data?.message || error.message),
      );
    }
  }

  async function handleTerminateJob() {
    if (!selectedJob?.id) {
      setStatus("Select a job before terminating it.");
      return;
    }

    if (isReadOnlyConsoleEntry) {
      setStatus("Recompute console entries cannot be terminated from this console.");
      return;
    }

    try {
      const response = await postJson(`/admin/jobs/${selectedJob.id}/terminate`);
      setStatus(response.message || "Termination requested.");
      await loadJobs();
    } catch (error) {
      setStatus(
        "Unable to terminate task: " +
          (error.response?.data?.message || error.message),
      );
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col overflow-y-auto px-3 py-4 sm:px-4 sm:py-5 md:px-6 md:py-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-4 lg:mb-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white sm:h-10 sm:w-10 sm:rounded-xl">
              <Database size={20} />
            </div>
            {isGlobalAdmin ? "Global Admin Portal" : "Data Management Portal"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isGlobalAdmin
              ? "Manage system reference data, run full pipeline operations, and oversee all departments."
              : "Manage your department's datasets, run pipeline updates, and monitor system health."}
          </p>
        </div>

        <div className="flex w-full overflow-x-auto rounded border border-slate-200 bg-white p-1 shadow-none lg:w-auto">
          {isGlobalAdmin ? (
            <>
              <TabButton active={activeTab === "system"} onClick={() => setActiveTab("system")} icon={Database} label="System Data" />
              <TabButton active={activeTab === "operations"} onClick={() => setActiveTab("operations")} icon={UploadCloud} label="Operations" />
              <TabButton active={activeTab === "departments"} onClick={() => setActiveTab("departments")} icon={LayoutDashboard} label="Department Data" />
              <TabButton active={activeTab === "logs"} onClick={() => setActiveTab("logs")} icon={Terminal} label="System Logs" />
            </>
          ) : (
            <>
              <TabButton active={activeTab === "stewardship"} onClick={() => setActiveTab("stewardship")} icon={LayoutDashboard} label="Data Stewardship" />
              <TabButton active={activeTab === "operations"} onClick={() => setActiveTab("operations")} icon={UploadCloud} label="Operations" />
              <TabButton active={activeTab === "logs"} onClick={() => setActiveTab("logs")} icon={Terminal} label="System Logs" />
            </>
          )}
        </div>
      </div>

      <div className="min-h-[560px] flex-1 lg:min-h-0">
        {isGlobalAdmin && activeTab === "system" && <GlobalAdminStewardship />}

        {isGlobalAdmin && activeTab === "operations" && (
          <>
            <GlobalAdminOperations
              onJobQueued={(jobId) => {
                setSelectedJobId(jobId);
                setActiveTab("logs");
              }}
              onStatus={setStatus}
            />
            {status && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-mono text-slate-600">
                {status}
              </div>
            )}
          </>
        )}

        {((isGlobalAdmin && activeTab === "departments") ||
          (!isGlobalAdmin && activeTab === "stewardship")) && (
          <>
            {isGlobalAdmin && allowedDepartments.length > 0 && (
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="flex w-full flex-col gap-2 text-sm font-bold text-slate-700 sm:w-auto sm:flex-row sm:items-center">
                  Department
                  <select
                    value={selectedDepartment}
                    onChange={(event) => setSelectedDepartment(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900/10 sm:ml-3"
                  >
                    {allowedDepartments.map((department) => (
                      <option key={department} value={department}>
                        {department.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {selectedDepartment ? (
            <AdminDataStewardship
              department={selectedDepartment}
              deptConfig={departmentConfig[selectedDepartment]}
              showSubmissionHistory={!isGlobalAdmin}
            />
          ) : (
            <EmptyState
              title="No Department Access"
              description="This account is authenticated but has no department read permissions assigned. Ask a super admin to grant access in User Permissions."
            />
          )}
          </>
        )}

        {!isGlobalAdmin && activeTab === "operations" && (
          <div className="grid h-full grid-cols-1 gap-5 overflow-auto pb-8 lg:grid-cols-2 lg:gap-8">
            <Panel
              title="Dataset Ingestion"
              subtitle="Upload new records to the system via CSV or GeoJSON."
              surface="solid"
            >
              <form className="space-y-6" onSubmit={handleUpload}>
                <div className="space-y-4">
                  <label className="block text-sm font-bold text-slate-700">
                    Dataset Type
                    <select
                      className="mt-2 w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-slate-900/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      value={uploadFormState.type}
                      disabled={!selectedDepartment}
                      onChange={(e) =>
                        setUploadFormState((s) => ({
                          ...s,
                          type: e.target.value,
                        }))
                      }
                    >
                      {selectedDepartment
                        ? availableDatasetTypes.map((t) => (
                            <option key={t} value={t}>
                              {t.replace("_", " ")}
                            </option>
                          ))
                        : (
                            <option value="">No department access</option>
                        )}
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    Source File
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="file"
                        disabled={!selectedDepartment}
                        className="w-full flex-1 px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none"
                        onChange={(e) =>
                          setUploadFormState((s) => ({
                            ...s,
                            file: e.target.files?.[0],
                          }))
                        }
                      />
                      <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        disabled={!selectedDepartment || !selectedTemplate}
                        className="shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Download template file
                      </button>
                    </div>
                    {selectedTemplate && (
                      <p className="mt-2 text-xs font-medium text-slate-500">
                        {selectedTemplate.description}
                      </p>
                    )}
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={!selectedDepartment || !uploadFormState.file}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <UploadCloud size={18} />
                  Import Data
                </button>
                {!selectedDepartment && (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-700">
                    No department permissions were found for this account.
                  </div>
                )}
                {status && (
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-600 leading-relaxed font-mono">
                    {status}
                  </div>
                )}
              </form>
            </Panel>

            <Panel
              title="Pipeline Tasks"
              subtitle="Trigger automated analysis and recalculations."
              surface="solid"
            >
              <div className="grid gap-4">
                {Object.entries(taskDescriptions)
                  .filter(([key, task]) => {
                    if (!selectedDepartment) {
                      return false;
                    }
                    if (selectedDepartment === "education") {
                      return (
                        key === "worldpop_age_sex" ||
                        key === "education_insights"
                      );
                    }
                    if (selectedDepartment === "social_welfare") {
                      return task.department === "social_welfare";
                    }
                    if (selectedDepartment === "disaster") {
                      return task.department === "disaster";
                    }
                    if (selectedDepartment === "health") {
                      return key === "health_insights";
                    }
                    if (!authProfile) return true;
                    if (authProfile.role === "super_admin") return true;
                    return task.department === selectedDepartment;
                  })
                  .map(([key, task]) => (
                    <div
                      key={key}
                      className="p-4 border border-slate-100 rounded-2xl hover:border-slate-200 hover:bg-slate-50/50 transition-all group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                          {task.badge}
                        </span>
                        <Activity
                          size={14}
                          className="text-slate-300 group-hover:text-emerald-500 transition-colors"
                        />
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">
                        {task.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {task.description}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleRunTask(key)}
                        className="mt-4 text-xs font-bold text-slate-900 flex items-center gap-2 hover:gap-3 transition-all"
                      >
                        Execute Task <ChevronRight size={14} />
                      </button>
                    </div>
                  ))}
              </div>
            </Panel>
          </div>
        )}

        {activeTab === "logs" && (
          <div className="flex h-full min-h-[60vh] flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl">
            <div className="flex flex-col gap-3 border-b border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Terminal className="text-emerald-400" size={18} />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  System Console
                </h3>
                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold">
                  LIVE
                </span>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
                <select
                  value={selectedJobId}
                  onChange={(event) => setSelectedJobId(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none sm:max-w-64"
                >
                  {jobs.length ? (
                    jobs.map((job) => (
                      <option key={job.id} value={job.id}>
                        {job.label} [{job.status}]
                      </option>
                    ))
                  ) : (
                    <option value="">No jobs</option>
                  )}
                </select>
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  Stage: {selectedJob?.currentStage || "Idle"}
                </span>
                <button
                  onClick={handleClearConsole}
                  disabled={!selectedJob?.id || isReadOnlyConsoleEntry}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-white/80 transition-colors hover:bg-white/10 disabled:opacity-40 sm:flex-none"
                >
                  <Trash2 size={14} />
                  Clear console
                </button>
                <button
                  onClick={handleTerminateJob}
                  disabled={!selectedJob?.canTerminate || isReadOnlyConsoleEntry}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:opacity-40 sm:flex-none"
                >
                  <Square size={13} />
                  Terminate task
                </button>
                <button
                  onClick={loadJobs}
                  className="p-2 text-white/40 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isRefreshingJobs}
                >
                  <RefreshCw size={16} className={isRefreshingJobs ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
              <div className="border-b border-white/10 bg-black/20 lg:border-b-0 lg:border-r">
                <div className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                  Recent jobs
                </div>
                <div className="max-h-full overflow-auto">
                  {jobs.length ? (
                    jobs.map((job) => {
                      const isSelected = job.id === selectedJob?.id;
                      return (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedJobId(job.id)}
                          className={`flex w-full flex-col gap-1 border-b border-white/5 px-4 py-3 text-left transition-colors ${
                            isSelected ? "bg-white/10" : "hover:bg-white/5"
                          }`}
                        >
                          <span className="text-xs font-bold text-white">{job.label}</span>
                          <span className="text-[11px] text-slate-400">
                            {job.status} • {new Date(job.createdAt).toLocaleString()}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-4 py-6 text-sm text-slate-500">No jobs available.</div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed sm:p-6">
                {selectedJob?.logs?.length ? (
                  selectedJob.logs.map((log, i) => (
                    <div
                      key={i}
                      className="animate-in fade-in slide-in-from-left-2 mb-1.5 flex gap-3 duration-300 sm:gap-4"
                    >
                      <span className="w-16 flex-shrink-0 text-slate-500 sm:w-20">
                        [{new Date(log.at).toLocaleTimeString()}]
                      </span>
                      <span
                        className={
                          isErrorLogEntry(log)
                            ? "text-rose-400"
                            : "text-emerald-400"
                        }
                      >
                        {log.message}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
                    <AlertCircle size={32} className="mb-4 opacity-20" />
                    {selectedJob
                      ? "No logs available for the selected job."
                      : "No logs available for the current session."}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }) {
  const IconComponent = icon;

  return (
    <button
      onClick={onClick}
      style={{
        backgroundColor: active ? "#000000" : "#f3f4f6",
        borderColor: active ? "#000000" : "transparent",
        color: active ? "#ffffff" : "#374151",
      }}
      className="flex shrink-0 items-center gap-2 rounded border px-3 py-2 text-xs font-bold transition-all duration-200 ease-out hover:brightness-95 sm:px-4 sm:py-2.5 sm:text-sm md:px-6"
    >
      {IconComponent ? <IconComponent size={15} /> : null}
      {label}
    </button>
  );
}

export default AdminPage;
