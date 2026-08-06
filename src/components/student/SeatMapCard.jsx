import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase.js';
import { Card, CardContent } from '../shared/Card.jsx';
import { Button } from '../shared/Button.jsx';
import { Badge } from '../shared/Badge.jsx';
import { 
  MapPin, Clock, RefreshCw, Zap, Sun, ShieldCheck, Check, AlertCircle, 
  X, Sparkles, Filter, ChevronRight, Lock, CheckCircle2, User
} from 'lucide-react';
import toast from 'react-hot-toast';

function format12HourTime(timeStr) {
  if (!timeStr) return '';
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  return `${formattedHours}:${minutes < 10 ? '0' : ''}${minutes} ${period}`;
}

export default function SeatMapCard({
  floor,
  slot,
  dateStr,
  seats = [],
  loadingSeats = false,
  selectedSeat = null,
  onSelectSeat,
  onConfirmBooking,
  bookingLoading = false,
  onRefresh,
  isSlotCancelled = false,
  user
}) {
  const [realtimeStatus, setRealtimeStatus] = useState('connected'); // 'connected' | 'reconnecting'
  const [lastUpdated, setLastUpdated] = useState('Just now');
  const [filterZone, setFilterZone] = useState('ALL');
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false);
  const [filterPowerSocket, setFilterPowerSocket] = useState(false);
  const [filterNearWindow, setFilterNearWindow] = useState(false);

  // Setup Supabase Realtime listener for seat map availability changes
  useEffect(() => {
    if (!slot?.id || !dateStr) return;

    setRealtimeStatus('connected');
    const channel = supabase
      .channel(`realtime-seatmap-${slot.id}-${dateStr}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bookings',
          filter: `booking_date=eq.${dateStr}`
        },
        (payload) => {
          setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
          if (onRefresh) onRefresh();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setRealtimeStatus('reconnecting');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slot?.id, dateStr]);

  // Recalculate Occupancy Counts
  const occupancyCounts = useMemo(() => {
    let available = 0;
    let reserved = 0;
    let occupied = 0;
    let held = 0;
    let maintenance = 0;
    let userBooked = 0;

    seats.forEach(s => {
      const state = s.status_state || (s.ui_status || '').toLowerCase();
      if (s.isUserBooked || state === 'user_booked') {
        userBooked++;
      }
      if (state === 'maintenance' || s.status === 'maintenance') {
        maintenance++;
      } else if (state === 'occupied' || s.ui_status === 'Occupied') {
        occupied++;
      } else if (state === 'held' || s.ui_status === 'Held') {
        held++;
      } else if (state === 'reserved' || s.ui_status === 'Reserved') {
        reserved++;
      } else if (state === 'available' || s.ui_status === 'Available') {
        available++;
      }
    });

    return { available, reserved, occupied, held, maintenance, userBooked, total: seats.length || 40 };
  }, [seats]);

  // Filtered Seats
  const filteredSeats = useMemo(() => {
    return seats.filter(s => {
      if (filterAvailableOnly && s.status_state !== 'available' && s.ui_status !== 'Available') return false;
      if (filterZone !== 'ALL' && s.zoneId !== filterZone) return false;
      if (filterPowerSocket && !s.powerOutlet) return false;
      if (filterNearWindow && !s.nearWindow) return false;
      return true;
    });
  }, [seats, filterAvailableOnly, filterZone, filterPowerSocket, filterNearWindow]);

  // Group 40 seats into 4 rows of 10 (Bank 1: seats 1-5, Bank 2: seats 6-10 per row)
  const seatRows = useMemo(() => {
    const sorted = [...filteredSeats].sort((a, b) => {
      const numA = parseInt(String(a.seatNumber).replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(String(b.seatNumber).replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    const rows = [];
    for (let r = 0; r < 4; r++) {
      const bank1 = [];
      const bank2 = [];
      for (let c = 0; c < 5; c++) {
        const idx1 = r * 10 + c;
        const idx2 = r * 10 + 5 + c;
        if (sorted[idx1]) bank1.push(sorted[idx1]);
        if (sorted[idx2]) bank2.push(sorted[idx2]);
      }
      rows.push({ rowNumber: r + 1, bank1, bank2 });
    }
    return rows;
  }, [filteredSeats]);

  const handleSeatClick = (seat) => {
    if (isSlotCancelled) {
      toast.error('This slot has been cancelled by the library.');
      return;
    }

    const state = seat.status_state || (seat.ui_status || '').toLowerCase();
    if (state !== 'available' && seat.ui_status !== 'Available') {
      if (seat.isUserBooked) {
        toast.success(`You already have a booking for Seat ${seat.seatNumber}.`);
      } else {
        toast.error(`Seat ${seat.seatNumber} is ${seat.ui_status || 'unavailable'}. Please select an available seat.`);
      }
      return;
    }

    if (selectedSeat?.id === seat.id) {
      onSelectSeat(null); // Deselect
    } else {
      onSelectSeat(seat);
    }
  };

  const clearAllFilters = () => {
    setFilterZone('ALL');
    setFilterAvailableOnly(false);
    setFilterPowerSocket(false);
    setFilterNearWindow(false);
  };

  return (
    <Card className="border-2 border-slate-200/90 rounded-3xl bg-white shadow-lg overflow-hidden animate-in fade-in duration-300">
      <CardContent className="p-6 space-y-6">

        {/* 1. HALL HEADER & LIVE STATUS BAR */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-600 shadow-xs">
              <MapPin size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black text-navy tracking-tight">Main Quiet Reading Hall</h2>
                <Badge className="bg-navy text-white text-[10px] font-mono font-extrabold px-2 py-0.5">
                  Floor 1
                </Badge>
              </div>
              <p className="text-xs text-slate-500 font-medium flex items-center gap-2 mt-0.5">
                <span>Quiet Zone & Collaborative Area</span>
                <span>•</span>
                <span className="font-bold text-navy">40 Seats Total</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 rounded-2xl px-3.5 py-1.5 text-xs font-semibold">
              {realtimeStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  Live Availability
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-amber-600 font-bold">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse"></span>
                  Reconnecting...
                </span>
              )}
              <span className="text-slate-300">|</span>
              <span className="text-slate-400 font-mono text-[11px]">Updated {lastUpdated}</span>
            </div>

            {slot && (
              <div className="bg-blue-50 border border-blue-200/80 rounded-2xl px-3.5 py-1.5 text-xs font-bold text-brandBlue font-mono flex items-center gap-1.5">
                <Clock size={14} className="text-brandBlue" />
                <span>Slot: {format12HourTime(slot.startTime)} – {format12HourTime(slot.endTime)}</span>
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-9 px-3 rounded-2xl text-xs font-bold text-slate-600 border-slate-300 hover:bg-slate-100"
              title="Refresh seat availability"
            >
              <RefreshCw size={14} className="mr-1.5 text-teal-600" /> Refresh
            </Button>
          </div>
        </div>

        {/* 2. COMPACT OCCUPANCY SUMMARY */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-3.5 text-center transition-all hover:bg-emerald-50">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 block">Available</span>
            <span className="text-2xl font-black text-emerald-600 font-mono">{occupancyCounts.available}</span>
          </div>

          <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 text-center transition-all hover:bg-amber-50">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700 block">Reserved</span>
            <span className="text-2xl font-black text-amber-600 font-mono">{occupancyCounts.reserved}</span>
          </div>

          <div className="bg-rose-50/70 border border-rose-200/80 rounded-2xl p-3.5 text-center transition-all hover:bg-rose-50">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-rose-700 block">Occupied</span>
            <span className="text-2xl font-black text-rose-600 font-mono">{occupancyCounts.occupied}</span>
          </div>

          <div className="bg-teal-50/70 border border-teal-200/80 rounded-2xl p-3.5 text-center transition-all hover:bg-teal-50">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-teal-700 block">Held / Offer</span>
            <span className="text-2xl font-black text-teal-600 font-mono">{occupancyCounts.held}</span>
          </div>

          <div className="bg-slate-100/70 border border-slate-300/80 rounded-2xl p-3.5 text-center transition-all hover:bg-slate-100 col-span-2 sm:col-span-1">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600 block">Maintenance</span>
            <span className="text-2xl font-black text-slate-500 font-mono">{occupancyCounts.maintenance}</span>
          </div>
        </div>

        {/* 3. SEAT-STATUS LEGEND */}
        <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-4 space-y-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 block">Seat Availability Legend</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-semibold text-slate-700">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-emerald-500 border border-emerald-600 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">✓</span>
              <span>Available</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-brandBlue border border-blue-700 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">★</span>
              <span>Selected</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-amber-500 border border-amber-600 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">⏰</span>
              <span>Reserved</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-rose-500 border border-rose-600 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">🔒</span>
              <span>Occupied</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-teal-500 border border-teal-600 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">⏳</span>
              <span>Held / Offer Pending</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-slate-400 border border-slate-500 shadow-xs flex items-center justify-center text-[10px] text-white font-bold">🔧</span>
              <span>Maintenance</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-lg bg-blue-100 border-2 border-brandBlue text-brandBlue shadow-xs flex items-center justify-center text-[10px] font-black">👤</span>
              <span className="text-brandBlue font-bold">Booked by You</span>
            </div>
          </div>
        </div>

        {/* 4. FILTERS & CONTROLS */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500 font-bold flex items-center gap-1 mr-1">
              <Filter size={14} className="text-brandBlue" /> Filters:
            </span>

            <button
              type="button"
              onClick={() => setFilterAvailableOnly(!filterAvailableOnly)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                filterAvailableOnly
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              Show Available Only
            </button>

            <button
              type="button"
              onClick={() => setFilterZone('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                filterZone === 'ALL'
                  ? 'bg-navy text-white border-navy shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              All Zones
            </button>

            <button
              type="button"
              onClick={() => setFilterZone('zone-a')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                filterZone === 'zone-a'
                  ? 'bg-navy text-white border-navy shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              Zone A (Quiet)
            </button>

            <button
              type="button"
              onClick={() => setFilterZone('zone-b')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                filterZone === 'zone-b'
                  ? 'bg-navy text-white border-navy shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              Zone B (Group)
            </button>

            <button
              type="button"
              onClick={() => setFilterPowerSocket(!filterPowerSocket)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1 ${
                filterPowerSocket
                  ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Zap size={12} /> Power Socket
            </button>

            <button
              type="button"
              onClick={() => setFilterNearWindow(!filterNearWindow)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border flex items-center gap-1 ${
                filterNearWindow
                  ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
              }`}
            >
              <Sun size={12} /> Near Window
            </button>
          </div>

          {(filterZone !== 'ALL' || filterAvailableOnly || filterPowerSocket || filterNearWindow) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="h-8 px-2.5 text-xs font-bold text-red-600 border-red-200 hover:bg-red-50 rounded-xl"
            >
              Clear Filters
            </Button>
          )}
        </div>

        {/* CANCELLED SLOT ALERT */}
        {isSlotCancelled && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2 animate-in fade-in">
            <div className="flex items-center justify-center gap-2 text-red-700 font-black text-sm">
              <AlertCircle size={20} /> Slot Cancelled by Library Admin
            </div>
            <p className="text-xs text-slate-600 font-medium">
              This time slot is disabled. All seats are locked for reservation and waiting list queueing.
            </p>
          </div>
        )}

        {/* 5. INTERACTIVE PHYSICAL SEAT MAP (4 ROWS OF 10 SEATS SPLIT BY CENTRAL AISLE) */}
        {loadingSeats ? (
          <div className="py-16 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-brandBlue border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs font-bold text-slate-400">Loading interactive 40-seat hall layout...</p>
          </div>
        ) : filteredSeats.length === 0 ? (
          <div className="py-12 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-2">
            <p className="text-sm font-bold text-navy">No seats match the selected filter criteria.</p>
            <Button type="button" onClick={clearAllFilters} variant="outline" className="text-xs font-bold rounded-xl">
              Reset Filters
            </Button>
          </div>
        ) : (
          <div className="bg-slate-100/60 border border-slate-200 rounded-3xl p-5 md:p-8 space-y-6">
            
            {/* Top Physical Wall Markers */}
            <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-400 uppercase tracking-widest px-2">
              <span className="flex items-center gap-1.5"><Sun size={14} className="text-amber-500" /> Large Quiet Window Wall</span>
              <span className="bg-slate-200 text-slate-600 px-3 py-1 rounded-full text-[10px]">Front Whiteboard & Screen</span>
              <span className="flex items-center gap-1.5"><Zap size={14} className="text-blue-500" /> Power Hub Wall</span>
            </div>

            {/* Main Physical Seat Grid */}
            <div className="space-y-4 max-w-5xl mx-auto">
              {seatRows.map((row) => (
                <div key={row.rowNumber} className="flex flex-col md:flex-row items-center gap-3">
                  <div className="w-16 text-[11px] font-black text-slate-400 uppercase tracking-wider hidden md:block text-right pr-2">
                    Row {row.rowNumber}
                  </div>

                  <div className="flex-1 w-full grid grid-cols-11 gap-2 md:gap-3 items-center">
                    
                    {/* Bank 1 (Left Bank - 5 Seats) */}
                    <div className="col-span-5 grid grid-cols-5 gap-1.5 md:gap-2">
                      {row.bank1.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}, ${seat.powerOutlet ? 'Power outlet available' : ''}`}
                            onClick={() => handleSeatClick(seat)}
                            title={`Seat ${seat.seatNumber} (${seat.ui_status})${seat.powerOutlet ? ' • Power Outlet' : ''}`}
                            className={`
                              relative h-14 rounded-2xl flex flex-col items-center justify-center p-1.5 border-2 text-xs font-black
                              transition-all duration-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue focus:ring-offset-2
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-4 ring-blue-500/30 scale-105 shadow-md z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 hover:-translate-y-1 hover:shadow-md cursor-pointer'
                              }
                            `}
                          >
                            <span className="text-[10px] tracking-tight flex items-center gap-0.5">
                              {isSelected && <Check size={12} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={11} />}
                              {seat.seatNumber}
                            </span>

                            <span className="text-[8px] font-normal opacity-90 block mt-0.5">
                              {isSelected ? 'Selected' : seat.ui_status}
                            </span>

                            {seat.powerOutlet && (
                              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Central Physical Hall Aisle */}
                    <div className="col-span-1 h-full flex flex-col items-center justify-center bg-slate-200/80 rounded-xl py-1 text-[9px] font-black text-slate-500 font-mono uppercase tracking-widest text-center border border-slate-300/80">
                      <span>A</span>
                      <span>I</span>
                      <span>S</span>
                      <span>L</span>
                      <span>E</span>
                    </div>

                    {/* Bank 2 (Right Bank - 5 Seats) */}
                    <div className="col-span-5 grid grid-cols-5 gap-1.5 md:gap-2">
                      {row.bank2.map((seat) => {
                        const isSelected = selectedSeat?.id === seat.id;
                        const isAvailable = !isSlotCancelled && (seat.status_state === 'available' || seat.ui_status === 'Available');
                        const isUserBooked = seat.isUserBooked || seat.status_state === 'user_booked';
                        const isOccupied = seat.status_state === 'occupied' || seat.ui_status === 'Occupied';
                        const isReserved = seat.status_state === 'reserved' || seat.ui_status === 'Reserved';
                        const isHeld = seat.status_state === 'held' || seat.ui_status === 'Held';
                        const isMaintenance = seat.status_state === 'maintenance' || seat.ui_status === 'Maintenance';

                        return (
                          <button
                            key={seat.id}
                            type="button"
                            disabled={!isAvailable}
                            aria-disabled={!isAvailable}
                            aria-pressed={isSelected}
                            aria-label={`Seat ${seat.seatNumber}, ${seat.ui_status}, ${seat.powerOutlet ? 'Power outlet available' : ''}`}
                            onClick={() => handleSeatClick(seat)}
                            title={`Seat ${seat.seatNumber} (${seat.ui_status})${seat.powerOutlet ? ' • Power Outlet' : ''}`}
                            className={`
                              relative h-14 rounded-2xl flex flex-col items-center justify-center p-1.5 border-2 text-xs font-black
                              transition-all duration-200 shadow-xs focus:outline-none focus:ring-2 focus:ring-brandBlue focus:ring-offset-2
                              ${isSlotCancelled
                                ? 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed'
                                : isSelected
                                ? 'bg-brandBlue text-white border-blue-700 ring-4 ring-blue-500/30 scale-105 shadow-md z-10'
                                : isUserBooked
                                ? 'bg-blue-50 text-brandBlue border-brandBlue ring-2 ring-blue-300 font-extrabold'
                                : isOccupied
                                ? 'bg-rose-500 text-white border-rose-600 cursor-not-allowed opacity-90'
                                : isReserved
                                ? 'bg-amber-500 text-white border-amber-600 cursor-not-allowed opacity-90'
                                : isHeld
                                ? 'bg-teal-500 text-white border-teal-600 cursor-not-allowed opacity-90'
                                : isMaintenance
                                ? 'bg-slate-400 text-white border-slate-500 cursor-not-allowed opacity-80'
                                : 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 hover:-translate-y-1 hover:shadow-md cursor-pointer'
                              }
                            `}
                          >
                            <span className="text-[10px] tracking-tight flex items-center gap-0.5">
                              {isSelected && <Check size={12} className="stroke-[3]" />}
                              {isUserBooked && !isSelected && <User size={11} />}
                              {seat.seatNumber}
                            </span>

                            <span className="text-[8px] font-normal opacity-90 block mt-0.5">
                              {isSelected ? 'Selected' : seat.ui_status}
                            </span>

                            {seat.powerOutlet && (
                              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-300 border border-amber-500" title="Power Socket" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Entrance Label */}
            <div className="flex items-center justify-between text-[11px] font-extrabold text-slate-400 uppercase tracking-widest pt-2 border-t border-slate-200 px-2">
              <span>Main Entry Door (Quiet Zone)</span>
              <span>Water Dispenser & Locker Access</span>
            </div>
          </div>
        )}

        {/* 6. SELECTED SEAT DETAILS & CONFIRMATION PANEL */}
        {selectedSeat && !isSlotCancelled && (
          <div className="bg-gradient-to-r from-blue-900 to-navy text-white rounded-3xl p-6 shadow-xl space-y-4 animate-in slide-in-from-bottom duration-300">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-500/30 text-blue-200 border-blue-400/40 text-xs font-mono font-extrabold">
                    SELECTED SEAT
                  </Badge>
                  <span className="text-2xl font-black tracking-tight text-white">{selectedSeat.seatNumber}</span>
                </div>
                <p className="text-xs text-blue-200 font-medium">
                  Main Quiet Reading Hall • Floor 1 • {selectedSeat.type || 'Quiet Study (Zone A)'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onSelectSeat(null)}
                  className="bg-white/10 hover:bg-white/20 text-white font-bold h-11 px-4 rounded-2xl border-white/20 text-xs"
                >
                  Clear Selection
                </Button>
                
                <Button
                  type="button"
                  disabled={bookingLoading}
                  onClick={() => onConfirmBooking(selectedSeat)}
                  className="bg-brandBlue hover:bg-blue-600 text-white font-black h-11 px-7 rounded-2xl shadow-lg text-xs flex items-center gap-2"
                >
                  {bookingLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Reserving Seat {selectedSeat.seatNumber}...
                    </>
                  ) : (
                    <>
                      Confirm & Reserve Seat {selectedSeat.seatNumber} <ChevronRight size={16} />
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-white/10 rounded-2xl p-3.5 backdrop-blur-xs text-xs">
              <div>
                <span className="text-blue-300 text-[10px] font-bold uppercase block">Date</span>
                <span className="font-bold text-white">{dateStr}</span>
              </div>

              <div>
                <span className="text-blue-300 text-[10px] font-bold uppercase block">Time Window</span>
                <span className="font-bold text-white font-mono">
                  {slot ? `${format12HourTime(slot.startTime)} – ${format12HourTime(slot.endTime)}` : '10:00 AM – 11:00 AM'}
                </span>
              </div>

              <div>
                <span className="text-blue-300 text-[10px] font-bold uppercase block">Facilities</span>
                <span className="font-bold text-white flex items-center gap-1">
                  {selectedSeat.powerOutlet ? '⚡ Power Socket' : 'Standard Desk'}
                  {selectedSeat.nearWindow ? ' • Window View' : ''}
                </span>
              </div>

              <div>
                <span className="text-blue-300 text-[10px] font-bold uppercase block">Policy Reminder</span>
                <span className="font-bold text-amber-300">15-Min Check-in Window</span>
              </div>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
