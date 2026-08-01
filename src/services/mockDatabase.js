import { 
  defaultUsers, defaultSlots, defaultFloors, defaultZones, defaultSeats, 
  defaultBookings, defaultWaitlist, defaultNotifications, defaultActivityLogs, defaultSettings 
} from '../data/seedData';

class MockDatabase {
  constructor() {
    this.delay = 150;
    this.init();
  }

  init() {
    if (!localStorage.getItem('seatsync_initialized')) {
      localStorage.setItem('seatsync_users', JSON.stringify(defaultUsers));
      localStorage.setItem('seatsync_slots', JSON.stringify(defaultSlots));
      localStorage.setItem('seatsync_floors', JSON.stringify(defaultFloors));
      localStorage.setItem('seatsync_zones', JSON.stringify(defaultZones));
      localStorage.setItem('seatsync_seats', JSON.stringify(defaultSeats));
      localStorage.setItem('seatsync_bookings', JSON.stringify(defaultBookings));
      localStorage.setItem('seatsync_waitlist', JSON.stringify(defaultWaitlist));
      localStorage.setItem('seatsync_notifications', JSON.stringify(defaultNotifications));
      localStorage.setItem('seatsync_checkins', JSON.stringify([]));
      localStorage.setItem('seatsync_checkout_requests', JSON.stringify([]));
      localStorage.setItem('seatsync_activity_logs', JSON.stringify(defaultActivityLogs));
      localStorage.setItem('seatsync_settings', JSON.stringify(defaultSettings));
      localStorage.setItem('seatsync_initialized', 'true');
    }
  }

  async read(key) {
    return new Promise(resolve => {
      setTimeout(() => {
        const data = localStorage.getItem(key);
        resolve(data ? JSON.parse(data) : null);
      }, this.delay);
    });
  }

  async write(key, value) {
    return new Promise(resolve => {
      setTimeout(() => {
        localStorage.setItem(key, JSON.stringify(value));
        window.dispatchEvent(new StorageEvent('storage', {
          key: key,
          newValue: JSON.stringify(value)
        }));
        // Broadcast via BroadcastChannel if supported
        try {
          const bc = new BroadcastChannel('seatsync_channel');
          bc.postMessage({ type: 'storage_change', key, newValue: value });
          bc.close();
        } catch { /* ignore */ }
        resolve(value);
      }, this.delay);
    });
  }
}

export const db = new MockDatabase();
