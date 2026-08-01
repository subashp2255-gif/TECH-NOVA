import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/shared/Dialog';
import { Button } from '../../components/shared/Button';
import { Label } from '../../components/shared/Label';
import { Input } from '../../components/shared/Input';
import { AlertTriangle, ShieldAlert, Calendar, Users, BookmarkX, Clock, CheckCircle2 } from 'lucide-react';
import { slotService } from '../../services/slotService';
import toast from 'react-hot-toast';

const REASON_OPTIONS = [
  'Library maintenance',
  'Staff unavailable',
  'Power or network issue',
  'Special event',
  'Emergency closure',
  'Low staffing',
  'Other'
];

export default function DisableSlotModal({ isOpen, onClose, slot, dateStr, adminUser, onSuccess }) {
  const [scope, setScope] = useState('SELECTED_DATE');
  const [startDate, setStartDate] = useState(dateStr || '');
  const [endDate, setEndDate] = useState(dateStr || '');
  const [reason, setReason] = useState('Library maintenance');
  const [customMessage, setCustomMessage] = useState('');
  const [confirmedNotice, setConfirmedNotice] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [loading, setLoading] = useState(false);

  const [impact, setImpact] = useState({
    affectedBookingsCount: 0,
    affectedWaitlistCount: 0,
    activeSessionsCount: 0
  });

  useEffect(() => {
    if (isOpen && slot) {
      setStartDate(dateStr);
      setEndDate(dateStr);
      setConfirmedNotice(false);
      setIsEmergency(false);
      fetchImpact(scope, dateStr, dateStr, dateStr);
    }
  }, [isOpen, slot, dateStr]);

  const fetchImpact = async (currScope, currDate, currStart, currEnd) => {
    if (!slot) return;
    try {
      const res = await slotService.getSlotImpactAnalysis({
        slotId: slot.id,
        dateStr: currDate,
        scope: currScope,
        startDate: currStart,
        endDate: currEnd
      });
      setImpact(res);
    } catch {
      /* silent */
    }
  };

  const handleScopeChange = (newScope) => {
    setScope(newScope);
    fetchImpact(newScope, dateStr, startDate, endDate);
  };

  const handleDisable = async () => {
    if (reason === 'Other' && !customMessage.trim()) {
      toast.error('Please specify a custom reason.');
      return;
    }

    if (!confirmedNotice) {
      toast.error('Please check the confirmation box to proceed.');
      return;
    }

    if (impact.activeSessionsCount > 0 && !isEmergency) {
      toast.error('Active checked-in sessions exist. Check Emergency Closure to end active sessions.');
      return;
    }

    setLoading(true);
    try {
      const res = await slotService.disableSlotOccurrence({
        slotId: slot.id,
        slotName: slot.label,
        dateStr,
        scope,
        startDate,
        endDate,
        reason,
        customMessage,
        adminUser,
        isEmergency
      });

      toast.success(`${slot.label} disabled successfully. ${res.cancelledBookingCount} bookings cancelled and ${res.notifiedStudentsCount} students notified.`);
      if (onSuccess) onSuccess(res);
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Failed to disable slot.');
    } finally {
      setLoading(false);
    }
  };

  if (!slot) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg bg-white rounded-3xl p-6 space-y-5 border border-slate-200 shadow-2xl">
        <DialogHeader className="space-y-1 text-left">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-navy">
                Disable {slot.label}?
              </DialogTitle>
              <p className="text-xs text-slate-500 font-medium">
                {slot.startTime} – {slot.endTime} • Date: <span className="font-bold text-navy">{dateStr}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Impact Analysis Cards */}
        <div className="grid grid-cols-3 gap-2.5 p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80">
          <div className="text-center p-2 rounded-xl bg-white border border-slate-200/60 shadow-xs">
            <span className="block text-lg font-black text-amber-600">{impact.affectedBookingsCount}</span>
            <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
              <BookmarkX size={11} /> Bookings
            </span>
          </div>

          <div className="text-center p-2 rounded-xl bg-white border border-slate-200/60 shadow-xs">
            <span className="block text-lg font-black text-purple-600">{impact.affectedWaitlistCount}</span>
            <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
              <Users size={11} /> Waitlisted
            </span>
          </div>

          <div className="text-center p-2 rounded-xl bg-white border border-slate-200/60 shadow-xs">
            <span className={`block text-lg font-black ${impact.activeSessionsCount > 0 ? 'text-red-600 animate-pulse' : 'text-slate-700'}`}>
              {impact.activeSessionsCount}
            </span>
            <span className="text-[10px] font-bold text-slate-500 flex items-center justify-center gap-1">
              <Clock size={11} /> Active Now
            </span>
          </div>
        </div>

        {/* Active Checked-in Sessions Warning */}
        {impact.activeSessionsCount > 0 && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl text-xs space-y-2">
            <div className="flex items-center gap-2 font-extrabold text-amber-800">
              <ShieldAlert size={16} className="text-amber-600 shrink-0" />
              <span>Active Checked-in Students Detected ({impact.activeSessionsCount})</span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-700 font-medium">
              Students are currently occupying seats in this slot. Standard disable will preserve their session until completed unless Emergency Closure is enabled below.
            </p>
            <label className="flex items-center gap-2 text-xs font-bold text-red-700 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={isEmergency}
                onChange={(e) => setIsEmergency(e.target.checked)}
                className="rounded text-red-600 border-amber-400 h-4 w-4"
              />
              Force Emergency Closure (Ends active sessions gracefully with zero student penalty)
            </label>
          </div>
        )}

        {/* Scope Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-bold text-slate-700">Disable Scope</Label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'SELECTED_DATE', label: 'Selected Date', desc: dateStr },
              { id: 'DATE_RANGE', label: 'Date Range', desc: 'Custom range' },
              { id: 'ALL_FUTURE', label: 'All Future', desc: 'Until re-enabled' }
            ].map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleScopeChange(item.id)}
                className={`p-2.5 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                  scope === item.id 
                    ? 'border-brandBlue bg-blue-50/80 text-brandBlue font-bold shadow-xs' 
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="block font-bold">{item.label}</span>
                <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{item.desc}</span>
              </button>
            ))}
          </div>

          {scope === 'DATE_RANGE' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <Label className="text-[10px] font-bold text-slate-500">Start Date</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); fetchImpact('DATE_RANGE', dateStr, e.target.value, endDate); }}
                  className="h-9 text-xs font-mono"
                />
              </div>
              <div>
                <Label className="text-[10px] font-bold text-slate-500">End Date</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); fetchImpact('DATE_RANGE', dateStr, startDate, e.target.value); }}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>
          )}
        </div>

        {/* Reason Selector */}
        <div className="space-y-2">
          <Label htmlFor="disable-reason" className="text-xs font-bold text-slate-700">Reason for Disabling</Label>
          <select
            id="disable-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-10 px-3 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 bg-white focus:ring-2 focus:ring-brandBlue/20 focus:border-brandBlue"
          >
            {REASON_OPTIONS.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>

          {reason === 'Other' && (
            <Input
              placeholder="Provide a specific written explanation..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="h-10 text-xs font-semibold mt-1"
              required
            />
          )}
        </div>

        {/* Required Confirmation Checkbox */}
        <div className="pt-1 border-t border-slate-100">
          <label className="flex items-start gap-2.5 text-xs text-slate-700 font-semibold cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmedNotice}
              onChange={(e) => setConfirmedNotice(e.target.checked)}
              className="mt-0.5 rounded text-red-600 focus:ring-red-500 border-slate-300 h-4 w-4 shrink-0"
            />
            <span>I understand that affected students will be notified and reservations marked <strong>Cancelled by Library</strong>.</span>
          </label>
        </div>

        {/* Dialog Action Buttons */}
        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="h-10 text-xs font-bold rounded-xl"
          >
            Keep Slot Active
          </Button>
          <Button
            type="button"
            onClick={handleDisable}
            disabled={loading || !confirmedNotice}
            className="h-10 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-md shadow-red-500/20 flex items-center gap-1.5 cursor-pointer"
          >
            {loading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Disabling Slot...
              </>
            ) : (
              <>
                <AlertTriangle size={15} /> Disable Slot & Notify
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
