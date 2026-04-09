import { useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import Panel from '../components/Panel';
import { AUTH_EVENT_NAME, fetchJson, hydrateAuthToken, postJson, uploadForm } from '../lib/api';

const datasetTypes = ['boundaries', 'education', 'health', 'welfare', 'disaster'];

const taskDescriptions = {
  worldpop_totals: {
    badge: 'Population',
    title: 'Refresh district population',
    description: 'Updates district population totals in the background using WorldPop.',
  },
  worldpop_age_sex: {
    badge: 'Education input',
    title: 'Refresh children and school-age population',
    description: 'Updates the age-sex counts used to estimate school demand by district.',
  },
  education_insights: {
    badge: 'Education',
    title: 'Recalculate education insights',
    description: 'Refreshes school summary, service coverage, and nearest-school analyses.',
  },
  health_insights: {
    badge: 'Health',
    title: 'Recalculate health insights',
    description: 'Refreshes facility counts, coverage, served population, and access metrics.',
  },
  disaster_insights: {
    badge: 'Disaster',
    title: 'Recalculate disaster insights',
    description: 'Refreshes district-level disaster vulnerability outputs.',
  },
  planning_refresh: {
    badge: 'Full refresh',
    title: 'Run full planning refresh',
    description: 'Refreshes population inputs first, then recalculates education, health, and disaster views.',
  },
};

function formatJobStatus(status) {
  if (!status) {
    return 'Idle';
  }

  return status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTimestamp(value) {
  if (!value) {
    return 'Not started yet';
  }

  return new Date(value).toLocaleString();
}

function AdminPage() {
  const [token, setTokenState] = useState(() => hydrateAuthToken());
  const [uploadFormState, setUploadFormState] = useState({
    type: 'education',
    gazetteerPath: 'sample_data/master_gazetteer.csv',
    file: null,
  });
  const [status, setStatus] = useState('');
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState('');
  const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);

  const isAuthenticated = useMemo(() => Boolean(token), [token]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) || jobs[0] || null,
    [jobs, selectedJobId]
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
      const response = await fetchJson('/admin/jobs');
      const nextJobs = response.jobs || [];
      setJobs(nextJobs);
      setSelectedJobId((current) => current || nextJobs[0]?.id || '');
    } catch (error) {
      setStatus(error.response?.data?.message || 'Unable to refresh background jobs.');
    } finally {
      setIsRefreshingJobs(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setJobs([]);
      setSelectedJobId('');
      setStatus('Sign in from the sidebar to enable admin uploads and background refresh actions.');
      return undefined;
    }

    loadJobs();
    const intervalId = window.setInterval(loadJobs, 2500);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!isAuthenticated) {
      setStatus('Sign in from the sidebar before starting an upload.');
      return;
    }

    if (!uploadFormState.file) {
      setStatus('Choose a file before starting the upload.');
      return;
    }

    const formData = new FormData();
    formData.append('type', uploadFormState.type);
    formData.append('gazetteerPath', uploadFormState.gazetteerPath);
    formData.append('file', uploadFormState.file);

    setStatus(`Starting ${uploadFormState.type} upload in the background...`);

    try {
      const response = await uploadForm('/admin/upload', formData);
      setStatus(response.message || 'Dataset upload started.');
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
      }
      await loadJobs();
    } catch (error) {
      setStatus(error.response?.data?.message || 'Upload failed');
    }
  }

  async function runPresetTask(taskKey) {
    if (!isAuthenticated) {
      setStatus('Sign in from the sidebar before running a background task.');
      return;
    }

    setStatus(`Starting ${taskDescriptions[taskKey]?.title || 'background task'}...`);

    try {
      const response = await postJson('/admin/run-task', { task: taskKey });
      setStatus(response.message || 'Background task started.');
      if (response.data?.job_id) {
        setSelectedJobId(response.data.job_id);
      }
      await loadJobs();
    } catch (error) {
      setStatus(error.response?.data?.message || 'Could not start the background task.');
    }
  }

  async function pingApi() {
    setStatus('Checking backend availability...');
    try {
      const response = await fetchJson('/');
      setStatus(response.message || 'API is reachable.');
    } catch (error) {
      setStatus(error.response?.data?.message || 'API check failed');
    }
  }

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

      <div className="grid gap-6">
        <Panel
          title="Background activity"
          subtitle={
            isAuthenticated
              ? 'Every upload or refresh runs in the background and writes its progress here.'
              : 'Use the sidebar to sign in, then return here to manage uploads and background jobs.'
          }
          surface="solid"
          className="border-slate-200 bg-white text-slate-900 shadow-sm"
        >
          <div className="grid gap-4 lg:grid-cols-[0.38fr_0.62fr]">
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                {status || 'No admin action has been triggered yet.'}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <h3 className="text-sm font-semibold text-slate-900">Recent jobs</h3>
                  <button
                    type="button"
                    onClick={loadJobs}
                    className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                  >
                    {isRefreshingJobs ? 'Refreshing...' : 'Refresh'}
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
                            ? 'border-slate-900 bg-slate-100'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate-900">{job.label}</div>
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
                  <div className="text-xs uppercase tracking-[0.26em] text-emerald-300/70">Pipeline console</div>
                  <div className="mt-1 text-sm font-semibold text-white">
                    {selectedJob?.label || 'Waiting for a background job'}
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
                    <div key={`${entry.at}-${index}`} className="whitespace-pre-wrap break-words">
                      <span className="text-slate-400">[{new Date(entry.at).toLocaleTimeString()}]</span>{' '}
                      <span
                        className={
                          entry.level === 'error'
                            ? 'text-rose-300'
                            : entry.level === 'stderr'
                            ? 'text-amber-300'
                            : 'text-emerald-200'
                        }
                      >
                        {entry.message}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-400">Start an upload or refresh action to see ETL logs here.</div>
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
                onChange={(event) => setUploadFormState((state) => ({ ...state, type: event.target.value }))}
              >
                {datasetTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-700">
              File
              <input
                type="file"
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900"
                disabled={!isAuthenticated}
                onChange={(event) => setUploadFormState((state) => ({ ...state, file: event.target.files?.[0] || null }))}
              />
            </label>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              Upload CSV, Excel, GeoJSON, GeoPackage, or a zipped shapefile bundle. The pipeline will process it in the
              background and write progress to the console above.
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
              <div key={taskKey} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{task.badge}</div>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{task.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">{task.description}</p>
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
