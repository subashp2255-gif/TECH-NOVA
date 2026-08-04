import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { bookingService } from '../../services/bookingService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { 
  QrCode, Clock, MapPin, Calendar, AlertTriangle, CheckCircle2, XCircle, LogOut, 
  ArrowRight, ShieldCheck, RefreshCw, Copy, Info, Search, Plus, Filter, ArrowUpDown, 
  Check, Download, Zap, Sparkles, Building2, Users, Layers, AlertCircle, ChevronRight, Eye, ShieldAlert
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { format, parse, isAfter, isBefore, addDays } from 'date-fns';
import { QRCodeCanvas } from 'qrcode.react';

function getBookingState(booking) {
  if (!booking) return null;
  const rawStatus = (booking.status || '').toUpperCase();
  if (rawStatus === 'CANCELLED_BY_ADMIN') return 'CANCELLED_BY_ADMIN';
  if (rawStatus === 'CANCELLED_BY_STUDENT' || rawStatus === 'CANCELLED') return 'CANCELLED_BY_STUDENT';
  if (rawStatus === 'COMPLETED' || rawStatus === 'CHECKED_OUT') return 'COMPLETED';
  if (rawStatus === 'CHECKOUT_PENDING') return 'CHECKOUT_PENDING';

  const now = new Date();
  const datePart = booking.bookingDate || format(now, 'yyyy-MM-dd');
  let startDateTime = null;
  let endDateTime = null;

  if (booking.slotTime && booking.slotTime.includes('–')) {
    const [rawStart, rawEnd] = booking.slotTime.split('–').map(s => s.trim());
    try {
      startDateTime = parse(`${datePart} ${rawStart}`, 'yyyy-MM-dd hh:mm a', new Date());
      endDateTime = parse(`${datePart} ${rawEnd}`, 'yyyy-MM-dd hh:mm a', new Date());
    } catch {
      startDateTime = null;
    }
  }

  if (!startDateTime) {
    return rawStatus === 'ACTIVE' ? 'ACTIVE' : 'UPCOMING';
  }

  if (isAfter(now, endDateTime)) return 'COMPLETED';
  if (isAfter(now, startDateTime) && isBefore(now, endDateTime)) return 'ACTIVE';
  return 'UPCOMING';
}

function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  try {
    const dateObj = parse(dateStr, 'yyyy-MM-dd', new Date());
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');

    if (dateStr === todayStr) {
      return `Today · ${format(dateObj, 'EEEE, d MMMM yyyy')}`;
    }
    if (dateStr === tomorrowStr) {
      return `Tomorrow · ${format(dateObj, 'EEEE, d MMMM yyyy')}`;
    }
    return format(dateObj, 'EEEE, d MMMM yyyy');
  } catch {
    return dateStr;
  }
}

