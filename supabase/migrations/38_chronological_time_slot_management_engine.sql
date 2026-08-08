-- ====================================================================
-- SEATSYNC UNIFIED MIGRATION 38: RESTORE 9 HOURLY TIME SLOTS ENGINE
-- ====================================================================

-- 1. Repair Morning Slot 1 and convert any 00:00-23:59 template into Morning Slot 1 (08:00 AM - 09:00 AM)
DO $$
BEGIN
    -- Repair any slot named 'Morning Slot 1' or with 00:00:00 start_time to be 08:00:00 - 09:00:00
    UPDATE public.slots
    SET start_time = '08:00:00'::TIME,
        end_time = '09:00:00'::TIME,
        name = 'Morning Slot 1',
        status = 'active',
        disabled_by = NULL,
        disabled_at = NULL,
        cancellation_reason = NULL
    WHERE name ~* 'Morning Slot 1'
       OR id = 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a66'::UUID
       OR (start_time = '00:00:00'::TIME AND end_time >= '23:50:00'::TIME);

    -- Clear cancelled status on occurrences for 08:00 AM - 09:00 AM slots
    UPDATE public.slot_occurrences
    SET status = 'scheduled',
        is_booking_enabled = true,
        cancellation_reason = NULL,
        disabled_reason = NULL
    WHERE slot_id IN (
        SELECT id FROM public.slots WHERE start_time = '08:00:00'::TIME AND end_time = '09:00:00'::TIME
    );
END $$;

-- 2. Clean up any obsolete lunch break slots (12:00:00 to 13:00:00)
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN (
        SELECT id FROM public.slots
        WHERE start_time = '12:00:00'::TIME AND end_time = '13:00:00'::TIME
    ) LOOP
        IF EXISTS (SELECT 1 FROM public.bookings WHERE slot_id = rec.id) OR
           EXISTS (SELECT 1 FROM public.slot_occurrences WHERE slot_id = rec.id) THEN
            UPDATE public.slots 
            SET status = 'disabled', 
                cancellation_reason = 'Lunch break period (12:00 PM - 01:00 PM)' 
            WHERE id = rec.id;
        ELSE
            DELETE FROM public.slots WHERE id = rec.id;
        END IF;
    END LOOP;
END $$;

-- 3. Idempotently upsert the 9 standard hourly operational slot templates for all active rooms
DO $$
DECLARE
    v_lib RECORD;
    v_room RECORD;
    v_slot_names TEXT[] := ARRAY[
        'Morning Slot 1',
        'Morning Slot 2',
        'Late Morning Slot',
        'Midday Slot',
        'Afternoon Session 1',
        'Afternoon Session 2',
        'Afternoon Session 3',
        'Evening Slot 1',
        'Evening Slot 2'
    ];
    v_starts TIME[] := ARRAY[
        '08:00:00'::TIME,
        '09:00:00'::TIME,
        '10:00:00'::TIME,
        '11:00:00'::TIME,
        '13:00:00'::TIME,
        '14:00:00'::TIME,
        '15:00:00'::TIME,
        '16:00:00'::TIME,
        '17:00:00'::TIME
    ];
    v_ends TIME[] := ARRAY[
        '09:00:00'::TIME,
        '10:00:00'::TIME,
        '11:00:00'::TIME,
        '12:00:00'::TIME,
        '14:00:00'::TIME,
        '15:00:00'::TIME,
        '16:00:00'::TIME,
        '17:00:00'::TIME,
        '18:00:00'::TIME
    ];
    i INT;
    v_existing_id UUID;
BEGIN
    FOR v_lib IN SELECT id FROM public.libraries LOOP
        FOR v_room IN SELECT id FROM public.rooms WHERE library_id = v_lib.id LOOP
            FOR i IN 1..9 LOOP
                -- Find if slot template exists for start_time & end_time
                SELECT id INTO v_existing_id
                FROM public.slots
                WHERE library_id = v_lib.id
                  AND room_id = v_room.id
                  AND start_time = v_starts[i]
                  AND end_time = v_ends[i]
                LIMIT 1;

                IF v_existing_id IS NOT NULL THEN
                    UPDATE public.slots
                    SET name = v_slot_names[i],
                        status = 'active',
                        disabled_by = NULL,
                        disabled_at = NULL,
                        cancellation_reason = NULL
                    WHERE id = v_existing_id;
                ELSE
                    INSERT INTO public.slots (library_id, room_id, name, start_time, end_time, status)
                    VALUES (v_lib.id, v_room.id, v_slot_names[i], v_starts[i], v_ends[i], 'active');
                END IF;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- 4. Deduplicate any duplicate slots with same (library_id, room_id, start_time, end_time)
