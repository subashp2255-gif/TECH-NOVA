import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { db } from '../../services/mockDatabase';
import { bookingService } from '../../services/bookingService';
import { librarianService } from '../../services/librarianService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/shared/Card';
import { Button } from '../../components/shared/Button';
import { Input } from '../../components/shared/Input';
import { Badge } from '../../components/shared/Badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/shared/Dialog';
import {
  UserPlus, Search, Calendar, Clock, MapPin, CheckCircle2,
  AlertTriangle, QrCode, Printer, Sparkles, User, Armchair
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function WalkInAllocationPage() {
  const { user: staffUser } = useAuth();
  const [students, setStudents] = useState([]);
  const [slots, setSlots] = useState([]);
  const [seats, setSeats] = useState([]);
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [selectedSeatId, setSelectedSeatId] = useState('');
  const [autoCheckIn, setAutoCheckIn] = useState(true);

  const [loading, setLoading] = useState(false);
  const [bookingResult, setBookingResult] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, [selectedDate]);

  const loadInitialData = async () => {
    try {
      const [usersData, slotsData, seatsData] = await Promise.all([
        db.read('seatsync_users') || [],
        bookingService.getSlotsAvailability(selectedDate),
        db.read('seatsync_seats') || []
      ]);
      setStudents(usersData.filter(u => u.role === 'STUDENT'));
      setSlots(slotsData);
      setSeats(seatsData);
      if (slotsData.length > 0 && !selectedSlotId) {
        setSelectedSlotId(slotsData[0].id);
      }
    } catch (err) {
      console.warn('Failed to load walkin data:', err);
    }
  };

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(searchStudent.toLowerCase()) ||
    (s.collegeId && s.collegeId.toLowerCase().includes(searchStudent.toLowerCase())) ||
    (s.email && s.email.toLowerCase().includes(searchStudent.toLowerCase()))
  );

  const availableSeats = seats.filter(seat => {
    if (seat.status === 'maintenance' || seat.isMaintenance) return false;
    return true; // Simple filter for available seats
  });

  const handleCreateWalkIn = async (e) => {
    e.preventDefault();
    if (!selectedStudent) {
      toast.error('Please select a student for the walk-in booking.');
      return;
    }
    if (!selectedSlotId) {
      toast.error('Please select a time slot.');
      return;
    }
    if (!selectedSeatId) {
      toast.error('Please select an available seat.');
      return;
    }

    const slotObj = slots.find(s => String(s.id) === String(selectedSlotId));
    const seatObj = seats.find(s => String(s.id) === String(selectedSeatId));

    setLoading(true);
    try {
      const res = await librarianService.createWalkInBooking({
        student: selectedStudent,
        seat: seatObj,
        slot: slotObj,
        dateStr: selectedDate,
        staffUser,
        autoCheckIn
      });

      setBookingResult(res);
      toast.success(`Walk-In booking created for ${selectedStudent.name} (Seat ${seatObj.seatNumber})!`);
    } catch (err) {
      toast.error(err.message || 'Failed to create walk-in booking.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="pb-2 border-b border-slate-200">
        <h1 className="text-2xl sm:text-3xl font-black text-navy tracking-tight flex items-center gap-2">
          <UserPlus className="text-teal-600" size={28} /> Walk-In Seat Allocation Desk
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 font-medium mt-1">
          Allocate instant library seats for students arriving at the library desk without prior reservations.
        </p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 items-start">
        {/* STEP 1: STUDENT SELECTION */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-5 shadow-xs space-y-4 lg:col-span-1">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <User size={18} className="text-teal-600" /> 1. Select Student
          </h2>

          <div className="relative">
            <Search className="absolute left-3 top-3 text-slate-400" size={16} />
            <Input
              type="text"
              placeholder="Search student name or Reg ID..."
              value={searchStudent}
              onChange={(e) => setSearchStudent(e.target.value)}
              className="pl-9 h-10 bg-slate-50 border-slate-300 text-xs text-navy rounded-xl focus:border-teal-600"
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
            {filteredStudents.map(student => (
              <div
                key={student.id}
                onClick={() => setSelectedStudent(student)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedStudent?.id === student.id
                    ? 'border-teal-500 bg-teal-50 text-teal-900 font-bold'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300 text-slate-700'
                }`}
              >
                <p className="font-extrabold text-navy">{student.name}</p>
                <p className="text-[10px] text-slate-500 font-mono">ID: {student.collegeId || student.email}</p>
              </div>
            ))}
          </div>

          {selectedStudent && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl space-y-1 text-xs">
              <span className="text-[10px] font-bold text-teal-700 uppercase tracking-wider block">Selected Student</span>
              <p className="font-extrabold text-navy">{selectedStudent.name}</p>
              <p className="text-[11px] text-teal-800 font-mono">{selectedStudent.collegeId || selectedStudent.email}</p>
            </div>
          )}
        </Card>

        {/* STEP 2 & 3: DATE, SLOT & SEAT SELECTION */}
        <Card className="border border-slate-200/80 bg-white rounded-2xl p-6 shadow-xs space-y-6 lg:col-span-2">
          <h2 className="text-base font-bold text-navy flex items-center gap-2">
            <Armchair size={18} className="text-teal-600" /> 2. Choose Slot & Available Seat
          </h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Booking Date</label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-10 bg-slate-50 border-slate-300 text-navy text-xs rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 block">Time Slot</label>
              <select
                value={selectedSlotId}
                onChange={(e) => setSelectedSlotId(e.target.value)}
                className="w-full h-10 bg-slate-50 border border-slate-300 text-navy text-xs font-medium rounded-xl px-3 focus:border-teal-600"
              >
                {slots.map(s => (
                  <option key={s.id} value={s.id} disabled={s.isDisabledByAdmin}>
                    {s.label} ({s.startTime} - {s.endTime}) {s.isDisabledByAdmin ? '[CANCELLED]' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 block">Select Available Seat</label>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-2 bg-slate-50 border border-slate-200 rounded-xl">
              {availableSeats.map(seat => (
                <button
                  key={seat.id}
                  type="button"
                  onClick={() => setSelectedSeatId(seat.id)}
                  className={`p-2.5 rounded-xl border text-center font-bold text-xs transition-all ${
                    String(selectedSeatId) === String(seat.id)
                      ? 'border-teal-600 bg-teal-600 text-white shadow-xs'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {seat.seatNumber}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
            <input
              type="checkbox"
              id="autoCheckIn"
              checked={autoCheckIn}
              onChange={(e) => setAutoCheckIn(e.target.checked)}
              className="w-4 h-4 accent-teal-600 rounded"
            />
            <label htmlFor="autoCheckIn" className="text-xs font-bold text-navy cursor-pointer">
              Perform Instant Check-In (Activate Seat Pass Immediately)
            </label>
          </div>

          <Button
            onClick={handleCreateWalkIn}
            disabled={loading || !selectedStudent || !selectedSeatId}
            className="w-full h-11 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
          >
            <UserPlus size={18} /> Confirm Walk-In Allocation & Issue Pass →
          </Button>
        </Card>
      </div>

      {/* CONFIRMATION MODAL */}
      {bookingResult && (
        <Dialog open={!!bookingResult} onOpenChange={() => setBookingResult(null)}>
          <DialogContent className="max-w-md bg-white border-2 border-teal-500 text-navy p-6 rounded-2xl space-y-4 shadow-2xl">
            <DialogHeader className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 border border-teal-200 flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 size={32} />
              </div>
              <DialogTitle className="text-lg font-black text-navy">Walk-In Pass Generated!</DialogTitle>
              <DialogDescription className="text-xs text-slate-500 font-medium">
                Walk-in reservation successfully issued for {bookingResult.studentName}.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-xl text-center space-y-3">
              <div className="bg-white p-3 rounded-xl border border-slate-200 inline-block shadow-xs">
                <QrCode size={120} className="text-navy" />
              </div>
              <div className="space-y-0.5 text-xs font-mono">
                <p className="font-extrabold text-teal-600">ID: {bookingResult.id}</p>
                <p className="text-slate-700">Seat: {bookingResult.seatNumber} ({bookingResult.floorName})</p>
                <p className="text-slate-700">Slot: {bookingResult.slotTime}</p>
                <p className="text-slate-500 text-[10px]">Source: WALK-IN DESK</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => window.print()}
                variant="outline"
                className="flex-1 h-10 border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl"
              >
                <Printer size={14} className="mr-1.5" /> Print Pass
              </Button>
              <Button
                onClick={() => setBookingResult(null)}
                className="flex-1 h-10 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl"
              >
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
