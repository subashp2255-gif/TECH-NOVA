import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Layers, Clock, RefreshCw, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SlotConfigPage() {
  const [slots, setSlots] = useState([]);
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const [slotsData, floorsData] = await Promise.all([
        db.read('seatsync_slots') || [],
        db.read('seatsync_floors') || []
      ]);
      setSlots(slotsData);
      setFloors(floorsData);
    } catch {
      toast.error('Failed to load configuration.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchConfig();
  });

  const handleToggleSlot = async (slotId) => {
    try {
      const data = await db.read('seatsync_slots') || [];
      const target = data.find(s => s.id === slotId);
      if (target) {
        target.active = !target.active;
        await db.write('seatsync_slots', data);
        toast.success(`Toggled status for ${target.label}.`);
        fetchConfig();
      }
    } catch {
      toast.error('Failed to update slot.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Time Slots & Floor Structure</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Manage fixed 1-hour library slots and floor layout zones.
          </p>
        </div>

        <Button onClick={fetchConfig} variant="outline" className="text-xs font-bold rounded-xl h-9">
          <RefreshCw size={14} className="mr-1.5" /> Refresh Config
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Slots Card */}
        <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
          <CardHeader className="border-b border-slate-100 bg-slate-50/80 p-4">
            <CardTitle className="text-base font-bold text-navy flex items-center gap-2">
              <Clock size={18} className="text-indigo-600" /> Fixed 1-Hour Time Slots ({slots.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 text-xs">
              {slots.map(s => (
                <div key={s.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div>
                    <span className="font-bold text-navy block">{s.label}</span>
                    <span className="text-[11px] text-slate-500 font-mono">{s.startTime} – {s.endTime}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`text-[10px] font-bold ${s.active ? 'bg-emerald-600 text-white' : 'bg-slate-400 text-white'}`}>
                      {s.active ? 'Active' : 'Disabled'}
                    </Badge>
                    <Button
                      onClick={() => handleToggleSlot(s.id)}
                      variant="outline"
                      className="h-7 text-[11px] font-bold rounded-lg border-slate-300"
                    >
                      {s.active ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
              ))}
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
    </div>
  );
}
