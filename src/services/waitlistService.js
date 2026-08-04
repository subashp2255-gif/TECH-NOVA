import { supabase, isUUID } from '../lib/supabase';
import { db } from './mockDatabase';
import { notificationService } from './notificationService';
import { slotService } from './slotService';
import { bookingService } from './bookingService';

export const waitlistService = {
  async getStudentWaitlistEntries(studentId) {
    if (isUUID(studentId)) {
      try {
        const { data, error } = await supabase
          .from('waitlist_entries')
          .select(`
            id,
            booking_date,
            status,
            queue_position,
            created_at,
            slots (id, name, start_time, end_time)
          `)
          .eq('student_id', studentId)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true });

        if (!error && data) {
          return data.map(w => ({
            id: w.id,
            dateStr: w.booking_date,
            status: w.status,
            queuePosition: w.queue_position,
            slot: w.slots ? {
              id: w.slots.id,
              name: w.slots.name,
              label: w.slots.name
            } : null
          }));
        }
      } catch { /* fallback */ }
    }

    const list = (await db.read('seatsync_waitlist')) || [];
    const slots = (await db.read('seatsync_slots')) || [];

    return list
      .filter(w => w.studentId === studentId && (w.status || '').toLowerCase() === 'waiting')
      .map(entry => {
        const slot = slots.find(s => s.id === entry.slotId);
        return {
          ...entry,
          slot
        };
      });
  },

  async getWaitlistSummaryForSlot(dateStr, slotId, studentId = null) {
    const disabledState = await slotService.getDisabledState(slotId, dateStr);
    if (disabledState) {
      return {
        waitlistCount: 0,
        isStudentWaiting: false,
        studentPosition: 0,
        studentEntry: null,
        isDisabled: true,
        disabledReason: disabledState.reason
      };
    }

    if (isUUID(slotId)) {
      try {
        const { data, error } = await supabase
          .from('waitlist_entries')
          .select('id, student_id, queue_position, created_at')
          .eq('slot_id', slotId)
          .eq('booking_date', dateStr)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true });

        if (!error && data) {
          const waitlistCount = data.length;
          let isStudentWaiting = false;
          let studentPosition = 0;
          let studentEntry = null;

          if (studentId) {
            const idx = data.findIndex(w => w.student_id === studentId);
            if (idx !== -1) {
              isStudentWaiting = true;
              studentPosition = idx + 1;
              studentEntry = data[idx];
            }
          }

          return {
            waitlistCount,
            isStudentWaiting,
            studentPosition,
            studentEntry,
            isDisabled: false
          };
        }
      } catch { /* fallback */ }
    }

    const list = (await db.read('seatsync_waitlist')) || [];
    const slotEntries = list.filter(w => 
      w.dateStr === dateStr &&
      w.slotId === slotId &&
      (w.status || '').toLowerCase() === 'waiting'
    );

    slotEntries.sort((a, b) => new Date(a.joinedAt) - new Date(b.joinedAt));

    const waitlistCount = slotEntries.length;
    let isStudentWaiting = false;
    let studentPosition = 0;
    let studentEntry = null;

    if (studentId) {
      const idx = slotEntries.findIndex(w => w.studentId === studentId);
      if (idx !== -1) {
        isStudentWaiting = true;
        studentPosition = idx + 1;
        studentEntry = slotEntries[idx];
      }
    }

    return {
      waitlistCount,
      isStudentWaiting,
      studentPosition,
      studentEntry,
      isDisabled: false
    };
  },

  async getWaitlistForSlot(slotId, dateStr) {
    let resolvedSlotId = slotId;
    if (slotId && !isUUID(slotId)) {
      const slotRow = await slotService.getSlotByCode(slotId);
      if (slotRow?.id) resolvedSlotId = slotRow.id;
    }

    if (isUUID(resolvedSlotId)) {
      try {
        const { data, error } = await supabase
          .from('waitlist_entries')
          .select('*')
          .eq('slot_id', resolvedSlotId)
          .eq('booking_date', dateStr)
          .eq('status', 'waiting')
          .order('created_at', { ascending: true });

        if (!error && data) return data;
      } catch { /* fallback */ }
    }

    const list = (await db.read('seatsync_waitlist')) || [];
    return list.filter(w =>
      (w.slotId === slotId || w.slotId === resolvedSlotId) &&
      (w.dateStr === dateStr || w.bookingDate === dateStr) &&
      (w.status || '').toLowerCase() === 'waiting'
    );
  },

  async getStudentWaitlistPosition(slotId, studentId, dateStr) {
    const list = await this.getWaitlistForSlot(slotId, dateStr);
    const idx = list.findIndex(w => w.student_id === studentId || w.studentId === studentId);
    return idx !== -1 ? idx + 1 : 0;
  },

  async joinWaitlist({ student, dateStr, slot, notificationPreference = 'In-App & System Notifications' }) {
    try {
      let resolvedSlotId = slot?.id || slot;
      if (resolvedSlotId && !isUUID(resolvedSlotId)) {
        const slotRow = await slotService.getSlotByCode(resolvedSlotId);
        if (slotRow?.id) resolvedSlotId = slotRow.id;
      }

      const { data: libraryData } = await supabase.from('libraries').select('id').limit(1).maybeSingle();
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).maybeSingle();

      if (libraryData?.id && roomData?.id && isUUID(resolvedSlotId)) {
        const { data, error } = await supabase.rpc('join_waitlist', {
          p_library_id: libraryData.id,
          p_room_id: roomData.id,
          p_slot_id: resolvedSlotId,
          p_booking_date: dateStr
        });

        if (error) throw new Error(error.message);

        if (data && data.success) {
          const newEntry = {
            id: data.waitlist_id || `WL-${Date.now()}`,
            studentId: student.id,
            studentName: student.name,
            dateStr,
            slotId: resolvedSlotId,
            status: 'WAITING',
            joinedAt: new Date().toISOString()
          };

          const list = (await db.read('seatsync_waitlist')) || [];
          list.push(newEntry);
          await db.write('seatsync_waitlist', list);

          return newEntry;
        }
      }
    } catch (err) {
      if (err.message && !err.message.includes('fetch')) throw err;
    }

    // Fallback
    const list = (await db.read('seatsync_waitlist')) || [];

    const existing = list.find(w =>
      w.studentId === student.id &&
      w.dateStr === dateStr &&
      w.slotId === slot.id &&
      (w.status || '').toLowerCase() === 'waiting'
    );

    if (existing) {
      throw new Error('You are already on the waiting list for this slot.');
    }

    const newEntry = {
      id: `WL-${Date.now()}`,
      studentId: student.id,
      studentName: student.name,
      dateStr,
      slotId: slot.id,
      notificationPreference,
      status: 'WAITING',
      joinedAt: new Date().toISOString()
    };

    list.push(newEntry);
    await db.write('seatsync_waitlist', list);
    return newEntry;
  },

  async leaveWaitlist(entryId, studentId) {
    if (isUUID(entryId)) {
      try {
        await supabase
          .from('waitlist_entries')
          .update({ status: 'cancelled' })
          .eq('id', entryId);
      } catch { /* fallback */ }
    }

    const list = (await db.read('seatsync_waitlist')) || [];
    const idx = list.findIndex(w => w.id === entryId && w.studentId === studentId);
    if (idx !== -1) {
      list[idx].status = 'CANCELLED_BY_STUDENT';
      await db.write('seatsync_waitlist', list);
    }
  },

  async notifyNextStudent(dateStr, slotId) {
    try {
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).single();
      if (roomData) {
        await supabase.rpc('allocate_next_waitlisted_student', {
          p_room_id: roomData.id,
          p_slot_id: slotId,
          p_booking_date: dateStr
        });
      }
    } catch { /* fallback */ }
  },

  // FILL AFTERNOON SLOT 1 WITH 40 MOCK BOOKINGS
  async fillAfternoonSlot1(dateStr) {
    const tomorrowStr = dateStr || bookingService.getTomorrowDateStr();
    const seats = (await db.read('seatsync_seats')) || [];
    const bookings = (await db.read('seatsync_bookings')) || [];

    // Filter out existing demo bookings for Afternoon Slot 1 (SLOT-05) on tomorrowStr
    const otherBookings = bookings.filter(b => !(b.slotId === 'SLOT-05' && b.bookingDate === tomorrowStr));

    // Generate 40 confirmed bookings for Afternoon Slot 1
    const demoBookings = [];
    const seatList = seats.length >= 40 ? seats.slice(0, 40) : Array.from({ length: 40 }, (_, i) => ({
      id: `seat-${i + 1}`,
      seatNumber: `A-${101 + i}`
    }));

    for (let i = 0; i < 40; i++) {
      const seat = seatList[i];
      demoBookings.push({
        id: `BK-DEMO-A1-${i + 1}`,
        booking_code: `BK-DEMO-A1-${i + 1}`,
        studentId: `demo-student-${i + 1}`,
        studentName: `Demo Student ${String(i + 1).padStart(2, '0')}`,
        collegeId: `DEMO${String(i + 1).padStart(3, '0')}`,
        studentCollegeId: `DEMO${String(i + 1).padStart(3, '0')}`,
        bookingDate: tomorrowStr,
        slotId: 'SLOT-05',
        slotTime: '12:00 PM – 01:00 PM',
        floorId: 'floor-1',
        floorName: 'Ground Floor',
        seatId: seat.id,
        seatNumber: seat.seatNumber || `A-${101 + i}`,
        status: 'confirmed',
        is_test_data: true,
        test_scenario_id: 'waitlist-demo-001',
        createdAt: new Date().toISOString()
      });
    }

    const updatedBookings = [...demoBookings, ...otherBookings];
    await db.write('seatsync_bookings', updatedBookings);

    // Also attempt Supabase sync
    try {
      const { data: slots } = await supabase.from('slots').select('id, name');
      const targetSlot = slots?.find(s => s.name?.toLowerCase().includes('afternoon') || s.id === 'SLOT-05') || slots?.[0];
      const { data: seatsData } = await supabase.from('seats').select('id').limit(40);
      const { data: libData } = await supabase.from('libraries').select('id').limit(1).single();
      const { data: roomData } = await supabase.from('rooms').select('id').limit(1).single();

      if (targetSlot && seatsData && libData && roomData) {
        const sbBookings = seatsData.map((s, idx) => ({
          booking_code: `BK-DEMO-A1-${idx + 1}`,
          qr_token: `SS-DEMO-A1-${idx + 1}`,
          student_id: '00000000-0000-0000-0000-' + String(idx + 1).padStart(12, '0'),
          library_id: libData.id,
          room_id: roomData.id,
          seat_id: s.id,
          slot_id: targetSlot.id,
          booking_date: tomorrowStr,
          status: 'confirmed',
          is_test_data: true,
          test_scenario_id: 'waitlist-demo-001'
        }));

        await supabase.from('bookings').upsert(sbBookings, { onConflict: 'booking_code' });
      }
    } catch { /* fallback */ }

    return { success: true, count: 40 };
  },

  // DEMO SCENARIO MANAGERS
  async prepareDemoScenario(includeQueue = true) {
    await this.fillAfternoonSlot1();
    try {
      const { data, error } = await supabase.rpc('prepare_waitlist_demo_scenario', {
        p_include_waitlist_queue: includeQueue
      });
      if (!error && data) return data;
    } catch { /* fallback */ }
    return { success: true, message: 'Afternoon Slot 1 filled with 40 mock bookings for demo.' };
  },

  async resetDemoScenario() {
    try {
      const { data, error } = await supabase.rpc('reset_waitlist_demo_scenario');
      if (!error && data) return data;
    } catch { /* fallback */ }

    const bookings = (await db.read('seatsync_bookings')) || [];
    const filtered = bookings.filter(b => !b.is_test_data && b.test_scenario_id !== 'waitlist-demo-001');
    await db.write('seatsync_bookings', filtered);

    return { success: true, message: 'Demo scenario data cleared.' };
  }
};