DO $$
DECLARE
    r RECORD;
    v_canonical_id UUID;
    v_dup_id UUID;
    v_dup_occ RECORD;
    v_b RECORD;
    v_canon_occ_id UUID;
    i INT;
BEGIN
    FOR r IN (
        SELECT library_id, room_id, start_time, end_time, array_agg(id ORDER BY created_at ASC, id ASC) AS ids
        FROM public.slots
        WHERE library_id IS NOT NULL AND room_id IS NOT NULL
        GROUP BY library_id, room_id, start_time, end_time
        HAVING COUNT(*) > 1
    ) LOOP
        v_canonical_id := r.ids[1];

        FOR i IN 2..array_length(r.ids, 1) LOOP
            v_dup_id := r.ids[i];

            FOR v_dup_occ IN (
                SELECT * FROM public.slot_occurrences WHERE slot_id = v_dup_id
            ) LOOP
                SELECT id INTO v_canon_occ_id
                FROM public.slot_occurrences
                WHERE library_id = v_dup_occ.library_id
                  AND room_id = v_dup_occ.room_id
                  AND slot_id = v_canonical_id
                  AND occurrence_date = v_dup_occ.occurrence_date
                LIMIT 1;

                IF v_canon_occ_id IS NOT NULL THEN
                    FOR v_b IN (SELECT * FROM public.bookings WHERE slot_occurrence_id = v_dup_occ.id) LOOP
                        IF EXISTS (
                            SELECT 1 FROM public.bookings 
                            WHERE student_id = v_b.student_id 
                              AND booking_date = v_b.booking_date 
                              AND slot_id = v_canonical_id
                              AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
                              AND id <> v_b.id
                        ) THEN
                            UPDATE public.bookings 
                            SET status = 'cancelled',
                                cancellation_reason = 'Deduplicated duplicate slot booking',
                                slot_occurrence_id = v_canon_occ_id,
                                slot_id = v_canonical_id
                            WHERE id = v_b.id;
                        ELSE
                            UPDATE public.bookings
                            SET slot_occurrence_id = v_canon_occ_id,
                                slot_id = v_canonical_id
                            WHERE id = v_b.id;
                        END IF;
                    END LOOP;

                    UPDATE public.check_in_logs
                    SET slot_occurrence_id = v_canon_occ_id
                    WHERE slot_occurrence_id = v_dup_occ.id;

                    BEGIN
                        UPDATE public.waitlist_entries
                        SET slot_occurrence_id = v_canon_occ_id
                        WHERE slot_occurrence_id = v_dup_occ.id;
                    EXCEPTION WHEN OTHERS THEN NULL;
                    END;

                    DELETE FROM public.slot_occurrences WHERE id = v_dup_occ.id;
                ELSE
                    UPDATE public.slot_occurrences
                    SET slot_id = v_canonical_id
                    WHERE id = v_dup_occ.id;
                END IF;
            END LOOP;

            FOR v_b IN (SELECT * FROM public.bookings WHERE slot_id = v_dup_id) LOOP
                SELECT id INTO v_canon_occ_id
                FROM public.slot_occurrences
                WHERE library_id = v_b.library_id
                  AND room_id = v_b.room_id
                  AND slot_id = v_canonical_id
                  AND occurrence_date = v_b.booking_date
                LIMIT 1;

                IF EXISTS (
                    SELECT 1 FROM public.bookings 
                    WHERE student_id = v_b.student_id 
                      AND booking_date = v_b.booking_date 
                      AND slot_id = v_canonical_id
                      AND status IN ('confirmed', 'checked_in', 'awaiting_check_in')
                      AND id <> v_b.id
                ) THEN
                    UPDATE public.bookings 
                    SET status = 'cancelled',
                        cancellation_reason = 'Deduplicated duplicate slot booking',
                        slot_occurrence_id = COALESCE(v_canon_occ_id, slot_occurrence_id),
                        slot_id = v_canonical_id
                    WHERE id = v_b.id;
                ELSE
                    UPDATE public.bookings
                    SET slot_occurrence_id = COALESCE(v_canon_occ_id, slot_occurrence_id),
                        slot_id = v_canonical_id
                    WHERE id = v_b.id;
                END IF;
            END LOOP;

            DELETE FROM public.slots WHERE id = v_dup_id;
        END LOOP;
    END LOOP;
END $$;

