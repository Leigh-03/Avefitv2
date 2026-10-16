const pool = require("../db");
const { getVapidPublicKey } = require("../utils/notifications");

const getPublicKey = (req, res) => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    return res.status(503).json({
      success: false,
      message: "Browser push is unavailable. Configure WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY in the server environment, then restart the API.",
    });
  }
  res.json({ success: true, publicKey });
};

const getNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT notification_id, message, is_read, created_at, notification_type,
              related_user_name AS user_name, target_url
       FROM app_notifications
       WHERE audience_type = $1 AND recipient_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.notificationAudience, req.notificationRecipientId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error("getNotifications error:", err.message);
    res.status(500).json({ success: false, message: "Unable to load notifications." });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) AS count FROM app_notifications
       WHERE audience_type = $1 AND recipient_id = $2 AND is_read = false`,
      [req.notificationAudience, req.notificationRecipientId]
    );
    res.json({ success: true, count: Number(result.rows[0].count) });
  } catch (err) {
    console.error("getUnreadCount error:", err.message);
    res.status(500).json({ success: false, message: "Unable to load unread notifications." });
  }
};

const markAsRead = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE app_notifications SET is_read = true
       WHERE notification_id = $1 AND audience_type = $2 AND recipient_id = $3
       RETURNING notification_id`,
      [req.params.id, req.notificationAudience, req.notificationRecipientId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }
    res.json({ success: true, message: "Marked as read." });
  } catch (err) {
    console.error("markAsRead error:", err.message);
    res.status(500).json({ success: false, message: "Unable to mark notification as read." });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await pool.query(
      `UPDATE app_notifications SET is_read = true
       WHERE audience_type = $1 AND recipient_id = $2 AND is_read = false`,
      [req.notificationAudience, req.notificationRecipientId]
    );
    res.json({ success: true, message: "All marked as read." });
  } catch (err) {
    console.error("markAllAsRead error:", err.message);
    res.status(500).json({ success: false, message: "Unable to mark notifications as read." });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM app_notifications
       WHERE notification_id = $1 AND audience_type = $2 AND recipient_id = $3
       RETURNING notification_id`,
      [req.params.id, req.notificationAudience, req.notificationRecipientId]
    );
    if (!result.rowCount) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }
    res.json({ success: true, message: "Notification deleted." });
  } catch (err) {
    console.error("deleteNotification error:", err.message);
    res.status(500).json({ success: false, message: "Unable to delete notification." });
  }
};

const saveSubscription = async (req, res) => {
  if (!getVapidPublicKey()) {
    return res.status(503).json({
      success: false,
      message: "Browser push is unavailable. Configure WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY in the server environment, then restart the API.",
    });
  }

  const subscription = req.body;
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.endpoint.startsWith("https://") ||
    typeof subscription.keys?.p256dh !== "string" ||
    typeof subscription.keys?.auth !== "string"
  ) {
    return res.status(400).json({ success: false, message: "A valid browser push subscription is required." });
  }

  try {
    await pool.query(
      `INSERT INTO push_subscriptions (audience_type, recipient_id, endpoint, subscription)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (audience_type, recipient_id, endpoint) DO UPDATE
       SET
           subscription = EXCLUDED.subscription,
           updated_at = NOW()`,
      [
        req.notificationAudience,
        req.notificationRecipientId,
        subscription.endpoint,
        JSON.stringify(subscription),
      ]
    );
    res.status(201).json({ success: true, message: "Browser notifications enabled." });
  } catch (err) {
    console.error("saveSubscription error:", err.message);
    res.status(500).json({ success: false, message: "Unable to save browser notification settings." });
  }
};

const removeSubscription = async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== "string") {
    return res.status(400).json({ success: false, message: "A push subscription endpoint is required." });
  }

  try {
    await pool.query(
      `DELETE FROM push_subscriptions
       WHERE endpoint = $1 AND audience_type = $2 AND recipient_id = $3`,
      [endpoint, req.notificationAudience, req.notificationRecipientId]
    );
    res.json({ success: true, message: "Browser notifications disabled." });
  } catch (err) {
    console.error("removeSubscription error:", err.message);
    res.status(500).json({ success: false, message: "Unable to disable browser notifications." });
  }
};

module.exports = {
  getPublicKey,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  saveSubscription,
  removeSubscription,
};
