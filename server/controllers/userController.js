const pool = require("../db");
const { expireMemberships } = require("../db");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const {
  validateRegistration,
  validateEmail,
  validatePassword,
  validateName,
  validatePhone,
  validateImageDataUrl,
  normalizeEmail,
  publicUser,
} = require("../utils/security");
const { sendMail, sendVerificationEmail } = require("../utils/mailer");
const { notifyNewUser } = require("../utils/notifications");
const googleClient = new OAuth2Client();
const {
  generateVerificationCode,
  hashVerificationToken,
  hashVerificationCode,
  verificationCodeExpiryDate,
  isExpired,
  isInResendCooldown,
  resendCooldownSeconds,
} = require("../utils/emailVerification");

/**
 * Issue a new verification code. The plaintext code is emailed while the
 * database stores only its hash.
 * @returns {Promise<{ delivered: boolean }>}
 */
const issueVerificationCode = async (user) => {
  const code = generateVerificationCode();
  const expiresAt = verificationCodeExpiryDate();

  await pool.query(
    `UPDATE users
     SET verification_token_hash = $1,
         verification_token_expires_at = $2,
         verification_sent_at = NOW()
     WHERE user_id = $3`,
    [hashVerificationCode(code), expiresAt, user.user_id]
  );

  try {
    const result = await sendVerificationEmail({
      to: user.email,
      firstName: user.first_name,
      code,
    });

    return { delivered: result.delivered };
  } catch (err) {
    // The account is created either way; the member can use "resend" once the
    // SMTP credentials are fixed, so this must not fail the registration.
    console.error("sendVerificationEmail error:", err.message);
    return { delivered: false };
  }
};

const createUserToken = (user, rememberMe) => jwt.sign(
  {
    user_id: user.user_id,
    email: user.email,
    token_version: Number(user.token_version || 0),
  },
  process.env.JWT_SECRET,
  { expiresIn: rememberMe === true ? "30d" : "8h" }
);

const issuePasswordResetToken = async (user) => {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  const resetUrl = `${(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "")}/user/reset-password?token=${encodeURIComponent(token)}`;

  await pool.query(
    `UPDATE users
     SET password_reset_token_hash = $1,
         password_reset_expires_at = $2,
         password_reset_sent_at = NOW()
     WHERE user_id = $3`,
    [hashVerificationToken(token), expiresAt, user.user_id]
  );

  const text = [
    `Hi ${user.first_name || "there"},`,
    "",
    "We received a request to reset your AveFit password.",
    "",
    `Use this link to choose a new password: ${resetUrl}`,
    "",
    "This link expires in 30 minutes. If you did not request this, you can safely ignore this email.",
    "",
    "Avenue Power & Fitness Gym",
  ].join("\n");

  const html = `
    <div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#0f172a;">
      <div style="background:#f97316;padding:22px 24px;border-radius:14px 14px 0 0;color:#fff;">
        <strong style="font-size:22px;letter-spacing:-0.04em;">AveFit</strong>
      </div>
      <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 14px 14px;background:#fff;">
        <p style="margin:0 0 12px;font-size:16px;">Hi ${user.first_name || "there"},</p>
        <p style="margin:0 0 16px;line-height:1.6;">We received a request to reset your AveFit password.</p>
        <p style="margin:0 0 20px;">
          <a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700;">Reset your password</a>
        </p>
        <p style="margin:0;line-height:1.6;">This link expires in 30 minutes. If you did not request this, you can safely ignore this email.</p>
      </div>
    </div>
  `;

  try {
    const result = await sendMail({
      to: user.email,
      subject: "Reset your AveFit password",
      text,
      html,
    });

    return { delivered: result.delivered, token };
  } catch (err) {
    console.error("send reset password email error:", err.message);
    return { delivered: false, token };
  }
};

