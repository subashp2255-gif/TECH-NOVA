import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { db } from '../../services/mockDatabase';
import { waitlistService } from '../../services/waitlistService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ListOrdered, RefreshCw, Clock, Play, RotateCcw, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

const DEFAULT_MOCK_WAITLIST = [
  { id: 'WL-001', studentName: 'Subash P', registrationNumber: 'USR-001', department: 'Computer Science & Engineering', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: false, queuePosition: 1 },
  { id: 'WL-002', studentName: 'Aarav Sharma', registrationNumber: '2024CSE042', department: 'Computer Science & Engineering', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 2 },
  { id: 'WL-003', studentName: 'Priya Patel', registrationNumber: '2024ECE019', department: 'Electronics & Communication', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 3 },
  { id: 'WL-004', studentName: 'Rohan Verma', registrationNumber: '2024IT088', department: 'Information Technology', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 4 },
  { id: 'WL-005', studentName: 'Ananya Roy', registrationNumber: '2024AI015', department: 'AI & Data Science', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 5 },
  { id: 'WL-006', studentName: 'Karthik Sundaram', registrationNumber: '2024ME033', department: 'Mechanical Engineering', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 6 },
  { id: 'WL-007', studentName: 'Diya Nair', registrationNumber: '2024EEE027', department: 'Electrical & Electronics', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 7 },
  { id: 'WL-008', studentName: 'Vikram Singh', registrationNumber: '2024CIV051', department: 'Civil Engineering', slotName: 'Afternoon Slot 1', dateStr: '2026-08-02', status: 'WAITING', isTestData: true, queuePosition: 8 }
];

