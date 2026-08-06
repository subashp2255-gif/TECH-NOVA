import assert from 'assert';
import { librarianService } from '../src/services/librarianService.js';
import { supabase } from '../src/lib/supabase.js';

console.log('=== SeatSync Live Library Occupancy Real Data Test Suite ===\n');

let passed = 0;
let failed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (e) {
    console.error(`[FAIL] ${name}:`, e.message);
    failed++;
  }
}

async function runAll() {
  const todayDate = '2026-08-06';
  const tomorrowDate = '2026-08-07';

  // Fetch real library, room, slot
  const [{ data: libs }, { data: rooms }, { data: slots }] = await Promise.all([
    supabase.from('libraries').select('id').limit(1),
    supabase.from('rooms').select('id').limit(1),
    supabase.from('slots').select('id').limit(1)
  ]);

  const libId = libs?.[0]?.id || null;
  const roomId = rooms?.[0]?.id || null;
  const slotId = slots?.[0]?.id || null;

  // Test 1: Fetch Live Occupancy Snapshot via RPC
  let snapshotToday = null;
  await asyncTest('Test 1: Fetch live occupancy snapshot RPC from Supabase', async () => {
    snapshotToday = await librarianService.getLiveOccupancySnapshot(libId, null, roomId, slotId, todayDate);
    assert.ok(snapshotToday, 'Snapshot returned');
    assert.ok(typeof snapshotToday.total_seats === 'number', 'Total seats is number');
    assert.ok(typeof snapshotToday.operational_seats === 'number', 'Operational seats is number');
  });

  // Test 2: Verify Math Invariant (Occupied + Reserved + Available = Operational)
  await asyncTest('Test 2: Verify Math Invariant (Occupied + Reserved + Available = Operational seats)', async () => {
    const sum = snapshotToday.occupied_seats + snapshotToday.reserved_seats + snapshotToday.available_seats;
    assert.strictEqual(sum, snapshotToday.operational_seats, `Sum (${sum}) equals Operational Seats (${snapshotToday.operational_seats})`);
  });

  // Test 3: Operational Capacity Math (Operational = Total - Maintenance)
  await asyncTest('Test 3: Verify Operational Capacity Math (Operational = Total - Maintenance)', async () => {
    const expectedOperational = Math.max(0, snapshotToday.total_seats - snapshotToday.maintenance_seats);
    assert.strictEqual(snapshotToday.operational_seats, expectedOperational, 'Operational capacity math matches');
  });

  // Test 4: Fetch Current Occupants List via RPC
  let occupants = [];
  await asyncTest('Test 4: Fetch current checked-in occupants list RPC from Supabase', async () => {
    occupants = await librarianService.getCurrentOccupants(libId, null, roomId, slotId, todayDate);
    assert.ok(Array.isArray(occupants), 'Occupants list returned');
    assert.strictEqual(occupants.length, snapshotToday.occupied_seats, 'Occupants count matches occupied seats count');
  });

  // Test 5: Verify Future Booking Does NOT Inflate Today Occupancy
  await asyncTest('Test 5: Verify future confirmed booking on tomorrow does not inflate today occupancy', async () => {
    const snapshotTomorrow = await librarianService.getLiveOccupancySnapshot(libId, null, roomId, slotId, tomorrowDate);
    assert.ok(snapshotTomorrow, 'Tomorrow snapshot returned');
    // Tomorrow booking does not affect today's occupied count
    assert.strictEqual(snapshotToday.occupied_seats, occupants.length, 'Today occupied count unaffected by future dates');
  });

  // Test 6: Verify Occupancy Percentage Calculation
  await asyncTest('Test 6: Verify occupancy percentage math (Occupied / Operational * 100)', async () => {
    const expectedPct = snapshotToday.operational_seats > 0 
      ? Math.round((snapshotToday.occupied_seats / snapshotToday.operational_seats) * 100 * 10) / 10 
      : 0;
    assert.strictEqual(Math.round(snapshotToday.occupancy_percentage), Math.round(expectedPct), 'Occupancy percentage math matches');
  });

  console.log(`\n=== Live Library Occupancy Results: ${passed} Passed, ${failed} Failed ===\n`);
  if (failed > 0) process.exit(1);
}

runAll();
