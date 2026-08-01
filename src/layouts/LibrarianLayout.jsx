import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  LayoutDashboard, QrCode, BookmarkCheck, Users, ShieldAlert, Sliders, User,
  LogOut, Menu, X, BookOpen, Clock, Bell, Sparkles, AlertTriangle
} from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Badge } from '../components/shared/Badge';
import { format } from 'date-fns';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/librarian/dashboard', icon: LayoutDashboard },
  { name: 'QR Pass Scanner', path: '/librarian/scan-entry', icon: QrCode },
  { name: 'Reservations & Seats', path: '/librarian/bookings', icon: BookmarkCheck },
  { name: 'Waiting List Queue', path: '/librarian/waitlist', icon: Users },
  { name: 'No-Show Monitor', path: '/librarian/students', icon: ShieldAlert },
  { name: 'Policy Settings', path: '/librarian/settings', icon: Sliders },
  { name: 'Staff Profile', path: '/librarian/profile', icon: User },
];

export default function LibrarianLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Desktop Sidebar (Teal accent) */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-white shrink-0 border-r border-slate-800">
        <div className="h-16 flex items-center gap-3 px-5 border-b border-slate-800 bg-slate-950">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center shadow-md">
            <BookOpen size={18} />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-white leading-none">SeatSync</h1>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-teal-400">Librarian Operations</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-teal-600 text-white font-bold shadow-md shadow-teal-600/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <item.icon size={18} />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800 bg-slate-950/60 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-teal-600/20 text-teal-300 border border-teal-500/30 font-bold flex items-center justify-center text-sm">
              {(user?.name || 'L').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{user?.name || 'Librarian'}</p>
              <p className="text-[10px] text-teal-400 font-mono truncate">{user?.staffId || 'Staff Pass'}</p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            className="w-full h-9 text-xs font-bold border-slate-700 text-slate-300 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 rounded-xl flex items-center justify-center gap-2"
          >
            <LogOut size={14} /> Logout Staff Session
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <Badge className="bg-teal-50 text-teal-700 border-teal-200 font-bold text-xs px-3 py-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-teal-600" /> Staff Operations Center
            </Badge>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-xl font-mono">
              <Clock size={13} className="text-slate-400" />
              <span>{format(currentTime, 'EEEE, d MMM yyyy • hh:mm:ss a')}</span>
            </div>
          </div>
        </header>

        {/* Mobile Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs p-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-bold text-white text-base">Librarian Menu</span>
                <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 p-1">
                  <X size={20} />
                </button>
              </div>
              <div className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold ${
                        isActive ? 'bg-teal-600 text-white font-bold' : 'text-slate-300 hover:bg-slate-800'
                      }`
                    }
                  >
                    <item.icon size={18} />
                    <span>{item.name}</span>
                  </NavLink>
                ))}
              </div>
            </div>

            <Button onClick={handleLogout} className="w-full bg-red-600 text-white font-bold h-11 rounded-xl">
              <LogOut size={16} className="mr-2" /> Logout
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
