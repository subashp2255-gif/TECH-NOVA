import { db } from './mockDatabase';
import { bookingService } from './bookingService';

export const dashboardService = {
  async getStudentStats(studentId) {
    const bookings = (await db.read('seatsync_bookings')) || [];
    const tomorrowDate = bookingService.getTomorrowDateStr();

    const myBookings = bookings.filter(b => b.studentId === studentId);
    const tomorrowsBookings = myBookings.filter(b => b.bookingDate === tomorrowDate && b.status !== 'cancelled').length;
    const completedReservations = myBookings.filter(b => b.status === 'completed' || b.status === 'checked_out').length;
    const activeBooking = myBookings.find(b => b.status === 'active' || b.status === 'confirmed' || b.status === 'checkout_pending');
    const upcomingBooking = myBookings.find(b => b.bookingDate === tomorrowDate && b.status === 'confirmed');

    const totalStudyHours = completedReservations * 1; // 1 hour per slot

    return {
      tomorrowsBookings,
      completedReservations,
      activeBooking,
      upcomingBooking,
      totalStudyHours
    };
  },

  async getLibraryInfo() {
    const settings = (await db.read('seatsync_settings')) || {};
    const seats = (await db.read('seatsync_seats')) || [];

    const activeSeats = seats.filter(s => s.status === 'active').length || 40;

    return {
      libraryName: settings.libraryName || 'SeatSync Central University Library',
      operatingHours: settings.operatingHours || '08:00 AM – 10:00 PM',
      totalSeats: activeSeats,
      notice: settings.notice || 'Quiet Study Hours are in effect in Zone A from 6:00 PM onwards.'
    };
  }
};
