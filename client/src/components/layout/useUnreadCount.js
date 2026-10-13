import { useEffect, useState } from "react";
import { createNotificationsApi } from "../../services/notificationsApi";

/**
 * Admin notification badge count. Re-fetches whenever `key` changes
 * (the layouts pass the current pathname) so the badge stays fresh as
 * the admin moves between pages.
 */
export default function useUnreadCount(key, audience = "admin") {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    createNotificationsApi(audience)
      .get("/unread-count")
      .then((res) => {
        if (active) setCount(res.data.count ?? 0);
      })
      .catch((err) => {
        console.error("Unread notification count fetch failed:", err.message);
      });
    return () => {
      active = false;
    };
  }, [key, audience]);

  return count;
}
