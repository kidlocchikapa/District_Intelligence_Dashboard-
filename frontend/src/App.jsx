import { BarChart3, HeartPulse, Home, School, ShieldAlert, UploadCloud, Users2, Menu, ChevronLeft, ChevronRight, LogIn, LogOut, GraduationCap, Activity, UserCheck, LayoutDashboard, Database } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, Route, Routes, useNavigate, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'react-hot-toast';
import { setAuthToken, hydrateAuthToken, AUTH_EVENT_NAME } from './lib/api';
import Login from './Login';
import { useDistrict } from './context/DistrictContext';
import AdminPage from './Pages/AdminPage';
import SuperAdminPage from './Pages/SuperAdminPage';
import DisasterPage from './Pages/DisasterPage';
import EducationPage from './Pages/EducationPage';
import HealthPage from './Pages/HealthPage';
import OverviewPage from './Pages/OverviewPage';
import PopulationPage from './Pages/PopulationPage';
import WelfarePage from './Pages/WelfarePage';
import SuperAdminLayout from './layouts/SuperAdminLayout';
import PermissionsPage from './Pages/PermissionsPage';

const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/education', label: 'Education', icon: GraduationCap },
  { to: '/health', label: 'Health', icon: Activity },
  { to: '/welfare', label: 'Social Welfare', icon: UserCheck },
  { to: '/population', label: 'Population', icon: Users2 },
  { to: '/disaster', label: 'Disaster Risk', icon: ShieldAlert },
];

function decodeJwtRole(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.user?.role || payload.role;
  } catch {
    return null;
  }
}

function App() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(hydrateAuthToken()));
  const [userRole, setUserRole] = useState(() => decodeJwtRole(hydrateAuthToken()));
  const { selectedDistrict } = useDistrict();
  const navigate = useNavigate();
  const location = useLocation();

  const isSuperAdmin = isAuthenticated && userRole === 'super_admin';

  useEffect(() => {
    function syncAuthState(event) {
      const nextToken = event?.detail?.token || null;
      setIsAuthenticated(Boolean(nextToken));
      setUserRole(nextToken ? decodeJwtRole(nextToken) : null);
    }

    window.addEventListener(AUTH_EVENT_NAME, syncAuthState);
    return () => window.removeEventListener(AUTH_EVENT_NAME, syncAuthState);
  }, []);

  const navItems = [
    ...navigation,
    ...(isAuthenticated ? [{ 
      to: '/admin', 
      label: 'Data Management', 
      icon: Database 
    }] : [])
  ];

  function handleSessionAction() {
    if (isAuthenticated) {
      setAuthToken(null);
      setIsAuthenticated(false);
      navigate('/');
      return;
    }
    navigate('/login');
  }

  return (
    <div className="h-screen overflow-hidden bg-[#F9FAFB] font-sans">
      <Toaster position="top-right" />
      
      <Routes>
        {/* Super Admin Branch */}
        <Route path="/superadmin/*" element={
          isSuperAdmin ? (
            <SuperAdminLayout>
              <Routes>
                <Route index element={<SuperAdminPage />} />
                <Route path="permissions" element={<PermissionsPage />} />
              </Routes>
            </SuperAdminLayout>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <ShieldAlert size={48} className="mx-auto text-rose-500 mb-4" />
                <h2 className="text-xl font-bold">Access Denied</h2>
                <p className="text-slate-500 mt-2">You do not have permission to view this page.</p>
                <button onClick={() => navigate('/')} className="mt-4 text-emerald-600 font-bold">Go to Dashboard</button>
              </div>
            </div>
          )
        } />

        {/* Login Route */}
        <Route path="/login" element={
          <div className="flex items-center justify-center min-h-screen bg-white p-6">
            <Login onLogin={(token, role) => {
              setAuthToken(token);
              setIsAuthenticated(Boolean(token));
              const resolvedRole = role || decodeJwtRole(token);
              if (resolvedRole === 'super_admin') {
                navigate('/superadmin');
              } else {
                navigate('/admin');
              }
            }} />
          </div>
        } />

        {/* Standard App Layout */}
        <Route path="/*" element={
          <div className="mx-auto flex h-full w-full flex-col lg:flex-row">
            {/* Sidebar Container */}
            <div className={`relative flex flex-col bg-[#F9FAFB] border-b border-gray-200 lg:h-full transition-all duration-300 ease-in-out lg:border-b-0 lg:border-r flex-shrink-0 ${isCollapsed ? 'lg:w-20' : 'lg:w-64'}`}>
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="hidden lg:flex absolute -right-3 top-10 z-[60] bg-white border border-gray-200 rounded-full p-1 shadow-sm text-gray-500 hover:text-black hover:bg-gray-50 transition-all hover:scale-110 active:scale-95"
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>

              <aside className="flex flex-col h-full w-full overflow-y-auto px-4 py-8">
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
                {navItems.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    title={isCollapsed ? label : ''}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded transition-all duration-200 ${isCollapsed ? 'p-3 justify-center' : 'px-3 py-2.5 text-[15px]'
                      } font-semibold ${isActive
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
                  onClick={handleSessionAction}
                  title={isCollapsed ? (isAuthenticated ? "Sign Out" : "Sign In") : ""}
                  className={`rounded bg-black text-white transition-all duration-200 hover:bg-gray-800 shadow-lg active:scale-[0.98] ${isCollapsed ? 'p-3' : 'w-full px-4 py-3 text-sm font-bold'
                    }`}
                >
                  {isCollapsed ? (isAuthenticated ? <LogOut size={20} /> : <LogIn size={20} />) : (isAuthenticated ? "Sign Out" : "Sign In")}
                </button>
              </div>
              </aside>
            </div>

            {/* Main Content Area */}
            <main className="flex-1 bg-white overflow-y-auto">
              <Routes>
                <Route path="/" element={<OverviewPage />} />
                <Route path="/education" element={<EducationPage />} />
                <Route path="/health" element={<HealthPage />} />
                <Route path="/disaster" element={<DisasterPage />} />
                <Route path="/welfare" element={<WelfarePage />} />
                <Route path="/population" element={<PopulationPage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </div>
  );
}

export default App;
