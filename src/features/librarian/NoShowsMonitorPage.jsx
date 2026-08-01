import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { ShieldAlert, AlertTriangle, UserCheck, ShieldCheck } from 'lucide-react';
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">No-Show & Standing Monitor</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Track missed student check-ins and manage automated 7-day restriction flags.
        </p>
      </div>

      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading student records...</div>
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
                    <th className="p-3.5">Account Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 font-mono text-slate-600">{s.collegeId || s.identifier}</td>
                      <td className="p-3.5 text-slate-500">{s.department || 'Computer Science'}</td>
                      <td className="p-3.5 font-bold">
                        <span className={s.noShowCount >= 3 ? 'text-red-600 font-black' : s.noShowCount >= 2 ? 'text-amber-600' : 'text-slate-700'}>
                          {s.noShowCount || 0} / 3
                        </span>
                      </td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${
                          s.accountStatus === 'restricted' || (s.noShowCount || 0) >= 3 ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'
                        }`}>
                          {s.accountStatus === 'restricted' || (s.noShowCount || 0) >= 3 ? 'Restricted' : 'Active'}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          onClick={() => handleResetNoShows(s.id)}
                          variant="outline"
                          className="h-7 text-[11px] font-bold rounded-lg border-slate-300"
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
