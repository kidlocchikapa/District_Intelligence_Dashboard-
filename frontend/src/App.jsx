import { BarChart3, HeartPulse, Home, School, ShieldAlert, UploadCloud, Users2, Menu, ChevronLeft, ChevronRight, LogIn, GraduationCap, Activity, UserCheck, LayoutDashboard } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useDistrict } from './context/DistrictContext';
import AdminPage from './Pages/AdminPage';
import DisasterPage from './Pages/DisasterPage';
import EducationPage from './Pages/EducationPage';
import HealthPage from './Pages/HealthPage';
import OverviewPage from './Pages/OverviewPage';
import WelfarePage from './Pages/WelfarePage';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/education', label: 'Education', icon: GraduationCap },
  { to: '/health', label: 'Health', icon: Activity },
  { to: '/welfare', label: 'Social Welfare', icon: UserCheck },
  { to: '/population', label: 'Population', icon: Users2 },
  { to: '/disaster', label: 'Disaster Risk', icon: ShieldAlert },
];

function App() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { selectedDistrict } = useDistrict();

  return (
    <div className="min-h-screen bg-[#F9FAFB] font-sans">
      <div className="mx-auto flex min-h-screen w-full flex-col lg:flex-row">
        {/* Sidebar */}
        <aside 
          className={`flex flex-col bg-[#F9FAFB] px-4 py-8 border-b border-gray-200 lg:min-h-screen transition-all duration-300 ease-in-out lg:border-b-0 lg:border-r flex-shrink-0 relative ${
            isCollapsed ? 'lg:w-20' : 'lg:w-64'
          }`}
        >
          {/* Collapse Toggle Button (Desktop) */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex absolute -right-3 top-10 z-50 bg-white border border-gray-200 rounded-full p-1 shadow-sm text-gray-500 hover:text-black hover:bg-gray-50 transition-all hover:scale-110 active:scale-95"
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
          
          <div className={`mb-10 px-2 transition-all ${isCollapsed ? 'items-center flex flex-col' : ''}`}>
            {!isCollapsed ? (
              <>
                <h1 className="text-[24px] font-extrabold text-black tracking-tight leading-tight">
                  District Intel
                </h1>
                <div className="mt-2">
                  <div className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-black border border-gray-200 w-fit">
                    {selectedDistrict || 'All Districts'}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-black text-white w-10 h-10 rounded flex items-center justify-center font-extrabold text-lg shadow-lg">
                DI
              </div>
            )}
          </div>

          {!isCollapsed && (
            <div className="mb-4 px-2">
              <h2 className="text-xs font-extrabold text-black uppercase tracking-wider">Departments</h2>
            </div>
          )}

          <nav className={`flex-1 space-y-1 ${isCollapsed ? 'flex flex-col items-center' : ''}`}>
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={isCollapsed ? label : ''}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded transition-all duration-200 ${
                    isCollapsed ? 'p-3 justify-center' : 'px-3 py-2.5 text-[15px]'
                  } font-semibold ${
                    isActive 
                      ? 'bg-gray-200/60 text-black shadow-sm' 
                      : 'text-gray-700 hover:bg-gray-100 hover:text-black'
                  }`
                }
              >
                <Icon className={`opacity-70 ${isCollapsed ? 'h-6 w-6' : 'h-5 w-5'}`} />
                {!isCollapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </nav>

          <div className={`mt-auto pt-8 ${isCollapsed ? 'flex justify-center' : ''}`}>
            <button 
              title={isCollapsed ? "Sign In" : ""}
              className={`rounded bg-black text-white transition-all duration-200 hover:bg-gray-800 shadow-lg active:scale-[0.98] ${
                isCollapsed ? 'p-3' : 'w-full px-4 py-3 text-sm font-bold'
              }`}
            >
              {isCollapsed ? <LogIn size={20} /> : "Sign In"}
            </button>
          </div>

        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-white overflow-y-auto">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/education" element={<EducationPage />} />
            <Route path="/health" element={<HealthPage />} />
            <Route path="/disaster" element={<DisasterPage />} />
            <Route path="/welfare" element={<WelfarePage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
