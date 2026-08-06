import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { occupancyService, getTodayKolkataDate, getCurrentOrNextKolkataSlot } from '../../services/occupancyService';
import { librarianService } from '../../services/librarianService';
import { useSync } from '../../hooks/useSync';
import { db } from '../../services/mockDatabase';
import { defaultSlots } from '../../data/seedData';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  Eye, Armchair, RefreshCw, Layers, Calendar, Clock, MapPin, AlertCircle, CheckCircle2, 
  User, LogOut, LogIn, Wrench, ShieldAlert, Lock, Activity, Filter, RotateCcw, 
  ChevronDown, ChevronUp, Zap, Check, Building2
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
    heldCount: 0,
    occupancyPercentage: 0
  });

  const [loading, setLoading] = useState(true);
  const [filterLoading, setFilterLoading] = useState(false);
  const [queryError, setQueryError] = useState(null);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Connection & Activity Log states
  const [connectionStatus, setConnectionStatus] = useState('live'); // 'live', 'reconnecting', 'offline', 'updating'
  const [activityLog, setActivityLog] = useState([
    { id: 'act-1', timeStr: '10:04 AM', seatNumber: 'S-08', action: 'Checked in by Subash P', status: 'occupied' },
    { id: 'act-2', timeStr: '10:01 AM', seatNumber: 'S-12', action: 'Reservation confirmed', status: 'reserved' },
    { id: 'act-3', timeStr: '09:55 AM', seatNumber: 'S-24', action: 'Seat released (Checkout)', status: 'available' },
    { id: 'act-4', timeStr: '09:42 AM', seatNumber: 'S-36', action: 'Marked under maintenance', status: 'maintenance' }
  ]);
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  // 1. Fetch Libraries, Rooms, and Slots on mount
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
            { id: 'RM-01', name: 'Main Quiet Reading Hall (Ground Floor)' },
            { id: 'RM-02', name: 'First Floor Reference & Research Hall' }
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
  const loadOccupancy = useCallback(async (isSilent = false) => {
    if (!selectedRoomId || !selectedDate || !selectedSlotId) return;

    if (!isSilent) {
      setLoading(true);
      setConnectionStatus('updating');
    }
    setQueryError(null);

    try {
      const res = await occupancyService.getOccupancy({
        roomId: selectedRoomId,
        bookingDate: selectedDate,
        slotId: selectedSlotId
      });

      if (res.error && !res.seats.length) {
        setQueryError(res.error);
        toast.error(`Database Query Error: ${res.error}`);
        setConnectionStatus('offline');
      } else {
        setOccupancyData(res);
        setLastUpdated(new Date());
        setConnectionStatus('live');
      }
    } catch {
      setConnectionStatus('offline');
    } finally {
      setLoading(false);
      setFilterLoading(false);
    }
  }, [selectedRoomId, selectedDate, selectedSlotId]);

  useEffect(() => {
    if (selectedRoomId && selectedDate && selectedSlotId) {
      setFilterLoading(true);
      loadOccupancy();
    }
  }, [loadOccupancy]);

  // 3. Supabase Realtime Subscription
  useEffect(() => {
    if (!selectedRoomId || !selectedDate || !selectedSlotId) return;

    setConnectionStatus('live');
    const channelName = `librarian-occupancy-${selectedRoomId}-${selectedDate}-${selectedSlotId}`;
    const channel = supabase.channel(channelName);

    ['bookings', 'seats', 'rooms', 'slots', 'seat_maintenance'].forEach(table => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          loadOccupancy(true);

          // Append to live activity feed
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const newAct = {
            id: `act-${Date.now()}`,
            timeStr,
            seatNumber: payload.new?.seat_number || 'S-12',
            action: `Realtime state update (${payload.table})`,
            status: payload.new?.status || 'updated'
          };
          setActivityLog(prev => [newAct, ...prev.slice(0, 7)]);
        }
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConnectionStatus('live');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        setConnectionStatus('reconnecting');
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedRoomId, selectedDate, selectedSlotId, loadOccupancy]);

  // Operational Seat Calculations (Excluding Maintenance)
  const maintenanceCount = useMemo(() => {
    return occupancyData.seats.filter(s => s.displayStatus === 'maintenance').length;
  }, [occupancyData.seats]);

  const operationalSeats = useMemo(() => {
    return Math.max(0, occupancyData.totalCapacity - maintenanceCount);
  }, [occupancyData.totalCapacity, maintenanceCount]);

  const checkedInCount = useMemo(() => {
    return occupancyData.seats.filter(s => s.displayStatus === 'occupied').length;
  }, [occupancyData.seats]);

  const reservedCount = useMemo(() => {
    return occupancyData.seats.filter(s => s.displayStatus === 'reserved').length;
  }, [occupancyData.seats]);

  const availableCount = useMemo(() => {
    return occupancyData.seats.filter(s => s.displayStatus === 'available').length;
  }, [occupancyData.seats]);

  const heldCount = useMemo(() => {
    return occupancyData.seats.filter(s => s.displayStatus === 'held' || s.displayStatus === 'allocated').length;
  }, [occupancyData.seats]);

  const utilizationPercent = useMemo(() => {
    if (operationalSeats === 0) return 0;
    return Math.round((checkedInCount / operationalSeats) * 100);
  }, [checkedInCount, operationalSeats]);

  const utilizationColor = useMemo(() => {
    if (utilizationPercent >= 85) return { stroke: '#EF4444', text: 'text-rose-600', bg: 'bg-rose-500/10' };
    if (utilizationPercent >= 60) return { stroke: '#F59E0B', text: 'text-amber-600', bg: 'bg-amber-500/10' };
    return { stroke: '#22C55E', text: 'text-emerald-600', bg: 'bg-emerald-500/10' };
  }, [utilizationPercent]);

  // Check-In / Check-Out Actions inside drawer
  const handleCheckInSeat = async (bookingId) => {
    try {
      await librarianService.processCheckIn(bookingId, null, 'Desk Checked In by Staff');
      toast.success(`Seat ${selectedSeat?.seatNumber} checked in! Desk updated to Occupied.`);
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setActivityLog(prev => [
        { id: `act-${Date.now()}`, timeStr, seatNumber: selectedSeat?.seatNumber || 'Seat', action: 'Manual Staff Check-In', status: 'occupied' },
        ...prev.slice(0, 7)
      ]);

      setSelectedSeat(null);
      await loadOccupancy();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-in.');
    }
  };

  const handleCheckOutSeat = async (bookingId) => {
    try {
      await librarianService.processCheckOut(bookingId, null);
      toast.success(`Seat ${selectedSeat?.seatNumber} checked out! Desk released.`);
      
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setActivityLog(prev => [
        { id: `act-${Date.now()}`, timeStr, seatNumber: selectedSeat?.seatNumber || 'Seat', action: 'Manual Staff Check-Out', status: 'available' },
        ...prev.slice(0, 7)
      ]);

      setSelectedSeat(null);
      await loadOccupancy();
    } catch (err) {
      toast.error(err.message || 'Failed to process check-out.');
    }
  };

  useSync(['seats', 'seatsync_seats', 'seatsync_maintenance'], () => loadOccupancy(true));

  const handleResolveMaintenance = async (seatNumberOrId) => {
    try {
      await librarianService.resolveSeatMaintenance(seatNumberOrId);
      toast.success(`Seat ${seatNumberOrId} activated! Live occupancy updated.`);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setActivityLog(prev => [
        { id: `act-${Date.now()}`, timeStr, seatNumber: selectedSeat?.seatNumber || 'Seat', action: 'Maintenance Ended (Activated)', status: 'available' },
        ...prev.slice(0, 7)
      ]);
      setSelectedSeat(null);
      await loadOccupancy();
    } catch {
      toast.error('Failed to activate seat.');
    }
  };

  const handleReportMaintenance = async (seatNumberOrId) => {
    try {
      await librarianService.reportSeatMaintenance({
        seatNumber: seatNumberOrId,
        category: 'Desk Maintenance',
        description: 'Flagged for maintenance by librarian'
      });
      toast.success(`Seat ${seatNumberOrId} set under maintenance! Live occupancy updated.`);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setActivityLog(prev => [
        { id: `act-${Date.now()}`, timeStr, seatNumber: selectedSeat?.seatNumber || 'Seat', action: 'Set Under Maintenance', status: 'maintenance' },
        ...prev.slice(0, 7)
      ]);
      setSelectedSeat(null);
      await loadOccupancy();
    } catch {
      toast.error('Failed to set maintenance status.');
    }
  };

  const handleResetToday = () => {
    setSelectedDate(getTodayKolkataDate());
    if (slots.length > 0) {
      const defSlot = getCurrentOrNextKolkataSlot(slots) || slots[0];
      setSelectedSlotId(defSlot.id);
    }
    toast.success('Filters reset to today in Asia/Kolkata.');
  };

  const currentRoomObj = rooms.find(r => r.id === selectedRoomId);
  const currentSlotObj = slots.find(s => s.id === selectedSlotId);

  // Group 40 seats into 4 rows of 10 seats for 2-bank physical layout
  const rows = useMemo(() => {
    const seatList = occupancyData.seats || [];
    const grouped = [];
    for (let i = 0; i < seatList.length; i += 10) {
      const rowSeats = seatList.slice(i, i + 10);
      grouped.push({
        bank1: rowSeats.slice(0, 5),
        bank2: rowSeats.slice(5, 10)
      });
    }
    return grouped;
  }, [occupancyData.seats]);

  const getSeatVisualConfig = (seat) => {
    const status = seat.displayStatus || 'available';
    switch (status) {
      case 'occupied':
        return {
          bg: 'bg-teal-600 text-white border-teal-700 shadow-teal-600/20',
          badgeBg: 'bg-teal-700 text-white',
          label: 'Occupied',
          icon: <User size={15} className="stroke-[2.5]" />
        };
      case 'reserved':
        return {
          bg: 'bg-brandBlue text-white border-blue-700 shadow-blue-600/20',
          badgeBg: 'bg-blue-700 text-white',
          label: 'Reserved',
          icon: <Calendar size={15} className="stroke-[2.5]" />
        };
      case 'held':
      case 'allocated':
        return {
          bg: 'bg-amber-500 text-white border-amber-600 shadow-amber-500/20',
          badgeBg: 'bg-amber-600 text-white',
          label: 'Held / Offer',
          icon: <Clock size={15} className="stroke-[2.5]" />
        };
      case 'maintenance':
        return {
          bg: 'bg-rose-600 text-white border-rose-700 shadow-rose-600/20',
          badgeBg: 'bg-rose-700 text-white',
          label: 'Maintenance',
          icon: <Wrench size={15} className="stroke-[2.5]" />
        };
      case 'blocked':
        return {
          bg: 'bg-slate-400 text-white border-slate-500',
          badgeBg: 'bg-slate-500 text-white',
          label: 'Blocked',
          icon: <Lock size={15} className="stroke-[2.5]" />
        };
      default: // available
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 hover:border-emerald-400',
          badgeBg: 'bg-emerald-100 text-emerald-800',
          label: 'Available',
          icon: <Armchair size={15} className="text-emerald-600 stroke-[2.5]" />
        };
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">

      {/* 1. ENHANCED PAGE HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
              <Eye className="text-teal-600" size={30} /> Live Library Occupancy
            </h1>
            <Badge className="bg-navy text-white text-[11px] font-mono font-extrabold px-3 py-1 rounded-xl shadow-xs">
              Operational Control Desk
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
            Monitor reservations, check-ins and seat availability in real time across reading halls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Connection Status Indicator */}
          <div className="flex items-center gap-2 bg-white border border-slate-200/90 rounded-2xl px-3.5 py-1.5 shadow-xs">
            {connectionStatus === 'live' && (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </span>
                <span className="text-xs font-mono font-bold text-emerald-700">Live Realtime</span>
              </>
            )}
            {connectionStatus === 'reconnecting' && (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs font-mono font-bold text-amber-700">Reconnecting...</span>
              </>
            )}
            {connectionStatus === 'offline' && (
              <>
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="text-xs font-mono font-bold text-rose-700">Offline</span>
              </>
            )}
            {connectionStatus === 'updating' && (
              <>
                <RefreshCw size={14} className="animate-spin text-brandBlue" />
                <span className="text-xs font-mono font-bold text-brandBlue">Updating...</span>
              </>
            )}
          </div>

          <div className="text-right hidden sm:block text-[11px] text-slate-400 font-mono">
            <div>Updated {lastUpdated.toLocaleTimeString()}</div>
            <div className="text-[10px] text-slate-500 font-bold">{selectedDate}</div>
          </div>

          <Button
            onClick={() => loadOccupancy()}
            className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold h-9 px-3.5 rounded-2xl border border-slate-300 shadow-xs flex items-center gap-1.5"
          >
            <RefreshCw size={14} className="text-teal-600" /> Refresh Map
          </Button>
        </div>
      </div>

      {/* 2. ENHANCED FILTER PANEL WITH STICKY CONTEXT BANNER */}
      <Card className="border border-slate-200 bg-white rounded-3xl p-5 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Reading Room Filter */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <MapPin size={12} className="text-brandBlue" /> Reading Room
            </label>
            <select
              value={selectedRoomId}
              disabled={filterLoading}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 cursor-pointer disabled:opacity-50"
            >
              {rooms.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Date Selector */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Calendar size={12} className="text-brandBlue" /> Date (Asia/Kolkata)
            </label>
            <input
              type="date"
              value={selectedDate}
              disabled={filterLoading}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 font-mono cursor-pointer disabled:opacity-50"
            />
          </div>

          {/* Slot Selector */}
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <label className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
              <Clock size={12} className="text-brandBlue" /> Operational Time Slot
            </label>
            <select
              value={selectedSlotId}
              disabled={filterLoading}
              onChange={(e) => setSelectedSlotId(e.target.value)}
              className="w-full h-10 bg-slate-50 border border-slate-300 text-navy font-bold text-xs rounded-2xl px-3.5 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 font-mono cursor-pointer disabled:opacity-50"
            >
              {slots.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({format12HourTime(s.startTime || s.start_time)} – {format12HourTime(s.endTime || s.end_time)})
                </option>
              ))}
            </select>
          </div>

          {/* Quick Actions */}
          <div className="space-y-1.5 flex items-end gap-2">
            <Button
              type="button"
              onClick={handleResetToday}
              className="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-2xl border border-slate-300 flex items-center justify-center gap-1.5"
            >
              <RotateCcw size={14} className="text-slate-500" /> Today (IST)
            </Button>
          </div>
        </div>

        {/* Selection Summary Banner */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs font-mono text-slate-600">
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-teal-600 shrink-0" />
            <span className="font-bold text-navy">{currentRoomObj?.name || 'Main Reading Room'}</span>
            <span>•</span>
            <span className="text-teal-600 font-bold">{selectedDate}</span>
            <span>•</span>
            <span className="text-slate-800 font-bold">{currentSlotObj?.name || 'Slot Window'}</span>
            <span className="text-slate-400 font-normal">
              ({format12HourTime(currentSlotObj?.startTime)} – {format12HourTime(currentSlotObj?.endTime)})
            </span>
          </div>
          <span className="text-[11px] text-slate-400 font-sans font-medium">Real-Time Operational Context</span>
        </div>
      </Card>

      {/* ERROR ALERT STATE */}
      {queryError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between text-xs text-rose-700 font-medium">
          <div className="flex items-center gap-2">
            <AlertCircle size={18} className="text-rose-600 shrink-0" />
            <span>Failed to load occupancy data from database: {queryError}</span>
          </div>
          <Button onClick={() => loadOccupancy()} className="bg-rose-600 text-white font-bold text-xs h-8 px-3 rounded-xl">
            Retry Query
          </Button>
        </div>
      )}

      {/* 3. REDESIGNED METRIC CARDS & CIRCULAR UTILIZATION GAUGE */}
      <div className="grid grid-cols-1 lg:grid-cols-6 gap-4">
        {/* SVG Circular Occupancy Ring Card */}
        <Card className="lg:col-span-2 border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider block">Current Occupancy</span>
            <div className={`text-3xl font-black font-mono ${utilizationColor.text}`}>
              {checkedInCount} / {operationalSeats}
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Operational Seats ({utilizationPercent}% active)
            </p>
            {maintenanceCount > 0 && (
              <p className="text-[10px] text-rose-600 font-semibold italic">
                *Excludes {maintenanceCount} maintenance seat{maintenanceCount > 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Circular SVG Ring */}
          <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="32" stroke="#E2E8F0" strokeWidth="7" fill="transparent" />
              <circle
                cx="40"
                cy="40"
                r="32"
                stroke={utilizationColor.stroke}
                strokeWidth="7"
                strokeDasharray={201.06}
                strokeDashoffset={201.06 - (utilizationPercent / 100) * 201.06}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className={`absolute text-center text-xs font-black font-mono ${utilizationColor.text}`}>
              {utilizationPercent}%
            </div>
          </div>
        </Card>

        {/* 4 Staggered Metric Cards */}
        <div className="lg:col-span-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Total Capacity */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
            <Card className="border border-slate-200/90 bg-white rounded-3xl p-4 shadow-xs hover:-translate-y-0.5 transition-all">
              <div className="flex items-center justify-between text-slate-400">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Total Seats</span>
                <Layers size={16} />
              </div>
              <h3 className="text-2xl font-black text-navy mt-2 font-mono">{occupancyData.totalCapacity}</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Configured in room</p>
            </Card>
          </motion.div>

          {/* Available Now */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
            <Card className="border border-emerald-200/80 bg-emerald-50/40 rounded-3xl p-4 shadow-xs hover:-translate-y-0.5 transition-all">
              <div className="flex items-center justify-between text-emerald-600">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Available Now</span>
                <Armchair size={16} />
              </div>
              <h3 className="text-2xl font-black text-emerald-700 mt-2 font-mono">{availableCount}</h3>
              <p className="text-[10px] text-emerald-600 font-medium mt-1">Ready for booking</p>
            </Card>
          </motion.div>

          {/* Checked-in Occupied */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
            <Card className="border border-teal-200/80 bg-teal-50/40 rounded-3xl p-4 shadow-xs hover:-translate-y-0.5 transition-all">
              <div className="flex items-center justify-between text-teal-600">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Checked-In</span>
                <User size={16} />
              </div>
              <h3 className="text-2xl font-black text-teal-700 mt-2 font-mono">{checkedInCount}</h3>
              <p className="text-[10px] text-teal-600 font-medium mt-1">Students seated</p>
            </Card>
          </motion.div>

          {/* Reserved Passes */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}>
            <Card className="border border-blue-200/80 bg-blue-50/40 rounded-3xl p-4 shadow-xs hover:-translate-y-0.5 transition-all">
              <div className="flex items-center justify-between text-brandBlue">
                <span className="text-[10px] font-extrabold uppercase tracking-wider">Reserved Passes</span>
                <Calendar size={16} />
              </div>
              <h3 className="text-2xl font-black text-brandBlue mt-2 font-mono">{reservedCount}</h3>
              <p className="text-[10px] text-blue-600 font-medium mt-1">Awaiting check-in</p>
            </Card>
          </motion.div>
        </div>
      </div>

      {/* 5. COMPACT RESPONSIVE STATUS LEGEND */}
      <Card className="border border-slate-200/90 bg-white rounded-3xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
          <span className="font-extrabold text-navy uppercase text-[10px] tracking-wider flex items-center gap-1.5">
            <Filter size={14} className="text-brandBlue" /> Seat Status Legend:
          </span>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-emerald-500 border border-emerald-400" />
              <span className="text-slate-700 font-bold">Available ({availableCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-teal-600 border border-teal-500" />
              <span className="text-slate-700 font-bold">Occupied ({checkedInCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-brandBlue border border-blue-500" />
              <span className="text-slate-700 font-bold">Reserved ({reservedCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-amber-500 border border-amber-400" />
              <span className="text-slate-700 font-bold">Held / Offer ({heldCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-lg bg-rose-600 border border-rose-500" />
              <span className="text-slate-700 font-bold">Maintenance ({maintenanceCount})</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 6 & 7. PHYSICAL 40-SEAT MAP MATRIX & RECENT ACTIVITY FEED */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Physical Seat Grid (3 cols on desktop) */}
        <Card className="lg:col-span-3 border border-slate-200/90 bg-white rounded-3xl p-6 shadow-xs space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-black text-navy flex items-center gap-2">
                <Layers size={18} className="text-teal-600" /> {currentRoomObj?.name || 'Main Quiet Reading Hall'}
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                Floor 1 • Quiet Zone • 40 Physical Desks (2 Seat Banks with Central Hall Aisle)
              </p>
            </div>
            <Badge className="bg-slate-100 text-slate-700 border-slate-200 text-xs font-mono font-bold">
              {operationalSeats} Operational Desks
            </Badge>
          </div>

          {/* Physical Hall Marker: Window Wall */}
          <div className="w-full bg-slate-100/80 border border-slate-200 rounded-2xl py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
            🪟 Large Quiet Window Wall (Natural Light)
          </div>

          {/* 4 Rows of 10 Seats (2 Banks of 5 separated by AISLE) */}
          {loading ? (
            <div className="p-16 text-center text-xs text-slate-400 font-mono animate-pulse">
              Loading physical seat layout & student reservation matrix...
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map((row, rowIdx) => (
                <div key={`row-${rowIdx}`} className="flex items-center justify-center gap-3 sm:gap-6">
                  {/* Bank 1 (5 Desks) */}
                  <div className="grid grid-cols-5 gap-2 sm:gap-3 flex-1">
                    {row.bank1.map(seat => {
                      const cfg = getSeatVisualConfig(seat);
                      return (
                        <motion.button
                          key={seat.seatId}
                          type="button"
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setSelectedSeat(seat)}
                          className={`
                            h-14 rounded-2xl border flex flex-col items-center justify-center p-1.5 transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandBlue
                            ${cfg.bg}
                          `}
                          title={`Seat ${seat.seatNumber} — ${cfg.label}`}
                        >
                          <div className="flex items-center gap-1">
                            {cfg.icon}
                            <span className="text-xs font-black font-mono">{seat.seatNumber}</span>
                          </div>
                          <span className="text-[9px] font-semibold opacity-90 truncate max-w-full">
                            {cfg.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>

                  {/* CENTRAL AISLE MARKER */}
                  <div className="w-10 sm:w-16 h-14 bg-slate-100/70 rounded-2xl border border-slate-200/80 flex flex-col items-center justify-center text-[9px] font-bold text-slate-400 uppercase tracking-tighter shrink-0 select-none">
                    <span>AISLE</span>
                    <span className="text-[7px]">🚶</span>
                  </div>

                  {/* Bank 2 (5 Desks) */}
                  <div className="grid grid-cols-5 gap-2 sm:gap-3 flex-1">
                    {row.bank2.map(seat => {
                      const cfg = getSeatVisualConfig(seat);
                      return (
                        <motion.button
                          key={seat.seatId}
                          type="button"
                          whileHover={{ y: -2, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setSelectedSeat(seat)}
                          className={`
                            h-14 rounded-2xl border flex flex-col items-center justify-center p-1.5 transition-all shadow-xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-brandBlue
                            ${cfg.bg}
                          `}
                          title={`Seat ${seat.seatNumber} — ${cfg.label}`}
                        >
                          <div className="flex items-center gap-1">
                            {cfg.icon}
                            <span className="text-xs font-black font-mono">{seat.seatNumber}</span>
                          </div>
                          <span className="text-[9px] font-semibold opacity-90 truncate max-w-full">
                            {cfg.label}
                          </span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Physical Hall Marker: Entry Door */}
          <div className="w-full bg-slate-100/80 border border-slate-200 rounded-2xl py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
            🚪 Main Entry Door & Turnstile Check-In Gate
          </div>
        </Card>

        {/* 11. RECENT LIVE ACTIVITY FEED (1 col on desktop) */}
        <Card className="lg:col-span-1 border border-slate-200/90 bg-white rounded-3xl p-5 shadow-xs space-y-4 h-fit">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-xs font-extrabold text-navy uppercase tracking-wider flex items-center gap-1.5">
              <Activity size={16} className="text-teal-600" /> Recent Live Activity
            </h3>
            <button
              type="button"
              onClick={() => setActivityCollapsed(!activityCollapsed)}
              className="lg:hidden text-slate-400 hover:text-slate-600"
            >
              {activityCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          </div>

          {!activityCollapsed && (
            <div className="space-y-2.5">
              <AnimatePresence initial={false}>
                {activityLog.map((act) => (
                  <motion.div
                    key={act.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span className="font-bold text-navy">{act.seatNumber}</span>
                      <span>{act.timeStr}</span>
                    </div>
                    <p className="text-[11px] font-bold text-slate-700">{act.action}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Card>
      </div>

      {/* 10. SEAT DETAILS DIALOG / POPOVER */}
      {selectedSeat && (
        <Dialog open={!!selectedSeat} onOpenChange={() => setSelectedSeat(null)}>
          <DialogContent className="max-w-md bg-white border border-slate-200 text-navy p-6 rounded-3xl space-y-4 shadow-2xl">
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center justify-between">
                <span>Seat {selectedSeat.seatNumber} Details</span>
                <Badge className={`text-xs font-bold ${getSeatVisualConfig(selectedSeat).badgeBg}`}>
                  {getSeatVisualConfig(selectedSeat).label}
                </Badge>
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                {currentRoomObj?.name || 'Main Quiet Reading Hall'} • Floor 1
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2.5 text-xs font-mono">
              <p className="text-slate-600">
                Current Status: <span className="font-bold text-navy uppercase">{getSeatVisualConfig(selectedSeat).label}</span>
              </p>

              {selectedSeat.displayStatus === 'maintenance' ? (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center gap-2 text-xs font-bold font-sans">
                    <Wrench size={16} className="text-rose-600 shrink-0" />
                    <span>Seat is under maintenance</span>
                  </div>
                  <p className="text-slate-600">
                    Reported By: <strong className="text-navy font-bold">{selectedSeat.maintenanceInfo?.reportedByLabel || 'Librarian'}</strong>
                  </p>
                  {selectedSeat.maintenanceInfo?.reason && (
                    <p className="text-slate-600">
                      Reason: <strong className="text-slate-800">{selectedSeat.maintenanceInfo.reason}</strong>
                    </p>
                  )}
                </div>
              ) : selectedSeat.booking ? (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <p className="text-slate-600">Student: <strong className="text-navy">{selectedSeat.booking.studentName}</strong></p>
                  <p className="text-slate-600">College Reg No: <strong className="text-indigo-600">{selectedSeat.booking.studentRegistrationNumber}</strong></p>
                  <p className="text-slate-600">Booking Code: <strong className="text-teal-600">{selectedSeat.booking.bookingCode}</strong></p>
                  <p className="text-slate-600">Time Slot: <strong className="text-slate-800">{selectedSeat.booking.slotName}</strong></p>
                  {selectedSeat.booking.checkedInAt && (
                    <p className="text-emerald-700">Checked In: {new Date(selectedSeat.booking.checkedInAt).toLocaleTimeString()}</p>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 italic">No active reservation for this date and time slot.</p>
              )}
            </div>

            {/* Staff Operational Actions */}
            <div className="space-y-2 pt-1">
              {selectedSeat.booking && selectedSeat.displayStatus === 'reserved' && (
                <Button
                  onClick={() => handleCheckInSeat(selectedSeat.booking.id)}
                  className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <LogIn size={16} /> Process Check-In →
                </Button>
              )}

              {selectedSeat.booking && selectedSeat.displayStatus === 'occupied' && (
                <Button
                  onClick={() => handleCheckOutSeat(selectedSeat.booking.id)}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <LogOut size={16} /> Process Check-Out →
                </Button>
              )}

              {selectedSeat.displayStatus === 'maintenance' ? (
                <Button
                  type="button"
                  onClick={() => handleResolveMaintenance(selectedSeat.seatNumber)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <CheckCircle2 size={16} /> Activate Seat (End Maintenance) →
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => handleReportMaintenance(selectedSeat.seatNumber)}
                  className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-10 rounded-2xl flex items-center justify-center gap-2 shadow-md"
                >
                  <Wrench size={16} /> Set Under Maintenance →
                </Button>
              )}

              <Button
                onClick={() => setSelectedSeat(null)}
                variant="outline"
                className="w-full text-slate-700 font-bold text-xs h-10 rounded-2xl border-slate-300"
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
