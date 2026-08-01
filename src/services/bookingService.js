import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { slotService } from './slotService';
import { defaultSlots } from '../data/seedData';
import { format, addDays } from 'date-fns';

export const bookingService = {
  getTomorrowDateStr() {
    return format(addDays(new Date(), 1), 'yyyy-MM-dd');
  },

  async getFloors() {
    try {
      const { data, error } = await supabase.from('floors').select('*').order('floor_number');
      if (!error && data && data.length > 0) return data;
    } catch { /* fallback */ }
    let floors = await db.read('seatsync_floors');
    if (!floors || floors.length === 0) {
      floors = [
        { id: 'floor-1', name: 'Ground Floor (Main Hall)', floor_number: 1, status: 'active' },
        { id: 'floor-2', name: 'First Floor (Silent Zone)', floor_number: 2, status: 'active' }
      ];
    }
    return floors;
  },

  async getSlotsAvailability(dateStr) {
    let sourceSlots = [];
    let sourceSeats = [];
    let sourceBookings = [];

    // 1. Attempt fetching from Supabase
    try {
      const [{ data: slots }, { data: seats }, { data: bookings }] = await Promise.all([
        supabase.from('slots').select('*').order('start_time'),
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*').eq('booking_date', dateStr)
      ]);

      if (slots && slots.length > 0) {
        sourceSlots = slots.map(s => ({
          id: s.id,
          name: s.name,
          label: s.name,
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          cancellation_reason: s.cancellation_reason
        }));
        sourceSeats = seats || [];
        sourceBookings = bookings || [];
      }
    } catch { /* proceed to fallback */ }

    // 2. Fallback to local db if Supabase returned 0 slots
    if (sourceSlots.length === 0) {
      try {
        const localSlots = await db.read('seatsync_slots');
        const localSeats = await db.read('seatsync_seats');
        const localBookings = await db.read('seatsync_bookings');

        if (localSlots && localSlots.length > 0) {
          sourceSlots = localSlots;
        } else {
          sourceSlots = defaultSlots;
          await db.write('seatsync_slots', defaultSlots).catch(() => {});
        }

        sourceSeats = localSeats || [];
        sourceBookings = localBookings || [];
      } catch {
        sourceSlots = defaultSlots;
      }
    }

    const activeSeatsCount = sourceSeats.filter(s =>
      s.status === 'available' || s.status === 'active'
    ).length || 40;

    const disabledList = await slotService.getDisabledOccurrences().catch(() => []);

    return sourceSlots.map(slot => {
      const slotId = slot.id;
      const disabledRecord = disabledList.find(d => 
        d.slotId === slotId && 
        (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
      );
      const isDisabledByAdmin = slot.status === 'disabled' || slot.status === 'cancelled' || !!disabledRecord;

      const slotBookings = sourceBookings.filter(b => {
        const bSlotId = b.slot_id || b.slotId;
        const bDate = b.booking_date || b.bookingDate;
        const bStatus = String(b.status || '').toLowerCase();

        return (bSlotId === slotId || bSlotId === slot.name || bSlotId === slot.label) &&
          (bDate === dateStr) &&
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active'].includes(bStatus);
      });

      const bookedCount = slotBookings.length;
      const availableCount = isDisabledByAdmin ? 0 : Math.max(0, activeSeatsCount - bookedCount);

      return {
        id: slot.id,
        name: slot.name || slot.label,
        label: slot.label || slot.name,
        startTime: slot.startTime || slot.start_time,
        endTime: slot.endTime || slot.end_time,
        totalCount: activeSeatsCount,
        bookedCount,
        availableCount,
        isFullyBooked: availableCount === 0,
        isDisabledByAdmin,
        disabledReason: disabledRecord ? disabledRecord.reason : (slot.cancellation_reason || null)
      };
    });
  },

  async getSeatsForSlot(floorId, dateStr, slotId) {
    try {
      const [{ data: seats }, { data: bookings }] = await Promise.all([
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*').eq('booking_date', dateStr)
      ]);

      if (seats && seats.length > 0) {
        const activeBookings = (bookings || []).filter(b => 
          (b.slot_id === slotId || b.slotId === slotId) &&
          ['confirmed', 'awaiting_check_in', 'checked_in'].includes(b.status)
        );
        const bookedSeatIds = new Set(activeBookings.map(b => b.seat_id || b.seatId));

        return seats.map(s => ({
          id: s.id,
          seatNumber: s.seat_number,
          type: s.seat_type || 'Quiet Study (Zone A)',
          zoneId: s.is_accessible ? 'zone-a' : 'zone-b',
          powerOutlet: s.has_power_socket,
          nearWindow: s.is_accessible,
          ui_status: bookedSeatIds.has(s.id) ? 'Occupied' : (s.status === 'maintenance' ? 'Maintenance' : 'Available')
        }));
      }
    } catch { /* fallback */ }

    // Fallback local db
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const activeBookings = bookings.filter(b => 
      b.bookingDate === dateStr &&
      b.slotId === slotId &&
      !['cancelled', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN', 'slot_cancelled'].includes(b.status)
    );
    const bookedSeatIds = new Set(activeBookings.map(b => b.seatId));

    return seats.map(s => ({
      ...s,
      seatNumber: s.seatNumber || s.id,
      ui_status: bookedSeatIds.has(s.id) ? 'Occupied' : (s.status === 'maintenance' ? 'Maintenance' : 'Available')
    }));
  },

  async createBooking(user, dateStr, slot, floorId, seatId) {
    try {
      const { data: result, error } = await supabase.rpc('create_booking', {
        p_student_id: user.id,
        p_booking_date: dateStr,
        p_slot_id: slot.id,
        p_seat_id: seatId
      });

      if (!error && result) {
        if (result.success === false) {
          throw new Error(result.error || 'Failed to complete booking');
        }
        return result;
      }
    } catch (err) {
      if (err.message && !err.message.includes('rpc')) {
        throw err;
      }
    }

    // Local fallback creation
    const bookings = (await db.read('seatsync_bookings')) || [];
    const seats = (await db.read('seatsync_seats')) || [];
    const targetSeat = seats.find(s => s.id === seatId) || { seatNumber: 'A-101' };

    const newBooking = {
      id: `BK-${Date.now()}`,
      booking_code: `SS-${Math.floor(1000 + Math.random() * 9000)}`,
      studentId: user.id,
      studentName: user.name,
      studentEmail: user.email,
      collegeId: user.collegeId || user.registrationNumber || '2024CSE001',
      bookingDate: dateStr,
      slotId: slot.id,
      slotTime: `${slot.startTime} – ${slot.endTime}`,
      floorId,
      floorName: 'Ground Floor',
      seatId,
      seatNumber: targetSeat.seatNumber || 'A-101',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.push(newBooking);
    await db.write('seatsync_bookings', bookings);
    return newBooking;
  },

  async cancelBooking(bookingId, studentId) {
    try {
      const { data: result, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: bookingId,
        p_student_id: studentId,
        p_reason: 'Cancelled by student'
      });

      if (!error && result) {
        return result;
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => b.id === bookingId && b.studentId === studentId);

    if (!target) {
      throw new Error('Booking not found or not owned by student.');
    }

    target.status = 'cancelled';
    target.cancelledAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);
    return target;
  }
};
