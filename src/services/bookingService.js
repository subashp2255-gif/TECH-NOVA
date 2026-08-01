import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { slotService } from './slotService';
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
    if (!floors) floors = [];
    return floors;
  },

  async getSlotsAvailability(dateStr) {
    try {
      const [{ data: slots }, { data: seats }, { data: bookings }] = await Promise.all([
        supabase.from('slots').select('*').order('start_time'),
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*').eq('booking_date', dateStr)
      ]);

      if (slots && seats) {
        const activeSeatsCount = seats.filter(s => s.status === 'available' || s.status === 'active').length || 40;
        const disabledList = await slotService.getDisabledOccurrences();

        return slots.map(slot => {
          const disabledRecord = disabledList.find(d => 
            d.slotId === slot.id && 
            (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
          );
          const isDisabledByAdmin = slot.status === 'disabled' || slot.status === 'cancelled' || !!disabledRecord;

          const slotBookings = (bookings || []).filter(b => 
            b.slot_id === slot.id &&
            ['confirmed', 'awaiting_check_in', 'checked_in'].includes(b.status)
          );
          const bookedCount = slotBookings.length;
          const availableCount = isDisabledByAdmin ? 0 : Math.max(0, activeSeatsCount - bookedCount);

          return {
            id: slot.id,
            name: slot.name,
            startTime: slot.start_time,
            endTime: slot.end_time,
            totalCount: activeSeatsCount,
            bookedCount,
            availableCount,
            isFullyBooked: availableCount === 0,
            isDisabledByAdmin,
            disabledReason: disabledRecord ? disabledRecord.reason : slot.cancellation_reason
          };
        });
      }
    } catch { /* fallback */ }

    // Fallback to local db
    const slots = (await db.read('seatsync_slots')) || [];
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];
    const disabledList = await slotService.getDisabledOccurrences();

    const activeSeatsCount = seats.filter(s => s.status === 'active' || s.status === 'available').length || 40;

    return slots.map(slot => {
      const disabledRecord = disabledList.find(d => 
        d.slotId === slot.id && 
        (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
      );
      const isDisabledByAdmin = !!disabledRecord;

      const slotBookings = bookings.filter(b => 
        b.bookingDate === dateStr &&
        b.slotId === slot.id &&
        !['cancelled', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN', 'slot_cancelled'].includes(b.status)
      );
      const bookedCount = slotBookings.length;
      const availableCount = isDisabledByAdmin ? 0 : Math.max(0, activeSeatsCount - bookedCount);

      return {
        ...slot,
        totalCount: activeSeatsCount,
        bookedCount,
        availableCount,
        isFullyBooked: availableCount === 0,
        isDisabledByAdmin,
        disabledReason: disabledRecord ? disabledRecord.reason : null
      };
    });
  },

  async getSeatsForSlot(floorId, dateStr, slotId) {
    try {
      const [{ data: seats }, { data: bookings }] = await Promise.all([
        supabase.from('seats').select('*'),
        supabase.from('bookings').select('*').eq('booking_date', dateStr).eq('slot_id', slotId)
      ]);

      if (seats) {
        const activeBookings = (bookings || []).filter(b => ['confirmed', 'awaiting_check_in', 'checked_in'].includes(b.status));
        const bookedSeatIds = new Set(activeBookings.map(b => b.seat_id));

        return seats.map(s => {
          const isOccupied = bookedSeatIds.has(s.id);
          const isMaintenance = s.status === 'maintenance';
          let ui_status = 'Available';

          if (isMaintenance) ui_status = 'Maintenance';
          else if (isOccupied) ui_status = 'Occupied';

          return {
            id: s.id,
            seatNumber: s.seat_number,
            floorId: s.floor_id,
            status: s.status,
            ui_status
          };
        });
      }
    } catch { /* fallback */ }

    // Fallback
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const activeBookingsForSlot = bookings.filter(b =>
      b.bookingDate === dateStr &&
      b.slotId === slotId &&
      !['cancelled', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN', 'slot_cancelled'].includes(b.status)
    );

    const bookedSeatIds = new Set(activeBookingsForSlot.map(b => b.seatId));

    return seats.map(s => {
      const isOccupied = bookedSeatIds.has(s.id);
      const isMaintenance = s.status === 'maintenance';
      let ui_status = 'Available';

      if (isMaintenance) ui_status = 'Maintenance';
      else if (isOccupied) ui_status = 'Occupied';

      return {
        ...s,
        ui_status
      };
    });
  },

  async createBooking(user, bookingDate, slot, floorId, seatId) {
    // Attempt Supabase RPC call first
    try {
      const { data: libraryData } = await supabase.from('libraries').select('id').limit(1).single();
      const { data: roomData } = await supabase.from('rooms').select('id, floor_id').limit(1).single();

      if (libraryData && roomData) {
        const { data, error } = await supabase.rpc('create_booking', {
          p_library_id: libraryData.id,
          p_floor_id: roomData.floor_id || floorId,
          p_room_id: roomData.id,
          p_seat_id: seatId,
          p_slot_id: slot.id,
          p_booking_date: bookingDate,
          p_booking_source: 'online'
        });

        if (error) {
          throw new Error(error.message);
        }

        if (data && data.success) {
          // Keep local mock copy in sync for seamless rendering
          const localBooking = {
            id: data.booking_code || `BK-${Date.now()}`,
            booking_code: data.booking_code,
            studentId: user.id,
            studentName: user.name,
            collegeId: user.collegeId || user.identifier,
            bookingDate,
            slotId: slot.id,
            slotTime: `${slot.startTime || ''} – ${slot.endTime || ''}`,
            floorId,
            floorName: 'Ground Floor',
            seatId,
            seatNumber: data.seat_number || 'A-101',
            status: 'confirmed',
            qrToken: data.qr_token,
            createdAt: new Date().toISOString()
          };

          const bookings = (await db.read('seatsync_bookings')) || [];
          bookings.unshift(localBooking);
          await db.write('seatsync_bookings', bookings);

          return localBooking;
        }
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch')) {
        throw err;
      }
    }

    // Fallback to local database logic
    const disabledState = await slotService.getDisabledState(slot.id, bookingDate);
    if (disabledState) {
      throw new Error(`This time slot is unavailable on ${bookingDate} due to: ${disabledState.reason}.`);
    }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const seats = (await db.read('seatsync_seats')) || [];
    const floors = (await db.read('seatsync_floors')) || [];

    const existingUserBooking = bookings.find(b =>
      b.studentId === user.id &&
      b.bookingDate === bookingDate &&
      b.slotId === slot.id &&
      !['cancelled', 'CANCELLED_BY_STUDENT', 'CANCELLED_BY_ADMIN', 'slot_cancelled'].includes(b.status)
    );

    if (existingUserBooking) {
      throw new Error('You already have a seat reservation for this time slot.');
    }

    const seat = seats.find(s => s.id === seatId);
    const floor = floors.find(f => f.id === floorId);

    const newBooking = {
      id: `BK-${Date.now()}`,
      studentId: user.id,
      studentName: user.name,
      collegeId: user.collegeId || user.identifier,
      studentCollegeId: user.collegeId || user.identifier,
      bookingDate,
      slotId: slot.id,
      slotTime: `${slot.startTime || ''} – ${slot.endTime || ''}`,
      floorId,
      floorName: floor ? floor.name : 'Ground Floor',
      seatId: seat ? seat.id : seatId,
      seatNumber: seat ? seat.seatNumber : 'A-101',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.unshift(newBooking);
    await db.write('seatsync_bookings', bookings);

    return newBooking;
  },

  async getMyBookings(studentId) {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          booking_date,
          status,
          created_at,
          seats (seat_number),
          slots (name, start_time, end_time)
        `)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        return data.map(b => ({
          id: b.booking_code || b.id,
          booking_code: b.booking_code,
          studentId,
          bookingDate: b.booking_date,
          slotTime: b.slots ? `${b.slots.start_time} - ${b.slots.end_time}` : 'Slot',
          seatNumber: b.seats ? b.seats.seat_number : 'A-101',
          status: b.status,
          createdAt: b.created_at
        }));
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    return bookings.filter(b => b.studentId === studentId);
  },

  async cancelBooking(bookingId, studentId) {
    try {
      const { data, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: bookingId,
        p_reason: 'Cancelled by student'
      });
      if (!error && data && data.success) {
        const bookings = (await db.read('seatsync_bookings')) || [];
        const target = bookings.find(b => b.id === bookingId || b.booking_code === bookingId);
        if (target) {
          target.status = 'CANCELLED_BY_STUDENT';
          await db.write('seatsync_bookings', bookings);
        }
        return { id: bookingId, status: 'cancelled' };
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => (b.id === bookingId || b.booking_code === bookingId) && b.studentId === studentId);
    if (!target) throw new Error('Booking not found.');

    target.status = 'CANCELLED_BY_STUDENT';
    target.cancelledAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);

    return target;
  }
};
