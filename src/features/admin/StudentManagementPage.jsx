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
import { Search, Plus, RefreshCw, UserCheck, ShieldAlert, GraduationCap } from 'lucide-react';
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
    department: 'Computer Science & Engineering',
    yearOfStudy: '2'
  });

  const fetchStudents = async () => {
    try {
      setLoading(true);

      let dbStudents = [];

      // 1. Fetch real Supabase profiles via get_admin_students_list RPC or profiles table
      try {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_admin_students_list');
        if (!rpcErr && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
          dbStudents = rpcData.map(p => ({
            id: p.id,
            collegeId: p.registration_number || p.email?.split('@')[0] || p.id?.substring(0, 12),
            identifier: p.registration_number || p.email,
            name: p.full_name || p.email?.split('@')[0] || 'Student',
            email: p.email,
            department: p.department || 'Computer Science & Engineering',
            yearOfStudy: p.year_of_study || 1,
            noShowCount: p.no_show_count || 0,
            status: String(p.status || 'active').toUpperCase(),
            createdAt: p.created_at,
            lastLoginAt: p.last_login_at
          }));
        } else {
          // Direct profiles table select fallback
          const { data, error } = await supabase.from('profiles').select('*');
          if (!error && data && Array.isArray(data)) {
            const studentRows = data.filter(p => {
              const r = String(p.role || 'student').toLowerCase();
              return !['admin', 'super_admin', 'librarian', 'senior_librarian', 'support_staff'].includes(r);
            });

            dbStudents = studentRows.map(p => ({
              id: p.id,
              collegeId: p.registration_number || p.login_identifier || p.id?.substring(0, 12),
              identifier: p.registration_number || p.email,
              name: p.full_name || p.email?.split('@')[0] || 'Student',
              email: p.email,
              department: p.department || 'Computer Science & Engineering',
              yearOfStudy: p.year_of_study || 1,
              noShowCount: p.no_show_count || 0,
              status: String(p.status || p.account_status || 'active').toUpperCase(),
              createdAt: p.created_at,
              lastLoginAt: p.last_login_at
            }));
          }
        }
      } catch (err) {
        console.warn('Supabase student profiles fetch notice:', err);
      }

      // 2. Fetch from local mock/storage database fallback
      let localStudents = [];
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
            yearOfStudy: u.yearOfStudy || 1,
            noShowCount: u.noShowCount || u.no_show_count || 0,
            status: String(u.status || 'ACTIVE').toUpperCase(),
            createdAt: u.createdAt
          }));
      } catch { /* ignore */ }

      // 3. Merge databases, deduplicating by email or collegeId
      const mergedMap = new Map();

      // Database profiles have highest precedence
      dbStudents.forEach(s => {
        const key = (s.email || s.collegeId || s.id).toLowerCase();
        mergedMap.set(key, s);
      });

      // Local storage fallback users
      localStudents.forEach(s => {
        const key = (s.email || s.collegeId || s.id).toLowerCase();
        if (!mergedMap.has(key)) {
          mergedMap.set(key, s);
        } else {
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
      const email = newStudent.email.trim().toLowerCase() || `${cleanCollegeId.toLowerCase()}@college.edu`;

      // 1. Try Supabase Auth Signup
      const { data: authData } = await supabase.auth.signUp({
        email,
        password: newStudent.password || 'student123',
        options: {
          data: {
            full_name: cleanName,
            registration_number: cleanCollegeId,
            department: newStudent.department,
            year_of_study: Number(newStudent.yearOfStudy || 1),
            role: 'student'
          }
        }
      });

      // If user created or ID available, update profiles table directly
      if (authData?.user?.id) {
        try {
          await supabase.from('profiles').upsert({
            id: authData.user.id,
            full_name: cleanName,
            email,
            registration_number: cleanCollegeId,
            login_identifier: email,
            department: newStudent.department,
            year_of_study: Number(newStudent.yearOfStudy || 1),
            role: 'student',
            status: 'active',
            updated_at: new Date().toISOString()
          });
        } catch { /* proceed */ }
      }

      // 2. Save to local storage database so student can log in instantly
      const users = await db.read('seatsync_users') || [];
      const created = {
        id: authData?.user?.id || `USR-${Date.now()}`,
        identifier: cleanCollegeId,
        collegeId: cleanCollegeId,
        registration_number: cleanCollegeId,
        name: cleanName,
        email,
        password: newStudent.password || 'student123',
        role: 'STUDENT',
        status: 'ACTIVE',
        department: newStudent.department,
        yearOfStudy: Number(newStudent.yearOfStudy || 1),
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

      toast.success(`Student ${cleanName} (${cleanCollegeId}) registered successfully!`);
      setAddModalOpen(false);
      setNewStudent({ collegeId: '', name: '', email: '', password: 'student123', department: 'Computer Science & Engineering', yearOfStudy: '2' });
      fetchStudents();
    } catch (err) {
      toast.error(err.message || 'Failed to register student account.');
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
        try {
          await supabase.rpc('admin_toggle_student_status', {
            p_student_id: student.id,
            p_new_status: dbStatus,
            p_reason: reason
          });
        } catch {
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
    (s.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.department || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <GraduationCap className="text-indigo-600" size={28} />
            <span>Student Account Management</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Registered student details fetched from <code className="text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded-md font-mono">public.profiles</code> table.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchStudents} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl h-9 shadow-sm">
            <Plus size={16} className="mr-1.5" /> Register New Student
          </Button>
        </div>
      </div>

      {/* Search Toolbar */}
      <Card className="border border-slate-200/90 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by student name, Reg/College ID, email, or department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy font-medium"
          />
        </div>
      </Card>

      {/* Student Table */}
      <Card className="border border-slate-200/90 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">
              Fetching student profiles from public.profiles table...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 font-mono italic">
              No matching student records found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Registration / College ID</th>
                    <th className="p-3.5">Student Name</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Year</th>
                    <th className="p-3.5">No-Shows</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id || s.email} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-indigo-600">{s.collegeId || s.identifier}</td>
                      <td className="p-3.5 font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 text-slate-500 font-mono">{s.email}</td>
                      <td className="p-3.5 text-slate-600 font-medium">{s.department || 'Computer Science & Engineering'}</td>
                      <td className="p-3.5 font-mono font-bold text-slate-700">Year {s.yearOfStudy || 1}</td>
                      <td className="p-3.5 font-bold text-slate-700">{s.noShowCount || 0} / 3</td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${s.status === 'ACTIVE' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          onClick={() => handleToggleStatus(s)}
                          variant="outline"
                          className={`h-7 text-[11px] font-bold rounded-lg ${
                            s.status === 'ACTIVE'
                              ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
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
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
              <UserCheck className="text-indigo-600" size={20} />
              <span>Register New Student Account</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Creates auth account and profile row in public.profiles table.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddStudent} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Registration / College ID *</Label>
              <Input
                placeholder="e.g. 7376252AD344"
                value={newStudent.collegeId}
                onChange={(e) => setNewStudent({ ...newStudent, collegeId: e.target.value })}
                className="h-10 text-xs font-mono bg-slate-50 border-slate-300 text-navy font-bold"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Full Student Name *</Label>
              <Input
                placeholder="e.g. Subash P"
                value={newStudent.name}
                onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                className="h-10 text-xs bg-slate-50 border-slate-300 text-navy font-semibold"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Email Address *</Label>
              <Input
                type="email"
                placeholder="e.g. subash@bitsathy.ac.in"
                value={newStudent.email}
                onChange={(e) => setNewStudent({ ...newStudent, email: e.target.value })}
                className="h-10 text-xs bg-slate-50 border-slate-300 text-navy font-medium"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Department</Label>
                <select
                  value={newStudent.department}
                  onChange={(e) => setNewStudent({ ...newStudent, department: e.target.value })}
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
                >
                  <option value="Computer Science & Engineering">CSE</option>
                  <option value="AI & Data Science">AI & DS</option>
                  <option value="Electronics & Communication">ECE</option>
                  <option value="Information Technology">IT</option>
                  <option value="Mechanical Engineering">Mech</option>
                  <option value="Electrical & Electronics">EEE</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-slate-700">Year</Label>
                <select
                  value={newStudent.yearOfStudy}
                  onChange={(e) => setNewStudent({ ...newStudent, yearOfStudy: e.target.value })}
                  className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white text-navy"
                >
                  <option value="1">1st Year</option>
                  <option value="2">2nd Year</option>
                  <option value="3">3rd Year</option>
                  <option value="4">4th Year</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs font-bold">
                Cancel
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm">
                Save & Register Profile →
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
