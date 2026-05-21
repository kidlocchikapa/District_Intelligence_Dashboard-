import { ShieldAlert, Users2, Menu, X, ChevronLeft, ChevronRight, LogIn, LogOut, GraduationCap, Activity, UserCheck, LayoutDashboard, Database, KeyRound } from 'lucide-react';
import { useState, useEffect } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
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
import ChangePasswordModal from './components/ChangePasswordModal';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(hydrateAuthToken()));
  const [userRole, setUserRole] = useState(() => decodeJwtRole(hydrateAuthToken()));
  const { selectedDistrict } = useDistrict();
  const navigate = useNavigate();

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

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setIsMobileMenuOpen(false);
      }
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
      setIsMobileMenuOpen(false);
      setIsChangePasswordOpen(false);
      navigate('/');
      return;
    }
    setIsMobileMenuOpen(false);
    navigate('/login');
  }

  const isCompactSidebar = isCollapsed && !isMobileMenuOpen;

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
          <div className="mx-auto flex h-full min-h-0 w-full flex-col lg:flex-row">
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="inline-flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700"
              >
                <Menu size={18} />
                Menu
              </button>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Scope</p>
                <p className="text-xs font-bold text-black">{selectedDistrict || 'All Districts'}</p>
              </div>
            </div>

            {isMobileMenuOpen ? (
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 z-[65] bg-black/35 lg:hidden"
              />
            ) : null}

            {/* Sidebar Container */}
            <div className={`fixed inset-y-0 left-0 z-[70] flex w-72 max-w-[85vw] -translate-x-full flex-col border-r border-gray-200 bg-[#F9FAFB] shadow-xl transition-all duration-300 ease-in-out lg:static lg:h-full lg:max-w-none lg:translate-x-0 lg:shadow-none ${isCollapsed ? 'lg:w-20' : 'lg:w-64'} ${isMobileMenuOpen ? 'translate-x-0' : ''}`}>
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="hidden lg:flex absolute -right-3 top-10 z-[60] bg-white border border-gray-200 rounded-full p-1 shadow-sm text-gray-500 hover:text-black hover:bg-gray-50 transition-all hover:scale-110 active:scale-95"
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="absolute right-3 top-3 rounded border border-gray-200 bg-white p-2 text-gray-500 lg:hidden"
              >
                <X size={16} />
              </button>

              <aside className="flex flex-col h-full w-full overflow-y-auto px-4 py-6 lg:py-8">
                <div className={`mb-10 px-2 transition-all ${isCompactSidebar ? 'items-center flex flex-col' : ''}`}>
                {!isCompactSidebar ? (
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

              {!isCompactSidebar && (
                <div className="mb-4 px-2">
                  <h2 className="text-xs font-extrabold text-black uppercase tracking-wider">Departments</h2>
                </div>
              )}

              <nav className={`flex-1 space-y-1 ${isCompactSidebar ? 'flex flex-col items-center' : ''}`}>
                {navItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setIsMobileMenuOpen(false)}
                    title={isCompactSidebar ? item.label : ''}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded transition-all duration-200 ${isCompactSidebar ? 'p-3 justify-center' : 'px-3 py-2.5 text-[15px]'
                      } font-semibold ${isActive
                        ? 'bg-gray-200/60 text-black shadow-sm'
                        : 'text-gray-700 hover:bg-gray-100 hover:text-black'
                      }`
                    }
                  >
                    {item.icon ? (
                      <item.icon
                        className={`opacity-70 ${isCompactSidebar ? 'h-6 w-6' : 'h-5 w-5'}`}
                      />
                    ) : null}
                    {!isCompactSidebar && <span>{item.label}</span>}
                  </NavLink>
                ))}
              </nav>

              <div className={`mt-auto pt-8 ${isCompactSidebar ? 'flex justify-center' : ''}`}>
                <div className={`w-full space-y-2 ${isCompactSidebar ? 'flex flex-col items-center' : ''}`}>
                  {isAuthenticated ? (
                    <button
                      onClick={() => setIsChangePasswordOpen(true)}
                      title={isCompactSidebar ? "Change Password" : ""}
                      className={`rounded border border-gray-300 bg-white text-gray-800 transition-all duration-200 hover:bg-gray-100 active:scale-[0.98] ${isCompactSidebar ? 'p-3' : 'w-full px-4 py-3 text-sm font-bold'
                        }`}
                    >
                      {isCompactSidebar ? <KeyRound size={20} /> : "Change Password"}
                    </button>
                  ) : null}

                  <button
                    onClick={handleSessionAction}
                    title={isCompactSidebar ? (isAuthenticated ? "Sign Out" : "Sign In") : ""}
                    className={`rounded bg-black text-white transition-all duration-200 hover:bg-gray-800 shadow-lg active:scale-[0.98] ${isCompactSidebar ? 'p-3' : 'w-full px-4 py-3 text-sm font-bold'
                      }`}
                  >
                    {isCompactSidebar ? (isAuthenticated ? <LogOut size={20} /> : <LogIn size={20} />) : (isAuthenticated ? "Sign Out" : "Sign In")}
                  </button>
                </div>
              </div>
              </aside>
            </div>

            {/* Main Content Area */}
            <main className="flex-1 min-h-0 bg-white overflow-y-auto">
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

            <ChangePasswordModal
              isOpen={isAuthenticated && isChangePasswordOpen}
              onClose={() => setIsChangePasswordOpen(false)}
            />
          </div>
        } />
      </Routes>
    </div>
  );
}

export default App;
