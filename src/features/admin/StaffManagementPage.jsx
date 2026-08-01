import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { UserCheck, Plus, Search, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StaffManagementPage() {
  const [staffList, setStaffList] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newStaff, setNewStaff] = useState({
    staffId: '',
    name: '',
    email: '',
    password: 'staff123',
    department: 'Library Operations'
  });

  const fetchStaff = async () => {
    try {
      setLoading(true);
      const users = await db.read('seatsync_users') || [];
      setStaffList(users.filter(u => u.role === 'LIBRARIAN' || u.role === 'STAFF'));
    } catch {
      toast.error('Failed to load staff list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchStaff();
  });

  const handleAddStaff = async (e) => {
    e.preventDefault();
    if (!newStaff.staffId.trim() || !newStaff.name.trim()) {
      toast.error('Please enter Staff ID and Name.');
      return;
    }

    try {
      const users = await db.read('seatsync_users') || [];
      const exists = users.find(u => u.staffId === newStaff.staffId.trim() || u.identifier === newStaff.staffId.trim());
      if (exists) {
        toast.error('A staff account with this Staff ID already exists.');
        return;
      }

      const created = {
        id: `USR-${Date.now()}`,
        identifier: newStaff.staffId.trim(),
        staffId: newStaff.staffId.trim(),
        name: newStaff.name.trim(),
        email: newStaff.email.trim() || `${newStaff.staffId.trim().toLowerCase()}@college.edu`,
        password: newStaff.password || 'staff123',
        role: 'LIBRARIAN',
        status: 'ACTIVE',
        department: newStaff.department,
        createdAt: new Date().toISOString()
      };

      users.push(created);
      await db.write('seatsync_users', users);
      toast.success(`Staff account ${created.name} created successfully!`);
      setAddModalOpen(false);
      setNewStaff({ staffId: '', name: '', email: '', password: 'staff123', department: 'Library Operations' });
      fetchStaff();
    } catch {
      toast.error('Failed to add staff account.');
    }
  };

  const filtered = staffList.filter(s =>
    (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.staffId || s.identifier || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.email || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Staff & Librarian Accounts</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Manage library staff credentials and scanner access privileges.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchStaff} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add Staff Officer
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search staff by name, Staff ID, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300"
          />
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading staff accounts...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No staff accounts found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Staff ID</th>
                    <th className="p-3.5">Staff Name</th>
                    <th className="p-3.5">Email</th>
                    <th className="p-3.5">Department</th>
                    <th className="p-3.5">Role</th>
                    <th className="p-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-teal-700">{s.staffId || s.identifier}</td>
                      <td className="p-3.5 font-bold text-navy">{s.name}</td>
                      <td className="p-3.5 text-slate-500">{s.email}</td>
                      <td className="p-3.5 text-slate-500">{s.department || 'Library Operations'}</td>
                      <td className="p-3.5">
                        <Badge className="bg-teal-100 text-teal-800 border-teal-300 font-bold text-[10px]">
                          Librarian
                        </Badge>
                      </td>
                      <td className="p-3.5">
                        <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                          {s.status || 'ACTIVE'}
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

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy">Add New Staff Officer</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Create librarian credentials for QR pass validation and seat management.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddStaff} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Staff ID</Label>
              <Input
                placeholder="e.g. LIB002"
                value={newStaff.staffId}
                onChange={(e) => setNewStaff({ ...newStaff, staffId: e.target.value })}
                className="h-10 text-xs font-mono"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Full Staff Name</Label>
              <Input
                placeholder="e.g. Anitha M"
                value={newStaff.name}
                onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                className="h-10 text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Email Address</Label>
              <Input
                type="email"
                placeholder="e.g. anitha@college.edu"
                value={newStaff.email}
                onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                className="h-10 text-xs"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs">
                Create Staff Officer
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
