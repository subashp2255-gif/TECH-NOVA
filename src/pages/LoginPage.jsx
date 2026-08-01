import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { authService } from '../services/authService';
import { Card, CardContent } from '../components/shared/Card';
import { Button } from '../components/shared/Button';
import { Input } from '../components/shared/Input';
import { Label } from '../components/shared/Label';
import { Eye, EyeOff, Lock, User, ShieldCheck, Sparkles, BookOpen, AlertCircle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-redirect if already logged in
  useEffect(() => {
    if (user) {
      const dest = authService.getDashboardRoute(user.role);
      navigate(dest, { replace: true });
    }
  }, [user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');

    if (!identifier.trim() || !password.trim()) {
      setErrorMsg('Please enter both your ID / Email and password.');
      toast.error('Please enter all required fields.');
      return;
    }

    setLoading(true);
    try {
      const loggedInUser = await login(identifier, password);
      toast.success(`Welcome back, ${loggedInUser.name}!`);
      const dest = authService.getDashboardRoute(loggedInUser.role);
      navigate(dest, { replace: true });
    } catch (err) {
      const msg = err?.message || 'Invalid credentials. Please check your ID and password.';
      setErrorMsg(msg);
      toast.error(msg);
    } fontFinally: {
      setLoading(false);
    }
  };

  const autofillDemo = (id, pass) => {
    setIdentifier(id);
    setPassword(pass);
    setErrorMsg('');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-navy to-indigo-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Decorative Glows */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Logo & Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-brandBlue to-indigo-500 text-white shadow-xl shadow-brandBlue/30 mb-2 border border-white/20">
            <BookOpen size={28} />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">SeatSync</h1>
          <p className="text-xs font-semibold text-blue-200/80 uppercase tracking-widest">Smart Library Booking System</p>
        </div>

        {/* Login Card */}
        <Card className="border-white/10 bg-white/95 backdrop-blur-xl shadow-2xl rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1 text-center sm:text-left">
            <h2 className="text-xl font-black text-navy">Welcome to SeatSync</h2>
            <p className="text-xs text-slate-500 font-medium">
              Sign in with your college or staff credentials to continue.
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-start gap-2 animate-in fade-in">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identifier Input */}
            <div className="space-y-1.5">
              <Label htmlFor="identifier" className="text-xs font-bold text-slate-700">
                College ID, Staff ID or Email
              </Label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input
                  id="identifier"
                  type="text"
                  placeholder="e.g. 24AD042, LIB001, or ADM001"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="pl-10 h-11 border-slate-300 focus:border-brandBlue focus:ring-2 focus:ring-brandBlue/20 rounded-xl text-xs font-semibold"
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-bold text-slate-700">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-11 border-slate-300 focus:border-brandBlue focus:ring-2 focus:ring-brandBlue/20 rounded-xl text-xs font-semibold"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 text-xs text-slate-600 font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded text-brandBlue focus:ring-brandBlue border-slate-300 h-4 w-4"
                />
                Remember me
              </label>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-xs font-bold bg-gradient-to-r from-brandBlue to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl shadow-lg shadow-brandBlue/25 flex items-center justify-center gap-2 transition-all mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  Sign In <ArrowRight size={16} />
                </>
              )}
            </Button>
          </form>

          {/* Quick Demo Credentials Helper */}
          <div className="border-t border-slate-200/80 pt-4 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center flex items-center justify-center gap-1">
              <Sparkles size={11} className="text-amber-500" /> Demo Quick Select (Hackathon)
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => autofillDemo('24AD042', 'student123')}
                className="p-2 rounded-xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors text-center cursor-pointer"
              >
                <span className="block text-[10px] font-extrabold text-blue-900">Student</span>
                <span className="text-[9px] font-mono text-blue-700">24AD042</span>
              </button>
              <button
                type="button"
                onClick={() => autofillDemo('LIB001', 'staff123')}
                className="p-2 rounded-xl bg-teal-50 border border-teal-200 hover:bg-teal-100 transition-colors text-center cursor-pointer"
              >
                <span className="block text-[10px] font-extrabold text-teal-900">Librarian</span>
                <span className="text-[9px] font-mono text-teal-700">LIB001</span>
              </button>
              <button
                type="button"
                onClick={() => autofillDemo('ADM001', 'admin123')}
                className="p-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 transition-colors text-center cursor-pointer"
              >
                <span className="block text-[10px] font-extrabold text-indigo-900">Admin</span>
                <span className="text-[9px] font-mono text-indigo-700">ADM001</span>
              </button>
            </div>
          </div>
        </Card>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-400 font-medium">
          SeatSync Library Management • Safe Role-Based Session
        </p>
      </div>
    </div>
  );
}
