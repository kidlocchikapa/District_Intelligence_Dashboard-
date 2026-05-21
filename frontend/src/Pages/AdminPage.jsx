import { useEffect, useMemo, useState } from "react";
import EmptyState from "../components/EmptyState";
import Panel from "../components/Panel";
import AdminDataStewardship from "../components/AdminDataStewardship";
import {
  AUTH_EVENT_NAME,
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
    columns: ["name", "type", "healthcare", "district_name"],
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
    endpoint: "disaster",
    idKey: "id",
    columns: ["event_type", "risk_level", "population_at_risk"],
  },
};

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
  const allowedDepartments = useMemo(() => {
    if (!authProfile) {
      return [];
    }

    if (
      authProfile.is_global_admin ||
      authProfile.role === "super_admin" ||
      authProfile.role === "admin"
    ) {
      return availableDepartments;
    }

    const profileDepartments = Array.isArray(authProfile.departments)
      ? authProfile.departments
      : [];

    return profileDepartments.filter((department) =>
      availableDepartments.includes(department),
    );
  }, [authProfile, availableDepartments]);

  useEffect(() => {
    function syncAuthState(event) {
      const nextToken = event?.detail?.token || null;
      setTokenState(nextToken);
    }
    window.addEventListener(AUTH_EVENT_NAME, syncAuthState);
    return () => window.removeEventListener(AUTH_EVENT_NAME, syncAuthState);
  }, []);

  async function loadJobs() {
    if (!isAuthenticated) return;
    try {
      setIsRefreshingJobs(true);
      const response = await fetchJson("/admin/jobs");
      const nextJobs = response.jobs || [];
      setJobs(nextJobs);
      setSelectedJobId((current) => current || nextJobs[0]?.id || "");
    } catch (error) {
      console.error("Load jobs error", error);
    } finally {
      setIsRefreshingJobs(false);
    }
  }

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
  }, [isAuthenticated]);

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
      setUploadFormState((s) => ({ ...s, type: "social_welfare" }));
    } else if (selectedDepartment === "disaster") {
      setUploadFormState((s) => ({ ...s, type: "disaster" }));
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
    const selectedType =
      uploadFormState.type === "social_welfare"
        ? "welfare"
        : uploadFormState.type;
    const formData = new FormData();
    formData.append("type", selectedType);
    formData.append("file", uploadFormState.file);
    try {
      setStatus(`Starting ${uploadFormState.type} upload...`);
      const response = await uploadForm("/admin/upload", formData);
      setStatus(response.message || "Upload started.");
      if (response.data?.job_id) setSelectedJobId(response.data.job_id);
      loadJobs();
    } catch (error) {
      setStatus(
        "Upload failed: " + (error.response?.data?.message || error.message),
      );
    }
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
      if (response.data?.job_id) setSelectedJobId(response.data.job_id);
      loadJobs();
    } catch (error) {
      setStatus(
        "Task failed: " + (error.response?.data?.message || error.message),
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
            <span className="leading-tight">Data Management Portal</span>
          </h1>
          <p className="mt-1 max-w-3xl text-xs text-slate-500 sm:text-sm">
            Manage your department's datasets, run pipeline updates, and monitor
            system health.
          </p>
        </div>

        <div className="flex w-full overflow-x-auto rounded border border-slate-200 bg-white p-1 shadow-none lg:w-auto">
          <TabButton active={activeTab === 'stewardship'} onClick={() => setActiveTab('stewardship')} icon={LayoutDashboard} label="Data Stewardship" />
          <TabButton active={activeTab === 'operations'} onClick={() => setActiveTab('operations')} icon={UploadCloud} label="Operations" />
          <TabButton active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} icon={Terminal} label="System Logs" />
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {activeTab === 'stewardship' && (
          selectedDepartment ? (
            <AdminDataStewardship
              department={selectedDepartment}
              deptConfig={departmentConfig[selectedDepartment]}
            />
          ) : (
            <EmptyState
              title="No Department Access"
              description="This account is authenticated but has no department read permissions assigned. Ask a super admin to grant access in User Permissions."
            />
          )
        )}

        {activeTab === "operations" && (
          <div className="grid h-full grid-cols-1 gap-4 overflow-auto pb-6 sm:gap-6 lg:grid-cols-2 lg:gap-8 lg:pb-8">
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
                        ? datasetTypes
                            .filter((t) => {
                              if (selectedDepartment === "education")
                                return t === "education";
                              if (selectedDepartment === "social_welfare")
                                return t === "social_welfare" || t === "roads";
                              if (selectedDepartment === "disaster")
                                return t === "disaster" || t === "flood";
                              if (selectedDepartment === "health")
                                return t === "health";
                              return true;
                            })
                            .map((t) => (
                              <option key={t} value={t}>
                                {t.replace("_", " ")}
                              </option>
                            ))
                        : (
                          <option value="">
                            No department access
                          </option>
                        )}
                    </select>
                  </label>
                  <label className="block text-sm font-bold text-slate-700">
                    Source File
                    <input
                      type="file"
                      disabled={
                        !selectedDepartment ||
                        selectedDepartment === "education" ||
                        selectedDepartment === "health"
                      }
                      className="mt-2 w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl outline-none"
                      onChange={(e) =>
                        setUploadFormState((s) => ({
                          ...s,
                          file: e.target.files?.[0],
                        }))
                      }
                    />
                  </label>
                </div>
                <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 font-bold text-white transition-all hover:bg-slate-800">
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
              <div className="flex items-center gap-3">
                <Terminal className="text-emerald-400" size={18} />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  System Console
                </h3>
                <span className="text-[10px] px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full font-bold">
                  LIVE
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                <span className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Active Job: {selectedJob?.label || "None"}
                </span>
                <button
                  onClick={loadJobs}
                  className="p-2 text-white/40 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isRefreshingJobs}
                >
                  <RefreshCw size={16} className={isRefreshingJobs ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed sm:p-4 sm:text-xs md:p-6">
              {selectedJob?.logs?.length ? (
                selectedJob.logs.map((log, i) => (
                  <div
                    key={i}
                    className="mb-1.5 flex flex-col gap-1 animate-in fade-in slide-in-from-left-2 duration-300 sm:flex-row sm:gap-4"
                  >
                    <span className="w-20 shrink-0 text-slate-500">
                      [{new Date(log.at).toLocaleTimeString()}]
                    </span>
                    <span
                      className={
                        log.level === "error"
                          ? "text-rose-400"
                          : "text-emerald-400 opacity-90"
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 italic">
                  <AlertCircle size={32} className="mb-4 opacity-20" />
                  No logs available for the current session.
                </div>
              )}
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
