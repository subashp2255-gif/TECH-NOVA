import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { waitlistService } from '../../services/waitlistService';
import { librarianService } from '../../services/librarianService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Users, Clock, CheckCircle2, AlertTriangle, RefreshCw, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StaffWaitlistPage() {
  const [waitlists, setWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchWaitlist = async () => {
    try {
      setLoading(true);
      const data = await db.read('seatsync_waitlist') || [];
      setWaitlists(data.reverse());
    } catch {
      toast.error('Failed to load waitlist entries.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWaitlist();
  }, []);

  useSync(['seatsync_waitlist'], fetchWaitlist);

  const handleManualNotifyNext = async (slotId, dateStr) => {
    try {
      const notified = await waitlistService.notifyNextStudent(dateStr || new Date().toISOString().split('T')[0], slotId);
      if (notified) {
        toast.success(`Notified student ${notified.studentName} for slot ${slotId}!`);
      } else {
        toast.info('No waiting students in queue for this slot.');
      }
      fetchWaitlist();
    } catch (err) {
      toast.error('Failed to dispatch notification.');
    }
  };

  const handleRemoveEntry = async (entryId) => {
    try {
      const data = (await db.read('seatsync_waitlist')) || [];
      const updated = data.filter(w => String(w.id) !== String(entryId));
      await db.write('seatsync_waitlist', updated);
      toast.success('Waitlist entry removed.');
      fetchWaitlist();
    } catch (err) {
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
            Monitor FIFO queue entries for fully booked library slots and dispatch manual seat allocations.
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
                    <th className="p-3.5">Queue ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Slot ID</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {waitlists.map((w, idx) => (
                    <tr key={w.id || idx} className="hover:bg-slate-50 text-slate-700">
                      <td className="p-3.5 font-mono font-bold text-navy">{w.id || `W-${idx + 1}`}</td>
                      <td className="p-3.5 font-sans font-bold text-navy">{w.studentName || w.studentId}</td>
                      <td className="p-3.5 font-mono font-bold text-teal-600">{w.slotId}</td>
                      <td className="p-3.5 font-mono">{w.dateStr}</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          w.status === 'CANCELLED_BY_ADMIN' ? 'bg-red-600 text-white' :
                          w.status === 'ALLOCATED' ? 'bg-emerald-600 text-white' :
                          'bg-amber-600 text-white'
                        }`}>
                          {w.status || 'WAITING'}
                        </Badge>
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