export default function MyReservations() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [waitlistEntries, setWaitlistEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [qrModalTarget, setQrModalTarget] = useState(null);
  const [detailTarget, setDetailTarget] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  // Filter & Sort state
  const [selectedFilter, setSelectedFilter] = useState('ALL'); // ALL, ACTIVE, UPCOMING, WAITLISTED, COMPLETED, CANCELLED
  const [sortBy, setSortBy] = useState('nearest'); // nearest, newest, oldest

  const fetchBookingsAndWaitlist = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [userBookings, localWaitlist] = await Promise.all([
        bookingService.getMyBookings(user.id),
        db.read('seatsync_waitlist').catch(() => [])
      ]);

      setBookings(userBookings || []);
      const userWaiting = (localWaitlist || []).filter(
        w => String(w.studentId) === String(user.id) && (w.status || '').toLowerCase() === 'waiting'
      );
      setWaitlistEntries(userWaiting);
    } catch (error) {
      toast.error('Failed to load reservations data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookingsAndWaitlist();
  }, [user]);

  useSync((event) => {
    if (event?.type === 'storage_change' || event?.type?.startsWith('WAITLIST_')) {
      fetchBookingsAndWaitlist();
    }
  });

  // Calculate conflict booking IDs (same date + overlapping slot time)
  const conflictBookingIds = useMemo(() => {
    const ids = new Set();
    const activeAndUpcoming = bookings.filter(b => {
      const st = getBookingState(b);
      return st === 'ACTIVE' || st === 'UPCOMING';
    });

    for (let i = 0; i < activeAndUpcoming.length; i++) {
      for (let j = i + 1; j < activeAndUpcoming.length; j++) {
        const b1 = activeAndUpcoming[i];
        const b2 = activeAndUpcoming[j];

        if (b1.bookingDate === b2.bookingDate) {
          if (b1.slotTime === b2.slotTime || (b1.slotId && b1.slotId === b2.slotId)) {
            ids.add(b1.id);
            ids.add(b2.id);
          }
        }
      }
    }
    return ids;
  }, [bookings]);

  // Identify nearest upcoming/active booking
  const nearestBookingId = useMemo(() => {
    const activeOrUpcoming = bookings.filter(b => {
      const st = getBookingState(b);
      return st === 'ACTIVE' || st === 'UPCOMING';
    });

    if (activeOrUpcoming.length === 0) return null;

    const active = activeOrUpcoming.find(b => getBookingState(b) === 'ACTIVE');
    if (active) return active.id;

    const sorted = [...activeOrUpcoming].sort((a, b) => {
      const tA = (a.bookingDate || '') + (a.slotTime || '');
      const tB = (b.bookingDate || '') + (b.slotTime || '');
      return tA.localeCompare(tB);
    });

    return sorted[0]?.id || null;
  }, [bookings]);

  // Counts for statistics & filters
  const counts = useMemo(() => {
    const active = bookings.filter(b => ['ACTIVE', 'CHECKOUT_PENDING'].includes(getBookingState(b))).length;
    const upcoming = bookings.filter(b => getBookingState(b) === 'UPCOMING').length;
    const completed = bookings.filter(b => getBookingState(b) === 'COMPLETED').length;
    const cancelled = bookings.filter(b => ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN'].includes(getBookingState(b))).length;
    const waitlisted = waitlistEntries.length;
    const all = bookings.length;

    return { all, active, upcoming, completed, cancelled, waitlisted };
  }, [bookings, waitlistEntries]);

  // Filtered and sorted bookings
  const filteredAndSortedBookings = useMemo(() => {
    let list = [...bookings];

    if (selectedFilter === 'ACTIVE') {
      list = list.filter(b => ['ACTIVE', 'CHECKOUT_PENDING'].includes(getBookingState(b)));
    } else if (selectedFilter === 'UPCOMING') {
      list = list.filter(b => getBookingState(b) === 'UPCOMING');
    } else if (selectedFilter === 'COMPLETED') {
      list = list.filter(b => getBookingState(b) === 'COMPLETED');
    } else if (selectedFilter === 'CANCELLED') {
      list = list.filter(b => ['CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN'].includes(getBookingState(b)));
    }

    if (sortBy === 'nearest') {
      list.sort((a, b) => {
        if (a.id === nearestBookingId) return -1;
        if (b.id === nearestBookingId) return 1;
        const tA = (a.bookingDate || '') + (a.slotTime || '');
        const tB = (b.bookingDate || '') + (b.slotTime || '');
        return tA.localeCompare(tB);
      });
    } else if (sortBy === 'newest') {
      list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else if (sortBy === 'oldest') {
      list.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    }

    return list;
  }, [bookings, selectedFilter, sortBy, nearestBookingId]);

  const handleCopyId = (id, e) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(id);
    toast.success(`Booking reference ${id} copied!`);
  };

  const handleDownloadQr = (booking) => {
    const canvas = document.getElementById(`qr-canvas-${booking.id}`);
    if (!canvas) {
      toast.error('Unable to generate pass image.');
      return;
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `SeatSync-Pass-${booking.seatNumber || 'Seat'}-${booking.bookingDate}.png`;
    a.click();
    toast.success('QR Pass image saved to device!');
  };

  const handleCancelBooking = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await bookingService.cancelBooking(cancelTarget.id, user.id);
      toast.success('Reservation cancelled successfully');
      setCancelTarget(null);
      fetchBookingsAndWaitlist();
    } catch (err) {
      toast.error(err.message || 'Failed to cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  const handleRequestCheckout = async (booking) => {
    if (!booking || !user) return;
    try {
      const payload = {
        token: `CKOUT-${booking.id}-${Math.floor(1000 + Math.random() * 9000)}`,
        bookingId: booking.id,
        studentId: user.id,
        studentName: user.name,
        collegeId: user.collegeId,
        seatNumber: booking.seatNumber,
        floorName: booking.floorName || 'Ground Floor',
        slotTime: booking.slotTime,
        issuedAt: new Date().toISOString()
      };

      localStorage.setItem('seatsync_checkout_token', JSON.stringify(payload));

      const allBookings = await db.read('seatsync_bookings');
      const target = allBookings.find(b => b.id === booking.id && b.studentId === user.id);
      if (target) {
        target.status = 'checkout_pending';
        target.checkoutRequestedAt = payload.issuedAt;
        await db.write('seatsync_bookings', allBookings);
      }

      const logs = await db.read('seatsync_activity_logs').catch(() => []);
      logs.push({
        userId: user.id,
        action: 'request_checkout',
        entityId: booking.id,
        timestamp: payload.issuedAt,
      });
      await db.write('seatsync_activity_logs', logs);

      toast.success('Checkout requested — show QR pass to librarian.');
      fetchBookingsAndWaitlist();
    } catch (err) {
      toast.error('Failed to generate Checkout request.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-16">
      
      {/* 1. PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">My Reservations</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Manage your upcoming, active, and previous library reservations.
          </p>
        </div>

        <Button
          onClick={() => navigate('/student/find-seat')}
          className="bg-brandBlue hover:bg-blue-600 text-white font-bold h-10 px-5 rounded-xl text-xs shadow-md shadow-brandBlue/25 border border-blue-400/30 flex items-center gap-2 shrink-0"
        >
          <Search size={15} /> Book Another Seat <ArrowRight size={14} />
        </Button>
      </div>

      {/* 2. STATS SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Card className="border border-slate-200/90 shadow-xs hover:border-emerald-500/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
              <Zap size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Active Sessions</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.active}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-brandBlue/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-50 text-brandBlue flex items-center justify-center shrink-0 border border-blue-100">
              <Calendar size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Upcoming Passes</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.upcoming}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-amber-500/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 border border-amber-100">
              <Users size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Waitlist Entries</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.waitlisted}</h3>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200/90 shadow-xs hover:border-slate-400/40 transition-all rounded-2xl bg-white">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200">
              <CheckCircle2 size={20} />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Completed</p>
              <h3 className="text-lg font-black text-navy mt-0.5">{counts.completed}</h3>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. FILTER BAR & SORT CONTROL */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-2 sm:p-2.5 rounded-2xl border border-slate-200/90 shadow-xs">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: 'All', count: counts.all },
            { id: 'ACTIVE', label: 'Active', count: counts.active },
            { id: 'UPCOMING', label: 'Upcoming', count: counts.upcoming },
            { id: 'WAITLISTED', label: 'Waitlisted', count: counts.waitlisted },
            { id: 'COMPLETED', label: 'Completed', count: counts.completed },
            { id: 'CANCELLED', label: 'Cancelled', count: counts.cancelled },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                selectedFilter === tab.id
                  ? 'bg-navy text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-navy'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                selectedFilter === tab.id ? 'bg-white/20 text-white' : 'bg-slate-200/80 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Sort Control */}
        <div className="flex items-center gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100 shrink-0 self-end sm:self-center">
          <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
            <ArrowUpDown size={12} /> Sort:
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-8 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl px-2.5 text-navy focus:outline-none focus:ring-2 focus:ring-brandBlue/30"
          >
            <option value="nearest">Nearest First</option>
            <option value="newest">Newest Created</option>
            <option value="oldest">Oldest Created</option>
          </select>
        </div>
      </div>

      {/* 4. WAITLIST TAB DISPLAY (If Waitlisted selected) */}
      {selectedFilter === 'WAITLISTED' && (
        <div className="space-y-4">
          {waitlistEntries.length === 0 ? (
            <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-8 text-center space-y-3">
              <Users size={32} className="text-slate-400 mx-auto" />
              <h3 className="text-base font-bold text-navy">No Active Waitlist Queue</h3>
              <p className="text-xs text-slate-500 font-medium max-w-sm mx-auto">
                You are not currently in any waiting list queues for fully booked slots.
              </p>
            </Card>
          ) : (
            waitlistEntries.map(entry => (
              <Card key={entry.id} className="border-2 border-amber-300/80 bg-amber-50/30 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-amber-500 text-white font-bold text-xs flex items-center gap-1">
                    <Users size={13} /> Waiting List Queue
                  </Badge>
                  <span className="text-xs font-mono font-bold text-slate-500">{entry.dateStr || entry.date}</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-3 bg-white border border-amber-200 rounded-xl p-3.5 text-xs">
                  <div>
                    <span className="text-slate-400 font-semibold block text-[10px] uppercase">Slot</span>
                    <span className="font-bold text-navy">{entry.slotName || entry.slotId}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block text-[10px] uppercase">Queue Position</span>
                    <span className="font-black text-amber-700 text-sm font-mono">Pos #{entry.position || 1}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-semibold block text-[10px] uppercase">Auto-Allocation</span>
                    <span className="font-semibold text-emerald-700">Active (Automatic)</span>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* 5. RESERVATIONS LIST */}
      {selectedFilter !== 'WAITLISTED' && (
        loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-44 bg-white rounded-2xl border border-slate-200/90 animate-pulse p-6 space-y-4">
                <div className="h-5 bg-slate-100 rounded-lg w-1/3"></div>
                <div className="h-16 bg-slate-50 rounded-xl w-full"></div>
              </div>
            ))}
          </div>
        ) : filteredAndSortedBookings.length === 0 ? (
          <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-10 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-brandBlue flex items-center justify-center mx-auto border border-blue-100">
              <Calendar size={28} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-navy">No Reservations Found</h3>
              <p className="text-xs text-slate-500 font-medium max-w-md mx-auto">
                {selectedFilter === 'ALL'
                  ? "You haven't reserved any library seats yet. Click below to book a seat."
                  : `No reservations found under the "${selectedFilter}" filter.`}
              </p>
            </div>
            <Button
              onClick={() => navigate('/student/find-seat')}
              className="bg-brandBlue hover:bg-blue-600 text-white font-bold h-10 px-6 rounded-xl text-xs shadow-sm"
            >
              Book a Seat Now <ArrowRight size={14} className="ml-1.5" />
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredAndSortedBookings.map(booking => {
              const computedState = getBookingState(booking);
              const isNearest = booking.id === nearestBookingId;
              const hasConflict = conflictBookingIds.has(booking.id);
              const isCancelledByAdmin = computedState === 'CANCELLED_BY_ADMIN';
              const isCancelledByStudent = computedState === 'CANCELLED_BY_STUDENT';
              const isCompleted = computedState === 'COMPLETED';
              const isActive = computedState === 'ACTIVE';
              const isCheckoutPending = computedState === 'CHECKOUT_PENDING';
              const isUpcoming = computedState === 'UPCOMING';

              return (
                <Card
                  key={booking.id}
                  className={`border-2 transition-all rounded-2xl overflow-hidden shadow-xs relative ${
                    isCancelledByAdmin
                      ? 'border-red-200 bg-red-50/10'
                      : hasConflict
                      ? 'border-red-400 bg-red-50/20'
                      : isNearest
                      ? 'border-brandBlue/50 bg-gradient-to-r from-blue-50/60 via-white to-slate-50 shadow-md border-l-4 border-l-brandBlue'
                      : 'border-slate-200/90 hover:border-brandBlue/40 bg-white'
                  }`}
                >
                  <CardContent className="p-5 space-y-4">
                    
                    {/* CARD HEADER */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isNearest && (
                          <Badge className="bg-brandBlue text-white font-extrabold text-[10px] px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                            <Sparkles size={11} className="text-amber-300" /> YOUR NEXT RESERVATION
                          </Badge>
                        )}

                        <Badge className={`font-bold text-xs flex items-center gap-1 px-2.5 py-0.5 ${
                          isCancelledByAdmin ? 'bg-red-600 text-white' :
                          isCancelledByStudent ? 'bg-red-500 text-white' :
                          isActive ? 'bg-emerald-600 text-white' :
                          isCheckoutPending ? 'bg-amber-500 text-white' :
                          isCompleted ? 'bg-slate-600 text-white' : 'bg-brandBlue text-white'
                        }`}>
                          {isCancelledByAdmin ? <AlertTriangle size={12} /> :
                           isCancelledByStudent ? <XCircle size={12} /> :
                           isActive ? <Zap size={12} /> :
                           isCheckoutPending ? <Clock size={12} /> :
                           isCompleted ? <CheckCircle2 size={12} /> : <Calendar size={12} />}
                          
                          {isCancelledByAdmin ? 'Cancelled by Library' :
                           isCancelledByStudent ? 'Cancelled by You' :
                           isActive ? 'Active Session' :
                           isCheckoutPending ? 'Pending Checkout' :
                           isCompleted ? 'Completed' : 'Upcoming Pass'}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-mono font-bold text-slate-600">
                        <span className="flex items-center gap-1 text-slate-700">
                          <Calendar size={14} className="text-brandBlue" /> {formatHumanDate(booking.bookingDate)}
                        </span>
                        
                        <div className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded-lg text-[11px]">
                          <span className="text-slate-500">Ref:</span>
                          <span className="text-navy">{booking.bookingCode || booking.id}</span>
                          <button
                            onClick={(e) => handleCopyId(booking.id, e)}
                            className="text-slate-400 hover:text-brandBlue transition-colors ml-1 p-0.5"
                            title="Copy Booking Reference"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* CONFLICT WARNING BANNER */}
                    {hasConflict && (
                      <div className="p-3 bg-red-100/90 border border-red-300 rounded-xl text-xs flex items-center gap-2.5 text-red-950 font-bold animate-in fade-in">
                        <ShieldAlert size={18} className="text-red-600 shrink-0" />
                        <span>⚠️ Booking Conflict: You hold another reservation during this exact time slot. Please cancel one pass.</span>
                      </div>
                    )}

                    {/* MAIN INFORMATION GRID */}
                    <div className="grid sm:grid-cols-4 gap-3 bg-slate-50/80 border border-slate-200/80 rounded-xl p-3.5 text-xs">
                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Seat Number</span>
                        <span className="font-black text-navy text-base flex items-center gap-1.5">
                          <MapPin size={16} className="text-brandBlue" /> {booking.seatNumber || 'S-01'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Library & Floor</span>
                        <span className="font-bold text-navy block truncate">{booking.libraryName || 'Central Library'}</span>
                        <span className="text-slate-500 text-[11px] font-medium">{booking.floorName || 'Ground Floor'}</span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Time Slot</span>
                        <span className="font-bold text-navy font-mono flex items-center gap-1">
                          <Clock size={13} className="text-brandBlue" /> {booking.slotTime || '08:00 AM – 09:00 AM'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 font-semibold block text-[10px] uppercase tracking-wider">Session Duration</span>
                        <span className="font-bold text-navy">1-Hour Session</span>
                        <span className="text-slate-500 text-[11px] block">Zone A (Quiet Study)</span>
                      </div>
                    </div>

                    {/* HELPFUL DETAILS & STATUS STRIP */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-blue-50/40 border border-blue-100 rounded-xl p-2.5">
                      <div className="flex items-center gap-2 text-slate-600 font-semibold">
                        <Info size={14} className="text-brandBlue shrink-0" />
                        {isActive ? (
                          <span className="text-emerald-700 font-bold">Check-in active • Tap "Request Checkout QR" when ready to leave.</span>
                        ) : isUpcoming ? (
                          <span>Check-in opens 15 mins before slot. Free cancellation allowed before start time.</span>
                        ) : (
                          <span>Library entry pass archived.</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 font-mono font-bold text-slate-500">
                        <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px]">⚡ Power Socket</span>
                        <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px]">🔇 Quiet Desk</span>
                      </div>
                    </div>

                    {/* CANCELLED BY LIBRARY NOTICE */}
                    {isCancelledByAdmin && (
                      <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs space-y-1.5 animate-in fade-in">
                        <div className="flex items-center gap-2 font-bold text-red-900">
                          <AlertTriangle size={16} className="text-red-600 shrink-0" />
                          <span>Reservation Cancelled by Library Administration</span>
                        </div>
                        {booking.cancellationReason && (
                          <p className="text-slate-700 text-xs font-medium">
                            Reason: <strong>{booking.cancellationReason}</strong>
                          </p>
                        )}
                        <div className="pt-1 border-t border-red-200/60 flex items-center gap-1.5 text-[11px] text-emerald-800 font-semibold">
                          <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
                          <span>This library cancellation will NOT affect your student no-show count or booking eligibility.</span>
                        </div>
                      </div>
                    )}

                    {/* CARD ACTION BUTTONS */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      {isCancelledByAdmin ? (
                        <Button
                          type="button"
                          onClick={() => navigate('/student/find-seat')}
                          className="h-9 text-xs font-bold bg-brandBlue hover:bg-blue-600 text-white rounded-xl"
                        >
                          Find Another Slot <ArrowRight size={14} className="ml-1.5" />
                        </Button>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button
                              type="button"
                              onClick={() => setQrModalTarget(booking)}
                              className="h-9 text-xs font-bold bg-brandBlue hover:bg-blue-600 text-white rounded-xl shadow-xs flex items-center gap-1.5"
                            >
                              <QrCode size={15} /> View QR Pass
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setDetailTarget(booking)}
                              className="h-9 text-xs font-semibold rounded-xl text-slate-700 border-slate-300 hover:bg-slate-50 flex items-center gap-1.5"
                            >
                              <Eye size={14} /> Details
                            </Button>
                          </div>

                          <div className="flex items-center gap-2">
                            {isActive && (
                              <Button
                                type="button"
                                onClick={() => handleRequestCheckout(booking)}
                                className="h-9 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs"
                              >
                                <LogOut size={14} className="mr-1.5" /> Request Checkout QR
                              </Button>
                            )}

                            {isUpcoming && (
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setCancelTarget(booking)}
                                className="h-9 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                              >
                                Cancel Reservation
                              </Button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* ==================================================================== */}
      {/* 6. MODALS */}
      {/* ==================================================================== */}

      {/* A. QR PASS MODAL */}
      <Dialog open={!!qrModalTarget} onOpenChange={() => setQrModalTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 text-center">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center justify-center gap-2">
              <QrCode className="text-brandBlue" size={20} /> SeatSync Entry Pass
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-0.5">
              Present this QR code to the entrance scanner or librarian desk.
            </DialogDescription>
          </DialogHeader>

          {qrModalTarget && (
            <div className="space-y-4 py-3">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 inline-block shadow-inner">
                <QRCodeCanvas
                  id={`qr-canvas-${qrModalTarget.id}`}
                  value={`SEATSYNC-${qrModalTarget.id}-${qrModalTarget.bookingCode || 'PASS'}`}
                  size={170}
                  level="H"
                  includeMargin
                  className="mx-auto rounded-lg"
                />
              </div>

              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 text-xs space-y-1 text-left font-mono">
                <div className="flex justify-between"><span className="text-slate-500">Student:</span> <strong className="text-navy">{user?.name} ({user?.collegeId})</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Pass Code:</span> <strong className="text-brandBlue">{qrModalTarget.bookingCode || qrModalTarget.id}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Seat:</span> <strong className="text-navy font-bold">{qrModalTarget.seatNumber} (Ground Floor)</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Time:</span> <strong className="text-navy">{qrModalTarget.bookingDate} ({qrModalTarget.slotTime})</strong></div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setQrModalTarget(null)}
                  className="rounded-xl text-xs font-bold"
                >
                  Close
                </Button>
                <Button
                  onClick={() => handleDownloadQr(qrModalTarget)}
                  className="bg-brandBlue hover:bg-blue-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5"
                >
                  <Download size={14} /> Download Pass Image
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* B. RESERVATION DETAILS MODAL */}
      <Dialog open={!!detailTarget} onOpenChange={() => setDetailTarget(null)}>
        <DialogContent className="sm:max-w-lg rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Info className="text-brandBlue" size={20} /> Reservation Technical Details
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-0.5">
              Full breakdown of your seat reservation and library policies.
            </DialogDescription>
          </DialogHeader>

          {detailTarget && (
            <div className="space-y-4 py-2 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 font-mono">
                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500">Booking Reference:</span>
                  <span className="font-bold text-brandBlue flex items-center gap-1">
                    {detailTarget.bookingCode || detailTarget.id}
                    <button onClick={(e) => handleCopyId(detailTarget.id, e)} className="text-slate-400 hover:text-navy">
                      <Copy size={12} />
                    </button>
                  </span>
                </div>

                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500">Database Record ID:</span>
                  <span className="font-semibold text-slate-700">{detailTarget.id}</span>
                </div>

                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500">Student Account:</span>
                  <span className="font-bold text-navy">{user?.name} ({user?.collegeId || '24AD042'})</span>
                </div>

                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500">Assigned Seat:</span>
                  <span className="font-bold text-navy">{detailTarget.seatNumber || 'A-101'} (Quiet Zone A)</span>
                </div>

                <div className="flex justify-between border-b border-slate-200 pb-1.5">
                  <span className="text-slate-500">Date & Slot:</span>
                  <span className="font-bold text-navy">{detailTarget.bookingDate} • {detailTarget.slotTime}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-slate-500">Check-in Grace Period:</span>
                  <span className="font-bold text-emerald-700">15 Minutes</span>
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1 text-emerald-900">
                <p className="font-bold flex items-center gap-1">
                  <ShieldCheck size={15} className="text-emerald-600" /> Library Conduct Guidelines
                </p>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Please keep noise to a minimum in Zone A. Check out when you leave to release seats for other students.
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="outline" onClick={() => setDetailTarget(null)} className="rounded-xl text-xs font-bold">
                  Close Details
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* C. CANCELLATION CONFIRMATION MODAL */}
      <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <AlertTriangle className="text-red-500" size={20} /> Cancel Reservation?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Are you sure you want to cancel booking <strong>{cancelTarget?.id}</strong> for Seat <strong>{cancelTarget?.seatNumber}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs space-y-1.5 text-red-900">
              <p className="font-bold flex items-center gap-1">
                <ShieldAlert size={15} className="text-red-600 shrink-0" /> Important Cancellation Policy:
              </p>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                Cancelling this reservation will immediately release Seat {cancelTarget?.seatNumber} to waitlisted students. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling} className="rounded-xl text-xs font-bold">
              Keep Booking
            </Button>
            <Button onClick={handleCancelBooking} disabled={cancelling} className="bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs">
              {cancelling ? 'Cancelling...' : 'Yes, Confirm Cancellation'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