// POST register
const register = async (req, res) => {
  try {
    const { first_name, last_name, email, password, phone } = req.body;

    const validationError = validateRegistration({
      first_name,
      last_name,
      email,
      password,
      phone,
    });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existing = await pool.query(
      "SELECT user_id FROM users WHERE LOWER(email) = $1",
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Email already registered.",
      });
    }

    // New accounts must be approved by the gym admin before they can log in.
    const accountStatus = "Pending";

    const hashed = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `
      INSERT INTO users (
        first_name,
        last_name,
        email,
        password,
        phone,
        account_status,
        email_verified
      )
      VALUES ($1,$2,$3,$4,$5,$6,FALSE)
      RETURNING
        user_id,
        first_name,
        last_name,
        email,
        phone,
        account_status,
        email_verified,
        trainer_id,
        fitness_goal,
        height,
        weight,
        gender,
        activity_level,
        setup_completed
      `,
      [
        String(first_name).trim(),
        String(last_name).trim(),
        normalizedEmail,
        hashed,
        phone ? String(phone).trim() : null,
        accountStatus,
      ]
    );

    const user = result.rows[0];
    await notifyNewUser(user).catch((err) => {
      console.error("New-user admin notification failed:", err.message);
    });

    // Email verification and gym approval are both required before login;
    // admins may review the account before email verification completes.
    //
    // IMPORTANT:
    // Do not wait for the SMTP server here.
    // The account has already been created, so the registration request
    // can respond immediately while the verification email is sent
    // in the background.
    issueVerificationCode(user)
      .then(({ delivered }) => {
        console.log(
          `📧 Verification email process completed. Delivered: ${delivered}`
        );
      })
      .catch((err) => {
        console.error(
          "Background verification email error:",
          err.message
        );
      });

    // Respond immediately instead of waiting for SMTP.
    res.status(201).json({
      success: true,
      message:
        "Account created. Check your inbox for the verification code.",
      user,
      pending_approval: true,
      email_verification_required: true,
      email_sent: true,
    });
  } catch (err) {
    console.error("register error:", err.message);

    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Email already registered.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Unable to create account.",
    });
  }
};

