import { useState } from "react";
import OnboardingShell from "../components/layout/OnboardingShell";
import { useNavigate } from "react-router-dom";

const daysPerWeekOptions = ["1", "2", "3", "4", "5", "6", "7"];
const durationOptions = ["30 mins", "45 mins", "60 mins", "90 mins"];
const preferredDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const preferredWorkoutTimes = [
  { value: "Morning", label: "Morning", detail: "6:00 AM – 12:00 PM" },
  { value: "Afternoon", label: "Afternoon", detail: "12:00 PM – 5:00 PM" },
  { value: "Evening", label: "Evening", detail: "5:00 PM – 10:00 PM" },
  { value: "Flexible", label: "Flexible", detail: "Any time from 6:00 AM to 10:00 PM" },
];

function Chip({ label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition ${
        selected
          ? "border-orange-500 bg-orange-500/20 text-orange-500"
          : "border-slate-200 text-slate-500 hover:border-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

export default function Availability() {
  const navigate = useNavigate();
  // Single-select: only one "days per week" value and one "duration" value can be chosen.
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [duration, setDuration] = useState("45 mins");
  const [preferredWorkoutTime, setPreferredWorkoutTime] = useState("");
  // Multi-select: which specific days of the week the user will actually train.
  const [days, setDays] = useState([]);
  const [error, setError] = useState("");

  const toggleDay = (value) => {
    if (days.includes(value)) {
      setDays(days.filter((d) => d !== value));
    } else {
      if (days.length >= parseInt(daysPerWeek)) {
        setError(`You picked ${daysPerWeek} day${daysPerWeek !== "1" ? "s" : ""} per week — deselect a day first.`);
        return;
      }
      setError("");
      setDays([...days, value]);
    }
  };

  const handleDaysPerWeekChange = (value) => {
    setDaysPerWeek(value);
    // Trim any already-picked preferred days that now exceed the new count.
    setDays((prev) => prev.slice(0, parseInt(value)));
    setError("");
  };

  const handleContinue = () => {
    if (!preferredWorkoutTime) {
      setError("Please choose your preferred workout time.");
      return;
    }
    if (days.length === 0) {
      setError("Please select at least one preferred workout day.");
      return;
    }
    if (days.length !== parseInt(daysPerWeek)) {
      setError(`Please select exactly ${daysPerWeek} preferred day${daysPerWeek !== "1" ? "s" : ""}.`);
      return;
    }

    sessionStorage.setItem(
      "avefit_availability",
      JSON.stringify({ daysPerWeek, duration, days, preferredWorkoutTime })
    );

    navigate("/user/coach");
  };

  return (
    <OnboardingShell step={4} scroll>
    <button onClick={() => navigate("/user/health")} className="text-slate-500 hover:text-slate-900 text-sm mb-4 flex items-center gap-1">
      ← Back
    </button>

    <h2 className="text-2xl font-bold text-slate-900 mb-1">Workout Availability</h2>
    <p className="text-slate-500 text-sm mb-6">When are you available to work out?</p>

    {/* Days Per Week — single select */}
    <div className="mb-6">
      <label className="block text-sm font-medium text-slate-600 mb-3">Days Per Week</label>
      <div className="flex flex-wrap gap-2">
        {daysPerWeekOptions.map((d) => (
          <Chip key={d} label={`${d} day${d !== "1" ? "s" : ""}`} selected={daysPerWeek === d}
            onClick={() => handleDaysPerWeekChange(d)} />
        ))}
      </div>
    </div>

    {/* Preferred Workout Time — single select */}
    <fieldset className="mb-6">
      <legend className="mb-3 block text-sm font-medium text-slate-600">Preferred Workout Time</legend>
      <div className="grid grid-cols-2 gap-2">
        {preferredWorkoutTimes.map((time) => (
          <button
            key={time.value}
            type="button"
            aria-pressed={preferredWorkoutTime === time.value}
            onClick={() => {
              setPreferredWorkoutTime(time.value);
              setError("");
            }}
            className={`rounded-xl border-2 px-3 py-3 text-left transition ${
              preferredWorkoutTime === time.value
                ? "border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                : "border-slate-200 text-slate-700 hover:border-orange-300 dark:border-white/10 dark:text-slate-200"
            }`}
          >
            <span className="block text-sm font-semibold">{time.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{time.detail}</span>
          </button>
        ))}
      </div>
    </fieldset>

    {/* Workout Duration — single select */}
    <div className="mb-6">
      <label className="block text-sm font-medium text-slate-600 mb-3">Workout Duration</label>
      <div className="flex flex-wrap gap-2">
        {durationOptions.map((d) => (
          <Chip key={d} label={d} selected={duration === d}
            onClick={() => setDuration(d)} />
        ))}
      </div>
    </div>

    {/* Preferred Days — pick exactly as many as Days Per Week */}
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <label className="text-sm font-medium text-slate-600">Preferred Days</label>
        <span className="text-xs text-slate-500">{days.length}/{daysPerWeek} selected</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {preferredDays.map((d) => (
          <Chip key={d} label={d.slice(0, 3)} selected={days.includes(d)}
            onClick={() => toggleDay(d)} />
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Only these days will show workouts on your schedule — the rest will be marked as Rest Day.
      </p>
    </div>

    {error && <p className="text-red-400 text-xs mb-4">{error}</p>}

    <button
      onClick={handleContinue}
      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl transition"
    >
      Continue to Coach Selection →
    </button>
    </OnboardingShell>
  );
}
