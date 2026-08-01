import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { bookingService } from '../../services/bookingService';
import { waitlistService } from '../../services/waitlistService';
import { db } from '../../services/mockDatabase';
import { useSync } from '../../hooks/useSync';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import { format } from 'date-fns';
import { 
  Calendar, Clock, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, MapPin, Search, Users, Sparkles, Filter, ChevronRight
} from 'lucide-react';
import toast from 'react-hot-toast';
import WaitlistModal from '../../components/student/WaitlistModal';

function format12HourTime(timeStr) {
  if (!timeStr) return '';
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  return `${formattedHours}:${minutes < 10 ? '0' : ''}${minutes} ${period}`;
}

export default function FindSeat() {
  const { user } = useAuth();
  const [slots, setSlots] = useState([]);
  const [floors, setFloors] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedFloor, setSelectedFloor] = useState(null);
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [seats, setSeats] = useState([]);
  const [selectedSeat, setSelectedSeat] = useState(null);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const [waitlistSummaries, setWaitlistSummaries] = useState({});
  const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);
  const [waitlistModalMode, setWaitlistModalMode] = useState('confirm');
  const [targetWaitlistSlot, setTargetWaitlistSlot] = useState(null);

  const tomorrowDate = bookingService.getTomorrowDateStr();

  const fetchWaitlistSummaries = async (slotsList) => {
    try {
      const summaries = {};
      for (const slot of slotsList) {
        summaries[slot.id] = await waitlistService.getWaitlistSummaryForSlot(tomorrowDate, slot.id, user?.id);
      }
      setWaitlistSummaries(summaries);
    } catch (err) {
      console.warn('Failed to fetch waitlist summaries:', err);
    }
  };

  const fetchInitialData = async () => {
    try {
      setLoadingSlots(true);
      const [slotsData, floorsData] = await Promise.all([
        bookingService.getSlotsAvailability(tomorrowDate),
        bookingService.getFloors()
      ]);
      setSlots(slotsData);
      setFloors(floorsData || []);
      if (floorsData && floorsData.length > 0) {
        setSelectedFloor(floorsData[0]);
      }
      await fetchWaitlistSummaries(slotsData);
    } catch (error) {
      toast.error('Failed to load available slots.');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useSync((event) => {
    if (event?.type === 'storage_change' || event?.type?.startsWith('WAITLIST_')) {
      fetchInitialData();
    }
  });

  const fetchSeats = async () => {
    if (!selectedSlot || !selectedFloor) return;
    try {
      setLoadingSeats(true);
      const seatsData = await bookingService.getSeatsForSlot(
        selectedFloor.id,
        tomorrowDate,
        selectedSlot.id
      );
      setSeats(seatsData);
      setSelectedSeat(null);
    } catch (error) {
      toast.error('Failed to load seats map.');
    } finally {
      setLoadingSeats(false);
    }
  };

  useEffect(() => {
    if (selectedSlot && selectedFloor) {
      fetchSeats();
    }
  }, [selectedSlot, selectedFloor]);

  const handleSeatClick = (seat) => {
    if (seat.ui_status !== 'Available') return;
    setSelectedSeat(seat);
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlot || !selectedFloor || !selectedSeat || !user) return;
    setBookingLoading(true);
    try {
      await bookingService.createBooking(
        user,
        tomorrowDate,
        selectedSlot,
        selectedFloor.id,
        selectedSeat.id
      );
      toast.success(`Seat ${selectedSeat.seatNumber} successfully booked!`);
      setConfirmModalOpen(false);
      setSelectedSeat(null);
      setSelectedSlot(null);
      fetchInitialData();
    } catch (error) {
      toast.error(error.message || 'Failed to complete booking.');
    } finally {
      setBookingLoading(false);
    }
  };

  const filteredSeats = useMemo(() => {
    if (selectedZone === 'ALL') return seats;
    return seats.filter(s => s.zoneId === selectedZone);
  }, [seats, selectedZone]);

  const getSlotStatusInfo = (available, total) => {
    const pct = Math.round((available / total) * 100);
    if (available === 0) {
      return {
        label: 'Fully Booked',
        badgeClass: 'bg-red-100 text-red-800 border-red-300 font-bold',
        progressClass: 'bg-red-500',
        percent: 0,
        isDisabled: false,
        isFullyBooked: true
      };
    }
    if (pct <= 25) {
      return {
        label: `${available} Seats Left`,
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-bold',
        progressClass: 'bg-amber-500',
        percent: pct,
        isDisabled: false,
        isFullyBooked: false
      };
    }
    return {
      label: `${available} Available`,
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-bold',
      progressClass: 'bg-emerald-500',
      percent: pct,
      isDisabled: false,
      isFullyBooked: false
    };
  };

  const handleViewWaitingList = (event, slot) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setTargetWaitlistSlot(slot);
    setWaitlistModalMode('details');
    setWaitlistModalOpen(true);
  };

  const handleJoinWaitingList = (event, slot) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    setTargetWaitlistSlot(slot);
    setWaitlistModalMode('confirm');
    setWaitlistModalOpen(true);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="space-y-2 pb-2 border-b border-slate-200/80">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Book a Library Seat</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium">
          Select a time slot for tomorrow ({format(new Date(tomorrowDate), 'EEEE, d MMMM yyyy')}) and pick your seat.
        </p>
      </div>

      {/* 1. SLOT SELECTION */}
      {!selectedSlot ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy flex items-center gap-2">
              <Clock size={20} className="text-brandBlue" /> Step 1: Select Time Slot
            </h2>
            <Badge variant="outline" className="text-xs font-semibold">Tomorrow's Slots</Badge>
          </div>

          {loadingSlots ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))' }}>
              {[1, 2, 3, 4].map(i => <div key={i} className="h-36 bg-white rounded-xl border border-slate-200 animate-pulse"></div>)}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))' }}>
              {slots.map((slot, index) => {
                const isDisabled = slot.isDisabledByAdmin;
                const status = isDisabled 
                  ? { label: 'Cancelled by Library', badgeClass: 'bg-red-100 text-red-800 border-red-300 font-bold', isDisabled: true }
                  : getSlotStatusInfo(slot.availableCount, slot.totalCount);
                const isMorning = index < 4;
                const summary = waitlistSummaries[slot.id] || {};
                const isStudentWaiting = summary.isStudentWaiting;

                return (
                  <Card
                    key={slot.id}
                    onClick={() => {
                      if (isDisabled) return;
                      if (status.isFullyBooked) {
                        if (isStudentWaiting) handleViewWaitingList(null, slot);
                        else handleJoinWaitingList(null, slot);
                      } else {
                        setSelectedSlot(slot);
                      }
                    }}
                    className={`transition-all border-2 rounded-xl p-3.5 ${
                      isDisabled
                        ? 'border-red-200 bg-red-50/20 cursor-not-allowed opacity-90'
                        : status.isFullyBooked
                        ? isStudentWaiting ? 'border-amber-400 bg-amber-50/20 cursor-pointer' : 'border-red-200 bg-slate-50/40 cursor-pointer'
                        : 'border-slate-200 hover:border-brandBlue/50 hover:shadow-md bg-white cursor-pointer'
                    }`}
                  >
                    <CardContent className="p-0 space-y-3">
                      <div className="flex justify-between items-start gap-1.5">
                        <Badge variant="outline" className="text-[10px] font-bold uppercase bg-slate-50">
                          {isMorning ? 'Morning' : 'Afternoon'}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${status.badgeClass}`}>
                          {status.label}
                        </Badge>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-navy">{slot.label}</h3>
                        <p className="text-[10px] text-slate-500 font-mono font-semibold">
                          {format12HourTime(slot.startTime)} – {format12HourTime(slot.endTime)}
                        </p>
                      </div>

                      {isDisabled ? (
                        <div className="p-2 bg-red-100/60 border border-red-200 rounded-lg text-[10px] font-bold text-red-900 space-y-0.5">
                          <p className="flex items-center gap-1 text-red-700">
                            <AlertCircle size={12} className="shrink-0" /> This time slot is unavailable.
                          </p>
                          {slot.disabledReason && (
                            <p className="text-[9.5px] font-medium text-slate-600">Reason: {slot.disabledReason}</p>
                          )}
                        </div>
                      ) : isStudentWaiting ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between text-[10px]">
                          <span className="font-bold text-amber-950 flex items-center gap-1">
                            <Clock size={11} className="text-amber-600" /> Waitlisted
                          </span>
                          <Badge className="bg-amber-500 text-white font-mono font-bold text-[10px] px-1.5 py-0.5">
                            #{summary.studentPosition}
                          </Badge>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-slate-700">{slot.availableCount}/{slot.totalCount} seats</span>
                            <span className="text-slate-500 font-mono">{status.percent}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-full rounded-full ${status.progressClass}`} style={{ width: `${status.percent}%` }} />
                          </div>
                        </div>
                      )}

                      <Button
                        type="button"
                        disabled={isDisabled}
                        variant={isDisabled ? "outline" : status.isFullyBooked ? (isStudentWaiting ? "secondary" : "outline") : "default"}
                        className={`w-full h-9 text-xs font-bold rounded-lg ${
                          isDisabled
                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                            : status.isFullyBooked
                            ? isStudentWaiting ? 'bg-amber-100 text-amber-900 border-amber-300' : 'border-red-300 text-red-700 hover:bg-red-50'
                            : 'bg-brandBlue text-white'
                        }`}
                      >
                        {isDisabled
                          ? 'Slot Cancelled'
                          : status.isFullyBooked
                          ? isStudentWaiting ? 'View Waiting Status' : 'Join Waiting List'
                          : 'Select Seat'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 2. SEAT MAP SELECTION */
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSelectedSlot(null); setSelectedSeat(null); }}
                className="text-xs font-bold rounded-xl"
              >
                ← Change Slot
              </Button>
              <div>
                <h3 className="text-sm font-bold text-navy">{selectedSlot.label}</h3>
                <p className="text-[11px] text-slate-500 font-mono">
                  {format12HourTime(selectedSlot.startTime)} – {format12HourTime(selectedSlot.endTime)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-semibold">Zone:</span>
              <button
                onClick={() => setSelectedZone('ALL')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${selectedZone === 'ALL' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                All Zones
              </button>
              <button
                onClick={() => setSelectedZone('zone-a')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${selectedZone === 'zone-a' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Zone A (Quiet)
              </button>
              <button
                onClick={() => setSelectedZone('zone-b')}
                className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${selectedZone === 'zone-b' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                Zone B (Group)
              </button>
            </div>
          </div>

          <Card className="border border-slate-200/90 rounded-2xl bg-white p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h3 className="text-base font-bold text-navy flex items-center gap-2">
                <MapPin size={18} className="text-brandBlue" /> Select Seat on Ground Floor
              </h3>
              <div className="flex items-center gap-4 text-xs font-medium">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-emerald-100 border border-emerald-400" /> Available</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-brandBlue" /> Selected</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-md bg-slate-200" /> Occupied</span>
              </div>
            </div>

            {loadingSeats ? (
              <div className="p-12 text-center text-xs text-slate-400 animate-pulse">Loading interactive seat map...</div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-10 gap-3">
                {filteredSeats.map(seat => {
                  const isAvailable = seat.ui_status === 'Available';
                  const isSelected = selectedSeat?.id === seat.id;

                  return (
                    <button
                      key={seat.id}
                      disabled={!isAvailable}
                      onClick={() => handleSeatClick(seat)}
                      className={`
                        h-12 rounded-xl flex flex-col items-center justify-center border text-xs font-bold transition-all
                        ${!isAvailable
                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                          : isSelected
                            ? 'bg-brandBlue text-white border-brandBlue ring-2 ring-brandBlue/30 shadow-md scale-105'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 hover:-translate-y-0.5'
                        }
                      `}
                    >
                      <span>{seat.seatNumber}</span>
                      <span className="text-[9px] font-normal opacity-80">{seat.zoneId === 'zone-a' ? 'A' : 'B'}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedSeat && (
              <div className="bg-blue-50/80 border border-blue-200 rounded-2xl p-4 flex items-center justify-between animate-in fade-in">
                <div>
                  <h4 className="text-sm font-bold text-navy">Selected: Seat {selectedSeat.seatNumber}</h4>
                  <p className="text-xs text-slate-500 font-medium">{selectedSeat.type} • Ground Floor</p>
                </div>
                <Button
                  onClick={() => setConfirmModalOpen(true)}
                  className="bg-brandBlue hover:bg-blue-700 text-white font-bold h-10 px-6 rounded-xl text-xs"
                >
                  Confirm & Reserve Pass →
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* CONFIRMATION DIALOG */}
      <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-navy">Confirm Seat Reservation</DialogTitle>
            <DialogDescription className="text-xs text-slate-500 pt-1">
              Review your reservation details for tomorrow.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Student:</span> <strong className="text-navy">{user?.name} ({user?.collegeId})</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Date:</span> <strong className="text-navy">{tomorrowDate}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Slot:</span> <strong className="text-brandBlue font-mono">{selectedSlot?.label} ({selectedSlot?.startTime} – {selectedSlot?.endTime})</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Seat:</span> <strong className="text-navy">{selectedSeat?.seatNumber}</strong></div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setConfirmModalOpen(false)} disabled={bookingLoading} className="rounded-xl text-xs">
              Cancel
            </Button>
            <Button onClick={handleConfirmBooking} disabled={bookingLoading} className="bg-brandBlue hover:bg-blue-700 text-white font-bold rounded-xl text-xs">
              {bookingLoading ? 'Processing...' : 'Confirm Booking'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <WaitlistModal
        isOpen={waitlistModalOpen}
        onClose={() => setWaitlistModalOpen(false)}
        mode={waitlistModalMode}
        slot={targetWaitlistSlot}
        dateStr={tomorrowDate}
        user={user}
        summary={targetWaitlistSlot ? waitlistSummaries[targetWaitlistSlot.id] : null}
        onSuccess={fetchInitialData}
      />
    </div>
  );
}
