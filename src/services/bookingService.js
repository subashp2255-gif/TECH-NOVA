import { db } from './mockDatabase';
import { slotService } from './slotService';
import { format, addDays } from 'date-fns';

export const bookingService = {
  getTomorrowDateStr() {
    return format(addDays(new Date(), 1), 'yyyy-MM-dd');
  },

  async getFloors() {
    let floors = await db.read('seatsync_floors');
    if (!floors) floors = [];
    return floors;
  },

  async getSlotsAvailability(dateStr) {
    const slots = (await db.read('seatsync_slots')) || [];
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];
    const disabledList = await slotService.getDisabledOccurrences();

    const activeSeatsCount = seats.filter(s => s.status === 'active').length || 40;

    return slots.map(slot => {
      const disabledRecord = disabledList.find(d => 
        d.slotId === slot.id && 
        (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
      );
      const isDisabledByAdmin = !!disabledRecord;

      const slotBookings = bookings.filter(b => 
        b.bookingDate === dateStr &&
        b.slotId === slot.id &&
        b.status !== 'cancelled' &&
        b.status !== 'CANCELLED_BY_STUDENT' &&
        b.status !== 'CANCELLED_BY_ADMIN'
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
        disabledReason: disabledRecord ? disabledRecord.reason : null,
        disabledScope: disabledRecord ? disabledRecord.scope : null
      };
    });
  },

  async getSeatsForSlot(floorId, dateStr, slotId) {
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    const activeBookingsForSlot = bookings.filter(b =>
      b.bookingDate === dateStr &&
      b.slotId === slotId &&
      b.status !== 'cancelled' &&
      b.status !== 'CANCELLED_BY_STUDENT' &&
      b.status !== 'CANCELLED_BY_ADMIN'
    );

    const bookedSeatIds = new Set(activeBookingsForSlot.map(b => b.seatId));

    return seats
      .filter(s => s.floorId === floorId)
      .map(s => {
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
      b.status !== 'cancelled' &&
      b.status !== 'CANCELLED_BY_STUDENT' &&
      b.status !== 'CANCELLED_BY_ADMIN'
    );

    if (existingUserBooking) {
      throw new Error('You already have a seat reservation for this time slot.');
    }

    const seat = seats.find(s => s.id === seatId);
    if (!seat) throw new Error('Selected seat not found.');

    const floor = floors.find(f => f.id === floorId);

    const newBooking = {
      id: `BK-${Date.now()}`,
      studentId: user.id,
      studentName: user.name,
      collegeId: user.collegeId || user.identifier,
      studentCollegeId: user.collegeId || user.identifier,
      bookingDate,
      slotId: slot.id,
      slotTime: `${slot.startTime} – ${slot.endTime}`,
      floorId,
      floorName: floor ? floor.name : 'Ground Floor',
      seatId: seat.id,
      seatNumber: seat.seatNumber,
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };

    bookings.unshift(newBooking);
    await db.write('seatsync_bookings', bookings);

    // Record activity log
    const logs = (await db.read('seatsync_activity_logs')) || [];
    logs.unshift({
      id: `LOG-${Date.now()}`,
      userId: user.id,
      action: 'create_booking',
      entityId: newBooking.id,
      timestamp: newBooking.createdAt
    });
    await db.write('seatsync_activity_logs', logs);

    return newBooking;
  },

  async getMyBookings(studentId) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    return bookings.filter(b => b.studentId === studentId);
  },

  async cancelBooking(bookingId, studentId) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => b.id === bookingId && b.studentId === studentId);
    if (!target) throw new Error('Booking not found.');

    target.status = 'CANCELLED_BY_STUDENT';
    target.cancelledAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);

    // Check if waitlist needs notification
    try {
      const { waitlistService } = await import('./waitlistService');
      await waitlistService.notifyNextStudent(target.bookingDate, target.slotId);
    } catch { /* silent */ }

    return target;
  }
};
