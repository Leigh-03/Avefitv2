const pool = require("../db");

// GET user's workout plan
const getUserWorkoutPlan = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ws.*, e.exercise_name, e.muscle_group, e.difficulty, e.equipment, e.description
      FROM workout_sessions ws
      LEFT JOIN exercises e ON ws.exercise_id = e.exercise_id
      WHERE ws.workout_plan_id IN (
        SELECT workout_plan_id FROM workout_plans WHERE user_id = $1
      )
      ORDER BY ws.session_date ASC
    `, [req.user.user_id]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("getUserWorkoutPlan error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET user's workout plans list
const getUserPlans = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM workout_plans WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.user_id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("getUserPlans error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST create workout session (add workout to plan)
const addWorkoutSession = async (req, res) => {
  try {
    const { workout_plan_id, exercise_id, sets, reps, duration_minutes, session_date } = req.body;

    // Create a plan if none provided
    let planId = workout_plan_id;
    if (!planId) {
      const planRes = await pool.query(
        "INSERT INTO workout_plans (user_id, plan_name, goal) VALUES ($1, $2, $3) RETURNING workout_plan_id",
        [req.user.user_id, "My Workout Plan", "General Fitness"]
      );
      planId = planRes.rows[0].workout_plan_id;
    }

    const result = await pool.query(`
      INSERT INTO workout_sessions (workout_plan_id, exercise_id, sets, reps, duration_minutes, session_date)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [planId, exercise_id || null, sets || null, reps || null, duration_minutes || null, session_date || new Date()]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("addWorkoutSession error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT update workout session
const updateWorkoutSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { sets, reps, duration_minutes, completed } = req.body;
    const result = await pool.query(`
      UPDATE workout_sessions ws
      SET sets=$1, reps=$2, duration_minutes=$3, completed=$4
      FROM workout_plans wp
      WHERE ws.session_id=$5
        AND ws.workout_plan_id = wp.workout_plan_id
        AND wp.user_id = $6
      RETURNING ws.session_id
    `, [sets, reps, duration_minutes, completed || false, id, req.user.user_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Workout not found." });
    }

    res.json({ success: true, message: "Workout updated." });
  } catch (err) {
    console.error("updateWorkoutSession error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT record the member's workout start/check-in time.
const startWorkoutSession = async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE workout_sessions ws
      SET started_at = COALESCE(ws.started_at, NOW())
      FROM workout_plans wp
      WHERE ws.session_id = $1
        AND ws.workout_plan_id = wp.workout_plan_id
        AND wp.user_id = $2
        AND ws.completed = false
      RETURNING ws.session_id, ws.started_at
    `, [req.params.id, req.user.user_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Workout not found or already completed." });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("startWorkoutSession error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT mark session as complete
const completeSession = async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE workout_sessions ws
      SET completed = true, completed_at = NOW()
      FROM workout_plans wp
      WHERE ws.session_id = $1
        AND ws.workout_plan_id = wp.workout_plan_id
        AND wp.user_id = $2
        AND ws.started_at IS NOT NULL
      RETURNING ws.session_id
    `, [req.params.id, req.user.user_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Start this workout before marking it complete." });
    }

    res.json({ success: true, message: "Session completed." });
  } catch (err) {
    console.error("completeSession error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE workout session
const deleteWorkoutSession = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      DELETE FROM workout_sessions ws
      USING workout_plans wp
      WHERE ws.session_id = $1
        AND ws.workout_plan_id = wp.workout_plan_id
        AND wp.user_id = $2
      RETURNING ws.session_id
    `, [id, req.user.user_id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Workout not found." });
    }

    res.json({ success: true, message: "Workout deleted." });
  } catch (err) {
    console.error("deleteWorkoutSession error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE reset all sessions in user's plan
const resetWeek = async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM workout_sessions
      WHERE workout_plan_id IN (
        SELECT workout_plan_id FROM workout_plans WHERE user_id=$1
      )
      AND (
        session_date = ANY(ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']::text[])
        OR (
          session_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          AND session_date >= TO_CHAR(DATE_TRUNC('week', NOW() AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD')
          AND session_date < TO_CHAR((DATE_TRUNC('week', NOW() AT TIME ZONE 'Asia/Manila') + INTERVAL '7 days')::date, 'YYYY-MM-DD')
        )
      )
    `, [req.user.user_id]);
    res.json({ success: true, message: "Week reset." });
  } catch (err) {
    console.error("resetWeek error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getUserWorkoutPlan, getUserPlans, addWorkoutSession, updateWorkoutSession, startWorkoutSession, completeSession, deleteWorkoutSession, resetWeek };