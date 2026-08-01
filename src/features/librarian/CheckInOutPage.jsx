import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { librarianService } from '../../services/librarianService';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  UserCheck, LogOut, Search, QrCode, AlertCircle, CheckCircle2,
  Clock, MapPin, ShieldCheck, RefreshCw, User, Calendar
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function CheckInOutPage() {
  const { user: staffUser } = useAuth();
  const [activeTab, setActiveTab] = useState('check-in'); // 'check-in' | 'check-out'
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundBooking, setFoundBooking] = useState(null);
  const [checkInReason, setCheckInReason] = useState('Entry Pass Verified');
  const [recentLogs, setRecentLogs] = useState([]);

  useEffect(() => {
    loadRecentLogs();
  }, []);

  const loadRecentLogs = async () => {
    try {
      const logs = (await db.read('seatsync_checkins')) || [];
      setRecentLogs(logs.slice(-8).reverse());
    } catch (err) {
      console.warn('Failed to load checkin logs:', err);
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchInput.trim()) {
      toast.error('Please enter a booking ID, student register number, or QR token.');
      return;
    }

    setLoading(true);
    setFoundBooking(null);

    try {
      const res = await librarianService.verifyToken(searchInput.trim());
      setFoundBooking(res.booking);
      toast.success('Matching reservation found!');
    } catch (err) {
      toast.error(err.message || 'No reservation found matching search query.');
    } fontFinally: {
      setLoading(false);
    }
  };

  const handleConfirmCheckIn = async () => {
    if (!foundBooking) return;
    setLoading(true);
    try {
      await librarianService.processCheckIn(foundBooking.id, staffUser, checkInReason);
      toast.success(`Check-In confirmed for ${foundBooking.studentName} (Seat ${foundBooking.seatNumber}).`);
      setFoundBooking(null);
      setSearchInput('');
      await loadRecentLogs();
    } catch (err) {
      toast.error(err.message || 'Check-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCheckOut = async () => {
    if (!foundBooking) return;
    setLoading(true);
    try {
      await librarianService.processCheckOut(foundBooking.id, staffUser);
      toast.success(`Check-Out completed for ${foundBooking.studentName}. Seat ${foundBooking.seatNumber} released!`);
      setFoundBooking(null);
      setSearchInput('');
      await loadRecentLogs();
    } catch (err) {
      toast.error(err.message || 'Check-out failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <UserCheck className="text-teal-600" size={28} /> Check-In & Check-Out Desk
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Manually verify student entry passes, confirm desk check-ins, or process student check-outs.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex bg-slate-100 border border-slate-200 p-1 rounded-2xl">
          <button
            onClick={() => { setActiveTab('check-in'); setFoundBooking(null); }}
            className={`px-5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
              activeTab === 'check-in'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            <UserCheck size={16} /> Check-In Desk
          </button>
          <button
            onClick={() => { setActiveTab('check-out'); setFoundBooking(null); }}
            className={`px-5 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2 ${
              activeTab === 'check-out'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            <LogOut size={16} /> Check-Out Desk
          </button>
        </div>
      </div>

      {/* SEARCH CARD */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Search size={18} className="text-teal-600" /> Search Student Reservation
        </h2>

        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3.5 text-slate-400" size={18} />
            <Input
              type="text"
              placeholder="Enter Booking ID (e.g., BK-1785...), Register No (24AD042), or Token..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10 h-11 bg-slate-50 border-slate-300 text-navy font-mono text-xs focus:border-teal-600 rounded-xl"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className={`h-11 px-6 font-bold text-xs rounded-xl shadow-xs ${
              activeTab === 'check-in' ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'
            }`}
          >
            {loading ? 'Searching...' : 'Find Reservation'}
          </Button>
        </form>
      </Card>

      {/* FOUND RESERVATION CARD */}
      {foundBooking && (
        <Card className={`border-2 rounded-2xl p-6 shadow-sm space-y-6 animate-in slide-in-from-top-2 ${
          activeTab === 'check-in' ? 'border-teal-500/50 bg-white' : 'border-amber-500/50 bg-white'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Badge className={`text-xs font-extrabold px-3 py-1 ${
                foundBooking.status === 'active' ? 'bg-teal-600 text-white' :
                foundBooking.status === 'completed' ? 'bg-slate-500 text-white' :
                'bg-brandBlue text-white'
              }`}>
                {foundBooking.status.toUpperCase()}
              </Badge>
              <span className="text-xs font-mono font-bold text-slate-500">ID: {foundBooking.id}</span>
            </div>
            <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
              <Calendar size={14} className="text-teal-600" /> Date: {foundBooking.bookingDate}
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Student Name</span>
              <p className="text-base font-extrabold text-navy flex items-center gap-1.5">
                <User size={16} className="text-teal-600" /> {foundBooking.studentName}
              </p>
              <p className="text-[11px] text-slate-500 font-mono">Reg ID: {foundBooking.studentCollegeId || '24AD042'}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Assigned Seat</span>
              <p className="text-base font-extrabold text-navy flex items-center gap-1.5">
                <MapPin size={16} className="text-teal-600" /> Seat {foundBooking.seatNumber}
              </p>
              <p className="text-[11px] text-slate-500">{foundBooking.floorName || 'Ground Floor'}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reserved Slot</span>
              <p className="text-sm font-bold text-navy font-mono flex items-center gap-1.5">
                <Clock size={16} className="text-teal-600" /> {foundBooking.slotTime}
              </p>
            </div>
          </div>

          {activeTab === 'check-in' ? (
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Mandatory Verification Reason</label>
                <select
                  value={checkInReason}
                  onChange={(e) => setCheckInReason(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-navy px-3 focus:border-teal-600"
                >
                  <option value="Entry Pass Verified">Entry Pass QR Verified</option>
                  <option value="Physical ID Verified">Physical Student ID Verified</option>
                  <option value="Staff Manual Verification">Staff Manual Verification</option>
                  <option value="Late Entry Approved">Late Entry Approved</option>
                </select>
              </div>

              {foundBooking.status === 'active' ? (
                <div className="p-4 bg-teal-50 border border-teal-200 text-teal-700 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-teal-600 shrink-0" />
                  <span>Student is already checked in to Seat {foundBooking.seatNumber}.</span>
                </div>
              ) : (
                <Button
                  onClick={handleConfirmCheckIn}
                  disabled={loading}
                  className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                >
                  <UserCheck size={18} /> Confirm Desk Check-In & Activate Pass →
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {foundBooking.status === 'completed' ? (
                <div className="p-4 bg-slate-100 border border-slate-200 text-slate-600 text-xs rounded-xl flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-slate-400 shrink-0" />
                  <span>Student has already checked out from Seat {foundBooking.seatNumber}.</span>
                </div>
              ) : (
                <Button
                  onClick={handleConfirmCheckOut}
                  disabled={loading}
                  className="w-full h-11 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                >
                  <LogOut size={18} /> Confirm Student Check-Out & Release Seat →
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* RECENT CHECK-IN ACTIVITY TABLE */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h3 className="text-base font-bold text-navy flex items-center gap-2">
          <Clock size={18} className="text-teal-600" /> Recent Desk Check-In Activity Log
        </h3>

        {recentLogs.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No recent check-in records logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Student</th>
                  <th className="py-2.5 px-3">Seat</th>
                  <th className="py-2.5 px-3">Slot</th>
                  <th className="py-2.5 px-3">Verified By</th>
                  <th className="py-2.5 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 text-slate-700">
                    <td className="py-2.5 px-3 font-semibold text-slate-500">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}</td>
                    <td className="py-2.5 px-3 font-bold text-navy">{log.studentName}</td>
                    <td className="py-2.5 px-3 font-bold text-teal-600">{log.seatNumber}</td>
                    <td className="py-2.5 px-3">{log.slotTime}</td>
                    <td className="py-2.5 px-3 text-slate-500">{log.staffName || 'Staff'}</td>
                    <td className="py-2.5 px-3 text-slate-500">{log.reason || 'Verified'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
