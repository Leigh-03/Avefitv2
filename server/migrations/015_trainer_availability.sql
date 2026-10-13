BEGIN;

CREATE TABLE IF NOT EXISTS trainer_availability (
  availability_id BIGSERIAL PRIMARY KEY,
  trainer_id INTEGER NOT NULL REFERENCES trainers(trainer_id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (start_time < end_time),
  UNIQUE (trainer_id, day_of_week, start_time, end_time)
);

CREATE INDEX IF NOT EXISTS trainer_availability_trainer_day_idx
  ON trainer_availability (trainer_id, day_of_week, start_time);

COMMIT;
