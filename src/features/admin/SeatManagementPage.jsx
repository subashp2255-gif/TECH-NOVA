import React, { useEffect, useState } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Armchair, Plus, Search, RefreshCw, Zap, Sun } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SeatManagementPage() {
  const [seats, setSeats] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newSeat, setNewSeat] = useState({
    seatNumber: '',
    zoneId: 'zone-a',
    powerOutlet: true,
    nearWindow: false
  });

  const fetchSeats = async () => {
    try {
      setLoading(true);
      const data = await db.read('seatsync_seats') || [];
      setSeats(data);
    } catch {
      toast.error('Failed to load seats.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeats();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change') fetchSeats();
  });

  const handleAddSeat = async (e) => {
    e.preventDefault();
    if (!newSeat.seatNumber.trim()) {
      toast.error('Please enter Seat Number.');
      return;
    }

    try {
      const data = await db.read('seatsync_seats') || [];
      const exists = data.find(s => s.seatNumber === newSeat.seatNumber.trim() || s.id === `SEAT-${newSeat.seatNumber.trim()}`);
      if (exists) {
        toast.error('Seat Number already exists.');
        return;
      }

      const created = {
        id: `SEAT-${Date.now()}`,
        seatNumber: newSeat.seatNumber.trim(),
        floorId: 'floor-g',
        zoneId: newSeat.zoneId,
        type: newSeat.zoneId === 'zone-a' ? 'Quiet Study' : 'Group Discussion',
        status: 'active',
        powerOutlet: newSeat.powerOutlet,
        nearWindow: newSeat.nearWindow
      };

      data.push(created);
      await db.write('seatsync_seats', data);
      toast.success(`Seat ${created.seatNumber} added successfully!`);
      setAddModalOpen(false);
      setNewSeat({ seatNumber: '', zoneId: 'zone-a', powerOutlet: true, nearWindow: false });
      fetchSeats();
    } catch {
      toast.error('Failed to add seat.');
    }
  };

  const handleToggleMaintenance = async (seatId) => {
    try {
      const data = await db.read('seatsync_seats') || [];
      const target = data.find(s => s.id === seatId);
      if (target) {
        target.status = target.status === 'active' ? 'maintenance' : 'active';
        await db.write('seatsync_seats', data);
        toast.success(`Seat ${target.seatNumber} status updated.`);
        fetchSeats();
      }
    } catch {
      toast.error('Failed to update seat status.');
    }
  };

  const filtered = seats.filter(s =>
    (s.seatNumber || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.type || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Seat Inventory & Carrels</h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            Configure individual study seats, power outlets, window orientation, and maintenance status.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchSeats} variant="outline" className="text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Inventory
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-brandBlue hover:bg-blue-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add New Seat
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search seat number, type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300"
          />
        </div>
      </Card>

      <Card className="border border-slate-200 rounded-2xl shadow-xs overflow-hidden bg-white">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading seat inventory...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No seats found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                    <th className="p-3.5">Seat Number</th>
                    <th className="p-3.5">Zone / Type</th>
                    <th className="p-3.5">Power Outlet</th>
                    <th className="p-3.5">Near Window</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-bold text-navy">{s.seatNumber}</td>
                      <td className="p-3.5 font-semibold text-slate-700">{s.type} ({s.zoneId === 'zone-a' ? 'Zone A' : 'Zone B'})</td>
                      <td className="p-3.5">
                        {s.powerOutlet ? <span className="text-emerald-700 font-bold flex items-center gap-1"><Zap size={13} /> Yes</span> : <span className="text-slate-400">No</span>}
                      </td>
                      <td className="p-3.5">
                        {s.nearWindow ? <span className="text-amber-700 font-bold flex items-center gap-1"><Sun size={13} /> Yes</span> : <span className="text-slate-400">No</span>}
                      </td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${s.status === 'active' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white'}`}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right">
                        <Button
                          onClick={() => handleToggleMaintenance(s.id)}
                          variant="outline"
                          className="h-7 text-[11px] font-bold rounded-lg border-slate-300"
                        >
                          {s.status === 'active' ? 'Set Maintenance' : 'Activate'}
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

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy">Add New Study Seat</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Add a new carrel seat to Ground Floor inventory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddSeat} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Seat Number / Code</Label>
              <Input
                placeholder="e.g. S-41"
                value={newSeat.seatNumber}
                onChange={(e) => setNewSeat({ ...newSeat, seatNumber: e.target.value })}
                className="h-10 text-xs font-bold"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold">Zone Type</Label>
              <select
                value={newSeat.zoneId}
                onChange={(e) => setNewSeat({ ...newSeat, zoneId: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-white"
              >
                <option value="zone-a">Zone A — Quiet Study</option>
                <option value="zone-b">Zone B — Group Discussion</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-brandBlue hover:bg-blue-700 text-white font-bold rounded-xl text-xs">
                Create Seat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
