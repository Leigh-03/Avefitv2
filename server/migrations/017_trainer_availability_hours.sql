BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'trainer_availability'::regclass
      AND conname = 'trainer_availability_business_hours_check'
  ) THEN
    ALTER TABLE trainer_availability
      ADD CONSTRAINT trainer_availability_business_hours_check
      CHECK (start_time >= TIME '06:00' AND end_time <= TIME '22:00')
      NOT VALID;
  END IF;
END
$$;

COMMIT;
