import { useEffect, useState } from "react";
import Modal from "./Modal";
import { postJson } from "../lib/api";

const INITIAL_FORM = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export default function ChangePasswordModal({
  isOpen,
  onClose,
  title = "Change Password",
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setForm(INITIAL_FORM);
      setBusy(false);
      setError("");
    }
  }, [isOpen]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      setError("All password fields are required.");
      return;
    }

    if (form.newPassword.length < 8) {
      setError("New password must be at least 8 characters long.");
      return;
    }

    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }

    if (form.currentPassword === form.newPassword) {
      setError("New password must be different from your current password.");
      return;
    }

    try {
      setBusy(true);
      await postJson("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setForm(INITIAL_FORM);
      onClose?.();
    } catch (requestError) {
      const message =
        requestError?.response?.data?.message || "Failed to change password.";
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-1">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Current password
          </label>
          <input
            type="password"
            value={form.currentPassword}
            onChange={(event) => updateField("currentPassword", event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            autoComplete="current-password"
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            New password
          </label>
          <input
            type="password"
            value={form.newPassword}
            onChange={(event) => updateField("newPassword", event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            autoComplete="new-password"
            disabled={busy}
          />
          <p className="text-[11px] font-medium text-slate-400">
            Use at least 8 characters.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Confirm new password
          </label>
          <input
            type="password"
            value={form.confirmPassword}
            onChange={(event) => updateField("confirmPassword", event.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            autoComplete="new-password"
            disabled={busy}
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-black px-4 py-2 text-sm font-bold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            disabled={busy}
          >
            {busy ? "Updating..." : "Update Password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
