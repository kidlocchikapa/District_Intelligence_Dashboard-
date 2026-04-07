import { useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import PageHeader from '../components/PageHeader';
import Panel from '../components/Panel';
import { fetchJson, hydrateAuthToken, postJson, setAuthToken, uploadForm } from '../lib/api';

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
  const [loginForm, setLoginForm] = useState({ email: 'admin@district.gov', password: 'password' });
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
      return undefined;
    }

    loadJobs();
    const intervalId = window.setInterval(loadJobs, 2500);
    return () => window.clearInterval(intervalId);
  }, [isAuthenticated]);

  async function handleLogin(event) {
    event.preventDefault();
    setStatus('Authenticating admin session...');

    try {
      const response = await postJson('/auth/login', loginForm);
      const nextToken = response?.data?.token;
      setAuthToken(nextToken);
      setTokenState(nextToken);
      setStatus('Admin authenticated. Background actions are now available.');
    } catch (error) {
      setStatus(error.response?.data?.message || 'Login failed');
    }
  }

  async function handleUpload(event) {
    event.preventDefault();
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin portal"
        title="Simple background data operations"
        description="Upload new datasets, run refresh actions, and follow ETL progress from one simple control room."
        actions={[
          <button
            key="ping"
            type="button"
            onClick={pingApi}
            className="rounded border border-pine bg-white text-pine hover:bg-pine hover:text-white px-3 py-1.5 text-xs font-bold transition-all shadow-sm active:scale-95"
          >
            Check API
          </button>,
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <Panel title="Admin login" subtitle="Authenticate once, then use the simplified controls below.">
          <form className="space-y-4" onSubmit={handleLogin}>
            <label className="block text-sm text-slate/70">
              Email
              <input
                className="mt-2 w-full rounded border border-fog bg-sand/60 px-4 py-3 outline-none transition focus:border-moss"
                value={loginForm.email}
                onChange={(event) => setLoginForm((state) => ({ ...state, email: event.target.value }))}
              />
            </label>
            <label className="block text-sm text-slate/70">
              Password
              <input
                type="password"
                className="mt-2 w-full rounded border border-fog bg-sand/60 px-4 py-3 outline-none transition focus:border-moss"
                value={loginForm.password}
                onChange={(event) => setLoginForm((state) => ({ ...state, password: event.target.value }))}
              />
            </label>
            <button className="rounded bg-ember px-3 py-1.5 text-xs font-bold text-white transition-all shadow-sm hover:opacity-90 active:scale-95">
              {isAuthenticated ? 'Refresh session' : 'Login'}
            </button>
          </form>

          <div className="mt-4 rounded bg-sand/70 p-4 text-sm leading-6 text-slate/65">
            Demo credentials: <strong>admin@district.gov</strong> / <strong>password</strong>
          </div>
        </Panel>

        <Panel title="Background activity" subtitle="Every upload or refresh runs in the background and writes its progress here.">
          <div className="grid gap-4 lg:grid-cols-[0.38fr_0.62fr]">
            <div className="space-y-3">
              <div className="rounded bg-sand/70 p-4 text-sm leading-6 text-slate/65">
                {status || 'No admin action has been triggered yet.'}
              </div>

              <div className="rounded border border-fog bg-white p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <h3 className="text-sm font-semibold text-slate">Recent jobs</h3>
                  <button
                    type="button"
                    onClick={loadJobs}
                    className="rounded border border-fog px-3 py-1 text-xs font-medium text-slate/70 transition hover:border-moss hover:text-moss"
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
                            ? 'border-moss bg-moss/10'
                            : 'border-fog bg-sand/40 hover:border-moss/60'
                        }`}
                      >
                        <div className="text-sm font-semibold text-slate">{job.label}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate/45">
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
                title="Login required"
                description="Background uploads and refreshes use protected admin endpoints, so authenticate first."
              />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
        <Panel title="Upload a dataset" subtitle="Choose what you are uploading, select the file, and let the pipeline handle the rest in the background.">
          <form className="grid gap-4" onSubmit={handleUpload}>
            <label className="text-sm text-slate/70">
              Dataset type
              <select
                className="mt-2 w-full rounded border border-fog bg-sand/60 px-4 py-3"
                value={uploadFormState.type}
                onChange={(event) => setUploadFormState((state) => ({ ...state, type: event.target.value }))}
              >
                {datasetTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate/70">
              File
              <input
                type="file"
                className="mt-2 w-full rounded border border-fog bg-sand/60 px-4 py-3"
                onChange={(event) => setUploadFormState((state) => ({ ...state, file: event.target.files?.[0] || null }))}
              />
            </label>

            <div className="rounded bg-sand/70 p-4 text-sm leading-6 text-slate/65">
              Upload CSV, Excel, GeoJSON, GeoPackage, or a zipped shapefile bundle. The pipeline will process it in the
              background and write progress to the console above.
            </div>

            <button className="rounded bg-pine px-3 py-1.5 text-xs font-bold text-white transition-all shadow-sm hover:bg-moss active:scale-95">
              Start upload
            </button>
          </form>
        </Panel>

        <Panel title="Refresh data in one click" subtitle="Use friendly background actions instead of ETL parameters.">
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(taskDescriptions).map(([taskKey, task]) => (
              <div key={taskKey} className="rounded border border-fog bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                <div className="text-xs uppercase tracking-[0.2em] text-ember/70">{task.badge}</div>
                <h3 className="mt-2 text-lg font-semibold text-slate">{task.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate/65">{task.description}</p>
                <button
                  type="button"
                  onClick={() => runPresetTask(taskKey)}
                  disabled={!isAuthenticated}
                  className="mt-4 rounded bg-ember px-3 py-1.5 text-xs font-bold text-white transition-all shadow-sm hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate/30"
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
