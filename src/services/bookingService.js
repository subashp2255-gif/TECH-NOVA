import { supabase, isUUID } from '../lib/supabase';
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

  async getSlotsAvailability(dateStr, studentId = null) {
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
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending'].includes(bStatus);
      });

      const isBookedByStudent = studentId ? slotBookings.some(b => {
        const bStudentId = b.student_id || b.studentId;
        return String(bStudentId) === String(studentId);
      }) : false;

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
        isBookedByStudent,
        isDisabledByAdmin,
        disabledReason: disabledRecord ? disabledRecord.reason : (slot.cancellation_reason || null)
      };
    });
  },

  async getMyBookings(studentId) {
    if (!studentId) return [];

    if (isUUID(studentId)) {
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          return data.map(b => ({
            id: b.id,
            bookingCode: b.booking_code,
            studentId: b.student_id,
            studentName: b.student_name,
            studentEmail: b.student_email,
            collegeId: b.college_id,
            bookingDate: b.booking_date,
            slotId: b.slot_id,
            slotTime: b.slot_time || `${b.start_time || ''} – ${b.end_time || ''}`,
            floorId: b.floor_id,
            floorName: b.floor_name || 'Ground Floor',
            seatId: b.seat_id,
            seatNumber: b.seat_number || b.seat_id,
            status: b.status,
            cancellationReason: b.cancellation_reason,
            createdAt: b.created_at
          }));
        }
      } catch { /* fallback */ }
    }

    // Local fallback
    const bookings = (await db.read('seatsync_bookings')) || [];
    return bookings
      .filter(b => String(b.studentId || b.student_id) === String(studentId))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
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
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending'].includes(String(b.status || '').toLowerCase())
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
      (b.slotId === slotId || b.slot_id === slotId) &&
      !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(String(b.status || '').toLowerCase())
    );
    const bookedSeatIds = new Set(activeBookings.map(b => b.seatId || b.seat_id));

    return seats.map(s => ({
      ...s,
      seatNumber: s.seatNumber || s.id,
      ui_status: bookedSeatIds.has(s.id) ? 'Occupied' : (s.status === 'maintenance' ? 'Maintenance' : 'Available')
    }));
  },

  async getBookingsForSlot(slotId, dateStr) {
    let resolvedSlotId = slotId;
    if (slotId && !isUUID(slotId)) {
      const slotRow = await slotService.getSlotByCode(slotId);
      if (slotRow?.id) resolvedSlotId = slotRow.id;
    }

    if (isUUID(resolvedSlotId)) {
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .eq('slot_id', resolvedSlotId)
          .eq('booking_date', dateStr)
          .in('status', ['confirmed', 'awaiting_check_in', 'checked_in']);

        if (!error && data) return data;
      } catch { /* fallback */ }
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    return bookings.filter(b => 
      (b.slotId === slotId || b.slot_id === slotId || b.slotId === resolvedSlotId) &&
      (b.bookingDate === dateStr || b.booking_date === dateStr) &&
      ['confirmed', 'active', 'checked_in', 'awaiting_check_in'].includes(String(b.status || '').toLowerCase())
    );
  },

  async createBooking(user, dateStr, slot, floorId, seatId) {
    if (!user || !user.id) {
      throw new Error('User authentication required.');
    }

    try {
      let resolvedSlotId = slot?.id || slot;
      if (resolvedSlotId && !isUUID(resolvedSlotId)) {
        const slotRow = await slotService.getSlotByCode(resolvedSlotId);
        if (slotRow?.id) resolvedSlotId = slotRow.id;
      }

      let resolvedSeatId = seatId;
      if (resolvedSeatId && !isUUID(resolvedSeatId)) {
        let seatNumStr = resolvedSeatId;
        const match = String(resolvedSeatId).match(/\d+/);
        if (match) {
          const num = parseInt(match[0], 10);
          seatNumStr = `A-${100 + num}`;
        }

        const { data: seatRow } = await supabase
          .from('seats')
          .select('id')
          .or(`seat_number.eq.${resolvedSeatId},seat_number.eq.${seatNumStr}`)
          .maybeSingle();

        if (seatRow?.id) {
          resolvedSeatId = seatRow.id;
        } else {
          const matchNum = String(resolvedSeatId).match(/\d+/);
          const index = matchNum ? Math.max(0, parseInt(matchNum[0], 10) - 1) : 0;
          const { data: seatsList } = await supabase.from('seats').select('id').order('seat_number');
          if (seatsList && seatsList[index]) {
            resolvedSeatId = seatsList[index].id;
          }
        }
      }

      const { data: libRow } = await supabase.from('libraries').select('id').limit(1).maybeSingle();
      const { data: roomRow } = await supabase.from('rooms').select('id, floor_id').limit(1).maybeSingle();
      const { data: floorRow } = await supabase.from('floors').select('id').limit(1).maybeSingle();

      const libId = libRow?.id;
      const roomId = roomRow?.id;
      const fId = (isUUID(floorId) ? floorId : roomRow?.floor_id) || floorRow?.id;

      if (libId && roomId && fId && isUUID(resolvedSeatId) && isUUID(resolvedSlotId)) {
        const { data: result, error } = await supabase.rpc('create_booking', {
          p_library_id: libId,
          p_floor_id: fId,
          p_room_id: roomId,
          p_seat_id: resolvedSeatId,
          p_slot_id: resolvedSlotId,
          p_booking_date: dateStr,
          p_booking_source: 'online'
        });

        if (error) throw new Error(error.message);
        if (result && result.success) return result;
        if (result && result.error) throw new Error(result.error);
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch') && !err.message.includes('RPC')) {
        throw err;
      }
    }

    // Local fallback creation with strict validation
    const bookings = (await db.read('seatsync_bookings')) || [];

    // Check 1: Does student ALREADY have an active booking in this slot for this date?
    const existingStudentBooking = bookings.find(b => {
      const bStudentId = b.studentId || b.student_id;
      const bSlotId = b.slotId || b.slot_id;
      const bDate = b.bookingDate || b.booking_date;
      const bStatus = String(b.status || '').toLowerCase();

      return String(bStudentId) === String(user.id) &&
        (bSlotId === slot.id || bSlotId === slot.name) &&
        bDate === dateStr &&
        !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(bStatus);
    });

    if (existingStudentBooking) {
      throw new Error('You already have an active reservation for this time slot.');
    }

    // Check 2: Is this seat ALREADY reserved by anyone in this slot for this date?
    const existingSeatBooking = bookings.find(b => {
      const bSeatId = b.seatId || b.seat_id;
      const bSlotId = b.slotId || b.slot_id;
      const bDate = b.bookingDate || b.booking_date;
      const bStatus = String(b.status || '').toLowerCase();

      return (bSeatId === seatId) &&
        (bSlotId === slot.id || bSlotId === slot.name) &&
        bDate === dateStr &&
        !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(bStatus);
    });

    if (existingSeatBooking) {
      throw new Error('This seat is already reserved for this time slot.');
    }

    const seats = (await db.read('seatsync_seats')) || [];
    const targetSeat = seats.find(s => s.id === seatId) || { seatNumber: 'A-101' };

    const newBooking = {
      id: `BK-${Date.now()}`,
      booking_code: `SS-${Math.floor(1000 + Math.random() * 9000)}`,
      studentId: user.id,
      studentName: user.name,
      studentEmail: user.email,
      collegeId: user.collegeId || user.registrationNumber || '24AD042',
      bookingDate: dateStr,
      slotId: slot.id,
      slotTime: `${slot.startTime} – ${slot.endTime}`,
      floorId,
      floorName: 'Ground Floor',
      seatId,
      seatNumber: targetSeat.seatNumber || targetSeat.seat_number || 'A-101',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.push(newBooking);
    await db.write('seatsync_bookings', bookings);
    return newBooking;
  },

  async cancelBooking(bookingId, studentId) {
    if (isUUID(bookingId)) {
      try {
        const { data: result, error } = await supabase.rpc('cancel_booking', {
          p_booking_id: bookingId,
          p_reason: 'Cancelled by student'
        });

        if (!error && result) {
          return result;
        }
      } catch { /* fallback */ }
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => b.id === bookingId && String(b.studentId || b.student_id) === String(studentId));

    if (!target) {
      throw new Error('Booking not found or not owned by student.');
    }

    target.status = 'cancelled';
    target.cancelledAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);
    return target;
  }
};
