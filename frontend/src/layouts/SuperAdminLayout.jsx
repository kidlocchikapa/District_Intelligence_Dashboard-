import { NavLink, useNavigate } from 'react-router-dom';
import { Users2, ShieldAlert, LogOut, Database } from 'lucide-react';
import { setAuthToken } from '../lib/api';

export default function SuperAdminLayout({ children }) {
  const navigate = useNavigate();

  function handleLogout() {
    setAuthToken(null);
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50 font-sans lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Dedicated Super Admin Sidebar */}
      <aside className="z-50 flex w-full flex-col border-b border-gray-200 bg-[#F9FAFB] text-black lg:w-72 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
        <div className="p-5 pb-4 sm:p-8 sm:pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 bg-black rounded flex items-center justify-center shadow-lg">
              <Database className="text-white" size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">System Admin</h1>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Super User Mode</p>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:space-y-8 sm:py-6">
          <div>
            <h2 className="px-4 text-xs font-extrabold text-black uppercase tracking-wider mb-4">Core Management</h2>
            <nav className="space-y-1.5">
              <NavLink 
                to="/superadmin" 
                end
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded text-[15px] font-semibold transition-all duration-200
                  ${isActive ? 'bg-gray-200/60 text-black shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-black'}
                `}
              >
                <Users2 size={18} className="opacity-70" />
                Users
              </NavLink>
              <NavLink 
                to="/superadmin/permissions" 
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded text-[15px] font-semibold transition-all duration-200
                  ${isActive ? 'bg-gray-200/60 text-black shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-black'}
                `}
              >
                <ShieldAlert size={18} className="opacity-70" />
                User Permissions
              </NavLink>
            </nav>
          </div>

        </div>

        <div className="mt-auto p-4">
          <button 
            onClick={handleLogout}
            className="flex w-full items-center justify-center gap-3 rounded bg-black px-4 py-3 text-sm font-bold text-white shadow-lg transition-all duration-200 hover:bg-gray-800 active:scale-[0.98]"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] -z-10" />
        {children}
      </main>
    </div>
  );
}
