import { useEffect, useState } from "react";
import Modal from "../components/Modal";
import { fetchJson, postJson, patchJson, deleteJson } from "../lib/api";
import {
  Plus,
  RotateCw,
  Filter,
  Columns,
  MoreHorizontal,
  ArrowUpDown,
  Search,
  UserPlus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
} from "lucide-react";

const USER_ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Global Admin" },
  { value: "education_admin", label: "Education Admin" },
  { value: "health_admin", label: "Health Admin" },
  { value: "disaster_admin", label: "Disaster Admin" },
  { value: "welfare_admin", label: "Welfare Admin" },
  { value: "department_admin", label: "Department Admin" },
  { value: "analyst", label: "Analyst" },
  { value: "user", label: "Standard User" },
];

export default function SuperAdminPage() {
  const [users, setUsers] = useState([]);
  const [userFormBusy, setUserFormBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [rowBusyId, setRowBusyId] = useState(null);

  useEffect(() => {
    loadUsers();

    const handleGlobalClick = () => setOpenMenuId(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  async function loadUsers() {
    try {
      setIsLoading(true);
      const response = await fetchJson("/admin/users");
      setUsers(response || []);
    } catch (error) {
      console.error("Load users error:", error);
      setStatus("Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());

    try {
      setUserFormBusy(true);
      await postJson("/admin/users", data);
      setStatus("User created successfully");
      loadUsers();
      setIsModalOpen(false);
      event.target.reset();
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      setStatus(error.response?.data?.message || "Failed to create user");
    } finally {
      setUserFormBusy(false);
    }
  }

  async function handleDeleteUser(userId) {
    if (!window.confirm("Are you sure you want to delete this user?")) return;

    try {
      console.log("Deleting user:", userId);
      const res = await deleteJson(`/admin/users/${userId}`);
      console.log("Delete response:", res);
      setStatus("User deleted successfully");
      loadUsers();
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      console.error("Delete user error:", error);
      setStatus(error.response?.data?.message || "Failed to delete user");
    }
  }

  function startEdit(user) {
    setOpenMenuId(null);
    setEditingUserId(user.id);
    setEditDraft({
      username: user.username || "",
      fullName: user.fullName || "",
      email: user.email || "",
      role: user.role || "user",
      isActive: Boolean(user.isActive),
    });
  }

  function cancelEdit() {
    setEditingUserId(null);
    setEditDraft(null);
    setRowBusyId(null);
  }

  function updateDraftField(field, value) {
    setEditDraft((prev) => ({
      ...(prev || {}),
      [field]: value,
    }));
  }

  async function handleSaveEdit(userId) {
    if (!editDraft) return;

    const payload = {
      ...editDraft,
      username: editDraft.username.trim(),
      fullName: editDraft.fullName.trim(),
      email: editDraft.email.trim().toLowerCase(),
    };

    try {
      setRowBusyId(userId);
      const response = await patchJson(`/admin/users/${userId}`, payload);
      const updatedUser = response?.data || response?.user || response;

      setUsers((prev) =>
        prev.map((user) => (user.id === userId ? updatedUser : user)),
      );
      setStatus("User updated successfully");
      cancelEdit();
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      console.error("Update user error:", error);
      setStatus(error.response?.data?.message || "Failed to update user");
    } finally {
      setRowBusyId(null);
    }
  }

  async function toggleUserStatus(user) {
    try {
      console.log(
        "Toggling status for user:",
        user.id,
        "Current status:",
        user.isActive,
      );
      const res = await patchJson(`/admin/users/${user.id}`, {
        isActive: !user.isActive,
      });
      console.log("Patch response:", res);
      setStatus(
        `User ${user.isActive ? "deactivated" : "activated"} successfully`,
      );
      loadUsers();
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      console.error("Update status error:", error);
      setStatus(
        error.response?.data?.message || "Failed to update user status",
      );
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:space-y-6 sm:p-6">
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            User Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage all registered users and their access roles across the
            platform.
          </p>
        </div>

        {status && (
          <div className="animate-in fade-in slide-in-from-top-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-700 duration-300 sm:max-w-md">
            {status}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/50 p-3 px-4 md:flex-row md:items-center md:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <button className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:justify-start sm:px-4">
              <Filter size={16} className="text-slate-400" />
              Filters
            </button>
            <button className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:justify-start sm:px-4">
              <Columns size={16} className="text-slate-400" />
              Columns
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-md shadow-slate-200 transition-all hover:bg-slate-800 active:scale-[0.98] sm:col-span-1 sm:px-6"
            >
              <Plus size={18} />
              Add User
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              {users.length} users • {isLoading ? "loading..." : "uptodate"}
            </div>
            <div className="hidden h-4 w-px bg-slate-200 sm:block" />
            <div className="flex items-center gap-1">
              <button
                onClick={loadUsers}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                title="Refresh Table"
              >
                <RotateCw
                  size={16}
                  className={isLoading ? "animate-spin" : ""}
                />
              </button>
              <button className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <MoreHorizontal size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-200">
          <table className="min-w-[920px] w-full border-collapse text-left lg:min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/30">
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4"
                  />
                </th>
                <th className="w-16 px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest text-center">
                  #
                </th>
                <th className="px-2 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    User Name
                    <ArrowUpDown size={10} />
                  </div>
                </th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap w-full">
                  <div className="flex items-center gap-2">
                    Full Name
                    <ArrowUpDown size={10} />
                  </div>
                </th>
                <th className="px-2 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    Email Address
                    <ArrowUpDown size={10} />
                  </div>
                </th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    System Role
                    <ArrowUpDown size={10} />
                  </div>
                </th>
                <th className="px-2 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    Joined Date
                    <ArrowUpDown size={10} />
                  </div>
                </th>
                <th className="px-2 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap text-center">
                  Status
                </th>
                <th className="w-20 px-4 py-3 text-right text-[11px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {users.map((user, idx) => {
                const isEditing = editingUserId === user.id;
                const isRowBusy = rowBusyId === user.id;
                const draft = isEditing ? editDraft : null;

                return (
                  <tr
                    key={user.id}
                    className="group hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 h-4 w-4"
                      />
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-slate-400 text-center">
                      {idx + 1}
                    </td>
                    <td className="px-2 py-4 text-sm font-medium text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          value={draft?.username ?? ""}
                          onChange={(event) =>
                            updateDraftField("username", event.target.value)
                          }
                          className="w-full min-w-[140px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 outline-none"
                        />
                      ) : (
                        user.username || "n/a"
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600 ring-1 ring-white">
                          {user.fullName.charAt(0)}
                        </div>
                        {isEditing ? (
                          <input
                            value={draft?.fullName ?? ""}
                            onChange={(event) =>
                              updateDraftField("fullName", event.target.value)
                            }
                            className="w-full min-w-[200px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 font-semibold focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 outline-none"
                          />
                        ) : (
                          <div className="text-sm font-bold text-slate-900 whitespace-nowrap">
                            {user.fullName}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-4 text-sm text-slate-600 whitespace-nowrap">
                      {isEditing ? (
                        <input
                          type="email"
                          value={draft?.email ?? ""}
                          onChange={(event) =>
                            updateDraftField("email", event.target.value)
                          }
                          className="w-full min-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 outline-none"
                        />
                      ) : (
                        user.email
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      {isEditing ? (
                        <select
                          value={draft?.role ?? "user"}
                          onChange={(event) =>
                            updateDraftField("role", event.target.value)
                          }
                          className="w-full min-w-[180px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 uppercase tracking-wider focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 outline-none"
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                            user.role === "super_admin"
                              ? "bg-amber-50 text-amber-700 border-amber-100"
                              : user.role.includes("admin")
                                ? "bg-indigo-50 text-indigo-700 border-indigo-100"
                                : "bg-slate-50 text-slate-600 border-slate-100"
                          }`}
                        >
                          {user.role.replace("_", " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-4 text-sm text-slate-500 font-medium whitespace-nowrap">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })
                        : "n/a"}
                    </td>
                    <td className="px-2 py-4 text-center">
                      {isEditing ? (
                        <button
                          onClick={() =>
                            updateDraftField("isActive", !draft?.isActive)
                          }
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-200 border ${
                            draft?.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100"
                              : "bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100"
                          }`}
                        >
                          {draft?.isActive ? (
                            <>
                              <CheckCircle2 size={12} />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle size={12} />
                              Inactive
                            </>
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => toggleUserStatus(user)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all duration-200 border ${
                            user.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100"
                              : "bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100"
                          }`}
                        >
                          {user.isActive ? (
                            <>
                              <CheckCircle2 size={12} />
                              Active
                            </>
                          ) : (
                            <>
                              <XCircle size={12} />
                              Inactive
                            </>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right whitespace-nowrap relative">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={cancelEdit}
                            disabled={isRowBusy}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleSaveEdit(user.id)}
                            disabled={isRowBusy}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {isRowBusy ? "Saving..." : "Save"}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(
                                openMenuId === user.id ? null : user.id,
                              );
                            }}
                            className="text-slate-400 hover:text-slate-900 transition-colors p-1.5 rounded-lg hover:bg-slate-100"
                            title="User Actions"
                          >
                            <MoreHorizontal size={18} />
                          </button>

                          {openMenuId === user.id && (
                            <div className="absolute right-4 top-12 z-[60] w-40 rounded-xl bg-white shadow-2xl ring-1 ring-slate-200 py-1.5 animate-in fade-in zoom-in duration-150 origin-top-right">
                              <button
                                className="flex w-full items-center gap-3 px-4 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 transition-colors uppercase tracking-wider"
                                onClick={() => startEdit(user)}
                              >
                                <Pencil size={14} className="text-slate-400" />
                                Edit User
                              </button>
                              <div className="my-1 h-px bg-slate-100" />
                              <button
                                className="flex w-full items-center gap-3 px-4 py-2 text-[11px] font-bold text-rose-600 hover:bg-rose-50 transition-colors uppercase tracking-wider"
                                onClick={() => handleDeleteUser(user.id)}
                              >
                                <Trash2 size={14} className="text-rose-400" />
                                Delete User
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && !isLoading && (
                <tr>
                  <td colSpan="9" className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-12 w-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300">
                        <Search size={24} />
                      </div>
                      <div className="text-sm font-semibold text-slate-900">
                        No users found
                      </div>
                      <p className="text-xs text-slate-500 max-w-[200px] mx-auto">
                        Try refreshing the page or add a new user to the system.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/50 p-3 px-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            <div className="flex items-center gap-2">
              Rows per page
              <select className="bg-transparent border-none p-0 text-slate-900 focus:ring-0 cursor-pointer">
                <option>50</option>
                <option>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              disabled
            >
              <ChevronLeft size={14} />
            </button>
            <div className="text-xs font-bold text-slate-900 px-2">1 of 1</div>
            <button
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              disabled
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Register New User"
      >
        <form onSubmit={handleCreateUser} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Full Name
              </label>
              <input
                name="fullName"
                required
                placeholder="John Doe"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Email Address
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="john@district.gov.mw"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              placeholder="••••••••••••"
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              System Role
            </label>
            <select
              name="role"
              required
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 transition-all outline-none appearance-none cursor-pointer"
            >
              {USER_ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all"
            >
              Cancel
            </button>
            <button
              disabled={userFormBusy}
              className="flex-[2] rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {userFormBusy ? (
                <>
                  <RotateCw size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus size={16} />
                  Create User
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
