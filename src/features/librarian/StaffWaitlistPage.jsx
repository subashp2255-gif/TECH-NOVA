import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { db } from '../../services/mockDatabase';
import { waitlistService } from '../../services/waitlistService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Users, Clock, Send, Trash2, RefreshCw, Sparkles } from 'lucide-react';
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

export default function StaffWaitlistPage() {
  const [waitlists, setWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);

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

    // Ensure we fill the list with mock entries so Subash P is #1 and next entries follow
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

    setWaitlists(reindexed);
    setLoading(false);
  };

  useEffect(() => {
    fetchWaitlist();
  }, []);

  useSync(['waitlist_entries', 'seatsync_waitlist'], fetchWaitlist);

  const handleManualNotifyNext = async (slotId, dateStr) => {
    try {
      await waitlistService.notifyNextStudent(dateStr, slotId);
      toast.success('Triggered waitlist seat allocation.');
      fetchWaitlist();
    } catch {
      toast.error('Failed to dispatch allocation.');
    }
  };

  const handleRemoveEntry = async (entryId) => {
    try {
      setWaitlists(prev => prev.filter(w => w.id !== entryId));
      await supabase.from('waitlist_entries').update({ status: 'cancelled' }).eq('id', entryId);
      toast.success('Waitlist entry removed.');
    } catch {
      toast.error('Failed to remove entry.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Users className="text-teal-600" size={28} /> Waiting List Queue Control
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Monitor FIFO queue entries for fully booked library slots and dispatch automated seat allocations.
          </p>
        </div>

        <Button onClick={fetchWaitlist} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh Queue
        </Button>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading waitlist entries...</div>
          ) : waitlists.length === 0 ? (
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
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {waitlists.map((w, idx) => (
                    <tr key={w.id || idx} className="hover:bg-slate-50 text-slate-700">
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
                      <td className="p-3.5 text-right flex items-center justify-end gap-2">
                        {w.status === 'WAITING' && (
                          <Button
                            onClick={() => handleManualNotifyNext(w.slotId, w.dateStr)}
                            className="h-7 text-[10px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-2.5"
                          >
                            <Send size={11} className="mr-1" /> Allocate
                          </Button>
                        )}
                        <button
                          onClick={() => handleRemoveEntry(w.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100"
                          title="Remove entry"
                        >
                          <Trash2 size={14} />
                        </button>
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
