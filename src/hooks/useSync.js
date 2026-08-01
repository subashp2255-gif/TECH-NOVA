import { useEffect, useRef } from 'react';

export function useSync(onSync) {
  const callbackRef = useRef(onSync);
  callbackRef.current = onSync;

  useEffect(() => {
    let bc = null;
    try {
      bc = new BroadcastChannel('seatsync_channel');
      bc.onmessage = (event) => {
        if (callbackRef.current) {
          callbackRef.current(event.data);
        }
      };
    } catch { /* BroadcastChannel not supported */ }

    const handleStorageEvent = (event) => {
      if (callbackRef.current && event.key && event.key.startsWith('seatsync_')) {
        callbackRef.current({
          type: 'storage_change',
          key: event.key,
          newValue: event.newValue
        });
      }
    };

    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener('storage', handleStorageEvent);
      if (bc) bc.close();
    };
  }, []);

  const broadcast = (data) => {
    try {
      const bc = new BroadcastChannel('seatsync_channel');
      bc.postMessage(data);
      bc.close();
    } catch { /* ignore */ }
  };

  return { broadcast };
}
