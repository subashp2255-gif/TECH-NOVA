import React, { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { waitlistService } from '../../services/waitlistService';
import { bookingService } from '../../services/bookingService';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Clock, Calendar, Users, Bell, AlertTriangle, ShieldCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

function format12HourTime(timeStr) {
  if (!timeStr) return '';
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  return `${formattedHours}:${minutes < 10 ? '0' : ''}${minutes} ${period}`;
}

export default function WaitingList() {
  const { user } = useAuth();
  const [myWaitlists, setMyWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);

  const tomorrowDate = bookingService.getTomorrowDateStr();

  const fetchWaitlistData = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const studentEntries = await waitlistService.getStudentWaitlistEntries(user.id);

      const enriched = await Promise.all(
        studentEntries.map(async (entry) => {
          const summary = await waitlistService.getWaitlistSummaryForSlot(
            entry.dateStr,
            entry.slotId,
            user.id
          );
          return { ...entry, summary };
        })
      );

      setMyWaitlists(enriched);
    } catch (err) {
      toast.error('Failed to load waiting list status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWaitlistData();
  }, [user]);

  useSync(['waitlist_entries', 'seatsync_waitlist'], fetchWaitlistData);

  const handleLeaveQueue = async (entryId) => {
    try {
      await waitlistService.leaveWaitlist(entryId, user.id);
      toast.success('You have left the waiting list queue.');
      fetchWaitlistData();
    } catch (err) {
      toast.error('Could not leave waiting list.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">My Waiting List Queues</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Track your queue positions for fully booked library slots.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => <div key={i} className="h-40 bg-white rounded-2xl border border-slate-200 animate-pulse" />)}
        </div>
      ) : myWaitlists.length === 0 ? (
        <Card className="border border-slate-200 shadow-xs rounded-2xl bg-white p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
            <Users size={28} />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-navy">No Active Waitlists</h3>
            <p className="text-xs text-slate-500 font-medium">You are not currently queued for any fully booked slots.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {myWaitlists.map(entry => {
            const slot = entry.slot;
            const summary = entry.summary || {};
            const position = summary.studentPosition || entry.queuePosition || 1;
            const aheadCount = Math.max(0, position - 1);

            return (
              <Card key={entry.id} className="border-2 border-amber-300/80 bg-white rounded-2xl overflow-hidden shadow-xs">
                <CardContent className="p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Badge className="bg-amber-500 text-white font-extrabold text-xs">
                        Waitlisted Queue
                      </Badge>
                      <span className="text-xs font-mono font-bold text-slate-500">Entry ID: {entry.id}</span>
                    </div>

                    <div className="bg-amber-500 text-white font-mono font-black text-sm px-3 py-1 rounded-xl shadow-xs">
                      Queue Position: #{position}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3 bg-amber-50/50 border border-amber-200/60 rounded-xl p-4 text-xs">
                    <div>
                      <span className="text-slate-400 font-bold text-[10px] uppercase block">Slot Label</span>
                      <span className="font-extrabold text-navy text-sm">{slot?.name || slot?.label || 'Afternoon Slot 1'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold text-[10px] uppercase block">Time Window</span>
                      <span className="font-bold text-brandBlue font-mono">
                        {slot?.startTime ? `${format12HourTime(slot.startTime)} – ${format12HourTime(slot.endTime)}` : '02:00 PM – 03:00 PM'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 font-bold text-[10px] uppercase block">Date</span>
                      <span className="font-bold text-navy">{entry.dateStr}</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center justify-between">
                    <span className="text-amber-800 font-bold">
                      {aheadCount > 0
                        ? `There are ${aheadCount} student(s) ahead of you in the queue.`
                        : 'You are next in line! You will receive a notification as soon as a seat opens.'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">Privacy Protected</span>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500 font-medium flex items-center gap-1.5">
                      <Bell size={14} className="text-blue-600" /> Auto-allocation enabled upon seat release
                    </span>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleLeaveQueue(entry.id)}
                      className="h-9 text-xs font-bold border-red-200 text-red-600 hover:bg-red-50 rounded-xl"
                    >
                      Leave Waiting List
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
