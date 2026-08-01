import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { notificationService } from '../../services/notificationService';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ShieldAlert, AlertTriangle, UserCheck, ShieldCheck, Clock, Bell } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NoShowsMonitorPage() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStudents = async () => {
    try {
      setLoading(true);
      const users = await db.read('seatsync_users') || [];
      setStudents(users.filter(u => u.role === 'STUDENT'));
    } catch {
      toast.error('Failed to load student standings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  const handleResetNoShows = async (studentId) => {
    try {
      const users = await db.read('seatsync_users') || [];
      const target = users.find(u => u.id === studentId);
      if (target) {
        target.noShowCount = 0;
        target.accountStatus = 'active';
        await db.write('seatsync_users', users);
        toast.success(`Reset no-shows for ${target.name}. Account reinstated.`);
        fetchStudents();
      }
    } catch (err) {
      toast.error('Failed to reset student status.');
    }
  };

  const handleSendWarning = async (student) => {
    try {
      await notificationService.addNotification({
        userId: student.id,
        type: 'NO_SHOW_WARNING',
        title: 'Attendance Warning — 15 Min Grace Period Violation',
        message: 'Your seat reservation passed the 15-minute grace period without desk verification. Please verify your attendance to prevent automated 7-day restriction.',
        priority: 'HIGH'
      });
      toast.success(`Warning notification dispatched to ${student.name}.`);
    } catch (err) {
      toast.error('Failed to send warning.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <ShieldAlert className="text-teal-600" size={28} /> No-Show & Standing Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Track missed student check-ins (15-min grace countdown) and manage 7-day penalty restrictions.
          </p>
        </div>

        <Badge variant="outline" className="bg-slate-100 border-slate-200 text-teal-700 font-mono text-xs px-3 py-1">
          Grace Limit: 15 Mins
        </Badge>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl shadow-xs overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading student standings...</div>
          ) : students.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No student accounts registered yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Student Name</th>
                    <th className="p-3.5">College ID</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">No-Show Count</th>
                    <th className="p-3.5">Account Standing</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {students.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 text-slate-700">
                      <td className="p-3.5 font-sans font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 font-mono text-slate-500">{s.collegeId || s.identifier}</td>
                      <td className="p-3.5 font-sans text-slate-500">{s.department || 'Computer Science'}</td>
                      <td className="p-3.5 font-bold">
                        <span className={s.noShowCount >= 3 ? 'text-red-600 font-black' : s.noShowCount >= 2 ? 'text-amber-600' : 'text-slate-700'}>
                          {s.noShowCount || 0} / 3 Offenses
                        </span>
                      </td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          s.accountStatus === 'restricted' || (s.noShowCount || 0) >= 3 ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}>
                          {s.accountStatus === 'restricted' || (s.noShowCount || 0) >= 3 ? 'Restricted' : 'Good Standing'}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleSendWarning(s)}
                          variant="outline"
                          className="h-7 text-[10px] font-bold border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg"
                        >
                          <Bell size={11} className="mr-1" /> Warn
                        </Button>
                        <Button
                          onClick={() => handleResetNoShows(s.id)}
                          className="h-7 text-[10px] font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-2.5"
                        >
                          Reset Standing
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
