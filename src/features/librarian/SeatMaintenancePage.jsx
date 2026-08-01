import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { librarianService } from '../../services/librarianService';
import { useSync } from '../../hooks/useSync';
import { db } from '../../services/mockDatabase';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Label } from '../../components/shared/Label';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { Armchair, Plus, Search, RefreshCw, Zap, Sun, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SeatMaintenancePage() {
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
      const { data, error } = await supabase.from('seats').select('*').order('seat_number');
      if (!error && data && data.length > 0) {
        setSeats(data.map(s => ({
          id: s.id,
          seatNumber: s.seat_number,
          type: s.seat_type || 'Quiet Study (Zone A)',
          zoneId: s.is_accessible ? 'zone-a' : 'zone-b',
          powerOutlet: s.has_power_socket,
          nearWindow: s.is_accessible,
          status: s.status === 'available' ? 'active' : s.status
        })));
        return;
      }
    } catch { /* fallback */ }

    try {
      const data = await db.read('seatsync_seats') || [];
      setSeats(data.map(s => ({
        ...s,
        seatNumber: s.seatNumber || s.id,
        type: s.type || (s.zoneId === 'zone-a' ? 'Quiet Study (Zone A)' : 'Group Discussion (Zone B)'),
        status: s.status === 'available' ? 'active' : (s.status || 'active')
      })));
    } catch {
      toast.error('Failed to load seats.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeats();
  }, []);

  useSync(['seats', 'seatsync_seats'], fetchSeats);

  const handleAddSeat = async (e) => {
    e.preventDefault();
    if (!newSeat.seatNumber.trim()) {
      toast.error('Please enter Seat Number.');
      return;
    }

    try {
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).single();
      if (roomData) {
        const { error } = await supabase.from('seats').insert({
          room_id: roomData.id,
          seat_number: newSeat.seatNumber.trim(),
          seat_type: newSeat.zoneId === 'zone-a' ? 'Quiet Study (Zone A)' : 'Group Discussion (Zone B)',
          has_power_socket: newSeat.powerOutlet,
          is_accessible: newSeat.nearWindow,
          status: 'available'
        });
        if (!error) {
          toast.success(`Seat ${newSeat.seatNumber.trim()} added successfully!`);
          setAddModalOpen(false);
          setNewSeat({ seatNumber: '', zoneId: 'zone-a', powerOutlet: true, nearWindow: false });
          fetchSeats();
          return;
        }
      }
    } catch { /* fallback */ }

    try {
      const data = await db.read('seatsync_seats') || [];
      const created = {
        id: `SEAT-${Date.now()}`,
        seatNumber: newSeat.seatNumber.trim(),
        floorId: 'floor-g',
        zoneId: newSeat.zoneId,
        type: newSeat.zoneId === 'zone-a' ? 'Quiet Study (Zone A)' : 'Group Discussion (Zone B)',
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

  const handleToggleMaintenance = async (seat) => {
    try {
      const isCurrentlyMaintenance = seat.status === 'maintenance';
      if (isCurrentlyMaintenance) {
        await supabase.from('seats').update({ status: 'available' }).eq('id', seat.id);
      } else {
        await librarianService.reportSeatMaintenance({
          seatNumber: seat.seatNumber,
          category: 'Desk Maintenance',
          description: 'Flagged for maintenance by librarian',
          priority: 'Medium'
        });
      }

      // Local fallback sync
      const data = await db.read('seatsync_seats') || [];
      const target = data.find(s => s.id === seat.id || s.seatNumber === seat.seatNumber);
      if (target) {
        target.status = isCurrentlyMaintenance ? 'active' : 'maintenance';
        await db.write('seatsync_seats', data);
      }

      toast.success(`Seat ${seat.seatNumber} status updated.`);
      fetchSeats();
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
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Armchair className="text-teal-600" size={28} /> Seat Inventory & Carrels
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Configure individual study seats, power outlets, window orientation, and maintenance status.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={fetchSeats} variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-100 text-xs font-bold rounded-xl h-9">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Inventory
          </Button>
          <Button onClick={() => setAddModalOpen(true)} className="bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl h-9">
            <Plus size={16} className="mr-1.5" /> Add New Seat
          </Button>
        </div>
      </div>

      {/* SEARCH BAR CARD */}
      <Card className="border border-slate-200 bg-white rounded-2xl p-4 shadow-xs">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search seat number, type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 text-xs rounded-xl border-slate-300 text-navy"
          />
        </div>
      </Card>

      {/* SEATS INVENTORY TABLE */}
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
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filtered.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3.5 font-bold text-navy">{s.seatNumber}</td>
                      <td className="p-3.5 font-semibold text-slate-700 font-sans">{s.type}</td>
                      <td className="p-3.5 font-sans">
                        {s.powerOutlet ? <span className="text-emerald-700 font-bold flex items-center gap-1"><Zap size={13} /> Yes</span> : <span className="text-slate-400">No</span>}
                      </td>
                      <td className="p-3.5 font-sans">
                        {s.nearWindow ? <span className="text-amber-700 font-bold flex items-center gap-1"><Sun size={13} /> Yes</span> : <span className="text-slate-400">No</span>}
                      </td>
                      <td className="p-3.5">
                        <Badge className={`text-[10px] font-bold ${s.status === 'active' || s.status === 'available' ? 'bg-emerald-600 text-white' : 'bg-amber-600 text-white'}`}>
                          {s.status}
                        </Badge>
                      </td>
                      <td className="p-3.5 text-right font-sans">
                        <Button
                          onClick={() => handleToggleMaintenance(s)}
                          variant="outline"
                          className="h-7 text-[11px] font-bold rounded-lg border-slate-300 text-slate-700 hover:bg-slate-100"
                        >
                          {s.status === 'active' || s.status === 'available' ? 'Set Maintenance' : 'Activate'}
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

      {/* ADD NEW SEAT MODAL */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6 bg-white text-navy">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy flex items-center gap-2">
              <Plus size={20} className="text-teal-600" /> Add New Study Seat
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Add a new carrel seat to Ground Floor inventory.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddSeat} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Seat Number / Code</Label>
              <Input
                placeholder="e.g. S-41"
                value={newSeat.seatNumber}
                onChange={(e) => setNewSeat({ ...newSeat, seatNumber: e.target.value })}
                className="h-10 text-xs font-bold bg-slate-50 border-slate-300 text-navy"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-700">Zone Type</Label>
              <select
                value={newSeat.zoneId}
                onChange={(e) => setNewSeat({ ...newSeat, zoneId: e.target.value })}
                className="w-full h-10 rounded-xl border border-slate-300 px-3 text-xs font-semibold bg-slate-50 text-navy"
              >
                <option value="zone-a">Quiet Study (Zone A)</option>
                <option value="zone-b">Group Discussion (Zone B)</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <Button type="button" variant="outline" onClick={() => setAddModalOpen(false)} className="rounded-xl text-xs">
                Cancel
              </Button>
              <Button type="submit" className="bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl text-xs">
                Create Seat
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