export default function AdminWaitlistPage() {
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [demoState, setDemoState] = useState({
    includeQueue: true,
    preparing: false,
    resetting: false,
    showConfirmReset: false
  });

  const fetchWaitlist = async () => {
    let combined = [];

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('waitlist_entries')
        .select(`
          id,
          booking_date,
          queue_position,
          status,
          created_at,
          is_test_data,
          test_scenario_id,
          profiles!student_id (full_name, registration_number, department),
          slots (name, start_time, end_time)
        `)
        .order('queue_position', { ascending: true })
        .order('created_at', { ascending: true });

      if (!error && data && data.length > 0) {
        combined = data.map((w, idx) => ({
          id: w.id,
          studentName: w.profiles?.full_name || 'Student',
          registrationNumber: w.profiles?.registration_number || 'N/A',
          department: w.profiles?.department || 'Computer Science & Engineering',
          slotName: w.slots?.name || 'Afternoon Slot 1',
          dateStr: w.booking_date,
          queuePosition: w.queue_position || idx + 1,
          status: (w.status || 'waiting').toUpperCase(),
          isTestData: Boolean(w.is_test_data || w.test_scenario_id === 'waitlist-demo-001'),
          joinedAt: w.created_at
        }));
      }
    } catch { /* fallback */ }

    if (combined.length === 0) {
      try {
        const localData = await db.read('seatsync_waitlist') || [];
        if (localData.length > 0) {
          combined = localData.map((w, idx) => ({
            ...w,
            studentName: w.studentName || 'Student',
            registrationNumber: w.registrationNumber || w.studentId || 'N/A',
            department: w.department || 'Computer Science & Engineering',
            slotName: w.slotName || w.slotId || 'Afternoon Slot 1',
            queuePosition: idx + 1,
            status: (w.status || 'waiting').toUpperCase(),
            isTestData: Boolean(w.is_test_data || w.test_scenario_id === 'waitlist-demo-001')
          }));
        }
      } catch { /* fallback */ }
    }

    const mergedList = [...combined];
    DEFAULT_MOCK_WAITLIST.forEach(mockItem => {
      const exists = mergedList.some(item => 
        item.id === mockItem.id || item.studentName.toLowerCase() === mockItem.studentName.toLowerCase()
      );
      if (!exists) {
        mergedList.push(mockItem);
      }
    });

    mergedList.sort((a, b) => (a.queuePosition || 99) - (b.queuePosition || 99));
    const reindexed = mergedList.map((item, idx) => ({
      ...item,
      queuePosition: idx + 1
    }));

    setWaitlist(reindexed);
    setLoading(false);
  };

  useEffect(() => {
    fetchWaitlist();
  }, []);

  useSync(['waitlist_entries', 'seatsync_waitlist'], fetchWaitlist);

  const handlePrepareDemo = async () => {
    setDemoState(prev => ({ ...prev, preparing: true }));
    try {
      const res = await waitlistService.prepareDemoScenario(demoState.includeQueue);
      toast.success(res.message || 'Demo scenario prepared: 40 seats reserved & 5 waitlist entries created.');
      fetchWaitlist();
    } catch (err) {
      toast.error('Failed to prepare demo scenario.');
    } finally {
      setDemoState(prev => ({ ...prev, preparing: false }));
    }
  };

  const handleResetDemo = async () => {
    setDemoState(prev => ({ ...prev, resetting: true, showConfirmReset: false }));
    try {
      const res = await waitlistService.resetDemoScenario();
      toast.success(res.message || 'Demo scenario records cleared.');
      fetchWaitlist();
    } catch (err) {
      toast.error('Failed to reset demo scenario.');
    } finally {
      setDemoState(prev => ({ ...prev, resetting: false }));
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ListOrdered className="text-indigo-600" size={28} /> System Waiting List Queue & Demo Console
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Global queue metrics for fully booked slots and automated demonstration scenario controls.
          </p>
        </div>

        <Button onClick={fetchWaitlist} variant="outline" className="text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh Queue
        </Button>
      </div>

      {/* DEMO SCENARIO CONTROL PANEL CARD */}
      <Card className="border border-indigo-200/80 bg-gradient-to-r from-indigo-50/60 to-purple-50/60 rounded-2xl p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-indigo-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-navy">Waiting List Demonstration Scenario Control</h2>
              <p className="text-xs text-indigo-700 font-medium">
                Scenario ID: <code className="font-mono bg-indigo-100 px-1 rounded font-bold">waitlist-demo-001</code> • Afternoon Slot 1 Full Capacity (40 Seats)
              </p>
            </div>
          </div>

          <Badge className="bg-indigo-600 text-white font-mono text-xs px-3 py-1">
            40 Seats Booked + 8 Waiting Queue
          </Badge>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={demoState.includeQueue}
                onChange={(e) => setDemoState(prev => ({ ...prev, includeQueue: e.target.checked }))}
                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
              />
              <span>Include Initial Waiting Queue (Positions 1-8)</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handlePrepareDemo}
              disabled={demoState.preparing}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold h-9 px-4 rounded-xl shadow-xs flex items-center gap-1.5"
            >
              <Play size={14} /> {demoState.preparing ? 'Preparing Scenario...' : 'Prepare Waiting List Demo'}
            </Button>

            <Button
              onClick={() => setDemoState(prev => ({ ...prev, showConfirmReset: true }))}
              disabled={demoState.resetting}
              variant="outline"
              className="border-red-300 text-red-600 hover:bg-red-50 text-xs font-bold h-9 px-3 rounded-xl flex items-center gap-1.5"
            >
              <RotateCcw size={14} /> Reset Demo Data
            </Button>
          </div>
        </div>
      </Card>

      {/* CONFIRMATION RESET MODAL */}
      {demoState.showConfirmReset && (
        <div className="fixed inset-0 z-50 bg-navy/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle size={24} />
              <h3 className="text-lg font-black text-navy">Reset Waiting List Demo Data?</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed font-medium">
              This action removes <strong>only</strong> records belonging to <code className="font-mono font-bold text-red-600">waitlist-demo-001</code> (40 mock student bookings and demo waitlist queue). Genuine SeatSync records will not be changed.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setDemoState(prev => ({ ...prev, showConfirmReset: false }))}
                className="text-xs font-bold border-slate-300 h-9"
              >
                Cancel
              </Button>
              <Button
                onClick={handleResetDemo}
                className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold h-9 px-4 rounded-xl"
              >
                Confirm Reset Demo
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* QUEUE TABLE */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading waitlist...</div>
          ) : waitlist.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No active students on the waiting list.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Pos</th>
                    <th className="p-3.5">Student Name & Reg No</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Slot / Date</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Tag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {waitlist.map((w, idx) => (
                    <tr key={w.id || idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-black text-indigo-600">#{w.queuePosition}</td>
                      <td className="p-3.5 font-sans font-bold text-navy">
                        <div>{w.studentName}</div>
                        <span className="text-[10px] font-mono text-indigo-600">{w.registrationNumber}</span>
                      </td>
                      <td className="p-3.5 font-sans text-slate-600">{w.department}</td>
                      <td className="p-3.5 font-mono">
                        <div>{w.slotName}</div>
                        <span className="text-[10px] text-slate-400">{w.dateStr}</span>
                      </td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          w.status === 'ALLOCATED' ? 'bg-purple-600 text-white' :
                          w.status === 'CANCELLED' || w.status === 'CANCELLED_BY_STUDENT' ? 'bg-red-600 text-white' :
                          'bg-amber-600 text-white'
                        }`}>
                          {w.status}
                        </Badge>
                      </td>
                      <td className="p-3.5">
                        {w.isTestData ? (
                          <Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 text-[9px] font-mono font-bold flex items-center gap-1 w-max">
                            <Sparkles size={10} /> Demo Data
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-slate-400 font-mono">Real User</span>
                        )}
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