// POST login
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const result = await pool.query(
      `SELECT user_id, first_name, email
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [normalizedEmail]
    );

    const neutral = {
      success: true,
      message: "If that email is registered, a password reset link has been sent.",
    };

    if (result.rows.length === 0) {
      return res.json(neutral);
    }

    await issuePasswordResetToken(result.rows[0]);

    return res.json({
      ...neutral,
      email_sent: true,
    });
  } catch (err) {
    console.error("forgotPassword error:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to send the reset email right now.",
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};

    if (typeof token !== "string" || token.length < 32) {
      return res.status(400).json({
        success: false,
        message: "A valid password reset token is required.",
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message: "Use 8–12 characters with a letter, a number, and a symbol. Avoid common passwords.",
      });
    }

    const tokenHash = hashVerificationToken(token);
    const result = await pool.query(
      `SELECT user_id, password_reset_expires_at
       FROM users
       WHERE password_reset_token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This reset link is invalid or has already been used.",
      });
    }

    const user = result.rows[0];
    const expiresAt = user.password_reset_expires_at
      ? new Date(user.password_reset_expires_at)
      : null;

    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "This reset link has expired. Please request a new password reset email.",
      });
    }

    const hashed = await bcrypt.hash(password, 12);

    await pool.query(
      `UPDATE users
       SET password = $1,
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           password_reset_sent_at = NULL,
           token_version = token_version + 1,
           updated_at = NOW()
       WHERE user_id = $2`,
      [hashed, user.user_id]
    );

    res.json({
      success: true,
      message: "Your password has been reset. You can now log in with your new password.",
    });
  } catch (err) {
    console.error("resetPassword error:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to reset your password right now.",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (
      !validateEmail(email) ||
      typeof password !== "string" ||
      password.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email and password.",
      });
    }

    const normalizedEmail = normalizeEmail(email);

    await expireMemberships();

    const result = await pool.query(
      `
      SELECT
        user_id,
        first_name,
        last_name,
        email,
        password,
        phone,
        account_status,
        email_verified,
        trainer_id,
        fitness_goal,
        height,
        weight,
        gender,
        activity_level,
        setup_completed,
        profile_image,
        token_version
      FROM users
      WHERE LOWER(email) = $1
      `,
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const user = result.rows[0];

    // Upgrade legacy plaintext member passwords to bcrypt after a successful login.
    const storedPassword =
      typeof user.password === "string" ? user.password : "";

    const isBcryptHash =
      /^\$2[aby]\$\d{2}\$/.test(storedPassword);

    let valid = false;

    if (isBcryptHash) {
      valid = await bcrypt.compare(password, storedPassword);
    } else {
      const submittedBytes = Buffer.from(password, "utf8");
      const storedBytes = Buffer.from(storedPassword, "utf8");

      valid =
        submittedBytes.length === storedBytes.length &&
        crypto.timingSafeEqual(submittedBytes, storedBytes);

      if (valid) {
        const upgradedPassword = await bcrypt.hash(password, 12);

        await pool.query(
          "UPDATE users SET password = $1 WHERE user_id = $2 AND password = $3",
          [upgradedPassword, user.user_id, storedPassword]
        );
      }
    }

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    // Email verification and admin approval are independent requirements:
    // admins may review unverified accounts, but members must verify before login.
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        status: "Unverified",
        message:
          "Please verify your email address first. Enter the AveFit verification code or request a new one below.",
      });
    }

    const accountStatus = String(
      user.account_status || "pending"
    ).toLowerCase();

    if (accountStatus !== "active") {
      if (accountStatus === "inactive") {
        return res.status(403).json({
          success: false,
          status: "Inactive",
          message:
            "Your membership has expired. Please contact the gym administrator to reactivate your account.",
        });
      }

      if (accountStatus === "rejected") {
        return res.status(403).json({
          success: false,
          status: "Rejected",
          message:
            "Your AveFit account was not approved. Please contact the gym administrator for assistance.",
        });
      }

      return res.status(403).json({
        success: false,
        status: "Pending",
        message:
          "Your account is still pending approval. Please wait 1-3 working days while the gym administrator reviews your registration.",
      });
    }

    const token = createUserToken(user, rememberMe);

    res.json({
      success: true,
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error("login error:", err.message);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// POST Google identity credential
const googleLogin = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      success: false,
      code: "GOOGLE_NOT_CONFIGURED",
      message: "Google sign-in is not configured on the server.",
    });
  }

  const {
    credential,
    intent,
    phone,
    first_name,
    last_name,
    termsAccepted,
    rememberMe,
  } = req.body || {};

  if (typeof credential !== "string" || credential.length > 8192 || !["login", "signup"].includes(intent)) {
    return res.status(400).json({
      success: false,
      message: "A valid Google credential and sign-in intent are required.",
    });
  }

  let googleProfile;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    googleProfile = ticket.getPayload();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Google could not verify this sign-in. Please try again.",
    });
  }

  if (!googleProfile?.sub || !validateEmail(googleProfile.email) || googleProfile.email_verified !== true) {
    return res.status(401).json({
      success: false,
      message: "A verified Google email address is required.",
    });
  }

  const email = normalizeEmail(googleProfile.email);

  try {
    await expireMemberships();

    const byGoogleId = await pool.query(
      `SELECT user_id, first_name, last_name, email, password, phone, google_sub,
              account_status, email_verified, trainer_id, fitness_goal, height,
              weight, gender, activity_level, setup_completed, profile_image,
              token_version
       FROM users
       WHERE google_sub = $1`,
      [googleProfile.sub]
    );

    let user = byGoogleId.rows[0];
    if (user && normalizeEmail(user.email) !== email) {
      return res.status(409).json({
        success: false,
        message: "The email on this Google account has changed. Sign in with your existing AveFit email and update it from your profile.",
      });
    }

    if (!user) {
      const byEmail = await pool.query(
        `SELECT user_id, first_name, last_name, email, password, phone, google_sub,
                account_status, email_verified, trainer_id, fitness_goal, height,
                weight, gender, activity_level, setup_completed, profile_image,
                token_version
         FROM users
         WHERE LOWER(email) = $1
         LIMIT 1`,
        [email]
      );
      user = byEmail.rows[0];
    }

    if (!user && intent !== "signup") {
      return res.status(404).json({
        success: false,
        code: "SIGNUP_REQUIRED",
        message: "No AveFit account is linked to this Google account.",
      });
    }

    if (!user) {
      if (termsAccepted !== true) {
        return res.status(400).json({
          success: false,
          code: "TERMS_REQUIRED",
          message: "Please agree to the Terms and Conditions before creating your account.",
        });
      }
      if (typeof phone !== "string" || !/^09\d{9}$/.test(phone)) {
        return res.status(400).json({
          success: false,
          code: "PHONE_REQUIRED",
          message: "Enter a valid phone number starting with 09 before continuing with Google.",
        });
      }

      const firstName = validateName(googleProfile.given_name)
        ? googleProfile.given_name
        : first_name;
      const lastName = validateName(googleProfile.family_name)
        ? googleProfile.family_name
        : last_name;
      if (!validateName(firstName) || !validateName(lastName)) {
        return res.status(400).json({
          success: false,
          code: "NAME_REQUIRED",
          message: "Enter a valid first and last name to create your AveFit account.",
        });
      }

      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
      const result = await pool.query(
        `INSERT INTO users (
           first_name, last_name, email, password, phone, google_sub,
           account_status, email_verified, email_verified_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'Pending', TRUE, NOW())
         RETURNING user_id, first_name, last_name, email, phone, google_sub,
                   account_status, email_verified, trainer_id, fitness_goal,
                   height, weight, gender, activity_level, setup_completed,
                   profile_image, token_version`,
        [
          String(firstName).trim(),
          String(lastName).trim(),
          email,
          passwordHash,
          phone,
          googleProfile.sub,
        ]
      );
      user = result.rows[0];
      await notifyNewUser(user).catch((err) => {
        console.error("Google signup admin notification failed:", err.message);
      });
    } else if (user.google_sub && user.google_sub !== googleProfile.sub) {
      return res.status(409).json({
        success: false,
        message: "This AveFit account is already linked to another Google account.",
      });
    } else {
      const result = await pool.query(
        `UPDATE users
         SET google_sub = $1,
             email_verified = TRUE,
             email_verified_at = COALESCE(email_verified_at, NOW())
         WHERE user_id = $2
         RETURNING user_id, first_name, last_name, email, phone, google_sub,
                   account_status, email_verified, trainer_id, fitness_goal,
                   height, weight, gender, activity_level, setup_completed,
                   profile_image, token_version`,
        [googleProfile.sub, user.user_id]
      );
      user = result.rows[0];
    }

    const accountStatus = String(user.account_status || "Pending").toLowerCase();
    if (accountStatus !== "active") {
      const status = accountStatus === "rejected"
        ? "Rejected"
        : accountStatus === "inactive" ? "Inactive" : "Pending";
      return res.status(403).json({
        success: false,
        status,
        email: user.email,
        message: status === "Rejected"
          ? "Your AveFit account was not approved. Please contact the gym administrator."
          : status === "Inactive"
            ? "Your membership has expired. Please contact the gym administrator to reactivate your account."
            : "Your account is awaiting approval from the gym.",
      });
    }

    res.json({
      success: true,
      token: createUserToken(user, rememberMe),
      user: publicUser(user),
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This Google account is already linked to an AveFit account.",
      });
    }
    console.error("google login error:", err.message);
    res.status(500).json({
      success: false,
      message: "Unable to complete Google sign-in.",
    });
  }
};

