import { useState } from "react";
import {
  Activity,
  ChevronRight,
  Globe,
  Map,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import Panel from "./Panel";
import { postJson, uploadForm } from "../lib/api";

const GLOBAL_TASKS = [
  {
    key: "planning_refresh",
    badge: "Full refresh",
    title: "Run full planning refresh",
    description:
      "Refreshes WorldPop inputs, then recalculates education, health, and disaster analyses.",
  },
  {
    key: "worldpop_totals",
    badge: "WorldPop",
    title: "Sync WorldPop population totals",
    description: "Fetches district population totals from the WorldPop API.",
  },
  {
    key: "worldpop_age_sex",
    badge: "WorldPop",
    title: "Sync WorldPop age-sex pyramid",
    description: "Fetches age-sex population breakdowns from the WorldPop API.",
  },
  {
    key: "roads_overpass_sync",
    badge: "Overpass",
    title: "Sync roads from Overpass API",
    description: "Fetches OpenStreetMap road network data for routing analyses.",
  },
  {
    key: "education_insights",
    badge: "Education",
    title: "Recalculate education insights",
    description: "Runs education summary, coverage, and nearest-school analyses.",
  },
  {
    key: "health_insights",
    badge: "Health",
    title: "Recalculate health insights",
    description: "Runs health summary, coverage, 2SFCA, and access analyses.",
  },
  {
    key: "disaster_insights",
    badge: "Disaster",
    title: "Recalculate disaster insights",
    description: "Runs flood vulnerability and disaster exposure analyses.",
  },
  {
    key: "welfare_insights",
    badge: "Welfare",
    title: "Recalculate welfare insights",
    description: "Refreshes beneficiary access indicators and travel metrics.",
  },
  {
    key: "road_travel_access",
    badge: "Routing",
    title: "Recalculate road travel access",
    description: "Updates beneficiary travel times to schools and health facilities.",
  },
];

export default function GlobalAdminOperations({ onJobQueued, onStatus }) {
  const [boundaryFile, setBoundaryFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleBoundaryUpload(event) {
    event.preventDefault();
    if (!boundaryFile) {
      onStatus?.("Please select a boundary shapefile or GeoJSON archive.");
      return;
    }

    const formData = new FormData();
    formData.append("type", "boundaries");
    formData.append("sourceType", "file");
    formData.append("file", boundaryFile);

    try {
      setBusy(true);
      onStatus?.("Uploading administrative boundaries...");
      const response = await uploadForm("/admin/upload", formData);
      onStatus?.(response.message || "Boundary upload queued.");
      if (response.data?.job_id) {
        onJobQueued?.(response.data.job_id);
      }
    } catch (error) {
      onStatus?.(
        "Boundary upload failed: " + (error.response?.data?.message || error.message),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRunTask(task) {
    try {
      setBusy(true);
      onStatus?.(`Starting ${task}...`);
      const response = await postJson("/admin/run-task", { task });
      onStatus?.(response.message || "Task queued.");
      if (response.data?.job_id) {
        onJobQueued?.(response.data.job_id);
      }
    } catch (error) {
      onStatus?.("Task failed: " + (error.response?.data?.message || error.message));
    } finally {
      setBusy(false);
    }
  }

  async function handleWorldPopSync(dataset) {
    try {
      setBusy(true);
      onStatus?.(`Starting WorldPop ${dataset} sync...`);
      const response = await postJson("/admin/sync", {
        type: "worldpop",
        worldpopDataset: dataset,
        worldpopYear: 2020,
      });
      onStatus?.(response.message || "WorldPop sync queued.");
      if (response.data?.job_id) {
        onJobQueued?.(response.data.job_id);
      }
    } catch (error) {
      onStatus?.("WorldPop sync failed: " + (error.response?.data?.message || error.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-8 overflow-auto pb-8 lg:grid-cols-2">
      <Panel
        title="Administrative Boundaries"
        subtitle="Upload district, TA, or village boundary shapefiles (SHP, GeoJSON, ZIP)."
        surface="solid"
      >
        <form className="space-y-6" onSubmit={handleBoundaryUpload}>
          <label className="block text-sm font-bold text-slate-700">
            Boundary file
            <input
              type="file"
              accept=".zip,.shp,.geojson,.json,.gpkg"
              disabled={busy}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm"
              onChange={(event) => setBoundaryFile(event.target.files?.[0] || null)}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {busy ? <RefreshCw size={18} className="animate-spin" /> : <UploadCloud size={18} />}
            Upload boundaries
          </button>
        </form>
      </Panel>

      <Panel
        title="External API Sync"
        subtitle="Pull fresh population and road network data from WorldPop and Overpass."
        surface="solid"
      >
        <div className="grid gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleWorldPopSync("wpgppop")}
            className="flex items-center justify-between rounded-2xl border border-slate-100 p-4 text-left hover:bg-slate-50 disabled:opacity-60"
          >
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                <Globe size={14} />
                WorldPop API
              </div>
              <h4 className="mt-1 text-sm font-bold text-slate-900">Population totals</h4>
              <p className="mt-1 text-xs text-slate-500">Sync district population totals.</p>
            </div>
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => handleWorldPopSync("wpgpas")}
            className="flex items-center justify-between rounded-2xl border border-slate-100 p-4 text-left hover:bg-slate-50 disabled:opacity-60"
          >
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                <Globe size={14} />
                WorldPop API
              </div>
              <h4 className="mt-1 text-sm font-bold text-slate-900">Age-sex pyramid</h4>
              <p className="mt-1 text-xs text-slate-500">Sync school-age population inputs.</p>
            </div>
            <ChevronRight size={16} />
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => handleRunTask("roads_overpass_sync")}
            className="flex items-center justify-between rounded-2xl border border-slate-100 p-4 text-left hover:bg-slate-50 disabled:opacity-60"
          >
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-sky-600">
                <Map size={14} />
                Overpass API
              </div>
              <h4 className="mt-1 text-sm font-bold text-slate-900">Road network sync</h4>
              <p className="mt-1 text-xs text-slate-500">Fetch OSM roads for routing analyses.</p>
            </div>
            <ChevronRight size={16} />
          </button>
        </div>
      </Panel>

      <Panel
        title="Pipeline Recompute"
        subtitle="Run full or partial ETL analysis pipelines across all departments."
        surface="solid"
        className="lg:col-span-2"
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {GLOBAL_TASKS.map((task) => (
            <div
              key={task.key}
              className="rounded-2xl border border-slate-100 p-4 transition-all hover:border-slate-200 hover:bg-slate-50/50"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                  {task.badge}
                </span>
                <Activity size={14} className="text-slate-300" />
              </div>
              <h4 className="text-sm font-bold text-slate-900">{task.title}</h4>
              <p className="mt-1 text-xs text-slate-500">{task.description}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleRunTask(task.key)}
                className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-900 disabled:opacity-60"
              >
                Execute task <ChevronRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
