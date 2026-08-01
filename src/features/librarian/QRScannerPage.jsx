import React, { useState } from 'react';
import { db } from '../../services/mockDatabase';
import { waitlistService } from '../../services/waitlistService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { QrCode, CheckCircle2, AlertTriangle, Search, LogOut, ArrowRight, UserCheck, ShieldCheck, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function QRScannerPage() {
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const handleVerifyToken = async (e) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      toast.error('Please enter a valid QR token or Booking ID.');
      return;
    }

    setLoading(true);
    setScanResult(null);

    try {
      const cleanToken = tokenInput.trim();
      const bookings = await db.read('seatsync_bookings') || [];
      
      // Match by raw ID, PASS token, or CKOUT token
      const matched = bookings.find(b => 
        String(b.id) === cleanToken || 
        cleanToken.includes(String(b.id)) ||
        (b.id && cleanToken.toLowerCase().includes(String(b.id).toLowerCase()))
      );

      if (!matched) {
        setScanResult({
          valid: false,
          message: `No active reservation found for token "${cleanToken}".`
        });
        toast.error('Invalid or expired QR token.');
        return;
      }

      const isCheckout = cleanToken.includes('CKOUT') || matched.status === 'checkout_pending';
      setScanResult({
        valid: true,
        isCheckout,
        booking: matched
      });
      toast.success(isCheckout ? 'Checkout QR verified!' : 'Entry Pass QR verified!');
    } catch (err) {
      toast.error('Verification failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCheckout = async (booking) => {
    setLoading(true);
    try {
      const bookings = await db.read('seatsync_bookings') || [];
      const target = bookings.find(b => b.id === booking.id);
      if (target) {
        target.status = 'completed';
        target.checkedOutAt = new Date().toISOString();
        await db.write('seatsync_bookings', bookings);
      }

      // Check if someone is waiting on waitlist for this slot!
      if (booking.slotId) {
        const dateStr = booking.bookingDate || new Date().toISOString().split('T')[0];
        await waitlistService.notifyNextStudent(dateStr, booking.slotId);
      }

      toast.success(`Checkout completed for ${booking.studentName}. Seat ${booking.seatNumber} is now free!`);
      setScanResult(null);
      setTokenInput('');
    } catch (err) {
      toast.error('Failed to complete checkout.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEntry = async (booking) => {
    setLoading(true);
    try {
      const bookings = await db.read('seatsync_bookings') || [];
      const target = bookings.find(b => b.id === booking.id);
      if (target) {
        target.status = 'active';
        target.checkedInAt = new Date().toISOString();
        await db.write('seatsync_bookings', bookings);
      }
      toast.success(`Entry verified for ${booking.studentName}! Seat ${booking.seatNumber} occupied.`);
      setScanResult(null);
      setTokenInput('');
    } catch (err) {
      toast.error('Failed to process entry.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">QR Pass Scanner & Entry Counter</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Verify student Entry QR passes and process Checkout QR requests to liberate seats.
        </p>
      </div>

      <Card className="border-2 border-teal-200 bg-white rounded-3xl p-6 sm:p-8 space-y-6 shadow-md">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 text-teal-600 border border-teal-200 flex items-center justify-center mx-auto shadow-sm">
            <QrCode size={36} />
          </div>
          <h2 className="text-xl font-extrabold text-navy">Scan or Enter Student QR Token</h2>
          <p className="text-xs text-slate-500 font-medium max-w-md mx-auto">
            Scan with a handheld QR scanner or manually paste the Pass Token / Booking ID below.
          </p>
        </div>

        <form onSubmit={handleVerifyToken} className="space-y-4 max-w-md mx-auto">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g. BK-1785... or CKOUT-BK-..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="h-11 font-mono text-xs border-slate-300 focus:border-teal-500 focus:ring-teal-500/20 rounded-xl"
            />
            <Button
              type="submit"
              disabled={loading}
              className="h-11 px-5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-md shrink-0"
            >
              {loading ? 'Verifying...' : 'Verify Token'}
            </Button>
          </div>
        </form>

        {scanResult && (
          <div className="pt-4 border-t border-slate-100 max-w-md mx-auto space-y-4 animate-in fade-in">
            {!scanResult.valid ? (
              <div className="p-4 bg-red-50 border border-red-200 text-red-700 text-xs rounded-2xl flex items-center gap-3">
                <AlertTriangle size={20} className="shrink-0 text-red-500" />
                <span>{scanResult.message}</span>
              </div>
            ) : (
              <div className="p-5 bg-emerald-50/70 border-2 border-emerald-300 text-emerald-950 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <Badge className={`text-xs font-bold ${scanResult.isCheckout ? 'bg-amber-500 text-white' : 'bg-emerald-600 text-white'}`}>
                    {scanResult.isCheckout ? 'Checkout Request Verified' : 'Entry Pass Verified'}
                  </Badge>
                  <span className="text-xs font-mono font-bold text-slate-500">ID: {scanResult.booking.id}</span>
                </div>

                <div className="space-y-1 text-xs">
                  <p className="font-extrabold text-navy text-sm">{scanResult.booking.studentName}</p>
                  <p className="text-slate-600 font-mono">College ID: {scanResult.booking.collegeId || scanResult.booking.studentCollegeId || '24AD042'}</p>
                  <p className="text-slate-600 font-bold">Seat: <span className="text-teal-700">{scanResult.booking.seatNumber}</span> ({scanResult.booking.floorName || 'Ground Floor'})</p>
                  <p className="text-slate-600 font-mono">Slot: {scanResult.booking.slotTime}</p>
                </div>

                {scanResult.isCheckout ? (
                  <Button
                    onClick={() => handleConfirmCheckout(scanResult.booking)}
                    disabled={loading}
                    className="w-full h-10 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-sm"
                  >
                    Confirm Student Checkout & Release Seat →
                  </Button>
                ) : (
                  <Button
                    onClick={() => handleConfirmEntry(scanResult.booking)}
                    disabled={loading}
                    className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm"
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
