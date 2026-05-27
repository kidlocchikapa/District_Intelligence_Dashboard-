import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Users2, ShieldAlert, LogOut, Database, KeyRound } from 'lucide-react';
import { setAuthToken } from '../lib/api';
import ChangePasswordModal from '../components/ChangePasswordModal';

export default function SuperAdminLayout({ children }) {
  const navigate = useNavigate();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  function handleLogout() {
    setIsChangePasswordOpen(false);
    setAuthToken(null);
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50 font-sans lg:h-screen lg:flex-row lg:overflow-hidden">
      {/* Dedicated Super Admin Sidebar */}
      <aside className="z-50 flex w-full flex-col border-b border-gray-200 bg-[#F9FAFB] text-black lg:min-h-0 lg:w-72 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
        <div className="p-4 pb-3 sm:p-6 sm:pb-4 lg:p-8 lg:pb-4">
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

        <div className="flex-none space-y-4 overflow-x-auto px-4 py-3 sm:space-y-6 lg:flex-1 lg:overflow-y-auto lg:py-6">
          <div>
            <h2 className="mb-3 px-1 text-xs font-extrabold uppercase tracking-wider text-black sm:px-4 lg:mb-4">Core Management</h2>
            <nav className="flex gap-2 lg:block lg:space-y-1.5">
              <NavLink 
                to="/superadmin" 
                end
                className={({ isActive }) => `
                  flex shrink-0 items-center gap-3 rounded px-3 py-2.5 text-[14px] font-semibold transition-all duration-200 sm:text-[15px]
                  ${isActive ? 'bg-gray-200/60 text-black shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-black'}
                `}
              >
                <Users2 size={18} className="opacity-70" />
                Users
              </NavLink>
              <NavLink 
                to="/superadmin/permissions" 
                className={({ isActive }) => `
                  flex shrink-0 items-center gap-3 rounded px-3 py-2.5 text-[14px] font-semibold transition-all duration-200 sm:text-[15px]
                  ${isActive ? 'bg-gray-200/60 text-black shadow-sm' : 'text-gray-700 hover:bg-gray-100 hover:text-black'}
                `}
              >
                <ShieldAlert size={18} className="opacity-70" />
                User Permissions
              </NavLink>
            </nav>
          </div>

        </div>

        <div className="mt-auto grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-1">
          <button
            onClick={() => setIsChangePasswordOpen(true)}
            className="flex w-full items-center justify-center gap-3 rounded border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-800 transition-all duration-200 hover:bg-gray-100 active:scale-[0.98]"
          >
            <KeyRound size={18} />
            Change Password
          </button>

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
      <main className="relative min-h-0 w-full flex-1 overflow-y-auto">
        <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] -z-10" />
        {children}
      </main>

      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </div>
  );
}
