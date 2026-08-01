import { supabase } from '../lib/supabase';
import { db } from './mockDatabase';
import { bookingService } from './bookingService';
import { waitlistService } from './waitlistService';
import { slotService } from './slotService';
import { getTodayKolkataDate } from './occupancyService';

export const librarianService = {
  // 1. DASHBOARD METRICS
  async getDashboardMetrics(dateStr = getTodayKolkataDate()) {
    try {
      const [{ data: bookings }, { data: seats }, { data: waitlist }, { data: users }, { data: maintenance }] = await Promise.all([
        supabase.from('bookings').select('*').eq('booking_date', dateStr),
        supabase.from('seats').select('*'),
        supabase.from('waitlist_entries').select('*').eq('booking_date', dateStr).eq('status', 'waiting'),
        supabase.from('profiles').select('*').eq('role', 'student'),
        supabase.from('seat_maintenance').select('*').neq('status', 'Resolved')
      ]);

      if (seats) {
        const bList = bookings || [];
        const sList = seats || [];
        const wList = waitlist || [];
        const uList = users || [];
        const mntList = maintenance || [];

        const todayBookings = bList.filter(b => !['cancelled', 'slot_cancelled'].includes(b.status));
        const checkedInCount = todayBookings.filter(b => b.status === 'checked_in').length;
        const reservedCount = todayBookings.filter(b => ['confirmed', 'awaiting_check_in'].includes(b.status)).length;
        const occupiedSeatsCount = checkedInCount;
        const maintenanceSeatsCount = sList.filter(s => s.status === 'maintenance' || mntList.some(m => m.seat_id === s.id)).length;
        const totalSeats = sList.length || 40;
        const availableSeatsCount = Math.max(0, totalSeats - occupiedSeatsCount - reservedCount - maintenanceSeatsCount);
        const occupancyPercentage = totalSeats > 0 ? Math.round((occupiedSeatsCount / totalSeats) * 100) : 0;

        const waitingCount = wList.length;
        const noShowsCount = uList.reduce((sum, u) => sum + (u.no_show_count || 0), 0);

        return {
          occupiedSeatsCount,
          reservedCount,
          availableSeatsCount,
          totalSeats,
          todayBookingsCount: todayBookings.length,
          checkedInCount,
          waitingCount,
          noShowsCount,
          maintenanceSeatsCount,
          occupancyPercentage,
          recentCheckins: [],
          upcomingReservations: todayBookings.slice(0, 5),
          seatsNeedingAttention: sList.filter(s => s.status === 'maintenance')
        };
      }
    } catch { /* fallback */ }

    // Fallback
    const [bookings, seats, waitlist, users, checkins, maintenance] = await Promise.all([
      db.read('seatsync_bookings') || [],
      db.read('seatsync_seats') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_users') || [],
      db.read('seatsync_checkins') || [],
      db.read('seatsync_maintenance') || []
    ]);

    const bList = bookings || [];
    const sList = seats || [];
    const wList = waitlist || [];
    const uList = users || [];

    const todayBookings = bList.filter(b => b.bookingDate === dateStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const reservedCount = todayBookings.filter(b => b.status === 'confirmed').length;
    const occupiedSeatsCount = checkedInCount;
    const maintenanceSeatsCount = sList.filter(s => s.status === 'maintenance').length;
    const totalSeats = sList.length || 40;
    const availableSeatsCount = Math.max(0, totalSeats - occupiedSeatsCount - reservedCount - maintenanceSeatsCount);
    const occupancyPercentage = totalSeats > 0 ? Math.round((occupiedSeatsCount / totalSeats) * 100) : 0;

    const waitingCount = wList.filter(w => w.dateStr === dateStr && (w.status || '').toLowerCase() === 'waiting').length;
    const students = uList.filter(u => u.role === 'STUDENT');
    const noShowsCount = students.reduce((sum, u) => sum + (u.noShowCount || 0), 0);

    return {
      occupiedSeatsCount,
      reservedCount,
      availableSeatsCount,
      totalSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      waitingCount,
      noShowsCount,
      maintenanceSeatsCount,
      occupancyPercentage,
      recentCheckins: [],
      upcomingReservations: todayBookings.slice(0, 5),
      seatsNeedingAttention: sList.filter(s => s.status === 'maintenance')
    };
  },

  // 2. VERIFY TOKEN
  async verifyToken(tokenInput) {
    if (!tokenInput || !tokenInput.trim()) {
      throw new Error('Please enter a valid QR token, booking code, or student ID.');
    }
    const cleanToken = tokenInput.trim();

    try {
      const { data, error } = await supabase.rpc('check_in_booking', {
        p_identifier: cleanToken,
        p_method: 'qr'
      });

      if (!error && data && data.success) {
        return {
          valid: true,
          booking: {
            id: data.booking_id,
            bookingCode: data.booking_code,
            seatNumber: data.seat_number,
            studentName: data.student_name,
            status: 'checked_in'
          }
        };
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const matched = bookings.find(b =>
      String(b.id) === cleanToken ||
      cleanToken.includes(String(b.id)) ||
      (b.qrToken && b.qrToken === cleanToken) ||
      (b.studentCollegeId && b.studentCollegeId.toLowerCase() === cleanToken.toLowerCase())
    );

    if (!matched) {
      throw new Error(`No active reservation found for token/ID "${cleanToken}".`);
    }

    return {
      valid: true,
      booking: matched
    };
  },

  // 3. PROCESS CHECK-IN
  async processCheckIn(bookingId, staffUser, reason = 'Entry Verified') {
    try {
      const { data, error } = await supabase.rpc('check_in_booking', {
        p_identifier: String(bookingId),
        p_method: 'manual'
      });
      if (!error && data && data.success) {
        return { id: bookingId, status: 'checked_in' };
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    target.status = 'active';
    target.checkedInAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);
    return target;
  },

  // 4. PROCESS CHECK-OUT
  async processCheckOut(bookingId, staffUser) {
    try {
      const { data, error } = await supabase.rpc('check_out_booking', {
        p_booking_id: bookingId
      });
      if (!error && data && data.success) {
        return { id: bookingId, status: 'completed' };
      }
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    target.status = 'completed';
    target.checkedOutAt = new Date().toISOString();
    await db.write('seatsync_bookings', bookings);
    return target;
  },

  // 5. WALK-IN SEAT ALLOCATION
  async createWalkInBooking({ student, seat, slot, dateStr, staffUser, autoCheckIn = true }) {
    const newBooking = await bookingService.createBooking(student, dateStr, slot, seat.floorId, seat.id);
    if (autoCheckIn && newBooking) {
      await this.processCheckIn(newBooking.id, staffUser, 'Walk-In Auto Check-In');
    }
    return newBooking;
  },

  // 6. SEAT TRANSFER
  async transferSeat({ bookingId, newSeat, staffUser, reason }) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    target.seatId = newSeat.id;
    target.seatNumber = newSeat.seatNumber;
    await db.write('seatsync_bookings', bookings);
    return target;
  },

  // 7. SEAT MAINTENANCE
  async reportSeatMaintenance({ seatNumber, category, description, priority, expectedResolution, staffUser }) {
    try {
      const { data: seatData } = await supabase.from('seats').select('id').eq('seat_number', seatNumber).single();
      if (seatData) {
        const { data, error } = await supabase.rpc('set_seat_maintenance', {
          p_seat_id: seatData.id,
          p_reason: description,
          p_category: category,
          p_priority: priority || 'Medium'
        });
        if (!error && data && data.success) {
          return { id: data.ticket_id, seatNumber, status: 'Reported' };
        }
      }
    } catch { /* fallback */ }

    const seats = (await db.read('seatsync_seats')) || [];
    const seatObj = seats.find(s => s.seatNumber === seatNumber || String(s.id) === String(seatNumber));
    if (seatObj) {
      seatObj.status = 'maintenance';
      await db.write('seatsync_seats', seats);
    }

    const maintenanceList = (await db.read('seatsync_maintenance')) || [];
    const ticket = {
      id: `MNT-${Date.now()}`,
      seatNumber,
      category,
      description,
      priority: priority || 'Medium',
      reportedAt: new Date().toISOString(),
      status: 'Reported'
    };
    maintenanceList.push(ticket);
    await db.write('seatsync_maintenance', maintenanceList);
    return ticket;
  },

  async updateMaintenanceStatus(ticketId, status, resolutionNotes, staffUser) {
    const maintenanceList = (await db.read('seatsync_maintenance')) || [];
    const ticket = maintenanceList.find(m => String(m.id) === String(ticketId));
    if (ticket) {
      ticket.status = status;
      await db.write('seatsync_maintenance', maintenanceList);
    }
    return ticket || { id: ticketId, status };
  },

  // 8. INCIDENT REPORTS
  async createIncidentReport({ category, description, severity, location, studentName, actionTaken, staffUser }) {
    const incidents = (await db.read('seatsync_incidents')) || [];
    const incident = {
      id: `INC-${Date.now()}`,
      category,
      description,
      severity: severity || 'Medium',
      location: location || 'Main Reading Room',
      studentName: studentName || 'N/A',
      actionTaken: actionTaken || 'Logged',
      createdAt: new Date().toISOString(),
      status: 'Open'
    };

    incidents.push(incident);
    await db.write('seatsync_incidents', incidents);
    return incident;
  },

  // 9. SHIFT HANDOVER
  async createShiftHandover({ outgoingStaff, incomingStaff, notes, pendingIssues, maintenanceCount, unresolvedIncidents }) {
    const handovers = (await db.read('seatsync_handovers')) || [];
    const handover = {
      id: `HND-${Date.now()}`,
      outgoingStaff,
      incomingStaff,
      notes,
      timestamp: new Date().toISOString(),
      status: 'Pending'
    };

    handovers.push(handover);
    await db.write('seatsync_handovers', handovers);
    return handover;
  },

  async acknowledgeShiftHandover(handoverId, incomingStaffName) {
    const handovers = (await db.read('seatsync_handovers')) || [];
    const handover = handovers.find(h => String(h.id) === String(handoverId));
    if (handover) {
      handover.status = 'Acknowledged';
      await db.write('seatsync_handovers', handovers);
    }
    return handover || { id: handoverId, status: 'Acknowledged' };
  }
};
