import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, Mail, HelpCircle } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { Card, CardContent } from '../components/shared/Card';
import { useAuth } from '../auth/AuthProvider';

export default function AccountBlockedPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleReturnToLogin = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[140px] pointer-events-none" />

      <Card className="w-full max-w-md border border-red-500/20 bg-slate-900/90 text-white rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 relative z-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 flex items-center justify-center mx-auto shadow-lg shadow-red-500/10">
          <ShieldAlert size={36} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-black text-white tracking-tight">Account Blocked</h1>
          <p className="text-xs text-slate-400 font-medium leading-relaxed max-w-sm mx-auto">
            Your SeatSync account has been blocked by the library administration due to a policy violation or security restriction.
          </p>
        </div>

        <div className="bg-red-950/40 border border-red-800/40 rounded-2xl p-4 text-xs space-y-1 text-red-200 text-left">
          <span className="text-[10px] uppercase font-bold text-red-400 tracking-wider block">Access Status</span>
          <p className="font-semibold">Account Status: <strong className="text-red-400">BLOCKED</strong></p>
          <p className="text-[11px] text-slate-300">All active bookings have been cancelled and dashboard access is restricted.</p>
        </div>

        <div className="space-y-3 pt-2">
          <Button
            onClick={handleReturnToLogin}
            className="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
          >
            <LogOut size={16} /> Return to Login
          </Button>

          <p className="text-[11px] text-slate-500 font-medium">
            If you believe this is an error, please contact library administration at{' '}
            <a href="mailto:support@library.edu" className="text-slate-300 underline font-semibold">
              support@library.edu
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}
