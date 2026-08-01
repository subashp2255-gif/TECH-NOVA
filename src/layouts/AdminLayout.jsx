import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  LayoutDashboard, Users, UserCheck, Armchair, Layers, BookmarkCheck, ListOrdered,
  BarChart3, Settings, ShieldCheck, User, LogOut, Menu, X, BookOpen, Clock, Sparkles
} from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Badge } from '../components/shared/Badge';
import { format } from 'date-fns';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/admin/dashboard', icon: LayoutDashboard },
  { name: 'Student Management', path: '/admin/students', icon: Users },
  { name: 'Staff Management', path: '/admin/staff', icon: UserCheck },
  { name: 'Seat Management', path: '/admin/seats', icon: Armchair },
  { name: 'Floor & Slot Config', path: '/admin/slots', icon: Layers },
  { name: 'All Reservations', path: '/admin/bookings', icon: BookmarkCheck },
  { name: 'Waiting List Queue', path: '/admin/waitlist', icon: ListOrdered },
  { name: 'Analytics & Reports', path: '/admin/reports', icon: BarChart3 },
  { name: 'System Settings', path: '/admin/settings', icon: Settings },
  { name: 'Audit Logs', path: '/admin/audit-logs', icon: ShieldCheck },
  { name: 'Admin Profile', path: '/admin/profile', icon: User },
];

export default function AdminLayout() {
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
      {/* Desktop Sidebar (Indigo/Violet accent) */}
      <aside className="hidden md:flex flex-col w-64 bg-indigo-950 text-white shrink-0 border-r border-indigo-900/60">
        <div className="h-16 flex items-center gap-3 px-5 border-b border-indigo-900/80 bg-slate-950">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-md">
            <BookOpen size={18} />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-white leading-none">SeatSync</h1>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-indigo-400">System Administration</span>
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
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold shadow-md shadow-indigo-600/30'
                    : 'text-indigo-200/70 hover:bg-indigo-900/60 hover:text-white'
                }`
              }
            >
              <item.icon size={18} />
              <span>{item.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-indigo-900/80 bg-slate-950/70 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-indigo-600/30 text-indigo-200 border border-indigo-500/40 font-bold flex items-center justify-center text-sm">
              {(user?.name || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">{user?.name || 'Admin'}</p>
              <p className="text-[10px] text-indigo-300 font-mono truncate">{user?.adminId || 'System Admin'}</p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            className="w-full h-9 text-xs font-bold border-indigo-800/80 text-indigo-200 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40 rounded-xl flex items-center justify-center gap-2"
          >
            <LogOut size={14} /> Logout Admin Session
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
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 font-bold text-xs px-3 py-1 flex items-center gap-1.5">
              <Sparkles size={12} className="text-indigo-600" /> Admin Command Center
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
              <div className="flex items-center justify-between border-b border-indigo-900 pb-3">
                <span className="font-bold text-white text-base">Admin Menu</span>
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
                      `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold ${
                        isActive ? 'bg-indigo-600 text-white font-bold' : 'text-slate-300 hover:bg-indigo-900'
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
