-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 24: LIVE LIBRARY OCCUPANCY REAL DATA ENGINE
-- ====================================================================

-- 1. GET LIVE OCCUPANCY SNAPSHOT RPC FUNCTION
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot(UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_live_occupancy_snapshot CASCADE;

CREATE OR REPLACE FUNCTION public.get_live_occupancy_snapshot(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_booking_date, v_now_kolkata::DATE);
    v_time TIME := v_now_kolkata::TIME;
    v_library_id UUID := p_library_id;
    v_slot_id UUID := p_slot_id;
    v_total_seats INTEGER := 0;
    v_maintenance_seats INTEGER := 0;
    v_operational_seats INTEGER := 0;
    v_occupied_seats INTEGER := 0;
    v_reserved_seats INTEGER := 0;
    v_available_seats INTEGER := 0;
    v_awaiting_checkin INTEGER := 0;
    v_pct NUMERIC := 0;
    v_floors_json JSONB := '[]'::jsonb;
    v_slot_name TEXT := 'Current Slot';
    v_slot_active BOOLEAN := true;
BEGIN
    -- Determine default Library ID if not provided
    IF v_library_id IS NULL THEN
        SELECT id INTO v_library_id FROM public.libraries LIMIT 1;
    END IF;

    -- Determine active Slot ID if not provided
    IF v_slot_id IS NULL THEN
        SELECT s.id, s.name INTO v_slot_id, v_slot_name
        FROM public.slots s
        LEFT JOIN public.slot_occurrences so ON so.slot_id = s.id AND so.date = v_date
        WHERE (so.is_disabled IS NOT TRUE AND so.status IS DISTINCT FROM 'cancelled')
          AND v_time >= s.start_time AND v_time <= s.end_time
        LIMIT 1;

        -- Fallback to first available slot if none active right now
        IF v_slot_id IS NULL THEN
            SELECT id, name INTO v_slot_id, v_slot_name FROM public.slots ORDER BY start_time LIMIT 1;
            v_slot_active := false;
        END IF;
    ELSE
        SELECT name INTO v_slot_name FROM public.slots WHERE id = v_slot_id;
    END IF;

    -- Check if slot occurrence is disabled or cancelled
    IF EXISTS (
        SELECT 1 FROM public.slot_occurrences
        WHERE slot_id = v_slot_id AND date = v_date AND (is_disabled = true OR status = 'cancelled')
    ) THEN
        v_slot_active := false;
    END IF;

    -- Overall Library Seat Capacity Metrics
    SELECT 
        COUNT(DISTINCT s.id)::INTEGER,
        COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)::INTEGER
    INTO v_total_seats, v_maintenance_seats
    FROM public.seats s
    JOIN public.rooms r ON r.id = s.room_id
    JOIN public.floors f ON f.id = r.floor_id
    LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND sm.status != 'Resolved'
    WHERE (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_total_seats := COALESCE(v_total_seats, 0);
    v_maintenance_seats := COALESCE(v_maintenance_seats, 0);
    v_operational_seats := GREATEST(0, v_total_seats - v_maintenance_seats);

    -- Occupied Seats: Valid checked_in bookings not checked out
    SELECT COUNT(DISTINCT b.seat_id)::INTEGER
    INTO v_occupied_seats
    FROM public.bookings b
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    WHERE b.booking_date = v_date
      AND b.slot_id = v_slot_id
      AND b.status = 'checked_in'
      AND b.checked_in_at IS NOT NULL
      AND b.checked_out_at IS NULL
      AND (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_occupied_seats := COALESCE(v_occupied_seats, 0);

    -- Reserved Seats: Confirmed bookings not checked in yet
    SELECT COUNT(DISTINCT b.seat_id)::INTEGER
    INTO v_reserved_seats
    FROM public.bookings b
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    WHERE b.booking_date = v_date
      AND b.slot_id = v_slot_id
      AND b.status IN ('confirmed', 'awaiting_check_in')
      AND b.checked_in_at IS NULL
      AND (v_library_id IS NULL OR f.library_id = v_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id);

    v_reserved_seats := COALESCE(v_reserved_seats, 0);
    v_awaiting_checkin := v_reserved_seats;

    -- Available Seats Math
    v_available_seats := GREATEST(0, v_operational_seats - v_occupied_seats - v_reserved_seats);

    -- Occupancy Percentage Math
    IF v_operational_seats > 0 THEN
        v_pct := ROUND((v_occupied_seats::NUMERIC / v_operational_seats::NUMERIC) * 100, 1);
    ELSE
        v_pct := 0;
    END IF;

    -- Floor-wise and Room-wise Breakdown JSON
    SELECT COALESCE(jsonb_agg(floor_data), '[]'::jsonb)
    INTO v_floors_json
    FROM (
        SELECT 
            f.id AS floor_id,
            f.name AS floor_name,
            COUNT(DISTINCT s.id)::INTEGER AS total_seats,
            COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)::INTEGER AS maintenance_seats,
            GREATEST(0, COUNT(DISTINCT s.id) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::INTEGER AS operational_seats,
            COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::INTEGER AS occupied_seats,
            COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN b.seat_id END)::INTEGER AS reserved_seats,
            GREATEST(0, 
                (COUNT(DISTINCT s.id) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) -
                COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END) -
                COUNT(DISTINCT CASE WHEN b.status IN ('confirmed', 'awaiting_check_in') AND b.checked_in_at IS NULL THEN b.seat_id END)
            )::INTEGER AS available_seats,
            CASE 
                WHEN (COUNT(DISTINCT s.id) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END)) > 0 
                THEN ROUND((COUNT(DISTINCT CASE WHEN b.status = 'checked_in' AND b.checked_in_at IS NOT NULL AND b.checked_out_at IS NULL THEN b.seat_id END)::NUMERIC / 
                            (COUNT(DISTINCT s.id) - COUNT(DISTINCT CASE WHEN s.status = 'maintenance' OR sm.id IS NOT NULL THEN s.id END))::NUMERIC) * 100, 1)
                ELSE 0 
            END AS occupancy_percentage
        FROM public.floors f
        JOIN public.rooms r ON r.floor_id = f.id
        JOIN public.seats s ON s.room_id = r.id
        LEFT JOIN public.seat_maintenance sm ON sm.seat_id = s.id AND sm.status != 'Resolved'
        LEFT JOIN public.bookings b ON b.seat_id = s.id AND b.booking_date = v_date AND b.slot_id = v_slot_id
        WHERE (v_library_id IS NULL OR f.library_id = v_library_id)
          AND (p_floor_id IS NULL OR f.id = p_floor_id)
          AND (p_room_id IS NULL OR r.id = p_room_id)
        GROUP BY f.id, f.name
        ORDER BY f.name
    ) floor_data;

    RETURN jsonb_build_object(
        'library_id', v_library_id,
        'slot_id', v_slot_id,
        'slot_name', v_slot_name,
        'slot_active', v_slot_active,
        'booking_date', v_date,
        'total_seats', v_total_seats,
        'operational_seats', v_operational_seats,
        'occupied_seats', v_occupied_seats,
        'reserved_seats', v_reserved_seats,
        'available_seats', v_available_seats,
        'maintenance_seats', v_maintenance_seats,
        'awaiting_check_in', v_awaiting_checkin,
        'checked_in_count', v_occupied_seats,
        'occupancy_percentage', v_pct,
        'floors', v_floors_json,
        'timestamp', NOW()
    );
