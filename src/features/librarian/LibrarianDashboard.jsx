import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { QrCode, RefreshCw, Layers, Users, Armchair, AlertTriangle, TrendingUp, Sparkles, CheckCircle2, LogOut, Search, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LibrarianDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [seats, setSeats] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStaffData = async () => {
    try {
      setLoading(true);
      const [seatsData, bookingsData, waitlistData] = await Promise.all([
        db.read('seatsync_seats').catch(() => []),
        db.read('seatsync_bookings').catch(() => []),
        db.read('seatsync_waitlist').catch(() => []),
      ]);
      setSeats(seatsData || []);
      setBookings(bookingsData || []);
      setWaitlist(waitlistData || []);
    } catch (err) {
      console.error('Failed to load librarian dashboard data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaffData();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change' || event?.type?.startsWith('WAITLIST_')) {
      fetchStaffData();
    }
  });

  const activeCount = bookings.filter(b => b.status === 'confirmed' || b.status === 'active' || b.status === 'checked_in').length;
  const pendingCheckoutCount = bookings.filter(b => b.status === 'checkout_pending').length;
  const waitingQueueCount = waitlist.filter(w => w.status === 'waiting' || w.status === 'WAITING').length;
  const totalOccupiedSeats = Math.min(seats.length || 40, activeCount + pendingCheckoutCount);

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-12">
      {/* Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 p-6 sm:p-8 text-white shadow-2xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-semibold backdrop-blur-md">
              <Sparkles size={14} className="text-teal-400" />
              <span>SeatSync Staff Command Desk</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Welcome back, {user?.name || 'Librarian'} 👋
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl leading-relaxed">
              Real-time monitoring console tracking {seats.length || 40} study seats across Ground Floor and reference zones.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="outline"
              onClick={fetchStaffData}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-bold rounded-xl h-10"
            >
              <RefreshCw size={14} className="mr-1.5" /> Refresh State
            </Button>
            <Button
              onClick={() => navigate('/librarian/scan-entry')}
              className="bg-gradient-to-r from-teal-400 to-emerald-500 hover:from-teal-500 hover:to-emerald-600 text-slate-950 font-bold shadow-lg text-xs rounded-xl h-10 px-4"
            >
              <QrCode size={16} className="mr-1.5" /> Launch QR Scanner
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0 border border-teal-100">
              <Armchair size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Active Occupancy</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{totalOccupiedSeats} / {seats.length || 40}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0 border border-amber-100">
              <LogOut size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Pending Checkout</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{pendingCheckoutCount}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center shrink-0 border border-blue-100">
              <Users size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Waitlist Queue</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{waitingQueueCount}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white">
          <CardContent className="p-4 sm:p-5 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Total Reservations</p>
              <h3 className="text-xl font-black text-navy mt-0.5">{bookings.length}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Reservations Table */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
            <Armchair size={18} className="text-teal-600" /> Current Library Reservations & Pass Status
          </CardTitle>
          <Button
            variant="outline"
            onClick={() => navigate('/librarian/bookings')}
            className="text-xs font-bold rounded-xl h-8"
          >
            Manage All →
          </Button>
        </CardHeader>

        <CardContent className="p-0">
          {bookings.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No active student bookings found in LocalStorage.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Booking ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Seat</th>
                    <th className="p-3.5">Slot Time</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bookings.slice(0, 10).map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-navy">{b.id}</td>
                      <td className="p-3.5">
                        <span className="font-bold text-navy block">{b.studentName}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{b.studentCollegeId || b.collegeId || '—'}</span>
                      </td>
                      <td className="p-3.5 font-bold text-brandBlue">{b.seatNumber}</td>
                      <td className="p-3.5 font-mono">{b.slotTime}</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          b.status === 'checkout_pending' ? 'bg-amber-500 text-white' :
                          b.status === 'completed' ? 'bg-slate-500 text-white' :
                          b.status === 'cancelled' ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'
                        }`}>
                          {b.status === 'checkout_pending' ? 'Checkout Pending' : (b.status || 'Active')}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          variant="outline"
                          onClick={() => navigate('/librarian/scan-entry')}
                          className="h-7 text-[11px] font-bold rounded-lg"
                        >
                          Verify Pass
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