-- 5. Add unique constraint uq_slots_library_room_time if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_slots_library_room_time'
    ) THEN
        ALTER TABLE public.slots 
        ADD CONSTRAINT uq_slots_library_room_time 
        UNIQUE (library_id, room_id, start_time, end_time);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Constraint uq_slots_library_room_time could not be added: %', SQLERRM;
END $$;

-- 6. Re-create get_student_slots RPC returning active 9 slots sorted chronologically
DROP FUNCTION IF EXISTS public.get_student_slots CASCADE;

CREATE OR REPLACE FUNCTION public.get_student_slots(
    p_library_id UUID,
    p_room_id UUID,
    p_booking_date DATE
)
RETURNS TABLE (
    slot_id UUID,
    slot_occurrence_id UUID,
    slot_name TEXT,
    start_time TIME,
    end_time TIME,
    occurrence_date DATE,
    effective_status TEXT,
    is_booking_enabled BOOLEAN,
    disabled_at TIMESTAMPTZ,
    disabled_by UUID,
    disabled_by_name TEXT,
    disabled_reason TEXT,
    has_student_booking BOOLEAN,
    student_booking_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_student_id UUID := auth.uid();
    v_slot_rec RECORD;
BEGIN
    -- Ensure occurrences exist for all active master slots
    FOR v_slot_rec IN 
        SELECT id, library_id, room_id FROM public.slots 
        WHERE (library_id = p_library_id OR p_library_id IS NULL)
          AND (room_id = p_room_id OR p_room_id IS NULL)
          AND (status::text = 'active')
          AND NOT (start_time = '00:00:00'::TIME AND end_time >= '23:50:00'::TIME)
          AND NOT (start_time = '12:00:00'::TIME AND end_time = '13:00:00'::TIME)
    LOOP
        PERFORM public.ensure_slot_occurrence(
            v_slot_rec.library_id,
            v_slot_rec.room_id,
            v_slot_rec.id,
            p_booking_date
        );
    END LOOP;

    RETURN QUERY
    SELECT
        sl.id AS slot_id,
        so.id AS slot_occurrence_id,
        sl.name AS slot_name,
        sl.start_time,
        sl.end_time,
        COALESCE(so.occurrence_date, p_booking_date) AS occurrence_date,
        CASE
            WHEN sl.status::text = 'disabled' THEN 'globally_disabled'
            WHEN so.status = 'cancelled' THEN 'cancelled'
            WHEN so.status = 'disabled' OR so.is_booking_enabled IS FALSE THEN 'disabled'
            ELSE 'active'
        END AS effective_status,
        (sl.status::text = 'active' AND COALESCE(so.is_booking_enabled, true) IS TRUE AND COALESCE(so.status, 'active') NOT IN ('cancelled', 'disabled')) AS is_booking_enabled,
        COALESCE(so.disabled_at, sl.disabled_at) AS disabled_at,
        COALESCE(so.disabled_by, sl.disabled_by) AS disabled_by,
        COALESCE(p.full_name, 'System Administrator') AS disabled_by_name,
        CASE
            WHEN sl.status::text = 'disabled' THEN COALESCE(sl.cancellation_reason, 'Globally disabled by administrator')
            WHEN so.status = 'cancelled' OR so.is_booking_enabled IS FALSE THEN COALESCE(so.cancellation_reason, so.disabled_reason, 'Cancelled by administrator')
            ELSE NULL
        END AS disabled_reason,
        (b.id IS NOT NULL) AS has_student_booking,
        b.status::text AS student_booking_status
    FROM public.slots sl
    LEFT JOIN public.slot_occurrences so 
        ON so.slot_id = sl.id 
       AND so.library_id = p_library_id 
       AND so.room_id = p_room_id 
       AND so.occurrence_date = p_booking_date
    LEFT JOIN public.profiles p 
        ON p.id = COALESCE(so.disabled_by, sl.disabled_by)
    LEFT JOIN public.bookings b 
        ON (b.slot_occurrence_id = so.id OR (b.slot_id = sl.id AND b.booking_date = p_booking_date AND b.room_id = p_room_id))
       AND b.student_id = v_student_id
       AND b.status IN ('confirmed', 'checked_in', 'awaiting_check_in')
    WHERE (sl.library_id = p_library_id OR p_library_id IS NULL)
      AND (sl.room_id = p_room_id OR p_room_id IS NULL)
      AND sl.status::text = 'active'
      AND NOT (sl.start_time = '00:00:00'::TIME AND sl.end_time >= '23:50:00'::TIME)
      AND NOT (sl.start_time = '12:00:00'::TIME AND sl.end_time = '13:00:00'::TIME)
    ORDER BY sl.start_time ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_student_slots(UUID, UUID, DATE) TO authenticated, anon;
