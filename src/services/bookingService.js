import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';
import { slotService } from './slotService.js';
import { defaultSlots } from '../data/seedData.js';
import { format, addDays } from 'date-fns';
import { sortSlotsChronologically } from '../utils/timeUtils.js';


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
        supabase.from('slots').select('*').eq('status', 'active').not('start_time', 'eq', '00:00:00').order('start_time'),
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

      return sortSlotsChronologically(sourceSlots.map(slot => {
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
      }));

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
              qrToken: b.qr_token || b.qrToken,
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
      const [{ data: seats }, { data: bookings }, { data: maintenanceList }] = await Promise.all([
        supabase.from('seats').select('*').order('seat_number', { ascending: true }),
        supabase.from('bookings').select('*').eq('booking_date', dateStr),
        supabase.from('seat_maintenance').select('seat_id, status, issue_type').in('status', ['reported', 'in_progress'])
      ]);

      if (seats && seats.length > 0) {
        // Filter ONLY online seats for student seat map (exclude is_walk_in_only seats S-41 to S-50)
        const onlineSeats = seats.filter(s => s.allocation_mode !== 'walk_in_only' && s.is_walk_in_only !== true && !String(s.seat_number || '').match(/^S-(4[1-9]|50)$/i));

        const activeBookings = (bookings || []).filter(b => 
          (b.slot_id === slotId || b.slotId === slotId) &&
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending'].includes(String(b.status || '').toLowerCase())
        );

        const bookingMap = new Map();
        activeBookings.forEach(b => {
          const seatKey = b.seat_id || b.seatId;
          if (seatKey) bookingMap.set(seatKey, b);
        });

        const maintenanceMap = new Map();
        (maintenanceList || []).forEach(m => {
          if (m.seat_id) maintenanceMap.set(m.seat_id, m);
        });

        return onlineSeats.map(s => {
          const booking = bookingMap.get(s.id);
          const activeMaint = maintenanceMap.get(s.id);
          const isUserBooked = Boolean(currentUserId && booking && String(booking.student_id || booking.studentId) === String(currentUserId));
          const bookingStatus = String(booking?.status || '').toLowerCase();
          const bookingSource = String(booking?.booking_source || '').toLowerCase();

          let uiStatus = 'Available';
          let statusState = 'available';

          if (s.status === 'maintenance' || s.is_active === false || activeMaint) {
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

  // SEARCH ACTIVE STUDENTS (SUPABASE REAL DATA)
  async searchActiveStudents(queryStr = '') {
    const clean = (queryStr || '').trim();
    try {
      let query = supabase
        .from('profiles')
        .select('id, full_name, email, registration_number, department, role, status, avatar_url')
        .eq('role', 'student')
        .eq('status', 'active');

      if (clean) {
        query = query.or(`full_name.ilike.%${clean}%,registration_number.ilike.%${clean}%,email.ilike.%${clean}%`);
      }

      const { data, error } = await query.order('full_name').limit(20);

      if (!error && data) {
        return data.map(u => ({
          id: u.id,
          name: u.full_name,
          fullName: u.full_name,
          full_name: u.full_name,
          email: u.email,
          collegeId: u.registration_number,
          registrationNumber: u.registration_number,
          registration_number: u.registration_number,
          department: u.department || 'N/A',
          role: u.role,
          status: u.status,
          avatarUrl: u.avatar_url
        }));
      }
    } catch (err) {
      console.warn('[bookingService] searchActiveStudents notice:', err.message);
    }

    const localUsers = (await db.read('seatsync_users')) || [];
    return localUsers
      .filter(u => String(u.role || '').toLowerCase() === 'student' && String(u.status || 'active').toLowerCase() === 'active')
      .filter(u => !clean ||
        (u.name || u.full_name || '').toLowerCase().includes(clean.toLowerCase()) ||
        (u.collegeId || u.registration_number || '').toLowerCase().includes(clean.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(clean.toLowerCase())
      )
      .map(u => ({
        id: u.id,
        name: u.name || u.full_name,
        fullName: u.name || u.full_name,
        full_name: u.name || u.full_name,
        email: u.email,
        collegeId: u.collegeId || u.registration_number || 'N/A',
        registrationNumber: u.collegeId || u.registration_number || 'N/A',
        registration_number: u.collegeId || u.registration_number || 'N/A',
        department: u.department || 'N/A',
        role: u.role || 'student',
        status: u.status || 'active'
      }));
  },

  // REAL SUPABASE WALK-IN SEATS S-41 TO S-50 FOR SLOT
  async getWalkInSeatsForSlot(roomId, dateStr, slotId) {
    try {
      const [{ data: seats }, { data: bookings }, { data: maintenanceList }] = await Promise.all([
        supabase.from('seats').select('*').or('is_walk_in_only.eq.true,seat_number.ilike.S-4%,seat_number.ilike.S-50').order('seat_number'),
        supabase.from('bookings').select('*').eq('booking_date', dateStr),
        supabase.from('seat_maintenance').select('seat_id, status').in('status', ['reported', 'in_progress'])
      ]);

      if (seats && seats.length > 0) {
        const activeBookings = (bookings || []).filter(b =>
          (b.slot_id === slotId || b.slotId === slotId) &&
          ['confirmed', 'awaiting_check_in', 'checked_in', 'active', 'checkout_pending'].includes(String(b.status || '').toLowerCase())
        );

        const bookingMap = new Map();
        activeBookings.forEach(b => {
          if (b.seat_id) bookingMap.set(b.seat_id, b);
        });

        const maintMap = new Map();
        (maintenanceList || []).forEach(m => {
          if (m.seat_id) maintMap.set(m.seat_id, m);
        });

        return seats.map(s => {
          const booking = bookingMap.get(s.id);
          const activeMaint = maintMap.get(s.id);
          let computedStatus = 'available';

          if (s.status === 'maintenance' || activeMaint) {
            computedStatus = 'maintenance';
          } else if (booking) {
            const bStatus = String(booking.status || '').toLowerCase();
            if (bStatus === 'checked_in' || bStatus === 'active') {
              computedStatus = 'checked_in';
            } else {
              computedStatus = 'allocated';
            }
          }

          return {
            id: s.id,
            seat_number: s.seat_number,
            seatNumber: s.seat_number,
            is_walk_in_only: Boolean(s.is_walk_in_only),
            allocation_mode: 'walk_in_only',
            physical_status: s.status,
            has_power_socket: s.has_power_socket ?? true,
            is_accessible: Boolean(s.is_accessible),
            computed_status: computedStatus,
            active_booking: booking ? {
              id: booking.id,
              booking_code: booking.booking_code || booking.bookingCode,
              student_id: booking.student_id || booking.studentId,
              status: booking.status,
              booking_source: booking.booking_source || 'librarian_walk_in'
            } : null
          };
        });
      }
    } catch { /* fallback */ }

    // Fallback local S-41 to S-50
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
        seatNumber: s.seat_number,
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
          booking_source: booking.bookingSource || 'librarian_walk_in'
        } : null
      };
    });
  },

  // ATOMIC WALK-IN ALLOCATION RPC CALL WITH RESOLUTION & SEAMLESS FALLBACK
  async allocateWalkInSeat({ studentId, seatId, slotOccurrenceId = null, slotId = null, bookingDate = null, instantCheckIn = true, idempotencyKey = null }) {
    if (!studentId) {
      throw new Error('Please select a valid active student profile.');
    }
    if (!seatId) {
      throw new Error('Please select an available walk-in pool seat (S-41 to S-50).');
    }

    const dateStr = bookingDate || format(new Date(), 'yyyy-MM-dd');
    let resolvedSeatId = seatId;
    let resolvedSeatNumber = typeof seatId === 'string' && seatId.startsWith('S-') ? seatId : 'S-41';
    let resolvedStudentId = studentId;

    // Resolve Student UUID if student object or registration number passed
    if (!isUUID(resolvedStudentId)) {
      try {
        const { data: prof } = await supabase.from('profiles').select('id, full_name, registration_number').or(`id.eq.${studentId},registration_number.eq.${studentId}`).maybeSingle();
        if (prof?.id) resolvedStudentId = prof.id;
      } catch { /* proceed */ }
    }

    // Resolve Seat UUID from public.seats if seat_number string passed
    try {
      if (isUUID(seatId)) {
        const { data: seatRow } = await supabase.from('seats').select('id, seat_number').eq('id', seatId).maybeSingle();
        if (seatRow) {
          resolvedSeatId = seatRow.id;
          resolvedSeatNumber = seatRow.seat_number;
        }
      } else {
        const targetNum = String(seatId).replace(/^seat-/, 'S-');
        const { data: seatRow } = await supabase.from('seats').select('id, seat_number').or(`seat_number.eq.${targetNum},seat_number.eq.${seatId}`).limit(1).maybeSingle();
        if (seatRow) {
          resolvedSeatId = seatRow.id;
          resolvedSeatNumber = seatRow.seat_number;
        }
      }
    } catch { /* proceed */ }

    // Resolve Slot UUID if needed
    let resolvedSlotId = slotId;
    if (slotId && !isUUID(slotId)) {
      const slotRow = await slotService.getSlotByCode(slotId);
      if (slotRow?.id) resolvedSlotId = slotRow.id;
    }

    // Attempt 1: Call Supabase RPC allocate_walk_in_seat
    if (isUUID(resolvedStudentId)) {
      try {
        const rpcPayload = {
          p_student_id: resolvedStudentId,
          p_seat_id: String(resolvedSeatId)
        };
        if (slotOccurrenceId && isUUID(slotOccurrenceId)) rpcPayload.p_slot_occurrence_id = slotOccurrenceId;
        if (resolvedSlotId) rpcPayload.p_slot_id = String(resolvedSlotId);
        if (dateStr) rpcPayload.p_booking_date = dateStr;
        rpcPayload.p_instant_check_in = Boolean(instantCheckIn);
        if (idempotencyKey) rpcPayload.p_idempotency_key = idempotencyKey;

        const { data, error } = await supabase.rpc('allocate_walk_in_seat', rpcPayload);

        if (!error && data) {
          if (data.success === false) {
            throw new Error(data.message || 'Walk-In seat allocation failed.');
          }
          const b = data.booking || {};
          return {
            id: b.id,
            bookingCode: b.booking_code,
            booking_code: b.booking_code,
            studentId: b.student_id,
            studentName: b.student_name,
            studentRegistrationNumber: b.registration_number,
            department: b.department,
            seatId: b.seat_id,
            seatNumber: b.seat_number || resolvedSeatNumber,
            roomName: b.room_name,
            floorName: b.floor_name,
            libraryName: b.library_name,
            slotName: b.slot_name,
            slotTime: b.slot_time,
            bookingDate: b.booking_date || dateStr,
            bookingSource: 'librarian_walk_in',
            createdBy: b.created_by,
            allocatedByName: b.allocated_by_name || 'Staff Librarian',
            isCancellable: false,
            status: b.status,
            checkedInAt: b.checked_in_at,
            createdAt: b.created_at
          };
        }
      } catch (rpcErr) {
        if (rpcErr.message && !rpcErr.message.includes('schema cache') && !rpcErr.message.includes('Could not find')) {
          throw rpcErr;
        }
        console.warn('[bookingService] RPC missing or schema cache pending. Falling back to direct database allocation:', rpcErr.message);
      }
    }

    // Attempt 2: Fallback Direct Insert via Supabase Client
    if (isUUID(resolvedStudentId) && isUUID(resolvedSeatId)) {
      try {
        const { data: studentProf } = await supabase.from('profiles').select('full_name, registration_number, department').eq('id', resolvedStudentId).maybeSingle();
        const { data: seatRow } = await supabase.from('seats').select('id, seat_number, room_id, rooms(library_id, floor_id, name)').eq('id', resolvedSeatId).maybeSingle();

        const bookingCode = `BK-${Math.floor(10000000 + Math.random() * 90000000)}`;
        const qrToken = `QR-${Math.floor(1000000000 + Math.random() * 9000000000)}`;

        const { data: newB, error: insErr } = await supabase
          .from('bookings')
          .insert({
            booking_code: bookingCode,
            student_id: resolvedStudentId,
            library_id: seatRow?.rooms?.library_id,
            floor_id: seatRow?.rooms?.floor_id,
            room_id: seatRow?.room_id,
            seat_id: resolvedSeatId,
            slot_id: isUUID(resolvedSlotId) ? resolvedSlotId : null,
            booking_date: dateStr,
            status: instantCheckIn ? 'checked_in' : 'confirmed',
            booking_source: 'librarian_walk_in',
            is_cancellable: false,
            qr_token: qrToken,
            checked_in_at: instantCheckIn ? new Date().toISOString() : null
          })
          .select()
          .single();

        if (!insErr && newB) {
          if (instantCheckIn) {
            await supabase.from('check_in_logs').insert({
              booking_id: newB.id,
              student_id: resolvedStudentId,
              seat_id: resolvedSeatId,
              action: 'check_in',
              method: 'manual',
              notes: 'Walk-In Instant Check-In Verified by Staff Librarian'
            }).catch(() => {});
          }

          return {
            id: newB.id,
            bookingCode,
            booking_code: bookingCode,
            studentId: resolvedStudentId,
            studentName: studentProf?.full_name || 'Student',
            studentRegistrationNumber: studentProf?.registration_number || 'N/A',
            department: studentProf?.department || 'N/A',
            seatId: resolvedSeatId,
            seatNumber: seatRow?.seat_number || resolvedSeatNumber,
            bookingDate: dateStr,
            bookingSource: 'librarian_walk_in',
            isCancellable: false,
            status: newB.status,
            checkedInAt: newB.checked_in_at,
            createdAt: newB.created_at
          };
        }
      } catch (dirErr) {
        console.warn('[bookingService] Direct insert fallback error:', dirErr.message);
      }
    }

    // Local DB fallback for offline or un-migrated dev environment
    const bookings = (await db.read('seatsync_bookings')) || [];
    const bookingCode = `BK-${Math.floor(10000000 + Math.random() * 90000000)}`;

    const newLocalBooking = {
      id: `BK-${Date.now()}`,
      booking_code: bookingCode,
      bookingCode,
      studentId: resolvedStudentId,
      student_id: resolvedStudentId,
      studentName: 'Walk-In Student',
      student_name: 'Walk-In Student',
      seatId: resolvedSeatId,
      seat_id: resolvedSeatId,
      seatNumber: resolvedSeatNumber,
      seat_number: resolvedSeatNumber,
      bookingDate: dateStr,
      booking_date: dateStr,
      slotId: resolvedSlotId || 'SLOT-01',
      bookingSource: 'librarian_walk_in',
      booking_source: 'librarian_walk_in',
      isCancellable: false,
      is_cancellable: false,
      status: instantCheckIn ? 'checked_in' : 'confirmed',
      checkedInAt: instantCheckIn ? new Date().toISOString() : null,
      createdAt: new Date().toISOString()
    };

    bookings.push(newLocalBooking);
    await db.write('seatsync_bookings', bookings);
    return newLocalBooking;
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

      if (isUUID(resolvedSeatId)) {
        const { data: maintCheck } = await supabase
          .from('seat_maintenance')
          .select('id, issue_type')
          .eq('seat_id', resolvedSeatId)
          .in('status', ['reported', 'in_progress'])
          .maybeSingle();

        if (maintCheck) {
          throw new Error('This seat is currently under maintenance. Please select another seat.');
        }
      }

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
        // First check if booking is walk-in / non-cancellable
        const { data: bCheck } = await supabase.from('bookings').select('booking_source, is_cancellable').eq('id', bookingId).maybeSingle();
        if (bCheck && (bCheck.booking_source === 'librarian_walk_in' || bCheck.is_cancellable === false)) {
          throw new Error('This librarian walk-in allocation cannot be cancelled.');
        }

        const { data: result, error } = await supabase.rpc('cancel_seat_booking', {
          p_booking_id: bookingId,
          p_reason: 'Cancelled by student'
        });

        if (error) {
          if (error.message && error.message.includes('walk-in')) {
            throw new Error('This librarian walk-in allocation cannot be cancelled.');
          }
          throw error;
        }

        if (result) return result;
      } catch (err) {
        if (err.message && err.message.includes('walk-in')) throw err;
      }
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId) && String(b.studentId || b.student_id) === String(studentId));

    if (!target) {
      throw new Error('Booking not found or not owned by student.');
    }

    if (target.bookingSource === 'librarian_walk_in' || target.booking_source === 'librarian_walk_in' || target.isCancellable === false || target.is_cancellable === false) {
      throw new Error('This librarian walk-in allocation cannot be cancelled.');
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
