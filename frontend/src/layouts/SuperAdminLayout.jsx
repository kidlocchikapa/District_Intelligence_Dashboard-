import { NavLink, useNavigate } from 'react-router-dom';
import { Users2, ShieldAlert, LogOut, LayoutDashboard, Database } from 'lucide-react';
import { setAuthToken } from '../lib/api';

export default function SuperAdminLayout({ children }) {
  const navigate = useNavigate();

  function handleLogout() {
    setAuthToken(null);
    navigate('/login');
  }

  return (
    <div className="flex h-screen w-full bg-slate-50 overflow-hidden font-sans">
      {/* Dedicated Super Admin Sidebar */}
      <aside className="w-72 bg-[#0F172A] text-white flex flex-col flex-shrink-0 shadow-2xl z-50">
        <div className="p-8 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Database className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">System Admin</h1>
              <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest">Super User Mode</p>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 py-6 space-y-8 overflow-y-auto">
          <div>
            <h2 className="px-4 text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Core Management</h2>
            <nav className="space-y-1.5">
              <NavLink 
                to="/superadmin" 
                end
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200
                  ${isActive ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}
                `}
              >
                <Users2 size={18} />
                Users
              </NavLink>
              <NavLink 
                to="/superadmin/permissions" 
                className={({ isActive }) => `
                  flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200
                  ${isActive ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}
                `}
              >
                <ShieldAlert size={18} />
                User Permissions
              </NavLink>
            </nav>
          </div>

        </div>

        <div className="p-4 mt-auto">
          <button 
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-3 px-4 py-4 rounded-2xl bg-white/5 text-slate-400 font-bold text-sm hover:bg-rose-500 hover:text-white transition-all duration-300 group"
          >
            <LogOut size={18} className="group-hover:rotate-180 transition-transform duration-500" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto relative">
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] -z-10" />
        {children}
      </main>
    </div>
  );
}
