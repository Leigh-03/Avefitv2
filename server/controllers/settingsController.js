const pool = require("../db");
const { validateImageDataUrl } = require("../utils/security");
const { getConfiguredAdminEmail } = require("../utils/adminAccess");

// GET admin profile
const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT admin_id, full_name, email, role, photo_url, created_at FROM admins WHERE admin_id = $1",
      [req.admin.admin_id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Admin not found." });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("getProfile error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT update profile
const updateProfile = async (req, res) => {
  try {
    const { full_name, email } = req.body;
    const adminEmail = getConfiguredAdminEmail();
    if (!adminEmail) {
      console.error("Admin profile update is disabled because ADMIN_EMAIL is not configured with a valid email address.");
      return res.status(503).json({ success: false, message: "Admin access is not configured. Contact the system administrator." });
    }
    if (typeof email !== "string" || email.trim().toLowerCase() !== adminEmail) {
      return res.status(400).json({
        success: false,
        message: "The admin account email is fixed by the ADMIN_EMAIL server setting.",
      });
    }
    await pool.query(
      "UPDATE admins SET full_name=$1, updated_at=NOW() WHERE admin_id=$2 AND LOWER(email)=$3",
      [full_name, req.admin.admin_id, adminEmail]
    );
    res.json({ success: true, message: "Profile updated." });
  } catch (err) {
    console.error("updateProfile error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT update just the profile photo
const updatePhoto = async (req, res) => {
  try {
    const { photo_url } = req.body;
    if (!photo_url) return res.status(400).json({ success: false, message: "photo_url is required." });
    const imageCheck = validateImageDataUrl(photo_url);
    if (!imageCheck.ok) return res.status(400).json({ success: false, message: imageCheck.message });
    await pool.query(
      "UPDATE admins SET photo_url=$1, updated_at=NOW() WHERE admin_id=$2",
      [photo_url, req.admin.admin_id]
    );
    res.json({ success: true, message: "Photo updated." });
  } catch (err) {
    console.error("updatePhoto error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getProfile, updateProfile, updatePhoto };