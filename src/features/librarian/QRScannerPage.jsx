import React, { useState } from 'react';
import { db } from '../../services/mockDatabase';
import { librarianService } from '../../services/librarianService';
import { waitlistService } from '../../services/waitlistService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import {
  QrCode, CheckCircle2, AlertTriangle, Search, LogOut, ArrowRight,
  UserCheck, ShieldCheck, Clock, Camera, CameraOff
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function QRScannerPage() {
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);

  const handleVerifyToken = async (e) => {
    if (e) e.preventDefault();
    if (!tokenInput.trim()) {
      toast.error('Please enter a valid QR token, Register ID, or Booking Code.');
      return;
    }

    setLoading(true);
    setScanResult(null);

    try {
      const res = await librarianService.verifyToken(tokenInput.trim());
      setScanResult(res);
      toast.success(res.isCheckout ? 'Checkout QR verified!' : 'Entry Pass QR verified!');
    } catch (err) {
      setScanResult({
        valid: false,
        message: err.message || 'Invalid or expired QR token.'
      });
      toast.error(err.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleCamera = () => {
    setIsCameraActive(prev => {
      const nextState = !prev;
      if (nextState) toast.success('Camera scanner activated. Point at student QR code.');
      else toast.success('Camera scanner stopped.');
      return nextState;
    });
  };

  const handleConfirmCheckout = async (booking) => {
    setLoading(true);
    try {
      await librarianService.processCheckOut(booking.id, { name: 'Librarian Staff' });
      toast.success(`Checkout completed for ${booking.studentName}. Seat ${booking.seatNumber} released!`);
      setScanResult(null);
      setTokenInput('');
    } catch (err) {
      toast.error(err.message || 'Failed to complete checkout.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEntry = async (booking) => {
    setLoading(true);
    try {
      await librarianService.processCheckIn(booking.id, { name: 'Librarian Staff' }, 'Entry Pass Verified');
      toast.success(`Entry verified for ${booking.studentName}! Seat ${booking.seatNumber} occupied.`);
      setScanResult(null);
      setTokenInput('');
    } catch (err) {
      toast.error(err.message || 'Failed to process entry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
          <QrCode className="text-teal-600" size={28} /> QR Pass Scanner & Entry Verification
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Scan student Entry QR passes, checkout QR tokens, or search by student register number.
        </p>
      </div>

      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 sm:p-8 space-y-6 shadow-xs">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center mx-auto shadow-sm">
            <QrCode size={36} />
          </div>
          <h2 className="text-xl font-extrabold text-navy">Scan or Input Student Token</h2>
          <p className="text-xs text-slate-500 font-medium max-w-md mx-auto">
            Use camera scanner or type token / Register ID below.
          </p>

          <Button
            type="button"
            variant="outline"
            onClick={toggleCamera}
            className={`h-10 text-xs font-bold rounded-xl border-slate-300 ${
              isCameraActive ? 'bg-red-50 text-red-600 border-red-200' : 'bg-slate-100 text-teal-700 hover:bg-slate-200'
            }`}
          >
            {isCameraActive ? <CameraOff size={16} className="mr-1.5" /> : <Camera size={16} className="mr-1.5" />}
            {isCameraActive ? 'Stop Camera Scanner' : 'Start Camera Scanner'}
          </Button>
        </div>

        {isCameraActive && (
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-center space-y-3 animate-in fade-in">
            <div className="w-full max-w-sm h-48 bg-white border-2 border-dashed border-teal-500/60 rounded-xl mx-auto flex flex-col items-center justify-center gap-2 text-slate-500 text-xs font-mono">
              <Camera size={32} className="text-teal-600 animate-pulse" />
              <span>Camera Feed Active (Point at QR)</span>
            </div>
          </div>
        )}

        <form onSubmit={handleVerifyToken} className="space-y-4 max-w-md mx-auto">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g. BK-1785..., 24AD042, or QR Token..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="h-11 font-mono text-xs bg-slate-50 border-slate-300 text-navy focus:border-teal-600 rounded-xl"
            />
            <Button
              type="submit"
              disabled={loading}
              className="h-11 px-5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs shrink-0"
            >
              {loading ? 'Verifying...' : 'Verify Token'}
            </Button>
          </div>
        </form>

        {scanResult && (
          <div className="pt-4 border-t border-slate-100 max-w-md mx-auto space-y-4 animate-in fade-in">
            {!scanResult.valid ? (
              <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-3">
                <AlertTriangle size={20} className="shrink-0 text-red-600" />
                <span>{scanResult.message}</span>
              </div>
            ) : (
              <div className="p-5 bg-slate-50 border-2 border-teal-500/60 text-navy rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Badge className={`text-xs font-bold ${scanResult.isCheckout ? 'bg-amber-600 text-white' : 'bg-teal-600 text-white'}`}>
                    {scanResult.isCheckout ? 'Checkout Token Verified' : 'Entry Pass Verified'}
                  </Badge>
                  <span className="text-xs font-mono font-bold text-slate-500">ID: {scanResult.booking.id}</span>
                </div>

                <div className="space-y-1 text-xs font-mono">
                  <p className="font-extrabold text-navy text-sm font-sans">{scanResult.booking.studentName}</p>
                  <p className="text-slate-500">College ID: {scanResult.booking.studentCollegeId || scanResult.booking.collegeId || '24AD042'}</p>
                  <p className="text-slate-700 font-bold">Seat: <span className="text-teal-600">{scanResult.booking.seatNumber}</span> ({scanResult.booking.floorName || 'Ground Floor'})</p>
                  <p className="text-slate-500">Slot: {scanResult.booking.slotTime}</p>
                </div>

                {scanResult.isCheckout ? (
                  <Button
                    onClick={() => handleConfirmCheckout(scanResult.booking)}
                    disabled={loading}
                    className="w-full h-10 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Confirm Student Checkout & Release Seat →
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleConfirmEntry(scanResult.booking)}
                    disabled={loading}
                    className="w-full h-10 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Confirm Entry & Mark Checked In →
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
