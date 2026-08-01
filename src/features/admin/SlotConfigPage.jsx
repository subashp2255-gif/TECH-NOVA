import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { slotService } from '../../services/slotService';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Layers, Clock, RefreshCw, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import DisableSlotModal from './DisableSlotModal';
import { format, addDays } from 'date-fns';
import toast from 'react-hot-toast';

export default function SlotConfigPage() {
  const { user } = useAuth();
  const [slots, setSlots] = useState([]);
  const [floors, setFloors] = useState([]);
  const [disabledList, setDisabledList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected date for slot inspection
  const tomorrowDateStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(tomorrowDateStr);

  // Modal State
  const [selectedSlotForDisable, setSelectedSlotForDisable] = useState(null);
  const [isDisableModalOpen, setIsDisableModalOpen] = useState(false);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const [slotsData, floorsData, disabledData] = await Promise.all([
        db.read('seatsync_slots') || [],
        db.read('seatsync_floors') || [],
        slotService.getDisabledOccurrences()
      ]);
      setSlots(slotsData);
      setFloors(floorsData);
      setDisabledList(disabledData);
    } catch {
      toast.error('Failed to load configuration.');
    } fontFinally: {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchConfig();
  });

  const handleOpenDisableModal = (slot) => {
    setSelectedSlotForDisable(slot);
    setIsDisableModalOpen(true);
  };

  const handleEnableSlot = async (slot) => {
    try {
      const res = await slotService.enableSlotOccurrence({
        slotId: slot.id,
        slotName: slot.label,
        dateStr: selectedDate,
        adminUser: user
      });
      toast.success(res.message);
      fetchConfig();
    } catch (err) {
      toast.error(err?.message || 'Failed to enable slot.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Time Slots & Floor Structure</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Manage fixed 1-hour library slots, occurrences, and floor layout zones.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl px-3 py-1.5 shadow-xs">
            <span className="text-xs font-bold text-slate-600">Effective Date:</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs font-mono font-bold text-navy focus:outline-none"
            />
          </div>

          <Button onClick={fetchConfig} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Config
          </Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Slots Card */}
        <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
          <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4">
            <CardTitle className="text-base font-bold text-navy flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Clock size={18} className="text-indigo-600" /> Fixed 1-Hour Time Slots ({slots.length})
              </span>
              <span className="text-[11px] text-slate-400 font-mono">Date: {selectedDate}</span>
            </CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 text-xs">
              {slots.map(s => {
                const disabledRecord = disabledList.find(d => 
                  d.slotId === s.id && 
                  (d.scope === 'ALL_FUTURE' || d.date === selectedDate || (d.startDate <= selectedDate && d.endDate >= selectedDate))
                );
                const isDisabled = !!disabledRecord;

                return (
                  <div key={s.id} className={`p-4 space-y-2 hover:bg-slate-50 transition-colors ${isDisabled ? 'bg-red-50/20' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-navy text-sm">{s.label}</span>
                          <Badge className={`text-[10px] font-bold ${isDisabled ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
                            {isDisabled ? 'DISABLED' : 'ACTIVE'}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono block mt-0.5">{s.startTime} – {s.endTime}</span>
                      </div>

                      <div>
                        {isDisabled ? (
                          <Button
                            onClick={() => handleEnableSlot(s)}
                            variant="outline"
                            className="h-8 text-xs font-bold rounded-xl border-emerald-300 text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                          >
                            <CheckCircle2 size={13} className="mr-1 text-emerald-600" /> Enable Slot
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleOpenDisableModal(s)}
                            variant="outline"
                            className="h-8 text-xs font-bold rounded-xl border-red-300 text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            <AlertTriangle size={13} className="mr-1 text-red-600" /> Disable
                          </Button>
                        )}
                      </div>
                    </div>

                    {isDisabled && disabledRecord && (
                      <div className="p-2.5 bg-red-50 border border-red-200/80 rounded-xl text-[11px] text-red-900 space-y-1">
                        <div className="flex items-center justify-between font-bold">
                          <span className="flex items-center gap-1 text-red-700">
                            <ShieldAlert size={12} /> Reason: {disabledRecord.reason}
                          </span>
                          <span className="text-[10px] font-mono text-red-600">Scope: {disabledRecord.scope}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium">
                          Disabled by {disabledRecord.disabledBy} on {new Date(disabledRecord.disabledAt).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Floors Card */}
        <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
          <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4">
            <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
              <Layers size={18} className="text-teal-600" /> Library Floors & Zones
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 text-xs">
              {floors.map(f => (
                <div key={f.id} className="p-4 space-y-1 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-navy text-sm">{f.name} (Level {f.level})</span>
                    <Badge className="bg-teal-100 text-teal-800 border-teal-300 font-bold text-[10px]">
                      Active Floor
                    </Badge>
                  </div>
                  <p className="text-slate-500">{f.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Disable Slot Confirmation Modal */}
      <DisableSlotModal
        isOpen={isDisableModalOpen}
        onClose={() => setIsDisableModalOpen(false)}
        slot={selectedSlotForDisable}
        dateStr={selectedDate}
        adminUser={user}
        onSuccess={fetchConfig}
      />
    </div>
  );
}
