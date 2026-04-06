import { BarChart3, HeartPulse, Home, School, ShieldAlert, UploadCloud, Users2 } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import AdminPage from './pages/AdminPage';
import DisasterPage from './pages/DisasterPage';
import EducationPage from './pages/EducationPage';
import HealthPage from './pages/HealthPage';
import OverviewPage from './pages/OverviewPage';
import WelfarePage from './pages/WelfarePage';

const navigation = [
  { to: '/', label: 'Overview', icon: Home },
  { to: '/education', label: 'Education', icon: School },
  { to: '/health', label: 'Health', icon: HeartPulse },
  { to: '/disaster', label: 'Disaster', icon: ShieldAlert },
  { to: '/welfare', label: 'Welfare', icon: Users2 },
  { to: '/admin', label: 'Admin', icon: UploadCloud },
];

function App() {
  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col lg:flex-row">
        <aside className="border-b border-white/60 bg-pine px-5 py-7 text-sand lg:min-h-screen lg:w-64 lg:border-b-0 lg:border-r">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.28em] text-fog">
              Malawi District Intelligence
            </div>
            <h1 className="font-serif text-2xl font-semibold leading-tight">
              Spatial evidence for schools, health, disaster risk, and social welfare.
            </h1>
            <p className="text-sm leading-6 text-fog/90">
              Explore choropleths, facility access, served population, and ETL operations from one control room.
            </p>
          </div>

          <nav className="mt-8 grid gap-2">
            {navigation.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${
                    isActive ? 'bg-white text-pine shadow-panel' : 'text-fog hover:bg-white/10'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="mt-8 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-fog">
            <div className="mb-2 flex items-center gap-2 font-semibold text-sand">
              <BarChart3 className="h-4 w-4" />
              Live analytics
            </div>
            <p className="leading-6">
              Designed for district-level choropleths, facility access analysis, upload workflows, and KPI tracking.
            </p>
          </div>
        </aside>

        <main className="flex-1 px-4 py-4 sm:px-6 lg:px-8 lg:py-8">
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
