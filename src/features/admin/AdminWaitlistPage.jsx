import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ListOrdered, RefreshCw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AdminWaitlistPage() {
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchWaitlist = async () => {
    try {
      setLoading(true);
      const data = await db.read('seatsync_waitlist') || [];
      setWaitlist(data);
    } catch {
      toast.error('Failed to load waitlist entries.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWaitlist();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change' || event?.type?.startsWith('WAITLIST_')) fetchWaitlist();
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">System Waiting List Queue</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Global queue metrics for fully booked slots across all floors and dates.
          </p>
        </div>

        <Button onClick={fetchWaitlist} variant="outline" className="text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh Queue
        </Button>
      </div>

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
                    <th className="p-3.5">Entry ID</th>
                    <th className="p-3.5">Student</th>
                    <th className="p-3.5">Slot ID</th>
                    <th className="p-3.5">Date</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {waitlist.map((w, idx) => (
                    <tr key={w.id || idx} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-navy">{w.id || `W-${idx + 1}`}</td>
                      <td className="p-3.5 font-bold text-navy">{w.studentName || w.studentId}</td>
                      <td className="p-3.5 font-mono font-bold text-indigo-600">{w.slotId}</td>
                      <td className="p-3.5 font-mono">{w.dateStr}</td>
                      <td className="p-3.5">
                        <Badge className="bg-amber-500 text-white text-[10px] font-bold">
                          {w.status || 'WAITING'}
                        </Badge>
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
