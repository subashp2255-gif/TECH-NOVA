import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { occupancyService, getTodayKolkataDate, getCurrentOrNextKolkataSlot } from '../../services/occupancyService';
import { librarianService } from '../../services/librarianService';
import { db } from '../../services/mockDatabase';
import { defaultSlots } from '../../data/seedData';
import { Card } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Eye, Armchair, RefreshCw, Layers, Calendar, Clock, MapPin, AlertCircle, CheckCircle2, User, LogOut, LogIn, Wrench
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function LiveOccupancyPage() {
  // Filter states
  const [libraries, setLibraries] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [slots, setSlots] = useState([]);

  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [selectedDate, setSelectedDate] = useState(getTodayKolkataDate());
  const [selectedSlotId, setSelectedSlotId] = useState('');

  // Data & loading states
  const [occupancyData, setOccupancyData] = useState({
    seats: [],
    totalCapacity: 0,
    availableCount: 0,
    reservedCount: 0,
    occupiedCount: 0,
    maintenanceCount: 0,
    occupancyPercentage: 0
  });

  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // 1. Fetch Libraries, Rooms, and Slots on mount with seed fallbacks
  useEffect(() => {
    async function initFilters() {
      let finalRooms = [];
      let finalSlots = [];

      try {
        const [{ data: roomData }, { data: slotData }] = await Promise.all([
          supabase.from('rooms').select('*').order('name'),
          supabase.from('slots').select('*').order('start_time')
        ]);

        if (roomData && roomData.length > 0) {
          finalRooms = roomData.map(r => ({ id: r.id, name: r.name }));
        }
        if (slotData && slotData.length > 0) {
          finalSlots = slotData.map(s => ({
            id: s.id,
            name: s.name,
            startTime: s.start_time || s.startTime,
            endTime: s.end_time || s.endTime
          }));
        }
      } catch (err) {
        console.warn('Failed to load filter dropdowns from Supabase:', err);
      }

      // Fallbacks if empty
      if (finalRooms.length === 0) {
        const localRooms = (await db.read('seatsync_rooms')) || [];
        if (localRooms.length > 0) {
          finalRooms = localRooms.map(r => ({ id: r.id, name: r.name }));
        } else {
          finalRooms = [
            { id: 'RM-01', name: 'Ground Floor Main Reading Room' },
            { id: 'RM-02', name: 'First Floor Reference Hall' }
          ];
        }
      }

      if (finalSlots.length === 0) {
        const localSlots = (await db.read('seatsync_slots')) || defaultSlots || [];
        if (localSlots.length > 0) {
          finalSlots = localSlots.map(s => ({
            id: s.id,
            name: s.label || s.name || `Slot ${s.id}`,
            startTime: s.startTime || '08:00 AM',
            endTime: s.endTime || '09:00 AM'
          }));
        } else {
          finalSlots = defaultSlots.map(s => ({
            id: s.id,
            name: s.label,
            startTime: s.startTime,
            endTime: s.endTime
          }));
        }
      }

      setRooms(finalRooms);
      setSlots(finalSlots);

      if (finalRooms.length > 0) setSelectedRoomId(finalRooms[0].id);
      if (finalSlots.length > 0) {
        const defSlot = getCurrentOrNextKolkataSlot(finalSlots) || finalSlots[0];
        setSelectedSlotId(defSlot.id);
      }
    }

    initFilters();
  }, []);

  // 2. Fetch Authoritative Occupancy Data
  const loadOccupancy = useCallback(async () => {
    if (!selectedRoomId || !selectedDate || !selectedSlotId) return;

    setLoading(true);
    setQueryError(null);

    const res = await occupancyService.getOccupancy({
      roomId: selectedRoomId,
      bookingDate: selectedDate,
      slotId: selectedSlotId
    });

    if (res.error && !res.seats.length) {
      setQueryError(res.error);
      toast.error(`Database Query Error: ${res.error}`);
    } else {
      setOccupancyData(res);
      setLastUpdated(new Date());
    }

    setLoading(false);
  }, [selectedRoomId, selectedDate, selectedSlotId]);

  useEffect(() => {
    loadOccupancy();
  }, [loadOccupancy]);

  // 3. Supabase Realtime Subscription
  useEffect(() => {
    if (!selectedRoomId || !selectedDate || !selectedSlotId) return;

    const channelName = `librarian-occupancy-${selectedRoomId}-${selectedDate}-${selectedSlotId}`;
    const channel = supabase.channel(channelName);

    ['bookings', 'seats', 'rooms', 'slots', 'seat_maintenance'].forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          loadOccupancy();
        }
      );
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedRoomId, selectedDate, selectedSlotId, loadOccupancy]);

  // Check-In / Check-Out Actions inside drawer
  const handleCheckInSeat = async (bookingId) => {
    try {
      await librarianService.processCheckIn(bookingId, null, 'Desk Checked In by Staff');
      toast.success('Student checked in! Desk updated to Occupied (Teal).');
      setSelectedSeat(null);
      await loadOccupancy();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-in.');
    }
  };

  const handleCheckOutSeat = async (bookingId) => {
    try {
      await librarianService.processCheckOut(bookingId, null);
      toast.success('Student checked out! Desk released.');
      setSelectedSeat(null);
      await loadOccupancy();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-out.');
    }
  };

  const currentRoomObj = rooms.find(r => r.id === selectedRoomId);
  const currentSlotObj = slots.find(s => s.id === selectedSlotId);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      {/* HEADER & TOP CONTROL BAR */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
            <Eye className="text-teal-600" size={28} /> Live Library Occupancy Monitor
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Real-time visual seat map matrix with automated Supabase state synchronization across desks.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-slate-100 border-slate-200 text-slate-600 text-xs font-mono px-3 py-1">
            Last Sync: {lastUpdated.toLocaleTimeString()}
          </Badge>
          <Button onClick={loadOccupancy} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold h-9 px-3 rounded-xl border border-slate-300">
            <RefreshCw size={14} className="mr-1.5" /> Refresh Map
          </Button>
        </div>
      </div>

      {/* PHASE 3: DATE, ROOM AND SLOT FILTER CONTROLS */}
      <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Room Selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Reading Room</label>
            <select
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-xl px-3 focus:border-teal-600"
            >
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Calendar size={12} /> Date (Asia/Kolkata)
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-xl px-3 focus:border-teal-600 font-mono"
            />
          </div>

          {/* Slot Selector */}
          <div className="space-y-1 sm:col-span-2 lg:col-span-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Clock size={12} /> Operational Time Slot
            </label>
            <select
              value={selectedSlotId}
              onChange={(e) => setSelectedSlotId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-xl px-3 focus:border-teal-600 font-mono"
            >
              {slots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.startTime || s.start_time} - {s.endTime || s.end_time})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* CONTEXT BANNER */}
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-600 font-mono">
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-teal-600" />
            <span className="font-bold text-navy">{currentRoomObj?.name || 'Main Room'}</span>
            <span>•</span>
            <span className="text-teal-600 font-bold">{selectedDate}</span>
            <span>•</span>
            <span className="text-slate-700">{currentSlotObj?.name || 'Selected Slot'}</span>
          </div>
          <span className="text-[11px] text-slate-400">Live Context Matrix</span>
        </div>
      </Card>

      {/* PHASE 11: ERROR ALERT STATE */}
      {queryError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between text-xs text-red-700 font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-red-600 shrink-0" />
            <span>Failed to load occupancy data from database: {queryError}</span>
          </div>
          <Button onClick={loadOccupancy} className="bg-red-600 text-white font-bold text-xs h-8 px-3 rounded-lg">
            Retry Query
          </Button>
        </div>
      )}

      {/* PHASE 5: STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Total Capacity</p>
          <h3 className="text-2xl font-black text-navy mt-1">{occupancyData.totalCapacity} Seats</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-emerald-600 uppercase tracking-wider">Available Now</p>
          <h3 className="text-2xl font-black text-emerald-600 mt-1">{occupancyData.availableCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-teal-600 uppercase tracking-wider">Checked-In Occupied</p>
          <h3 className="text-2xl font-black text-teal-600 mt-1">{occupancyData.occupiedCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-brandBlue uppercase tracking-wider">Reserved Passes</p>
          <h3 className="text-2xl font-black text-brandBlue mt-1">{occupancyData.reservedCount}</h3>
        </Card>
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-4 shadow-xs">
          <p className="text-[10px] font-extrabold text-red-600 uppercase tracking-wider">Maintenance</p>
          <h3 className="text-2xl font-black text-red-600 mt-1">{occupancyData.maintenanceCount}</h3>
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
          <Layers size={18} className="text-teal-600" /> {currentRoomObj?.name || 'Selected Room Seat Map'}
        </h2>

        {loading ? (
          <div className="p-12 text-center text-xs text-slate-400 font-mono animate-pulse">
            Loading authoritative seat map & student reservation states...
          </div>
        ) : occupancyData.seats.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 font-mono">
            No seat records found for this room.
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-10 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            {occupancyData.seats.map(seat => (
              <button
                key={seat.seatId}
                onClick={() => setSelectedSeat(seat)}
                className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 text-center transition-all hover:scale-105 shadow-xs cursor-pointer ${seat.colorClass}`}
              >
                <Armchair size={18} />
                <span className="text-xs font-black font-mono">{seat.seatNumber}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Seat Details Modal */}
      {selectedSeat && (
        <Dialog open={!!selectedSeat} onOpenChange={() => setSelectedSeat(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-extrabold text-navy flex items-center justify-between">
                <span>Seat {selectedSeat.seatNumber} Details</span>
                <Badge className={`text-xs font-bold ${selectedSeat.colorClass}`}>
                  {selectedSeat.displayStatus === 'maintenance' ? 'Maintenance' : selectedSeat.stateLabel}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                {currentRoomObj?.name || 'Ground Floor Main Reading Zone'}
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2.5 text-xs font-mono">
              <p className="text-slate-600">
                Status: <span className="font-bold text-navy uppercase">{selectedSeat.displayStatus === 'maintenance' ? 'UNDER MAINTENANCE' : selectedSeat.displayStatus}</span>
              </p>

              {selectedSeat.displayStatus === 'maintenance' ? (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="p-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xl flex items-center gap-2 text-xs font-bold font-sans">
                    <Wrench size={16} className="text-red-600 shrink-0" />
                    <span>Seat is currently under maintenance</span>
                  </div>

                  <p className="text-slate-600 pt-1">
                    Reported By: <strong className="text-navy font-extrabold">{selectedSeat.maintenanceInfo?.reportedByLabel || selectedSeat.maintenanceInfo?.reportedByRole || 'Librarian'}</strong>
                  </p>
                  {selectedSeat.maintenanceInfo?.reason && (
                    <p className="text-slate-600">
                      Reason: <strong className="text-slate-800">{selectedSeat.maintenanceInfo.reason}</strong>
                    </p>
                  )}
                  {selectedSeat.maintenanceInfo?.category && (
                    <p className="text-slate-600">
                      Category: <strong className="text-slate-800">{selectedSeat.maintenanceInfo.category}</strong>
                    </p>
                  )}
                  <p className="text-slate-400 text-[11px] italic pt-1 border-t border-slate-100">
                    Student booking details are hidden while seat is under maintenance.
                  </p>
                </div>
              ) : selectedSeat.booking ? (
                <>
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <p className="text-slate-600">Student: <strong className="text-navy">{selectedSeat.booking.studentName}</strong></p>
                    <p className="text-slate-600">College Reg No: <strong className="text-indigo-600">{selectedSeat.booking.studentRegistrationNumber}</strong></p>
                    <p className="text-slate-600">Booking Code: <strong className="text-teal-600">{selectedSeat.booking.bookingCode}</strong></p>
                    <p className="text-slate-600">Date & Slot: <strong className="text-slate-800">{selectedSeat.booking.bookingDate} ({selectedSeat.booking.slotName})</strong></p>
                    {selectedSeat.booking.checkedInAt && (
                      <p className="text-emerald-700">Checked In: {new Date(selectedSeat.booking.checkedInAt).toLocaleTimeString()}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-slate-400 italic">No active reservation for this date and time slot.</p>
              )}
            </div>

            {/* Actions inside Modal */}
            <div className="space-y-2 pt-1">
              {selectedSeat.booking && selectedSeat.displayStatus === 'reserved' && (
                <Button
                  onClick={() => handleCheckInSeat(selectedSeat.booking.id)}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 rounded-xl flex items-center justify-center gap-2"
                >
                  <LogIn size={16} /> Process Check-In →
                </Button>
              )}

              {selectedSeat.booking && selectedSeat.displayStatus === 'occupied' && (
                <Button
                  onClick={() => handleCheckOutSeat(selectedSeat.booking.id)}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs h-10 rounded-xl flex items-center justify-center gap-2"
                >
                  <LogOut size={16} /> Process Check-Out →
                </Button>
              )}

              <Button
                onClick={() => setSelectedSeat(null)}
                variant="outline"
                className="w-full text-slate-700 font-bold text-xs h-10 rounded-xl border-slate-300"
              >
                Close Details
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
