import React, { useEffect, useState } from 'react';
import { supabase, isUUID } from '../../lib/supabase';
import { adminService } from '../../services/adminService';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { db } from '../../services/mockDatabase';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Search, Plus, RefreshCw, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StudentManagementPage() {
  const { user: adminUser } = useAuth();
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({
    collegeId: '',
    name: '',
    email: '',
    password: 'student123',
    department: 'Computer Science & Engineering'
  });

  const fetchStudents = async () => {
    try {
      setLoading(true);

      let dbStudents = [];
      let localStudents = [];

      // 1. Fetch ALL real Supabase profiles and filter student roles in JS to prevent PostgREST enum syntax errors
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*');

        if (!error && data && Array.isArray(data)) {
          const studentRows = data.filter(p => {
            const r = String(p.role || 'student').toLowerCase();
            return !['admin', 'super_admin', 'librarian', 'senior_librarian', 'support_staff'].includes(r);
          });

          dbStudents = studentRows.map(p => ({
            id: p.id,
            collegeId: p.registration_number || p.login_identifier || (typeof p.id === 'string' && p.id.length < 15 ? p.id : p.id.substring(0, 12)),
            identifier: p.registration_number || p.email,
            name: p.full_name || p.email?.split('@')[0] || 'Student',
            email: p.email,
            department: p.department || 'Computer Science & Engineering',
            noShowCount: p.no_show_count || 0,
            status: String(p.status || p.account_status || 'active').toUpperCase(),
            createdAt: p.created_at
          }));
        } else if (error) {
          console.warn('Supabase profiles query notice:', error.message);
        }
      } catch (err) {
        console.warn('Supabase student profiles fetch notice:', err);
      }

      // 2. Fetch from local mock/storage database
      try {
        const users = await db.read('seatsync_users') || [];
        localStudents = users
          .filter(u => !u.role || String(u.role).toUpperCase() === 'STUDENT' || String(u.role).toUpperCase() === 'USER')
          .map(u => ({
            id: u.id,
            collegeId: u.collegeId || u.registration_number || u.identifier || u.id,
            identifier: u.identifier || u.collegeId || u.email,
            name: u.name || u.fullName || 'Student',
            email: u.email,
            department: u.department || 'Computer Science & Engineering',
            noShowCount: u.noShowCount || u.no_show_count || 0,
            status: String(u.status || 'ACTIVE').toUpperCase(),
            createdAt: u.createdAt
          }));
      } catch (err) {
        console.warn('Local users fetch notice:', err);
      }

      // 3. Merge both databases, deduplicating by email or collegeId
      const mergedMap = new Map();

      // Insert DB profiles first (highest precedence)
      dbStudents.forEach(s => {
        const key = (s.email || s.collegeId || s.id).toLowerCase();
        mergedMap.set(key, s);
      });

      // Insert/Merge local students
      localStudents.forEach(s => {
        const key = (s.email || s.collegeId || s.id).toLowerCase();
        if (!mergedMap.has(key)) {
          mergedMap.set(key, s);
        } else {
          // Merge metadata
          const existing = mergedMap.get(key);
          mergedMap.set(key, {
            ...s,
            ...existing,
            name: existing.name && existing.name !== 'Student' ? existing.name : s.name,
            collegeId: existing.collegeId || s.collegeId,
            department: existing.department || s.department
          });
        }
      });

      // 4. Also check active local session for any logged in student
      try {
        const stored = localStorage.getItem('seatsync_session');
        if (stored) {
          const activeUser = JSON.parse(stored);
          if (activeUser && (String(activeUser.role).toUpperCase() === 'STUDENT' || !activeUser.role)) {
            const key = (activeUser.email || activeUser.collegeId || activeUser.id).toLowerCase();
            if (!mergedMap.has(key)) {
              mergedMap.set(key, {
                id: activeUser.id,
                collegeId: activeUser.collegeId || activeUser.registration_number || activeUser.identifier || 'STD001',
                identifier: activeUser.identifier || activeUser.email,
                name: activeUser.name || activeUser.fullName || 'Student',
                email: activeUser.email,
                department: activeUser.department || 'Computer Science & Engineering',
                noShowCount: activeUser.noShowCount || 0,
                status: String(activeUser.status || 'ACTIVE').toUpperCase(),
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      } catch { /* ignore */ }

      setStudents(Array.from(mergedMap.values()));
    } catch {
      toast.error('Failed to load student list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  useSync(['profiles', 'users', 'seatsync_users'], fetchStudents);

  const handleAddStudent = async (e) => {
    e.preventDefault();
    const cleanCollegeId = newStudent.collegeId.trim();
    const cleanName = newStudent.name.trim();

    if (!cleanCollegeId || !cleanName) {
      toast.error('Please enter Student College ID and Name.');
      return;
    }

    try {
      const email = newStudent.email.trim() || `${cleanCollegeId.toLowerCase()}@college.edu`;

      // 1. Try Supabase Auth Signup
      await supabase.auth.signUp({
        email,
        password: newStudent.password || 'student123',
        options: {
          data: {
            full_name: cleanName,
            registration_number: cleanCollegeId,
            department: newStudent.department,
            role: 'student'
          }
        }
      });

      // 2. Save to local storage database so student can log in instantly
      const users = await db.read('seatsync_users') || [];
      const created = {
        id: `USR-${Date.now()}`,
        identifier: cleanCollegeId,
        collegeId: cleanCollegeId,
        registration_number: cleanCollegeId,
        name: cleanName,
        email,
        password: newStudent.password || 'student123',
        role: 'STUDENT',
        status: 'ACTIVE',
        department: newStudent.department,
        noShowCount: 0,
        createdAt: new Date().toISOString()
      };

      const existsIndex = users.findIndex(u => u.collegeId === cleanCollegeId || u.email === email);
      if (existsIndex >= 0) {
        users[existsIndex] = { ...users[existsIndex], ...created };
      } else {
        users.push(created);
      }
      await db.write('seatsync_users', users);

      toast.success(`Student ${cleanName} registered successfully!`);
      setAddModalOpen(false);
      setNewStudent({ collegeId: '', name: '', email: '', password: 'student123', department: 'Computer Science & Engineering' });
      fetchStudents();
    } catch {
      toast.error('Failed to register student account.');
    }
  };

  const handleToggleStatus = async (student) => {
    try {
      const isCurrentlyActive = student.status === 'ACTIVE';
      const newStatus = isCurrentlyActive ? 'BLOCKED' : 'ACTIVE';
      const dbStatus = isCurrentlyActive ? 'blocked' : 'active';
      const reason = isCurrentlyActive ? 'Restricted by administrator action' : 'Reinstated to good standing';

      // 1. Update Supabase Profile if UUID
      if (student.id && isUUID(student.id)) {
        await supabase
          .from('profiles')
          .update({
            status: dbStatus,
            blocked_reason: isCurrentlyActive ? reason : null,
            blocked_at: isCurrentlyActive ? new Date().toISOString() : null,
            no_show_count: isCurrentlyActive ? student.noShowCount : 0
          })
          .eq('id', student.id);
      }

      // 2. Update local storage database
      const users = await db.read('seatsync_users') || [];
      const target = users.find(u => u.id === student.id || u.collegeId === student.collegeId || u.email === student.email);
      if (target) {
        target.status = newStatus;
        if (!isCurrentlyActive) target.noShowCount = 0;
        await db.write('seatsync_users', users);
      }

      toast.success(`Updated status for ${student.name} to ${newStatus}.`);
      fetchStudents();
    } catch (err) {
      toast.error(err.message || 'Failed to update student status.');
    }
  };

  const filtered = students.filter(s =>
    (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.collegeId || s.identifier || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Student Account Management</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Register students, manage access status, and review standing metrics.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchStudents} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add New Student
          </Button>
        </div>
      </div>

      {/* Search Toolbar */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search student by name, College ID, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy"
          />
        </div>
      </Card>

      {/* Student Table */}
      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading student accounts...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No student records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">College ID</th>
                    <th className="p-3.5">Student Name</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">No-Shows</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id || s.email} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-indigo-600">{s.collegeId || s.identifier}</td>
                      <td className="p-3.5 font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 text-slate-500">{s.email}</td>
                      <td className="p-3.5 text-slate-500">{s.department || 'Computer Science'}</td>
                      <td className="p-3.5 font-bold">{s.noShowCount || 0} / 3</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${s.status === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          onClick={() => handleToggleStatus(s)}
                          variant="outline"
                          className="h-7 text-[11px] font-bold rounded-lg border-slate-300 text-slate-700 hover:bg-slate-100"
                        >
                          {s.status === 'ACTIVE' ? 'Block Access' : 'Unblock Access'}
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

      {/* Add Student Modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy">Add New Student Account</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Enter college credentials for the new student.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddStudent} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">College ID *</Label>
              <Input
                placeholder="e.g. 24AD099"
                value={newStudent.collegeId}
                onChange={(e) => setNewStudent({ ...newStudent, collegeId: e.target.value })}
                className="h-10 text-xs font-mono bg-slate-50 border-slate-300 text-navy"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Full Student Name *</Label>
              <Input
                placeholder="e.g. Rahul Kumar"
                value={newStudent.name}
                onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                className="h-10 text-xs bg-slate-50 border-slate-300 text-navy"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Email Address</Label>
              <Input
                type="email"
                placeholder="e.g. rahul@college.edu"
                value={newStudent.email}
                onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                className="h-10 text-xs bg-slate-50 border-slate-300 text-navy"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs">
                Create Student
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