// POST verify-email { code } (legacy { token } links are also accepted)
const verifyEmail = async (req, res) => {
  try {
    const code =
      typeof req.body?.code === "string"
        ? req.body.code.trim()
        : "";

    const legacyToken =
      typeof req.body?.token === "string"
        ? req.body.token.trim()
        : "";

    if (code && !/^\d{6}$/.test(code)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter the six-digit verification code from your email.",
      });
    }

    if (code && !validateEmail(req.body?.email)) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide the email address for this verification code.",
      });
    }

    const value = code || legacyToken;

    if (!value || value.length > 200) {
      return res.status(400).json({
        success: false,
        message:
          "A six-digit verification code is required.",
      });
    }

    const result = code
      ? await pool.query(
          `
          SELECT
            user_id,
            first_name,
            email,
            email_verified,
            verification_token_hash,
            verification_token_expires_at
          FROM users
          WHERE LOWER(email) = $1
            AND verification_token_hash = $2
          `,
          [
            normalizeEmail(req.body.email),
            hashVerificationCode(code),
          ]
        )
      : await pool.query(
          `
          SELECT
            user_id,
            first_name,
            email,
            email_verified,
            verification_token_hash,
            verification_token_expires_at
          FROM users
          WHERE verification_token_hash = $1
          `,
          [hashVerificationToken(legacyToken)]
        );

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "That verification code is incorrect. Please check it or request a new one.",
      });
    }

    const user = result.rows[0];

    // Already-verified members following an old email should not see an error.
    if (user.email_verified) {
      return res.json({
        success: true,
        already_verified: true,
        message:
          "Your email address is already verified. You can log in now.",
      });
    }

    if (isExpired(user)) {
      return res.status(400).json({
        success: false,
        expired: true,
        message:
          "That verification code has expired. Please request a new one.",
      });
    }

    // Clear the token so a link can only ever be redeemed once.
    await pool.query(
      `
      UPDATE users
      SET email_verified = TRUE,
          email_verified_at = NOW(),
          verification_token_hash = NULL,
          verification_token_expires_at = NULL,
          updated_at = NOW()
      WHERE user_id = $1
      `,
      [user.user_id]
    );

    res.json({
      success: true,
      message:
        "Email verified. Your registration is now with the gym administrator for approval.",
    });
  } catch (err) {
    console.error("verifyEmail error:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to verify your email right now.",
    });
  }
};