END;
$$;


-- 2. GET CURRENT CHECKED-IN OCCUPANTS RPC FUNCTION
DROP FUNCTION IF EXISTS public.get_current_occupants(UUID, UUID, UUID, UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_current_occupants(UUID, UUID, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_current_occupants CASCADE;

CREATE OR REPLACE FUNCTION public.get_current_occupants(
    p_library_id UUID DEFAULT NULL,
    p_floor_id UUID DEFAULT NULL,
    p_room_id UUID DEFAULT NULL,
    p_slot_id UUID DEFAULT NULL,
    p_booking_date DATE DEFAULT NULL
)
RETURNS TABLE (
    booking_id UUID,
    booking_code TEXT,
    student_id UUID,
    student_name TEXT,
    registration_number TEXT,
    seat_id UUID,
    seat_number TEXT,
    room_id UUID,
    room_name TEXT,
    floor_id UUID,
    floor_name TEXT,
    slot_id UUID,
    slot_name TEXT,
    checked_in_at TIMESTAMPTZ,
    time_occupied_minutes INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now_kolkata TIMESTAMPTZ := CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata';
    v_date DATE := COALESCE(p_booking_date, v_now_kolkata::DATE);
    v_slot_id UUID := p_slot_id;
BEGIN
    IF v_slot_id IS NULL THEN
        SELECT s.id INTO v_slot_id
        FROM public.slots s
        WHERE v_now_kolkata::TIME >= s.start_time AND v_now_kolkata::TIME <= s.end_time
        LIMIT 1;

        IF v_slot_id IS NULL THEN
            SELECT id INTO v_slot_id FROM public.slots ORDER BY start_time LIMIT 1;
        END IF;
    END IF;

    RETURN QUERY
    SELECT 
        b.id AS booking_id,
        b.booking_code,
        b.student_id,
        COALESCE(p.full_name, 'Student') AS student_name,
        COALESCE(p.registration_number, '24AD042') AS registration_number,
        b.seat_id,
        COALESCE(s.seat_number, 'S-01') AS seat_number,
        b.room_id,
        COALESCE(r.name, 'Reading Room') AS room_name,
        b.floor_id,
        COALESCE(f.name, 'Ground Floor') AS floor_name,
        b.slot_id,
        COALESCE(sl.name, 'Slot') AS slot_name,
        b.checked_in_at,
        GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - b.checked_in_at)) / 60)::INTEGER) AS time_occupied_minutes
    FROM public.bookings b
    JOIN public.profiles p ON p.id = b.student_id
    JOIN public.seats s ON s.id = b.seat_id
    JOIN public.rooms r ON r.id = b.room_id
    JOIN public.floors f ON f.id = r.floor_id
    JOIN public.slots sl ON sl.id = b.slot_id
    WHERE b.booking_date = v_date
      AND (v_slot_id IS NULL OR b.slot_id = v_slot_id)
      AND b.status = 'checked_in'
      AND b.checked_in_at IS NOT NULL
      AND b.checked_out_at IS NULL
      AND (p_library_id IS NULL OR f.library_id = p_library_id)
      AND (p_floor_id IS NULL OR f.id = p_floor_id)
      AND (p_room_id IS NULL OR r.id = p_room_id)
    ORDER BY b.checked_in_at DESC;
END;
$$;
