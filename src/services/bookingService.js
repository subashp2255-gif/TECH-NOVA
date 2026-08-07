import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { slotService } from './slotService.js';
import { defaultSlots } from '../data/seedData.js';
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
          .select(`
            *,
            seats (seat_number),
            slots (name, start_time, end_time)
          `)
          .eq('student_id', studentId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(b => {
            const rawSeat = b.seats?.seat_number || b.seat_number;
            const cleanSeatNumber = (rawSeat && !isUUID(rawSeat)) ? rawSeat : 'S-01';

            return {
              id: b.id,
              bookingCode: b.booking_code,
              studentId: b.student_id,
              studentName: b.student_name,
              studentEmail: b.student_email,
              collegeId: b.college_id,
              bookingDate: b.booking_date,
              slotId: b.slot_id,
              slotTime: b.slot_time || (b.slots ? `${b.slots.start_time || ''} – ${b.slots.end_time || ''}` : '09:00 AM – 10:00 AM'),
              floorId: b.floor_id,
              floorName: b.floor_name || 'Ground Floor',
              seatId: b.seat_id,
              seatNumber: cleanSeatNumber,
              status: b.status,
              cancellationReason: b.cancellation_reason,
              cancellationSource: b.cancellation_source,
              cancelledAt: b.cancelled_at,
              cancelledBy: b.cancelled_by,
              createdAt: b.created_at
            };
          });
        }
      } catch { /* fallback */ }
    }

    // Local fallback
    const bookings = (await db.read('seatsync_bookings')) || [];
    return bookings
      .filter(b => String(b.studentId || b.student_id) === String(studentId))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  },

  async getStudentBookings(studentId) {
    return this.getMyBookings(studentId);
  },

  async getSeatsForSlot(floorId, dateStr, slotId, currentUserId = null) {
    try {
      const [{ data: seats }, { data: bookings }] = await Promise.all([
        supabase.from('seats').select('*').order('seat_number', { ascending: true }),
        supabase.from('bookings').select('*').eq('booking_date', dateStr)
      ]);

      if (seats && seats.length > 0) {
        // Filter ONLY online seats for student seat map (S-01 to S-40)
        const onlineSeats = seats.filter(s => s.allocation_mode !== 'walk_in_only');

        const activeBookings = (bookings || []).filter(b => 
          (b.slot_id === slotId || b.slotId === slotId) &&
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending'].includes(String(b.status || '').toLowerCase())
        );

        const bookingMap = new Map();
        activeBookings.forEach(b => {
          const seatKey = b.seat_id || b.seatId;
          if (seatKey) bookingMap.set(seatKey, b);
        });

        return onlineSeats.map(s => {
          const booking = bookingMap.get(s.id);
          const isUserBooked = Boolean(currentUserId && booking && String(booking.student_id || booking.studentId) === String(currentUserId));
          const bookingStatus = String(booking?.status || '').toLowerCase();
          const bookingSource = String(booking?.booking_source || '').toLowerCase();

          let uiStatus = 'Available';
          let statusState = 'available';

          if (s.status === 'maintenance') {
            uiStatus = 'Maintenance';
            statusState = 'maintenance';
          } else if (isUserBooked) {
            uiStatus = 'Booked by You';
            statusState = 'user_booked';
          } else if (booking) {
            if (bookingStatus === 'checked_in' || bookingStatus === 'active') {
              uiStatus = 'Occupied';
              statusState = 'occupied';
            } else if (bookingSource.includes('waitlist') || bookingStatus === 'awaiting_check_in') {
              uiStatus = 'Held';
              statusState = 'held';
            } else {
              uiStatus = 'Reserved';
              statusState = 'reserved';
            }
          }

          const numStr = String(s.seat_number || '').replace(/^[A-Za-z]+-?/, '');
          const seatNum = parseInt(numStr, 10) || 1;

          return {
            id: s.id,
            seatNumber: s.seat_number ? (s.seat_number.startsWith('S-') ? s.seat_number : `S-${String(seatNum).padStart(2, '0')}`) : `S-${String(seatNum).padStart(2, '0')}`,
            rawSeatNumber: s.seat_number,
            type: s.seat_type || (seatNum <= 20 ? 'Quiet Study (Zone A)' : 'Collaborative (Zone B)'),
            zoneId: seatNum <= 20 ? 'zone-a' : 'zone-b',
            powerOutlet: s.has_power_socket ?? (seatNum % 2 === 1),
            nearWindow: s.is_accessible ?? (seatNum <= 10 || (seatNum >= 21 && seatNum <= 30)),
            isAccessible: Boolean(s.is_accessible),
            ui_status: uiStatus,
            status_state: statusState,
            isUserBooked,
            booking
          };
        });
      }
    } catch { /* fallback */ }

    // Fallback local db
    const rawSeats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const activeBookings = bookings.filter(b => 
      b.bookingDate === dateStr &&
      (b.slotId === slotId || b.slot_id === slotId) &&
      !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(String(b.status || '').toLowerCase())
    );

    const bookingMap = new Map();
    activeBookings.forEach(b => {
      const seatKey = b.seatId || b.seat_id;
      if (seatKey) bookingMap.set(seatKey, b);
    });

    // Ensure all 40 seats S-01 to S-40 exist in mock list
    const seatsList = rawSeats.length >= 40 ? rawSeats : Array.from({ length: 40 }, (_, i) => {
      const num = i + 1;
      const seatNo = `S-${String(num).padStart(2, '0')}`;
      return {
        id: `seat-${num}`,
        seatNumber: seatNo,
        status: num === 40 ? 'maintenance' : 'available',
        has_power_socket: num % 2 === 1,
        is_accessible: num <= 10 || (num >= 21 && num <= 30)
      };
    });

    return seatsList.map((s, idx) => {
      const num = idx + 1;
      const seatNo = s.seatNumber ? (s.seatNumber.startsWith('S-') ? s.seatNumber : `S-${String(num).padStart(2, '0')}`) : `S-${String(num).padStart(2, '0')}`;
      const booking = bookingMap.get(s.id) || bookingMap.get(seatNo);
      const isUserBooked = Boolean(currentUserId && booking && String(booking.studentId || booking.student_id) === String(currentUserId));
      const bookingStatus = String(booking?.status || '').toLowerCase();
      const bookingSource = String(booking?.booking_source || '').toLowerCase();

      let uiStatus = 'Available';
      let statusState = 'available';

      if (s.status === 'maintenance' || num === 40) {
        uiStatus = 'Maintenance';
        statusState = 'maintenance';
      } else if (isUserBooked) {
        uiStatus = 'Booked by You';
        statusState = 'user_booked';
      } else if (booking) {
        if (bookingStatus === 'checked_in' || bookingStatus === 'active') {
          uiStatus = 'Occupied';
          statusState = 'occupied';
        } else if (bookingSource.includes('waitlist') || bookingStatus === 'awaiting_check_in') {
          uiStatus = 'Held';
          statusState = 'held';
        } else {
          uiStatus = 'Reserved';
          statusState = 'reserved';
        }
      }

      return {
        id: s.id || `seat-${num}`,
        seatNumber: seatNo,
        type: num <= 20 ? 'Quiet Study (Zone A)' : 'Collaborative (Zone B)',
        zoneId: num <= 20 ? 'zone-a' : 'zone-b',
        powerOutlet: s.has_power_socket ?? (num % 2 === 1),
        nearWindow: num <= 10 || (num >= 21 && num <= 30),
        isAccessible: Boolean(s.is_accessible),
        ui_status: uiStatus,
        status_state: statusState,
        isUserBooked,
        booking
      };
    });
  },

  async getWalkInSeatsForSlot(roomId, dateStr, slotId) {
    if (isUUID(roomId) && isUUID(slotId)) {
      try {
        const { data, error } = await supabase.rpc('get_walk_in_available_seats', {
          p_room_id: roomId,
          p_booking_date: dateStr,
          p_slot_id: slotId
        });
        if (!error && data && data.length > 0) return data;
      } catch { /* fallback */ }
    }

    // Local fallback for S-41 to S-50
    const rawSeats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const activeBookings = bookings.filter(b => 
      b.bookingDate === dateStr &&
      (b.slotId === slotId || b.slot_id === slotId) &&
      !['cancelled', 'cancelled_by_student', 'cancelled_by_admin', 'slot_cancelled'].includes(String(b.status || '').toLowerCase())
    );

    const bookingMap = new Map();
    activeBookings.forEach(b => {
      const seatKey = b.seatId || b.seat_id;
      if (seatKey) bookingMap.set(seatKey, b);
    });

    const walkInSeatsList = Array.from({ length: 10 }, (_, i) => {
      const num = i + 41;
      const seatNo = `S-${num}`;
      return {
        id: `seat-${num}`,
        seat_number: seatNo,
        allocation_mode: 'walk_in_only',
        status: 'available',
        has_power_socket: true,
        is_accessible: false
      };
    });

    return walkInSeatsList.map(s => {
      const booking = bookingMap.get(s.id) || bookingMap.get(s.seat_number);
      let computedStatus = 'available';
      if (s.status === 'maintenance') {
        computedStatus = 'maintenance';
      } else if (booking) {
        const statusStr = String(booking.status || '').toLowerCase();
        if (statusStr === 'checked_in' || statusStr === 'active') {
          computedStatus = 'checked_in';
        } else {
          computedStatus = 'allocated';
        }
      }

      return {
        id: s.id,
        seat_number: s.seat_number,
        allocation_mode: 'walk_in_only',
        physical_status: s.status,
        has_power_socket: s.has_power_socket,
        is_accessible: s.is_accessible,
        computed_status: computedStatus,
        active_booking: booking ? {
          id: booking.id,
          booking_code: booking.bookingCode || booking.booking_code,
          student_id: booking.studentId || booking.student_id,
          status: booking.status,
          booking_source: booking.bookingSource || 'walk_in'
        } : null
      };
    });
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

  async createBooking(user, dateStr, slot, floorId, seatId, idempotencyKey = null) {
    if (!user || !user.id) {
      throw new Error('User authentication required.');
    }

    const seatIdStr = String(seatId || '');
    if (seatIdStr.includes('S-4') || seatIdStr.includes('S-50') || seatIdStr.includes('seat-4') || seatIdStr.includes('seat-50')) {
      throw new Error('SEAT_NOT_AVAILABLE_FOR_ONLINE_BOOKING: Seat is reserved exclusively for desk walk-in allocation.');
    }

    const key = idempotencyKey || `IK-BK-${user.id}-${dateStr}-${seatId}-${Date.now()}`;

    if (idempotencyKey) {
      const localBookings = (await db.read('seatsync_bookings')) || [];
      const existingIdempotent = localBookings.find(b => b.idempotencyKey === idempotencyKey || b.idempotency_key === idempotencyKey);
      if (existingIdempotent) return existingIdempotent;
    }

    try {
      let resolvedSlotId = slot?.id || slot;
      if (resolvedSlotId && !isUUID(resolvedSlotId)) {
        const slotRow = await slotService.getSlotByCode(resolvedSlotId);
        if (slotRow?.id) {
          resolvedSlotId = slotRow.id;
        } else {
          const { data: firstSlot } = await supabase.from('slots').select('id').limit(1).maybeSingle();
          if (firstSlot?.id) resolvedSlotId = firstSlot.id;
        }
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
        const { data: result, error } = await supabase.rpc('create_seat_booking', {
          p_library_id: libId,
          p_floor_id: fId,
          p_room_id: roomId,
          p_seat_id: resolvedSeatId,
          p_slot_id: resolvedSlotId,
          p_booking_date: dateStr,
          p_idempotency_key: key
        });

        if (error) {
          if (error.code === '23505' || error.message.includes('idx_bookings_active_occurrence_seat') || error.message.includes('reserved by another student')) {
            throw new Error('This seat was just reserved by another student. Please select another seat.');
          }
          if (error.message.includes('active booking')) {
            throw new Error('You already have an active booking for this time slot occurrence.');
          }
          throw new Error(error.message);
        }

        if (result && result.success) return result;
        if (result && result.error) {
          if (result.error.includes('reserved by another student')) {
            throw new Error('This seat was just reserved by another student. Please select another seat.');
          }
          throw new Error(result.error);
        }
      }
    } catch (err) {
      if (err.message && (err.message.includes('reserved') || err.message.includes('overlap') || err.message.includes('STUDENT_OVERLAP') || err.message.includes('SEAT_NOT_AVAILABLE'))) {
        throw err;
      }
      if (isUUID(user.id) || (err.message && !err.message.includes('fetch'))) {
        throw err;
      }
    }

    // Local fallback creation with strict validation
    const bookings = (await db.read('seatsync_bookings')) || [];

    // Idempotency check in local fallback
    if (key) {
      const existingIdempotent = bookings.find(b => b.idempotencyKey === key || b.idempotency_key === key);
      if (existingIdempotent) return existingIdempotent;
    }

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
    const targetSeat = seats.find(s => s.id === seatId || s.seatNumber === seatId) || { seatNumber: (typeof seatId === 'string' ? seatId : 'S-12') };

    const newBooking = {
      id: `BK-${Date.now()}`,
      booking_code: `BK-${Math.floor(10000000 + Math.random() * 90000000)}`,
      qrToken: `QR-${Math.floor(1000000000 + Math.random() * 9000000000)}`,
      idempotencyKey: key,
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
      seatNumber: (targetSeat && (targetSeat.seatNumber || targetSeat.seat_number)) || (typeof seatId === 'string' ? seatId : 'S-12'),
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
  },

  // Algorithm 18: Weighted Seat Recommendation Algorithm
  getRecommendedSeats(availableSeats, preferences = {}) {
    if (!availableSeats || availableSeats.length === 0) return [];

    const {
      preferPowerSocket = true,
      preferQuietZone = true,
      preferAccessible = false,
      preferredZone = 'zone-a'
    } = preferences;

    const scoredSeats = availableSeats.map(seat => {
      let score = 0;
      if (seat.ui_status !== 'Available') return { ...seat, score: -1 };

      if (preferPowerSocket && (seat.powerOutlet || seat.has_power_socket)) score += 30;
      if (preferQuietZone && (seat.zoneId === preferredZone || seat.type?.includes('Quiet'))) score += 25;
      if (preferAccessible && (seat.nearWindow || seat.is_accessible)) score += 20;

      // Distance / seat ordering preference heuristic
      const seatNumMatch = String(seat.seatNumber || seat.id).match(/\d+/);
      const num = seatNumMatch ? parseInt(seatNumMatch[0], 10) : 0;
      score += Math.max(0, 25 - (num % 10));

      return { ...seat, score };
    });

    return scoredSeats
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  },

  // Algorithm 20: Keyset/Cursor Pagination for Bookings
  async getMyBookingsPaginated(studentId, lastCreatedAt = null, pageSize = 10) {
    if (!studentId) return { data: [], hasMore: false, lastCursor: null };

    if (isUUID(studentId)) {
      try {
        let query = supabase
          .from('bookings')
          .select('*, seats(seat_number), slots(name, start_time, end_time)')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(pageSize + 1);

        if (lastCreatedAt) {
          query = query.lt('created_at', lastCreatedAt);
        }

        const { data, error } = await query;
        if (!error && data) {
          const hasMore = data.length > pageSize;
          const items = hasMore ? data.slice(0, pageSize) : data;
          const lastCursor = items.length > 0 ? items[items.length - 1].created_at : null;

          return { data: items, hasMore, lastCursor };
        }
      } catch { /* fallback */ }
    }

    const all = await this.getMyBookings(studentId);
    return { data: all.slice(0, pageSize), hasMore: all.length > pageSize, lastCursor: null };
  }
};
