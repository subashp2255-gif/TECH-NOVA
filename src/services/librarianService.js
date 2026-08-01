import { db } from './mockDatabase';
import { bookingService } from './bookingService';
import { waitlistService } from './waitlistService';
import { slotService } from './slotService';

export const librarianService = {
  // 1. DASHBOARD METRICS
  async getDashboardMetrics(dateStr = new Date().toISOString().split('T')[0]) {
    const [bookings, seats, waitlist, users, checkins, maintenance, logs] = await Promise.all([
      db.read('seatsync_bookings') || [],
      db.read('seatsync_seats') || [],
      db.read('seatsync_waitlist') || [],
      db.read('seatsync_users') || [],
      db.read('seatsync_checkins') || [],
      db.read('seatsync_maintenance') || [],
      db.read('seatsync_activity_logs') || []
    ]);

    const bList = bookings || [];
    const sList = seats || [];
    const wList = waitlist || [];
    const uList = users || [];
    const chkList = checkins || [];
    const mntList = maintenance || [];

    const todayBookings = bList.filter(b => b.bookingDate === dateStr && b.status !== 'CANCELLED_BY_ADMIN' && b.status !== 'cancelled');
    const checkedInCount = todayBookings.filter(b => b.status === 'active' || b.status === 'checked_in').length;
    const occupiedSeatsCount = checkedInCount;
    const maintenanceSeatsCount = sList.filter(s => s.status === 'maintenance' || mntList.some(m => m.seatNumber === s.seatNumber && m.status !== 'Resolved')).length;
    const totalSeats = sList.length || 40;
    const availableSeatsCount = Math.max(0, totalSeats - occupiedSeatsCount - maintenanceSeatsCount);
    const occupancyPercentage = totalSeats > 0 ? Math.round((occupiedSeatsCount / totalSeats) * 100) : 0;

    const waitingCount = wList.filter(w => w.dateStr === dateStr && (w.status || '').toLowerCase() === 'waiting').length;
    const students = uList.filter(u => u.role === 'STUDENT');
    const noShowsCount = students.reduce((sum, u) => sum + (u.noShowCount || 0), 0);

    const recentCheckins = chkList.slice(-5).reverse();
    const upcomingReservations = todayBookings.filter(b => b.status === 'confirmed' || b.status === 'ACTIVE').slice(0, 5);

    const seatsNeedingAttention = sList.filter(s =>
      s.status === 'maintenance' ||
      mntList.some(m => m.seatNumber === s.seatNumber && m.status !== 'Resolved')
    );

    return {
      occupiedSeatsCount,
      availableSeatsCount,
      totalSeats,
      todayBookingsCount: todayBookings.length,
      checkedInCount,
      waitingCount,
      noShowsCount,
      maintenanceSeatsCount,
      occupancyPercentage,
      recentCheckins,
      upcomingReservations,
      seatsNeedingAttention
    };
  },

  // 2. VERIFY QR SCAN TOKEN / BOOKING CODE
  async verifyToken(tokenInput) {
    if (!tokenInput || !tokenInput.trim()) {
      throw new Error('Please enter a valid QR token, booking code, or student ID.');
    }

    const cleanToken = tokenInput.trim();
    const bookings = (await db.read('seatsync_bookings')) || [];
    const users = (await db.read('seatsync_users')) || [];

    // Match by ID, QR token, CKOUT token, student name or student college ID
    const matched = bookings.find(b =>
      String(b.id) === cleanToken ||
      cleanToken.includes(String(b.id)) ||
      (b.qrToken && b.qrToken === cleanToken) ||
      (b.studentCollegeId && b.studentCollegeId.toLowerCase() === cleanToken.toLowerCase())
    );

    if (!matched) {
      // Check if student exists by college ID
      const student = users.find(u => u.collegeId && u.collegeId.toLowerCase() === cleanToken.toLowerCase());
      if (student) {
        const studentBookings = bookings.filter(b => b.studentId === student.id && b.status !== 'cancelled' && b.status !== 'CANCELLED_BY_ADMIN');
        if (studentBookings.length > 0) {
          const latest = studentBookings[studentBookings.length - 1];
          return {
            valid: true,
            isCheckout: latest.status === 'checkout_pending' || latest.status === 'active',
            booking: latest,
            student
          };
        }
      }
      throw new Error(`No active reservation found for token/ID "${cleanToken}".`);
    }

    if (matched.status === 'CANCELLED_BY_ADMIN' || matched.status === 'cancelled') {
      throw new Error(`Booking cancelled by library — This QR pass is no longer valid. (Reason: ${matched.cancellationReason || 'Library maintenance'})`);
    }

    const isCheckout = cleanToken.includes('CKOUT') || matched.status === 'checkout_pending';
    return {
      valid: true,
      isCheckout,
      booking: matched
    };
  },

  // 3. PROCESS CHECK-IN
  async processCheckIn(bookingId, staffUser, reason = 'Entry Verified') {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    if (target.status === 'active' || target.status === 'checked_in') {
      throw new Error(`Student ${target.studentName} is already checked in to Seat ${target.seatNumber}.`);
    }

    if (target.status === 'CANCELLED_BY_ADMIN' || target.status === 'cancelled') {
      throw new Error('Cannot check in a cancelled booking.');
    }

    const now = new Date().toISOString();
    target.status = 'active';
    target.checkedInAt = now;
    target.checkedInBy = staffUser?.name || 'Librarian Staff';
    await db.write('seatsync_bookings', bookings);

    // Record check-in log
    const checkins = (await db.read('seatsync_checkins')) || [];
    checkins.push({
      id: `CHK-${Date.now()}`,
      bookingId: target.id,
      studentId: target.studentId,
      studentName: target.studentName,
      seatNumber: target.seatNumber,
      slotTime: target.slotTime,
      timestamp: now,
      staffName: staffUser?.name || 'Staff',
      reason
    });
    await db.write('seatsync_checkins', checkins);

    // Record operational log
    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'CHECK_IN',
      affectedRecord: `Booking ${target.id} (${target.studentName})`,
      result: 'SUCCESS',
      notes: `Checked in seat ${target.seatNumber} (${reason})`
    });

    return target;
  },

  // 4. PROCESS CHECK-OUT
  async processCheckOut(bookingId, staffUser) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    const now = new Date().toISOString();
    target.status = 'completed';
    target.checkedOutAt = now;
    target.checkedOutBy = staffUser?.name || 'Staff';
    await db.write('seatsync_bookings', bookings);

    // Auto notify waitlist if waitlist exists for this slot
    if (target.slotId) {
      const dateStr = target.bookingDate || now.split('T')[0];
      await waitlistService.notifyNextStudent(dateStr, target.slotId);
    }

    // Log activity
    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'CHECK_OUT',
      affectedRecord: `Booking ${target.id} (${target.studentName})`,
      result: 'SUCCESS',
      notes: `Checked out seat ${target.seatNumber}`
    });

    return target;
  },

  // 5. WALK-IN SEAT ALLOCATION
  async createWalkInBooking({ student, seat, slot, dateStr, staffUser, autoCheckIn = true }) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    
    // Check if student already has an active booking on this date & slot
    const existing = bookings.find(b =>
      b.studentId === student.id &&
      b.bookingDate === dateStr &&
      b.slotId === slot.id &&
      b.status !== 'cancelled' &&
      b.status !== 'CANCELLED_BY_ADMIN'
    );
    if (existing) {
      throw new Error(`Student ${student.name} already has a booking (${existing.id}) for this slot.`);
    }

    const now = new Date().toISOString();
    const newBooking = {
      id: `BK-WALK-${Date.now()}`,
      studentId: student.id,
      studentName: student.name,
      studentCollegeId: student.collegeId || student.registerNo || 'WALKIN-001',
      seatId: seat.id,
      seatNumber: seat.seatNumber,
      floorName: seat.floorName || 'Ground Floor',
      slotId: slot.id,
      slotTime: `${slot.startTime} - ${slot.endTime}`,
      bookingDate: dateStr,
      status: autoCheckIn ? 'active' : 'confirmed',
      booking_source: 'walk_in',
      qrToken: `QR-WALK-${Date.now()}`,
      checkedInAt: autoCheckIn ? now : null,
      checkedInBy: autoCheckIn ? (staffUser?.name || 'Librarian Staff') : null,
      createdAt: now
    };

    bookings.push(newBooking);
    await db.write('seatsync_bookings', bookings);

    // Save to walkins
    const walkins = (await db.read('seatsync_walkins')) || [];
    walkins.push({
      id: `WALK-${Date.now()}`,
      bookingId: newBooking.id,
      studentName: student.name,
      seatNumber: seat.seatNumber,
      slotTime: newBooking.slotTime,
      staffName: staffUser?.name || 'Staff',
      timestamp: now
    });
    await db.write('seatsync_walkins', walkins);

    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'WALK_IN_ALLOCATION',
      affectedRecord: `Booking ${newBooking.id} (${student.name})`,
      result: 'SUCCESS',
      notes: `Allocated Seat ${seat.seatNumber} for ${newBooking.slotTime}`
    });

    return newBooking;
  },

  // 6. SEAT TRANSFER
  async transferSeat({ bookingId, newSeat, staffUser, reason }) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const target = bookings.find(b => String(b.id) === String(bookingId));
    if (!target) throw new Error('Booking record not found.');

    const oldSeatNumber = target.seatNumber;
    target.transferred_from_seat_id = target.seatId;
    target.seatId = newSeat.id;
    target.seatNumber = newSeat.seatNumber;
    target.floorName = newSeat.floorName || target.floorName;
    target.transferReason = reason;

    await db.write('seatsync_bookings', bookings);

    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'SEAT_TRANSFER',
      affectedRecord: `Booking ${target.id} (${target.studentName})`,
      result: 'SUCCESS',
      notes: `Transferred from Seat ${oldSeatNumber} to Seat ${newSeat.seatNumber}. Reason: ${reason}`
    });

    return target;
  },

  // 7. SEAT MAINTENANCE
  async reportSeatMaintenance({ seatNumber, category, description, priority, expectedResolution, staffUser }) {
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
      expectedResolution: expectedResolution || 'Within 24 Hours',
      reportedBy: staffUser?.name || 'Librarian Staff',
      reportedAt: new Date().toISOString(),
      status: 'Reported',
      resolutionNotes: ''
    };
    maintenanceList.push(ticket);
    await db.write('seatsync_maintenance', maintenanceList);

    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'SEAT_MAINTENANCE_REPORTED',
      affectedRecord: `Seat ${seatNumber}`,
      result: 'SUCCESS',
      notes: `Reported issue: ${category} - ${description}`
    });

    return ticket;
  },

  async updateMaintenanceStatus(ticketId, status, resolutionNotes, staffUser) {
    const maintenanceList = (await db.read('seatsync_maintenance')) || [];
    const ticket = maintenanceList.find(m => String(m.id) === String(ticketId));
    if (!ticket) throw new Error('Maintenance record not found.');

    ticket.status = status;
    if (resolutionNotes) ticket.resolutionNotes = resolutionNotes;
    await db.write('seatsync_maintenance', maintenanceList);

    if (status === 'Resolved') {
      const seats = (await db.read('seatsync_seats')) || [];
      const seatObj = seats.find(s => s.seatNumber === ticket.seatNumber);
      if (seatObj) {
        seatObj.status = 'available';
        await db.write('seatsync_seats', seats);
      }
    }

    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'SEAT_MAINTENANCE_UPDATED',
      affectedRecord: `Ticket ${ticketId} (Seat ${ticket.seatNumber})`,
      result: 'SUCCESS',
      notes: `Updated status to ${status}`
    });

    return ticket;
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
      actionTaken: actionTaken || 'Logged & Addressed',
      createdBy: staffUser?.name || 'Librarian Staff',
      createdAt: new Date().toISOString(),
      status: 'Open'
    };

    incidents.push(incident);
    await db.write('seatsync_incidents', incidents);

    await this.logActivity({
      librarianName: staffUser?.name || 'Staff',
      action: 'INCIDENT_REPORTED',
      affectedRecord: `Incident ${incident.id}`,
      result: 'SUCCESS',
      notes: `Reported ${category} (${severity})`
    });

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
      pendingIssues: pendingIssues || 'None',
      maintenanceCount: maintenanceCount || 0,
      unresolvedIncidents: unresolvedIncidents || 0,
      timestamp: new Date().toISOString(),
      status: 'Pending Acknowledgement'
    };

    handovers.push(handover);
    await db.write('seatsync_handovers', handovers);

    await this.logActivity({
      librarianName: outgoingStaff,
      action: 'SHIFT_HANDOVER_CREATED',
      affectedRecord: `Handover ${handover.id}`,
      result: 'SUCCESS',
      notes: `Handover created for ${incomingStaff}`
    });

    return handover;
  },

  async acknowledgeShiftHandover(handoverId, incomingStaffName) {
    const handovers = (await db.read('seatsync_handovers')) || [];
    const handover = handovers.find(h => String(h.id) === String(handoverId));
    if (!handover) throw new Error('Handover record not found.');

    handover.status = 'Acknowledged';
    handover.acknowledgedBy = incomingStaffName;
    handover.acknowledgedAt = new Date().toISOString();

    await db.write('seatsync_handovers', handovers);

    await this.logActivity({
      librarianName: incomingStaffName,
      action: 'SHIFT_HANDOVER_ACKNOWLEDGED',
      affectedRecord: `Handover ${handoverId}`,
      result: 'SUCCESS',
      notes: `Shift acknowledged by ${incomingStaffName}`
    });

    return handover;
  },

  // 10. LOG ACTIVITY HELPER
  async logActivity({ librarianName, action, affectedRecord, result = 'SUCCESS', notes = '' }) {
    try {
      const logs = (await db.read('seatsync_activity_logs')) || [];
      const entry = {
        id: `LOG-${Date.now()}`,
        userName: librarianName || 'Staff',
        userRole: 'LIBRARIAN',
        action,
        affectedRecord,
        result,
        timestamp: new Date().toISOString(),
        notes
      };
      logs.push(entry);
      await db.write('seatsync_activity_logs', logs);
    } catch (err) {
      console.warn('Failed to log librarian activity:', err);
    }
  }
};