// POST resend-verification { email }
const resendVerification = async (req, res) => {
  try {
    const { email } = req.body;

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        user_id,
        first_name,
        email,
        email_verified,
        verification_sent_at
      FROM users
      WHERE LOWER(email) = $1
      `,
      [normalizeEmail(email)]
    );

    // Always answer the same way so this endpoint cannot be used to find out
    // which email addresses are registered.
    const neutral = {
      success: true,
      message:
        "If that address has an unverified AveFit account, a new verification code is on its way.",
    };

    if (result.rows.length === 0) {
      return res.json(neutral);
    }

    const user = result.rows[0];

    if (user.email_verified) {
      return res.json({
        ...neutral,
        already_verified: true,
        message:
          "That email address is already verified. You can log in now.",
      });
    }

    if (isInResendCooldown(user)) {
      return res.status(429).json({
        success: false,
        retry_after: resendCooldownSeconds(),
        message: `Please wait a moment before requesting another link. You can request a new one in ${
          resendCooldownSeconds() / 60
        } minutes.`,
      });
    }

    const { delivered } = await issueVerificationCode(user);

    res.json({
      ...neutral,
      email_sent: delivered,
    });
  } catch (err) {
    console.error("resendVerification error:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to send the verification email right now.",
    });
  }
};

// GET verification-status?email=...
// Lets the "check your inbox" screen tell the member whether they are still
// expected to click a link before asking the admin to review them.
const getVerificationStatus = async (req, res) => {
  try {
    const { email } = req.query;

    if (!validateEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const result = await pool.query(
      `
      SELECT
        email_verified,
        verification_sent_at
      FROM users
      WHERE LOWER(email) = $1
      `,
      [normalizeEmail(email)]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        registered: false,
        email_verified: false,
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      registered: true,
      email_verified: Boolean(user.email_verified),
      can_resend:
        !user.email_verified && !isInResendCooldown(user),
      resend_available_in: user.email_verified
        ? 0
        : isInResendCooldown(user)
        ? resendCooldownSeconds()
        : 0,
    });
  } catch (err) {
    console.error("getVerificationStatus error:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to look up that account right now.",
    });
  }
};

// PUT update just the profile photo
const updatePhoto = async (req, res) => {
  try {
    const { profile_image } = req.body;

    if (!profile_image) {
      return res.status(400).json({
        success: false,
        message: "profile_image is required.",
      });
    }

    const imageCheck = validateImageDataUrl(profile_image);

    if (!imageCheck.ok) {
      return res.status(400).json({
        success: false,
        message: imageCheck.message,
      });
    }

    await pool.query(
      "UPDATE users SET profile_image=$1, updated_at=NOW() WHERE user_id=$2",
      [profile_image, req.user.user_id]
    );

    res.json({
      success: true,
      message: "Photo updated.",
    });
  } catch (err) {
    console.error("updatePhoto error:", err.message);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// GET profile
const getProfile = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        user_id,
        first_name,
        last_name,
        email,
        gender,
        birth_date,
        age,
        height,
        weight,
        fitness_goal,
        activity_level,
        phone,
        profile_image,
        target_weight,
        workout_days_per_week,
        workout_duration,
        preferred_days,
        intensity,
        injuries,
        health_conditions,
        trainer_id,
        setup_completed,
        account_status,
        email_verified,
        email_verified_at
      FROM users
      WHERE user_id = $1
      `,
      [req.user.user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error("getProfile error:", err.message);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// PUT update profile
const updateProfile = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      gender,
      birth_date,
      age,
      height,
      weight,
      fitness_goal,
      activity_level,
      phone,
      profile_image,
      target_weight,
      workout_days_per_week,
      workout_duration,
      preferred_days,
      intensity,
      injuries,
      health_conditions,
      trainer_id,
      setup_completed,
    } = req.body;

    if (
      first_name !== undefined &&
      !validateName(first_name)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid first name.",
      });
    }

    if (
      last_name !== undefined &&
      !validateName(last_name)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid last name.",
      });
    }

    if (
      email !== undefined &&
      !validateEmail(email)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (
      phone !== undefined &&
      !validatePhone(phone)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid phone number.",
      });
    }

    if (
      profile_image !== undefined &&
      profile_image !== null &&
      profile_image !== ""
    ) {
      const imageCheck =
        validateImageDataUrl(profile_image);

      if (!imageCheck.ok) {
        return res.status(400).json({
          success: false,
          message: imageCheck.message,
        });
      }
    }

    // When onboarding selects a coach, make sure the coach is still active.
    if (
      trainer_id !== undefined &&
      trainer_id !== null &&
      trainer_id !== ""
    ) {
      const trainerCheck = await pool.query(
        `
        SELECT trainer_id
        FROM trainers
        WHERE trainer_id = $1
          AND (status = 'Active' OR status IS NULL)
        `,
        [trainer_id]
      );

      if (trainerCheck.rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "The selected coach is not available.",
        });
      }
    }

    // Normalize workout duration so PostgreSQL accepts both UI values like
    // "45 mins" and numeric values. The database stores the duration in minutes.
    let normalizedWorkoutDuration = null;

    if (
      workout_duration !== undefined &&
      workout_duration !== null &&
      workout_duration !== ""
    ) {
      const durationMatch =
        String(workout_duration).match(/\d+/);

      if (!durationMatch) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid workout duration. Please choose a valid duration.",
        });
      }

      normalizedWorkoutDuration = parseInt(
        durationMatch[0],
        10
      );
    }

    // Calculate BMI
    let bmi = null;

    if (height && weight) {
      const h = parseFloat(height) / 100;
      bmi = (
        parseFloat(weight) /
        (h * h)
      ).toFixed(2);
    }

    // Changing the address invalidates the previous verification, otherwise a

    // member could confirm one address and then swap in an unverified one.
    const current = await pool.query(
      "SELECT user_id, first_name, email FROM users WHERE user_id = $1",
      [req.user.user_id]
    );

    const currentEmail =
      current.rows[0]?.email || null;

    const nextEmail = email
      ? normalizeEmail(email)
      : null;

    const emailChanged =
      Boolean(nextEmail) &&
      nextEmail !== currentEmail;

    await pool.query(
      `
      UPDATE users
      SET first_name=$1,
          last_name=$2,
          email=$3,
          gender=$4,
          birth_date=$5,
          height=$6,
          weight=$7,
          fitness_goal=$8,
          activity_level=$9,
          phone=$10,
          age=COALESCE($11, age),
          target_weight=COALESCE($12, target_weight),
          workout_days_per_week=COALESCE($13, workout_days_per_week),
          workout_duration=COALESCE($14, workout_duration),
          preferred_days=COALESCE($15, preferred_days),
          intensity=COALESCE($16, intensity),
          injuries=COALESCE($17, injuries),
          health_conditions=COALESCE($18, health_conditions),
          trainer_id=COALESCE($19, trainer_id),
          setup_completed=COALESCE($20, setup_completed),
          profile_image=COALESCE($21, profile_image),
          updated_at=NOW()
      WHERE user_id=$22
      `,
      [
        first_name
          ? String(first_name).trim()
          : first_name,
        last_name
          ? String(last_name).trim()
          : last_name,
        email
          ? normalizeEmail(email)
          : email,
        gender,
        birth_date || null,
        height || null,
        weight || null,
        fitness_goal,
        activity_level,
        phone,
        age ?? null,
        target_weight ?? null,
        workout_days_per_week ?? null,
        normalizedWorkoutDuration,
        preferred_days ?? null,
        intensity ?? null,
        injuries ?? null,
        health_conditions ?? null,
        trainer_id ?? null,
        typeof setup_completed === "boolean"
          ? setup_completed
          : null,
        profile_image ?? null,
        req.user.user_id,
      ]
    );

    // Keep the admin member record synchronized with the registered user.
    // A member record is created the first time onboarding is completed;
    // existing records keep their current approval status.
    if (
      typeof setup_completed === "boolean" &&
      setup_completed === true
    ) {
      const userResult = await pool.query(
        `
        SELECT
          user_id,
          first_name,
          last_name,
          email,
          phone,
          gender,
          age,
          height,
          weight,
          fitness_goal,
          trainer_id
        FROM users
        WHERE user_id = $1
        `,
        [req.user.user_id]
      );

      const u = userResult.rows[0];

      if (u) {
        const existingMember =
          await pool.query(
            `
            SELECT member_id, status
            FROM members
            WHERE LOWER(email) = LOWER($1)
            ORDER BY member_id
            LIMIT 1
            `,
            [u.email]
          );

        const memberName =
          `${u.first_name || ""} ${u.last_name || ""}`.trim();

        if (existingMember.rows.length === 0) {
          await pool.query(
            `
            INSERT INTO members
              (
                full_name,
                email,
                phone,
                gender,
                age,
                height,
                weight,
                bmi,
                fitness_goal,
                status,
                trainer_id
              )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending',$10)
            `,
            [
              memberName,
              u.email,
              u.phone,
              u.gender,
              u.age,
              u.height,
              u.weight,
              bmi || null,
              u.fitness_goal,
              u.trainer_id || null,
            ]
          );
        } else {
          await pool.query(
            `
            UPDATE members
            SET full_name=$1,
                phone=$2,
                gender=$3,
                age=$4,
                height=$5,
                weight=$6,
                bmi=COALESCE($7,bmi),
                fitness_goal=$8,
                trainer_id=COALESCE($9, trainer_id)
            WHERE member_id=$10
            `,
            [
              memberName,
              u.phone,
              u.gender,
              u.age,
              u.height,
              u.weight,
              bmi || null,
              u.fitness_goal,
              u.trainer_id || null,
              existingMember.rows[0].member_id,
            ]
          );
        }
      }
    } else if (bmi) {
      await pool
        .query(
          "UPDATE members SET bmi=$1 WHERE email=(SELECT email FROM users WHERE user_id=$2)",
          [bmi, req.user.user_id]
        )
        .catch(() => {});
    }

    // A new address has to be confirmed again before the account stays usable.
    if (emailChanged) {
      await pool.query(
        `
        UPDATE users
        SET email_verified = FALSE,
            email_verified_at = NULL,
            verification_token_hash = NULL,
            verification_token_expires_at = NULL
        WHERE user_id = $1
        `,
        [req.user.user_id]
      );

      await issueVerificationCode({
        user_id: req.user.user_id,
        first_name:
          first_name ||
          current.rows[0]?.first_name,
        email: nextEmail,
      });
    }

    res.json({
      success: true,
      message: emailChanged
        ? "Profile updated. Enter the verification code sent to your new email address."
        : "Profile updated.",
      ...(emailChanged
        ? { email_verification_required: true }
        : {}),
    });
  } catch (err) {
    console.error("updateProfile error:", err.message);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = {
  register,
  login,
  googleLogin,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  getVerificationStatus,
  getProfile,
  updateProfile,
  updatePhoto,
};