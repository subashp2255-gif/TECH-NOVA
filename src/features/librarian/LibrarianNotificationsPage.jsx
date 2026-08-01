import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { notificationService } from '../../services/notificationService';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  Bell, Send, User, Users, AlertTriangle, ShieldCheck, CheckCircle2, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function LibrarianNotificationsPage() {
  const { user: staffUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [students, setStudents] = useState([]);

  // Form
  const [targetType, setTargetType] = useState('single'); // 'single' | 'all'
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [notifsData, usersData] = await Promise.all([
        db.read('seatsync_notifications') || [],
        db.read('seatsync_users') || []
      ]);
      setNotifications(notifsData.reverse());
      setStudents(usersData.filter(u => u.role === 'STUDENT'));
      if (usersData.length > 0 && !selectedStudentId) {
        setSelectedStudentId(usersData.find(u => u.role === 'STUDENT')?.id || '');
      }
    } catch (err) {
      console.warn('Failed to load notifications data:', err);
    }
  };

  const handleSendNotification = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('Please enter a notification title and message.');
      return;
    }

    setLoading(true);
    try {
      if (targetType === 'single') {
        const student = students.find(s => s.id === selectedStudentId);
        await notificationService.addNotification({
          userId: selectedStudentId,
          type: 'OPERATIONAL_ALERT',
          title: `[Library Staff] ${title}`,
          message,
          priority
        });
        toast.success(`Notification sent to ${student?.name || 'student'}.`);
      } else {
        // Send to all active students
        for (const student of students) {
          await notificationService.addNotification({
            userId: student.id,
            type: 'OPERATIONAL_ALERT',
            title: `[Library Staff] ${title}`,
            message,
            priority
          });
        }
        toast.success(`Operational notice broadcasted to ${students.length} students.`);
      }

      setTitle('');
      setMessage('');
      await loadData();
    } catch (err) {
      toast.error('Failed to send notification.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
          <Bell className="text-teal-600" size={28} /> Operational Notifications Centre
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Dispatch targeted operational alerts, slot warnings, or desk reminders directly to students.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* DISPATCH FORM */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4 lg:col-span-1">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Send size={18} className="text-teal-600" /> Dispatch Notice
          </h2>

          <form onSubmit={handleSendNotification} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Recipient Group</label>
              <select
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
              >
                <option value="single">Single Student</option>
                <option value="all">All Active Students</option>
              </select>
            </div>

            {targetType === 'single' && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">Select Student</label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
                >
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.collegeId || 'Student'})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Notice Title</label>
              <Input
                type="text"
                placeholder="e.g. Desk Verification Reminder"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Notice Message</label>
              <Input
                type="text"
                placeholder="Message body..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Priority Level</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3"
              >
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High Priority</option>
                <option value="URGENT">Urgent / Emergency</option>
              </select>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs mt-2 flex items-center justify-center gap-2"
            >
              <Send size={16} /> {loading ? 'Sending...' : 'Dispatch Notification →'}
            </Button>
          </form>
        </Card>

        {/* NOTIFICATIONS LOG */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4 lg:col-span-2">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Clock size={18} className="text-teal-600" /> Dispatched Notifications Log
          </h2>

          {notifications.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No notifications sent yet.</p>
          ) : (
            <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
              {notifications.map(n => (
                <div key={n.id} className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-navy text-sm">{n.title}</span>
                    <Badge className={`text-[10px] font-bold ${
                      n.priority === 'HIGH' || n.priority === 'URGENT' ? 'bg-red-600 text-white' : 'bg-slate-500 text-white'
                    }`}>
                      {n.priority || 'NORMAL'}
                    </Badge>
                  </div>
                  <p className="text-slate-600 leading-relaxed">{n.message}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                    <span>Target: {n.userId || 'Student'}</span>
                    <span>Sent: {n.createdAt ? new Date(n.createdAt).toLocaleString() : 'Just now'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
