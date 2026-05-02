import { useState, useEffect, useMemo } from "react";
import { 
  Database, 
  Table as TableIcon, 
  Search, 
  Plus, 
  Filter, 
  Columns, 
  RefreshCw,
  MoreHorizontal,
  ChevronRight,
  ChevronLeft,
  FileText,
  Activity,
  School,
  Users,
  ShieldAlert,
  ArrowUpDown
} from "lucide-react";
import { fetchJson, postJson, patchJson, deleteJson } from "../lib/api";

const DEPARTMENT_TABLES = {
  education: [
    { 
      id: 'education_facilities', 
      label: 'Schools', 
      icon: School, 
      endpoint: 'education',
      columns: ["name", "status", "district_name", "ward_name"]
    },
    { 
      id: 'flood_exposed_schools', 
      label: 'Flood Exposed Schools', 
      icon: ShieldAlert, 
      endpoint: 'education?filter=flood_exposed',
      columns: ["name", "status", "district_name", "ward_name"]
    },
    { 
      id: 'flood_exposure_summary', 
      label: 'Flood Exposure Summary', 
      icon: FileText, 
      endpoint: 'education/flood_summary',
      columns: ["admin_unit_name", "metric_name", "metric_value", "metric_unit"]
    },
  ],
  health: [
    { 
      id: 'health_facilities', 
      label: 'Health Facilities', 
      icon: Activity, 
      endpoint: 'health',
      columns: ["name", "type", "healthcare", "district_name"]
    },
    { 
      id: 'flood_exposed_health', 
      label: 'Flood Exposed Health', 
      icon: ShieldAlert, 
      endpoint: 'health?filter=flood_exposed',
      columns: ["name", "type", "healthcare", "district_name"]
    },
    { 
      id: 'health_summary', 
      label: 'Health Summary', 
      icon: FileText, 
      endpoint: 'health/summary',
      columns: ["admin_unit_name", "facility_count", "beds_total"]
    },
  ],
  social_welfare: [
    { 
      id: 'welfare_beneficiary', 
      label: 'Welfare Beneficiary', 
      icon: Users, 
      endpoint: 'social_welfare',
      columns: ["program_name", "beneficiary_count", "district_name", "ward_name"]
    },
    { 
      id: 'welfare_indicator', 
      label: 'Beneficiary Indicators', 
      icon: Activity, 
      endpoint: 'social_welfare/indicators',
      columns: ["beneficiary_id", "indicator_name", "indicator_value", "last_updated"]
    },
    { 
      id: 'welfare_programs', 
      label: 'Welfare Programs', 
      icon: FileText, 
      endpoint: 'social_welfare/programs',
      columns: ["program_id", "program_name", "description"]
    },
  ],
  disaster: [
    { 
      id: 'flood_facility_exposure', 
      label: 'Flood Facility Exposure', 
      icon: Activity, 
      endpoint: 'disaster/facility_exposure',
      columns: ["name", "type", "risk_level", "flood_depth"]
    },
    { 
      id: 'flood_exposure_summary', 
      label: 'Exposure Summary', 
      icon: FileText, 
      endpoint: 'disaster/exposure_summary',
      columns: ["admin_unit_name", "total_facilities", "at_risk_count", "risk_percentage"]
    },
    { 
      id: 'flood_zones', 
      label: 'Flood Zones', 
      icon: ShieldAlert, 
      endpoint: 'disaster',
      columns: ["event_type", "risk_level", "population_at_risk"]
    },
  ],
};

export default function AdminDataStewardship({ department, deptConfig }) {
  const [selectedTableId, setSelectedTableId] = useState(DEPARTMENT_TABLES[department]?.[0]?.id || '');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, total_pages: 0 });
  
  const tables = DEPARTMENT_TABLES[department] || [];
  const selectedTable = tables.find(t => t.id === selectedTableId) || tables[0];

  useEffect(() => {
    if (selectedTable) {
      loadTableData();
    }
  }, [selectedTableId, page, searchQuery]);

  async function loadTableData() {
    try {
      setLoading(true);
      const params = {
        page,
        page_size: 25,
        search: searchQuery
      };
      const response = await fetchJson(`/admin-data/${selectedTable.endpoint}`, { params });
      setRecords(response.items || []);
      setMeta({
        total: response.total || 0,
        total_pages: response.total_pages || 0
      });
    } catch (err) {
      console.error("Failed to load table data", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Secondary Sidebar: Tables List */}
      <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-slate-200 bg-white">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Database size={16} className="text-slate-400" />
            Tables
          </h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            {department.replace('_', ' ')} Production
          </p>
        </div>
        
        <div className="p-3">
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text"
              placeholder="Search tables..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-slate-900/5 transition-all"
            />
          </div>

          <nav className="space-y-0.5">
            {tables.map(table => (
              <button
                key={table.id}
                onClick={() => setSelectedTableId(table.id)}
                className={`w-full text-left px-3 py-2 rounded-lg flex items-center gap-2.5 transition-all ${
                  selectedTableId === table.id 
                  ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10' 
                  : 'text-slate-600 hover:bg-slate-200/50 hover:text-slate-900'
                }`}
              >
                <table.icon size={14} className={selectedTableId === table.id ? 'text-emerald-400' : 'text-slate-400'} />
                <span className="text-[13px] font-bold">{table.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Table Toolbar */}
        <header className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-slate-900">{selectedTable?.label}</h2>
            <div className="h-4 w-px bg-slate-200 mx-2" />
            <div className="flex items-center gap-1">
              <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors" title="Filter">
                <Filter size={16} />
              </button>
              <button className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors" title="Columns">
                <Columns size={16} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input 
                type="text"
                placeholder="Search records..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:bg-white focus:ring-2 focus:ring-slate-900/5 transition-all w-64"
              />
            </div>
            <button className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-lg shadow-slate-900/10">
              <Plus size={16} />
              Add record
            </button>
          </div>
        </header>

        {/* Data Grid */}
        <div className="flex-1 overflow-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
              <RefreshCw size={24} className="animate-spin text-slate-400" />
            </div>
          )}

          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="sticky top-0 bg-slate-50 z-20 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input type="checkbox" className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20" />
                </th>
                {(selectedTable?.columns || deptConfig.columns).map(col => (
                  <th key={col} className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <div className="flex items-center gap-2 group cursor-pointer">
                      {col.replace('_', ' ')}
                      <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </th>
                ))}
                <th className="w-12 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {records.map((record, idx) => (
                <tr key={record[deptConfig.idKey] || idx} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-4 py-3">
                    <input type="checkbox" className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/20" />
                  </td>
                  {(selectedTable?.columns || deptConfig.columns).map(col => (
                    <td key={col} className="px-4 py-3">
                      <span className="text-[13px] text-slate-600 font-medium">
                        {String(record[col] || '-')}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">
                    <button className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all opacity-0 group-hover:opacity-100">
                      <MoreHorizontal size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={(selectedTable?.columns || deptConfig.columns).length + 2} className="py-12 text-center text-slate-400">
                    No records found for this table.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <footer className="p-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <div className="text-xs font-medium text-slate-500">
            Showing <span className="font-bold text-slate-900">{(page-1)*25 + 1}</span> to <span className="font-bold text-slate-900">{Math.min(page*25, meta.total)}</span> of <span className="font-bold text-slate-900">{meta.total}</span> records
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-xs font-bold px-3">Page {page} of {meta.total_pages || 1}</div>
            <button 
              onClick={() => setPage(p => Math.min(meta.total_pages, p + 1))}
              disabled={page >= meta.total_pages}
              className="p-2 border border-slate-200 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}
