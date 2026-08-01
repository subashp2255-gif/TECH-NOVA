import React, { useState, useEffect } from 'react';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Eye, MapPin, Armchair, ShieldAlert, CheckCircle2, Clock,
  RefreshCw, Wrench, Info, Users, Layers
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function LiveOccupancyPage() {
  const [seats, setSeats] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const todayStr = new Date().toISOString().split('T')[0];

  const loadData = async () => {
    try {
      const [seatsData, bookingsData, maintenanceData] = await Promise.all([
        db.read('seatsync_seats') || [],
        db.read('seatsync_bookings') || [],
        db.read('seatsync_maintenance') || []
      ]);
      setSeats(seatsData || []);
      setBookings(bookingsData || []);
      setMaintenance(maintenanceData || []);
      setLastUpdated(new Date());
    } catch (err) {
      console.warn('Failed to load live occupancy:', err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useSync(['seatsync_bookings', 'seatsync_seats', 'seatsync_maintenance'], loadData);

  const getSeatState = (seat) => {
    const mntList = maintenance || [];
    const bkList = bookings || [];

    const isMnt = seat.status === 'maintenance' || mntList.some(m => m.seatNumber === seat.seatNumber && m.status !== 'Resolved');
    if (isMnt) return { state: 'maintenance', label: 'Maintenance', color: 'bg-red-600 border-red-500 text-white' };

    const activeBooking = bkList.find(b =>
      b.seatNumber === seat.seatNumber &&
      b.bookingDate === todayStr &&
      (b.status === 'active' || b.status === 'checked_in')
    );
    if (activeBooking) return { state: 'occupied', label: 'Occupied', color: 'bg-teal-600 border-teal-500 text-white', booking: activeBooking };

    const reservedBooking = bkList.find(b =>
      b.seatNumber === seat.seatNumber &&
      b.bookingDate === todayStr &&
      b.status === 'confirmed'
    );
    if (reservedBooking) return { state: 'reserved', label: 'Reserved', color: 'bg-brandBlue border-blue-500 text-white', booking: reservedBooking };

    return { state: 'available', label: 'Available', color: 'bg-emerald-600 border-emerald-500 text-white' };
  };

  const totalSeats = seats.length || 40;
  const occupiedCount = seats.filter(s => getSeatState(s).state === 'occupied').length;
  const reservedCount = seats.filter(s => getSeatState(s).state === 'reserved').length;
  const maintenanceCount = seats.filter(s => getSeatState(s).state === 'maintenance').length;
  const availableCount = Math.max(0, totalSeats - occupiedCount - reservedCount - maintenanceCount);
  const occupancyPct = totalSeats > 0 ? Math.round((occupiedCount / totalSeats) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Eye className="text-teal-600" size={28} /> Live Library Occupancy Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time visual seat map matrix with automated state synchronization across desks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-slate-100 border-slate-200 text-slate-600 text-xs font-mono px-3 py-1">
            Last Updated: {lastUpdated.toLocaleTimeString()}
          </Badge>
          <Button onClick={loadData} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold h-9 px-3 rounded-xl border border-slate-300">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Map
          </Button>
        </div>
      </div>

      {/* STATS OVERVIEW */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Total Capacity</p>
          <h3 className="text-2xl font-black text-navy mt-1">{totalSeats} Seats</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-wider">Available Now</p>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">{availableCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-teal-600 uppercase tracking-wider">Checked-In Occupied</p>
          <h3 className="text-2xl font-black text-teal-600 mt-1">{occupiedCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-brandBlue uppercase tracking-wider">Reserved Passes</p>
          <h3 className="text-2xl font-black text-brandBlue mt-1">{reservedCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-red-600 uppercase tracking-wider">Maintenance</p>
          <h3 className="text-2xl font-black text-red-600 mt-1">{maintenanceCount}</h3>
        </Card>
      </div>

      {/* LEGEND */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-white border border-slate-200/80 rounded-2xl text-xs shadow-xs">
        <span className="font-bold text-navy uppercase text-[10px] tracking-wider">Seat Map Legend:</span>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 rounded-md bg-emerald-600 border border-emerald-500"></div>
            <span className="text-slate-600 font-semibold">Available (Green)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 rounded-md bg-teal-600 border border-teal-500"></div>
            <span className="text-slate-600 font-semibold">Occupied (Teal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 rounded-md bg-brandBlue border border-blue-500"></div>
            <span className="text-slate-600 font-semibold">Reserved (Blue)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 rounded-md bg-red-600 border border-red-500"></div>
            <span className="text-slate-600 font-semibold">Maintenance (Red)</span>
          </div>
        </div>
      </div>

      {/* INTERACTIVE SEAT GRID MATRIX */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-navy flex items-center gap-2">
          <Layers size={18} className="text-teal-600" /> Ground Floor Main Reading Zone
        </h2>

        <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-10 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
          {seats.map(seat => {
            const st = getSeatState(seat);
            return (
              <button
                key={seat.id}
                onClick={() => setSelectedSeat({ seat, ...st })}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all hover:scale-105 shadow-xs ${st.color}`}
              >
                <Armchair size={18} />
                <span className="text-xs font-black font-mono">{seat.seatNumber}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* SEAT DRAWER MODAL */}
      {selectedSeat && (
        <Dialog open={!!selectedSeat} onOpenChange={() => setSelectedSeat(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-extrabold text-navy flex items-center justify-between">
                <span>Seat {selectedSeat.seat.seatNumber} Details</span>
                <Badge className={`text-xs font-bold ${selectedSeat.color}`}>
                  {selectedSeat.label}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                {selectedSeat.seat.floorName || 'Ground Floor Main Reading Zone'}
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2 text-xs font-mono">
              <p className="text-slate-700">Status: <span className="font-bold text-navy uppercase">{selectedSeat.state}</span></p>
              {selectedSeat.booking && (
                <>
                  <p className="text-slate-700">Slot: <span className="text-teal-600 font-bold">{selectedSeat.booking.slotTime}</span></p>
                  <p className="text-slate-700">Pass ID: <span className="text-slate-500">{selectedSeat.booking.id}</span></p>
                </>
              )}
            </div>

            <Button
              onClick={() => setSelectedSeat(null)}
              className="w-full bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs h-10 rounded-xl"
            >
              Close Details
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
