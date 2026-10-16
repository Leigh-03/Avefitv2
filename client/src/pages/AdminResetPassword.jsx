import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import AuthShell from "../components/layout/AuthShell";
import { Alert, Field, PasswordField, PrimaryButton } from "../components/ui/Form";

export default function AdminResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    searchParams.get("reset") === "complete" ? "Your admin password has been reset." : ""
  );
  const [complete, setComplete] = useState(searchParams.get("reset") === "complete");

  const requestReset = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await axios.post(`${import.meta.env.VITE_API_URL}/api/admin/forgot-password`, {
        email: email.trim(),
      });
      setNotice(response.data.message || "If that email matches the configured admin account, a reset link has been sent.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to send the reset email. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    if (password.length < 8 || password.length > 12 ||
      !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      setError("Use 8–12 characters with a letter, a number, and a symbol. Avoid common passwords.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await axios.post(`${import.meta.env.VITE_API_URL}/api/admin/reset-password`, {
        token,
        password,
      });
      setNotice(response.data.message || "Your admin password has been reset.");
      setComplete(true);
      navigate("/admin/reset-password?reset=complete", { replace: true });
    } catch (err) {
      setError(err.response?.data?.message || "Unable to reset the admin password. Request a new link and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      width="max-w-lg"
      glass
      title={complete ? "Password reset complete" : token ? "Reset admin password" : "Forgot admin password?"}
      subtitle={complete ? "Your administrator password has been updated." : token ? "Choose a new password for the configured admin account." : "We can send a secure, one-time reset link to the configured admin email."}
      footer={
        <p className="mt-6 text-center text-sm text-slate-500">
          <button
            type="button"
            onClick={() => navigate("/login", { replace: true })}
            className="rounded font-medium transition hover:text-orange-600"
          >
            &larr; Back to admin sign in
          </button>
        </p>
      }
    >
      {complete ? (
        <div className="space-y-4">
          {notice && <Alert tone="info">{notice}</Alert>}
          <PrimaryButton type="button" onClick={() => navigate("/login", { replace: true })}>
            Go to admin sign in
          </PrimaryButton>
        </div>
      ) : token ? (
        <form className="space-y-4" onSubmit={resetPassword}>
          {error && <Alert tone="error">{error}</Alert>}
          <PasswordField
            label="New password"
            htmlFor="admin-reset-password"
            name="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={12}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Create a new password"
          />
          <PasswordField
            label="Confirm new password"
            htmlFor="admin-reset-password-confirm"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={8}
            maxLength={12}
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Re-enter your new password"
          />
          <p className="text-xs text-slate-500">Use 8–12 characters with a letter, a number, and a symbol.</p>
          <PrimaryButton type="submit" loading={loading} loadingText="Resetting…">
            Reset password
          </PrimaryButton>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={requestReset}>
          {notice && <Alert tone="info">{notice}</Alert>}
          {error && <Alert tone="error">{error}</Alert>}
          <Field
            label="Admin email address"
            htmlFor="admin-reset-email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="Enter the email configured for admin access"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <PrimaryButton type="submit" loading={loading} loadingText="Sending…">
            Send reset link
          </PrimaryButton>
        </form>
      )}
    </AuthShell>
  );
}
