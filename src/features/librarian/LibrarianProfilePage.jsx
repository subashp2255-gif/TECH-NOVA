import React from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Card, CardContent } from '../../components/shared/Card';
import { Badge } from '../../components/shared/Badge';
import { User, Mail, ShieldCheck, Building2, Key } from 'lucide-react';

export default function LibrarianProfilePage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Staff Account Profile</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Librarian credentials & system administration clearance details.
        </p>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-teal-600 text-white font-black text-2xl flex items-center justify-center shadow-md">
            {(user?.name || 'L').charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-xl font-bold text-navy">{user?.name || 'Librarian Officer'}</h2>
            <p className="text-xs font-mono text-teal-700 font-bold">{user?.staffId || user?.identifier || 'LIB001'}</p>
            <Badge className="bg-teal-100 text-teal-800 border-teal-300 font-bold text-[10px] uppercase mt-1">
              Authorized Staff Officer
            </Badge>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-3 text-xs">
          <div className="flex justify-between items-center"><span className="text-slate-500">Email:</span> <strong className="text-navy">{user?.email || 'librarian@college.edu'}</strong></div>
          <div className="flex justify-between items-center"><span className="text-slate-500">Department:</span> <strong className="text-navy">{user?.department || 'Library Operations & Access Control'}</strong></div>
          <div className="flex justify-between items-center"><span className="text-slate-500">Role Authority:</span> <strong className="text-teal-700">LIBRARIAN / STAFF</strong></div>
        </div>
      </Card>
    </div>
  );
}
