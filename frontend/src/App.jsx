import { BarChart3, HeartPulse, Home, School, ShieldAlert, UploadCloud, Users2, Menu } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import AdminPage from './Pages/AdminPage';
import DisasterPage from './Pages/DisasterPage';
import EducationPage from './Pages/EducationPage';
import HealthPage from './Pages/HealthPage';
import OverviewPage from './Pages/OverviewPage';
import WelfarePage from './Pages/WelfarePage';

const navigation = [
  { to: '/', label: 'Overview', icon: Home },
  { to: '/education', label: 'Education', icon: School },
  { to: '/health', label: 'Health', icon: HeartPulse },
  { to: '/welfare', label: 'Social Welfare', icon: Users2 },
  { to: '/population', label: 'Population', icon: Users2 },
  { to: '/disaster', label: 'Disaster Risk', icon: ShieldAlert },
];

function App() {
  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <div className="mx-auto flex min-h-screen w-full flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="flex flex-col bg-[#F9FAFB] px-6 py-8 border-b border-gray-200 lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r flex-shrink-0">
          
          <div className="mb-10 px-2">
            <h1 className="font-sans text-[24px] font-extrabold text-black tracking-tight leading-tight">
              District Intel
            </h1>
            <p className="mt-1 text-xs font-semibold text-gray-400">
              Current District
            </p>
          </div>

          <div className="mb-4 px-2">
            <h2 className="text-xs font-extrabold text-black uppercase tracking-wider">Departments</h2>
          </div>

          <nav className="flex-1 space-y-1">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-semibold transition ${
                    isActive 
                      ? 'bg-gray-200/60 text-black shadow-sm' 
                      : 'text-gray-700 hover:bg-gray-100 hover:text-black'
                  }`
                }
              >
                <Icon className="h-5 w-5 opacity-70" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto pt-8">
            <button className="w-full rounded-md bg-black px-4 py-3 text-sm font-bold text-white transition hover:bg-gray-800 shadow-lg active:scale-[0.98]">
              Sign In
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
