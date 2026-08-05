import { supabase, isUUID } from '../lib/supabase';
import { db } from './mockDatabase';
import { defaultSlots, defaultSeats } from '../data/seedData';

export function getTodayKolkataDate() {
  const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options); // Returns YYYY-MM-DD
  return formatter.format(new Date());
}

export function getCurrentOrNextKolkataSlot(slots = []) {
  if (!slots || slots.length === 0) return null;
  const nowStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date());

  const current = slots.find(s => {
    const st = s.start_time || s.startTime || '00:00:00';
    const et = s.end_time || s.endTime || '23:59:59';
    return st <= nowStr && et >= nowStr;
  });
  if (current) return current;

  const upcoming = slots
    .filter(s => (s.start_time || s.startTime || '00:00:00') > nowStr)
    .sort((a, b) => (a.start_time || a.startTime || '00:00:00').localeCompare(b.start_time || b.startTime || '00:00:00'));
  if (upcoming.length > 0) return upcoming[0];

  return slots[0];
}

export const occupancyService = {
  async getOccupancy({ roomId, bookingDate, slotId }) {
    try {
      // 1. Load seats from Supabase
      let seatQuery = supabase.from('seats').select('*');
      if (roomId && isUUID(roomId)) seatQuery = seatQuery.eq('room_id', roomId);
      const { data: seatsData } = await seatQuery.order('seat_number');

      let seats = seatsData || [];

      // Fallback if Supabase seats table is empty
      if (seats.length === 0) {
        const localSeats = (await db.read('seatsync_seats')) || [];
        seats = localSeats.length > 0 ? localSeats : defaultSeats;
      }

      // 2. Load active bookings from Supabase
      let bookingQuery = supabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          booking_date,
          status,
          checked_in_at,
          checked_out_at,
          student_id,
          seat_id,
          room_id,
          slot_id,
          profiles!student_id (full_name, registration_number, email),
          slots (name, start_time, end_time)
        `)
        .in('status', ['confirmed', 'awaiting_check_in', 'checked_in']);

      if (roomId && isUUID(roomId)) bookingQuery = bookingQuery.eq('room_id', roomId);
      if (bookingDate) bookingQuery = bookingQuery.eq('booking_date', bookingDate);
      if (slotId && isUUID(slotId)) bookingQuery = bookingQuery.eq('slot_id', slotId);

      const { data: bookingsData } = await bookingQuery;
      let activeBookings = bookingsData || [];

      // Combine with local DB bookings for complete fallback coverage
      const localBookings = (await db.read('seatsync_bookings')) || [];
      const filteredLocal = localBookings.filter(b => 
        (!bookingDate || b.bookingDate === bookingDate) &&
        (!slotId || b.slotId === slotId) &&
        ['confirmed', 'active', 'checked_in', 'awaiting_check_in'].includes(b.status)
      );

      const bookingMap = new Map();
      activeBookings.forEach(b => {
        if (b.seat_id) bookingMap.set(b.seat_id, b);
      });

      // 2b. Load active maintenance records
      let maintenanceRecords = [];
      try {
        const { data: supaMaint } = await supabase
          .from('seat_maintenance')
          .select(`
            id,
            seat_id,
            category,
            reason,
            priority,
            status,
            created_at,
            created_by,
            profiles!created_by (full_name, role)
          `)
          .neq('status', 'Resolved');

        if (supaMaint) maintenanceRecords = supaMaint;
      } catch { /* proceed */ }

      const localMaint = (await db.read('seatsync_maintenance')) || [];
      const maintenanceMap = new Map();

      maintenanceRecords.forEach(m => {
        if (m.seat_id) maintenanceMap.set(m.seat_id, m);
      });

      localMaint.forEach(m => {
        if (m.status !== 'Resolved') {
          if (m.seat_id) maintenanceMap.set(m.seat_id, m);
          if (m.seatNumber) maintenanceMap.set(m.seatNumber, m);
        }
      });

      // 3. Merge seats with active bookings and maintenance info
      const mergedSeats = seats.map((seat, index) => {
        const seatId = seat.id || `SEAT-${String(index + 1).padStart(2, '0')}`;
        const seatNumber = seat.seat_number || seat.seatNumber || `S-${String(index + 1).padStart(2, '0')}`;

        const maintRecord = maintenanceMap.get(seatId) || maintenanceMap.get(seatNumber);
        const isMaintenance = seat.status === 'maintenance' || seat.operationalStatus === 'maintenance' || !!maintRecord;

        let matchingBooking = bookingMap.get(seatId);
        if (!matchingBooking) {
          matchingBooking = activeBookings.find(b => b.seat_number === seatNumber) ||
            filteredLocal.find(b => b.seatId === seatId || b.seatNumber === seatNumber);
        }

        let displayStatus = 'available';
        let stateLabel = 'Available';
        let colorClass = 'bg-emerald-600 border-emerald-500 text-white';
        let maintenanceInfo = null;

        if (isMaintenance) {
          displayStatus = 'maintenance';
          stateLabel = 'Maintenance';
          colorClass = 'bg-red-600 border-red-500 text-white';

          const roleStr = String(
            maintRecord?.profiles?.role || 
            maintRecord?.reportedByRole || 
            maintRecord?.user_role || 
            maintRecord?.created_by_role || 
            ''
          ).toLowerCase();

          let reportedByRole = 'Librarian';
          if (roleStr.includes('admin')) {
            reportedByRole = 'Admin';
          } else if (roleStr.includes('librarian') || roleStr.includes('staff')) {
            reportedByRole = 'Librarian';
          }

          const reporterName = maintRecord?.profiles?.full_name || maintRecord?.reportedByName || null;

          maintenanceInfo = {
            reportedByRole,
            reporterName,
            reportedByLabel: reporterName ? `${reportedByRole} (${reporterName})` : reportedByRole,
            reason: maintRecord?.reason || maintRecord?.description || 'Flagged for maintenance & repair',
            category: maintRecord?.category || 'General Maintenance',
            priority: maintRecord?.priority || 'Medium',
            startedAt: maintRecord?.created_at || maintRecord?.createdAt || null
          };
        } else if (matchingBooking) {
          const bStatus = matchingBooking.status;
          if (bStatus === 'checked_in' || bStatus === 'active') {
            displayStatus = 'occupied';
            stateLabel = 'Occupied';
            colorClass = 'bg-teal-600 border-teal-500 text-white';
          } else if (['confirmed', 'awaiting_check_in', 'CONFIRMED'].includes(bStatus)) {
            displayStatus = 'reserved';
            stateLabel = 'Reserved';
            colorClass = 'bg-brandBlue border-blue-500 text-white';
          }
        }

        return {
          seatId,
          seatNumber,
          seatType: seat.seat_type || seat.type || 'Standard',
          hasPower: seat.has_power_socket ?? seat.powerOutlet ?? true,
          isAccessible: seat.is_accessible ?? seat.nearWindow ?? false,
          operationalStatus: seat.status || 'active',
          displayStatus,
          stateLabel,
          colorClass,
          maintenanceInfo,
          booking: isMaintenance ? null : (matchingBooking ? {
            id: matchingBooking.id,
            bookingCode: matchingBooking.booking_code || matchingBooking.bookingCode || matchingBooking.id,
            bookingDate: matchingBooking.booking_date || matchingBooking.bookingDate,
            status: matchingBooking.status,
            checkedInAt: matchingBooking.checked_in_at || matchingBooking.checkedInAt,
            studentName: matchingBooking.profiles?.full_name || matchingBooking.studentName || 'Student',
            studentRegistrationNumber: matchingBooking.profiles?.registration_number || matchingBooking.studentCollegeId || 'N/A',
            slotName: matchingBooking.slots?.name || matchingBooking.slotTime || 'Slot'
          } : null)
        };
      });

      // 4. Calculate Card Counts
      const totalCapacity = mergedSeats.length;
      const availableCount = mergedSeats.filter(s => s.displayStatus === 'available').length;
      const reservedCount = mergedSeats.filter(s => s.displayStatus === 'reserved').length;
      const occupiedCount = mergedSeats.filter(s => s.displayStatus === 'occupied').length;
      const maintenanceCount = mergedSeats.filter(s => s.displayStatus === 'maintenance').length;

      return {
        success: true,
        seats: mergedSeats,
        totalCapacity,
        availableCount,
        reservedCount,
        occupiedCount,
        maintenanceCount,
        occupancyPercentage: totalCapacity > 0 ? Math.round((occupiedCount / totalCapacity) * 100) : 0
      };
    } catch (err) {
      console.warn('[occupancyService] Failed to load occupancy, using local fallback:', err);
      const seats = defaultSeats;
      const mergedSeats = seats.map(s => ({
        seatId: s.id,
        seatNumber: s.seatNumber,
        operationalStatus: 'active',
        displayStatus: 'available',
        stateLabel: 'Available',
        colorClass: 'bg-emerald-600 border-emerald-500 text-white',
        booking: null
      }));

      return {
        success: true,
        seats: mergedSeats,
        totalCapacity: 40,
        availableCount: 40,
        reservedCount: 0,
        occupiedCount: 0,
        maintenanceCount: 0,
        occupancyPercentage: 0
      };
    }
  }
};
