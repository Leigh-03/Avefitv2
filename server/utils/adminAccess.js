const { normalizeEmail, validateEmail } = require("./security");

function getConfiguredAdminEmail() {
  const configuredEmail = process.env.ADMIN_EMAIL;
  if (!validateEmail(configuredEmail)) return "";
  return normalizeEmail(configuredEmail);
}

module.exports = { getConfiguredAdminEmail };
