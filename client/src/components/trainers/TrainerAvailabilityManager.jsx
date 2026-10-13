import { useEffect, useState } from "react";
import { CalendarClock, Plus, Save, Trash2, X } from "lucide-react";
import api from "../../services/api";
import trainerApi from "../../trainerApi";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const freshId = () => `${Date.now()}-${Math.random()}`;

export default function TrainerAvailabilityManager({
  mode = "trainer",
  trainerId,
  trainerName = "Coach",
  onClose,
}) {
  const isAdmin = mode === "admin";
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    const request = isAdmin
      ? api.get(`/trainers/${trainerId}/availability`)
      : trainerApi.get("/me/availability");
    request
      .then(({ data }) => {
        if (active) {
          setSlots((data.data || []).map((slot) => ({
            ...slot,
            id: freshId(),
            start_time: String(slot.start_time).slice(0, 5),
            end_time: String(slot.end_time).slice(0, 5),
          })));
        }
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || "Unable to load coach availability.");
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [isAdmin, trainerId]);

  const addSlot = (dayOfWeek) => {
    setSlots((current) => [
      ...current,
      { id: freshId(), day_of_week: dayOfWeek, start_time: "09:00", end_time: "17:00" },
    ]);
    setSuccess("");
  };

  const updateSlot = (id, key, value) => {
    setSlots((current) => current.map((slot) => slot.id === id ? { ...slot, [key]: value } : slot));
    setSuccess("");
  };

  const removeSlot = (id) => {
    setSlots((current) => current.filter((slot) => slot.id !== id));
    setSuccess("");
  };

  const save = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const availability = slots.map(({ day_of_week, start_time, end_time }) => ({
        day_of_week: Number(day_of_week),
        start_time,
        end_time,
      }));
      const response = isAdmin
        ? await api.put(`/trainers/${trainerId}/availability`, { availability })
        : await trainerApi.put("/me/availability", { availability });
      setSlots((response.data.data || []).map((slot) => ({
        ...slot,
        id: freshId(),
        start_time: String(slot.start_time).slice(0, 5),
        end_time: String(slot.end_time).slice(0, 5),
      })));
      setSuccess("Availability saved.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to save coach availability.");
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <CalendarClock size={20} className="text-orange-500" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isAdmin ? `${trainerName}'s availability` : "My availability"}
          </h2>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Set recurring weekly time windows. Coaches and admins can add multiple non-overlapping windows per day.
        </p>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {success && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-300">{success}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading availability…</p>
      ) : (
        <div className="space-y-3">
          {DAYS.map((day, dayOfWeek) => {
            const daySlots = slots.filter((slot) => Number(slot.day_of_week) === dayOfWeek);
            return (
              <section key={day} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800 dark:text-white">{day}</h3>
                  <button
                    type="button"
                    onClick={() => addSlot(dayOfWeek)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-500/10"
                  >
                    <Plus size={14} /> Add time
                  </button>
                </div>
                {daySlots.length === 0 ? (
                  <p className="text-xs text-slate-400">Not available</p>
                ) : (
                  <div className="space-y-2">
                    {daySlots.map((slot) => (
                      <div key={slot.id} className="flex flex-wrap items-center gap-2">
                        <label className="sr-only" htmlFor={`start-${slot.id}`}>{day} start time</label>
                        <input
                          id={`start-${slot.id}`}
                          type="time"
                          value={slot.start_time}
                          onChange={(event) => updateSlot(slot.id, "start_time", event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 dark:border-gray-700 dark:bg-[#111] dark:text-white"
                        />
                        <span className="text-sm text-slate-400">to</span>
                        <label className="sr-only" htmlFor={`end-${slot.id}`}>{day} end time</label>
                        <input
                          id={`end-${slot.id}`}
                          type="time"
                          value={slot.end_time}
                          onChange={(event) => updateSlot(slot.id, "end_time", event.target.value)}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 dark:border-gray-700 dark:bg-[#111] dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => removeSlot(slot.id)}
                          aria-label={`Remove ${day} time slot`}
                          className="grid h-9 w-9 place-items-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="flex justify-end gap-3">
        {onClose && (
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 dark:border-gray-700 dark:text-slate-300">
            Close
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
        >
          <Save size={16} /> {saving ? "Saving…" : "Save availability"}
        </button>
      </div>
    </div>
  );

  if (!isAdmin) return <div className="mx-auto max-w-3xl">{content}</div>;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#151515] sm:p-7" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={onClose} aria-label="Close availability editor" className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}
