import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { useSync } from '../../hooks/useSync';
import { bookingService } from '../../services/bookingService';
import { slotService } from '../../services/slotService';
import { occupancyService } from '../../services/occupancyService';
import { Card, CardContent } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../../components/shared/Dialog';
import { 
  Clock, Armchair, Shield, CheckCircle2, ChevronRight, AlertCircle, 
  MapPin, Sparkles, Filter, Lock, Check, Zap, Users, ShieldAlert, Ban
} from 'lucide-react';
import { format, addDays } from 'date-fns';
import toast from 'react-hot-toast';

function format12HourTime(timeStr) {
  if (!timeStr) return '';
  if (timeStr.includes('AM') || timeStr.includes('PM')) return timeStr;
  const [hours, minutes] = timeStr.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const formattedHours = hours % 12 || 12;
  return `${formattedHours}:${minutes < 10 ? '0' : ''}${minutes} ${period}`;
}

export default function FindSeat() {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const tomorrowDate = useMemo(() => format(addDays(new Date(), 1), 'yyyy-MM-dd'), []);
  
  const [floors, setFloors] = useState([]);
  const [selectedFloor, setSelectedFloor] = useState(null);
  
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  
  const [seats, setSeats] = useState([]);
  const [selectedZone, setSelectedZone] = useState('ALL');
  const [selectedSeat, setSelectedSeat] = useState(null);
  
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  const fetchInitialData = async () => {
    try {
      setLoadingSlots(true);
      const [floorsData, studentSlots] = await Promise.all([
        bookingService.getFloors(),
        slotService.getStudentSlots({ bookingDate: tomorrowDate })
      ]);
      
      setFloors(floorsData || []);
      if (floorsData && floorsData.length > 0 && !selectedFloor) {
        setSelectedFloor(floorsData[0]);
      }

      if (studentSlots && studentSlots.length > 0) {
        setSlots(studentSlots.map(s => ({
          id: s.slot_id,
          slot_occurrence_id: s.slot_occurrence_id,
          name: s.slot_name,
          label: s.slot_name,
          startTime: s.start_time,
          endTime: s.end_time,
          effectiveStatus: s.effective_status,
          isBookingEnabled: s.is_booking_enabled,
          disabledReason: s.disabled_reason,
          disabledByName: s.disabled_by_name,
          hasStudentBooking: s.has_student_booking,
          studentBookingStatus: s.student_booking_status,
          availableCount: s.is_booking_enabled ? 40 : 0,
          totalCount: 40
        })));
      } else {
        // Fallback default slots availability
        const availableSlots = await bookingService.getSlotsAvailability(tomorrowDate, user?.id);
        setSlots(availableSlots.map(s => ({
          ...s,
          effectiveStatus: s.isDisabledByAdmin ? 'cancelled' : 'active',
          isBookingEnabled: !s.isDisabledByAdmin
        })));
      }
    } catch (err) {
      toast.error('Failed to load slots availability: ' + err.message);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, [tomorrowDate, user?.id]);

  useSync(['slot_occurrences', 'slots', 'bookings', 'notifications'], fetchInitialData);

  const fetchSeats = async () => {
    if (!selectedSlot || !selectedFloor) return;
    try {
      setLoadingSeats(true);
      const seatsData = await bookingService.getSeatsForSlot(
        selectedFloor.id,
        tomorrowDate,
        selectedSlot.id,
        user?.id
      );
      setSeats(seatsData);
    } catch {
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

  const handleConfirmSeatBooking = async (targetSeat) => {
    const seatToBook = targetSeat || selectedSeat;
    if (!selectedSlot || !selectedFloor || !seatToBook || !user) return;

    if (selectedSlot.effectiveStatus === 'cancelled' || selectedSlot.effectiveStatus === 'globally_disabled' || selectedSlot.isBookingEnabled === false) {
      toast.error('This slot occurrence has been cancelled by the administrator.');
      return;
    }

    setBookingLoading(true);
    try {
      await bookingService.createBooking(
        user,
        tomorrowDate,
        selectedSlot,
        selectedFloor.id,
        seatToBook.id
      );
      toast.success(`Seat ${seatToBook.seatNumber} successfully booked! Reservation confirmed.`);
      setConfirmModalOpen(false);
      setSelectedSeat(null);
      setSelectedSlot(null);
      fetchInitialData();
    } catch (error) {
      if (error.message?.includes('reserved by another student') || error.message?.includes('already') || error.message?.includes('booked')) {
        toast.error('This seat was just reserved by another student. Please select another available seat.');
        setSelectedSeat(null);
        fetchSeats();
      } else {
        toast.error(error.message || 'Failed to complete booking.');
      }
    } finally {
      setBookingLoading(false);
    }
  };

  const filteredSeats = useMemo(() => {
    if (selectedZone === 'ALL') return seats;
    return seats.filter(s => s.zoneId === selectedZone);
  }, [seats, selectedZone]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300 pb-16">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight">Reserve a Seat</h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Select a time slot for tomorrow (<span className="font-mono font-bold text-navy">{format(new Date(tomorrowDate), 'EEEE, d MMMM yyyy')}</span>) and pick your seat.
        </p>
      </div>

      {/* 1. SLOT SELECTION */}
      {!selectedSlot ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-navy flex items-center gap-2">
              <Clock size={20} className="text-brandBlue" /> Step 1: Select Time Slot
            </h2>
            <Badge variant="outline" className="text-xs font-semibold">Tomorrow's Slots</Badge>
          </div>

          {loadingSlots ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))' }}>
              {[1, 2, 3, 4].map(i => <div key={i} className="h-36 bg-white rounded-xl border border-slate-200 animate-pulse"></div>)}
            </div>
          ) : slots.length === 0 ? (
            <Card className="p-8 text-center bg-white border border-slate-200 rounded-2xl space-y-3">
              <p className="text-xs text-slate-500 font-semibold">No operational time slots found for tomorrow.</p>
              <Button onClick={fetchInitialData} className="bg-brandBlue text-white font-bold text-xs h-9 px-4 rounded-xl">
                Reload Time Slots
              </Button>
            </Card>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))' }}>
              {slots.map((slot, index) => {
                const isCancelled = slot.effectiveStatus === 'cancelled' || slot.effectiveStatus === 'globally_disabled' || slot.effectiveStatus === 'disabled' || slot.isBookingEnabled === false;
                const isAlreadyBooked = Boolean(slot.hasStudentBooking && slot.studentBookingStatus && slot.studentBookingStatus !== 'cancelled');
                const isMorning = index < 4;

                return (
                  <Card
                    key={slot.id}
                    onClick={() => {
                      if (isCancelled) {
                        toast.error(`This slot was cancelled by administrator. Reason: ${slot.disabledReason || 'Library maintenance'}`);
                        return;
                      }
                      if (isAlreadyBooked) {
                        toast.error('You already have an active reservation for this time slot.');
                        return;
                      }
                      setSelectedSlot(slot);
                    }}
                    className={`transition-all border-2 rounded-2xl p-4 relative overflow-hidden ${
                      isCancelled
                        ? 'border-red-500 bg-red-50/60 cursor-not-allowed shadow-xs'
                        : isAlreadyBooked
                        ? 'border-emerald-500 bg-emerald-50/30 cursor-pointer shadow-xs'
                        : 'border-slate-200 hover:border-brandBlue/50 hover:shadow-md bg-white cursor-pointer'
                    }`}
                  >
                    <CardContent className="p-0 space-y-3">
                      <div className="flex justify-between items-start gap-1.5">
                        <Badge variant="outline" className="text-[10px] font-bold uppercase bg-white">
                          {isMorning ? 'Morning' : 'Afternoon'}
                        </Badge>
                        
                        {isCancelled ? (
                          <Badge className="bg-red-600 text-white font-bold text-[10px] uppercase shadow-xs">
                            CANCELLED BY ADMIN
                          </Badge>
                        ) : isAlreadyBooked ? (
                          <Badge className="bg-emerald-600 text-white font-bold text-[10px]">
                            Your Booking
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">
                            Available
                          </Badge>
                        )}
                      </div>

                      <div>
                        <h3 className="text-sm font-black text-navy">{slot.label || slot.name}</h3>
                        <p className="text-[10px] text-slate-500 font-mono font-semibold">
                          {format12HourTime(slot.startTime)} – {format12HourTime(slot.endTime)}
                        </p>
                      </div>

                      {/* Cancelled Banner */}
                      {isCancelled ? (
                        <div className="p-2.5 bg-white border border-red-300 rounded-xl text-[10.5px] space-y-1 shadow-xs">
                          <div className="font-bold text-red-700 flex items-center gap-1">
                            <ShieldAlert size={13} className="text-red-600" />
                            <span>Slot Cancelled by Administrator</span>
                          </div>
                          <p className="text-[10px] text-slate-600 font-medium">
                            <strong>Reason:</strong> {slot.disabledReason || 'Library closed for maintenance'}
                          </p>
                          {slot.hasStudentBooking && (
                            <p className="text-[10px] text-red-600 font-bold border-t border-red-100 pt-1 mt-1">
                              Your reservation for this slot was cancelled by Admin.
                            </p>
                          )}
                        </div>
                      ) : isAlreadyBooked ? (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2 flex items-center justify-between text-[10px]">
                          <span className="font-bold text-emerald-900 flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-emerald-600" /> Reserved by You
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-slate-700">Operational Capacity</span>
                            <span className="text-emerald-600 font-mono font-black">Open for Booking</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-500 w-full" />
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 2. SEAT SELECTION GRID */
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 border border-slate-200 rounded-2xl shadow-xs">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-brandBlue text-white font-bold text-xs">{selectedSlot.label || selectedSlot.name}</Badge>
                <span className="text-xs text-slate-500 font-mono font-bold">
                  {format12HourTime(selectedSlot.startTime)} – {format12HourTime(selectedSlot.endTime)}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Selected Floor: <strong className="text-navy">{selectedFloor?.name}</strong>
              </p>
            </div>

            <Button
              onClick={() => { setSelectedSlot(null); setSelectedSeat(null); }}
              variant="outline"
              className="text-xs font-bold rounded-xl h-9"
            >
              ← Change Time Slot
            </Button>
          </div>

          {/* Seat Map Controls */}
          <div className="grid lg:grid-cols-4 gap-6">
            <div className="lg:col-span-3 space-y-4">
              {/* Filter Zones */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1 shrink-0">
                  <Filter size={13} /> Zone:
                </span>
                <button
                  onClick={() => setSelectedZone('ALL')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${selectedZone === 'ALL' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All Seats (40)
                </button>
                <button
                  onClick={() => setSelectedZone('zone-a')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${selectedZone === 'zone-a' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Zone A — Quiet Study (S-01 to S-20)
                </button>
                <button
                  onClick={() => setSelectedZone('zone-b')}
                  className={`px-3 py-1 rounded-xl text-xs font-bold transition-colors ${selectedZone === 'zone-b' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  Zone B — Collaborative (S-21 to S-40)
                </button>
              </div>

              {/* Grid Layout */}
              <Card className="border border-slate-200 bg-white rounded-2xl p-6 shadow-xs">
                {loadingSeats ? (
                  <div className="py-12 text-center text-xs font-mono text-slate-400 animate-pulse">Loading seat map layout...</div>
                ) : (
                  <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2.5">
                    {filteredSeats.map(seat => {
                      const isSelected = selectedSeat?.id === seat.id;
                      const isAvailable = seat.status_state === 'available';
                      const isUserBooked = seat.status_state === 'user_booked';

                      return (
                        <button
                          key={seat.id}
                          disabled={!isAvailable}
                          onClick={() => setSelectedSeat(seat)}
                          className={`
                            h-12 rounded-xl flex flex-col items-center justify-center font-mono transition-all relative border
                            ${isSelected
                              ? 'bg-brandBlue text-white border-brandBlue ring-4 ring-brandBlue/20 scale-105 shadow-md z-10'
                              : isUserBooked
                              ? 'bg-emerald-600 text-white border-emerald-600 cursor-not-allowed font-bold'
                              : seat.status_state === 'occupied'
                              ? 'bg-rose-100 text-rose-800 border-rose-200 cursor-not-allowed opacity-80'
                              : seat.status_state === 'reserved'
                              ? 'bg-amber-100 text-amber-800 border-amber-200 cursor-not-allowed opacity-80'
                              : seat.status_state === 'maintenance'
                              ? 'bg-slate-200 text-slate-500 border-slate-300 cursor-not-allowed'
                              : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:border-brandBlue hover:bg-brandBlue/10 hover:scale-105 cursor-pointer font-bold'}
                          `}
                        >
                          <span className="text-xs font-bold">{seat.seatNumber}</span>
                          {seat.powerOutlet && <span className="text-[8px] opacity-75">⚡</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>

            {/* Selected Seat Details Sidebar */}
            <div className="space-y-4">
              <Card className="border border-slate-200 bg-white rounded-2xl p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-navy flex items-center gap-2">
                  <Armchair size={18} className="text-brandBlue" /> Selected Seat Details
                </h3>

                {selectedSeat ? (
                  <div className="space-y-3">
                    <div className="p-4 bg-blue-50/50 border border-blue-200/80 rounded-xl space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-black text-navy font-mono">{selectedSeat.seatNumber}</span>
                        <Badge className="bg-emerald-600 text-white text-[10px]">Available</Badge>
                      </div>
                      <p className="text-xs font-semibold text-slate-700">{selectedSeat.type}</p>
                    </div>

                    <div className="space-y-2 text-xs text-slate-600">
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Power Socket:</span>
                        <span className="font-bold text-navy">{selectedSeat.powerOutlet ? 'Available (⚡)' : 'No'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Window View:</span>
                        <span className="font-bold text-navy">{selectedSeat.nearWindow ? 'Yes' : 'No'}</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-slate-100">
                        <span>Accessible:</span>
                        <span className="font-bold text-navy">{selectedSeat.isAccessible ? 'Yes (♿)' : 'Standard'}</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => setConfirmModalOpen(true)}
                      className="w-full bg-brandBlue hover:bg-blue-700 text-white font-bold text-xs h-11 rounded-xl shadow-md flex items-center justify-center gap-2"
                    >
                      <span>Proceed to Confirm</span> <ChevronRight size={16} />
                    </Button>
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                    <Armchair size={32} className="mx-auto text-slate-300" />
                    <p>Click on any available green seat grid item to select.</p>
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* Booking Confirmation Dialog */}
      {selectedSeat && selectedSlot && (
        <Dialog open={confirmModalOpen} onOpenChange={setConfirmModalOpen}>
          <DialogContent className="max-w-md bg-white rounded-3xl p-6 space-y-4 border border-slate-200 shadow-2xl">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-lg font-black text-navy flex items-center gap-2">
                <Sparkles size={20} className="text-brandBlue" /> Confirm Seat Reservation
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                Please review your library booking details before confirming.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Student Name:</span>
                <span className="font-bold text-navy">{user?.name || user?.fullName}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Registration No:</span>
                <span className="font-mono font-bold text-indigo-600">{user?.collegeId || user?.registration_number}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Booking Date:</span>
                <span className="font-mono font-bold text-navy">{tomorrowDate}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/60">
                <span className="text-slate-500 font-medium">Time Slot:</span>
                <span className="font-bold text-navy">{selectedSlot.label || selectedSlot.name} ({format12HourTime(selectedSlot.startTime)} - {format12HourTime(selectedSlot.endTime)})</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-medium">Selected Seat:</span>
                <Badge className="bg-brandBlue text-white font-mono font-bold text-xs">{selectedSeat.seatNumber}</Badge>
              </div>
            </div>

            <DialogFooter className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setConfirmModalOpen(false)} className="rounded-xl text-xs font-bold h-10">
                Cancel
              </Button>
              <Button
                onClick={() => handleConfirmSeatBooking(selectedSeat)}
                disabled={bookingLoading}
                className="bg-brandBlue hover:bg-blue-700 text-white font-bold text-xs h-10 px-5 rounded-xl shadow-md"
              >
                {bookingLoading ? 'Reserving Seat...' : 'Confirm Reservation →'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
