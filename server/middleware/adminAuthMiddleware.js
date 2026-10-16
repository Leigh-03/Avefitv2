const jwt = require('jsonwebtoken');
const pool = require('../db');
const { getConfiguredAdminEmail } = require('../utils/adminAccess');

const verifyAdmin = async (req, res, next) => {
  const adminEmail = getConfiguredAdminEmail();
  if (!adminEmail) {
    console.error('Admin access is disabled because ADMIN_EMAIL is not configured with a valid email address.');
    return res.status(503).json({ success: false, message: 'Admin access is not configured. Contact the system administrator.' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin_id) return res.status(403).json({ success: false, message: 'Invalid admin token.' });

    const result = await pool.query(
      'SELECT admin_id, email, account_status, token_version FROM admins WHERE admin_id = $1',
      [decoded.admin_id]
    );
    if (!result.rows.length) return res.status(401).json({ success: false, message: 'Admin account not found.' });

    const admin = result.rows[0];
    if (
      String(decoded.email || '').trim().toLowerCase() !== adminEmail ||
      String(admin.email || '').trim().toLowerCase() !== adminEmail
    ) {
      return res.status(403).json({ success: false, message: 'This account is not authorized for admin access.' });
    }
    if (String(admin.account_status || 'Active').toLowerCase() !== 'active') {
      return res.status(403).json({ success: false, message: 'This admin account is inactive.' });
    }
    if (Number(decoded.token_version ?? -1) !== Number(admin.token_version ?? 0)) {
      return res.status(401).json({ success: false, message: 'Your admin session is no longer valid. Please log in again.' });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

module.exports = verifyAdmin;
