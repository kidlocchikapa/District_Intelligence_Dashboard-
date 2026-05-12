import { useEffect, useState } from "react";
import { fetchJson, putJson } from "../lib/api";
import {
  ShieldCheck,
  User,
  Search,
  RotateCw,
  Save,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  Lock,
} from "lucide-react";

const DEPARTMENTS = ["education", "health", "social_welfare", "disaster"];

export default function PermissionsPage() {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingPerms, setIsLoadingPerms] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState("");

  function formatApiError(error, fallback) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error ||
      error?.message ||
      fallback;
    return message ? String(message) : fallback;
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setIsLoadingUsers(true);
      const data = await fetchJson("/admin/users");
      setUsers(data || []);
      if (data && data.length > 0 && !selectedUserId) {
        handleSelectUser(data[0].id);
      }
    } catch (error) {
      const message = formatApiError(error, "Failed to load users");
      setStatus(message);
      console.error("PermissionsPage loadUsers error:", error);
    } finally {
      setIsLoadingUsers(false);
    }
  }

  async function handleSelectUser(userId) {
    setSelectedUserId(userId);
    try {
      setIsLoadingPerms(true);
      const data = await fetchJson(`/admin/users/${userId}/permissions`);
      const permissionRows = Array.isArray(data)
        ? data
        : data?.access?.permissions || data?.permissions || [];

      // Initialize permissions for all departments if missing
      const fullPerms = DEPARTMENTS.map((dept) => {
        const existing = permissionRows.find((p) => p.department === dept);
        return (
          existing || {
            department: dept,
            canRead: true,
            canWrite: false,
            canRecompute: false,
          }
        );
      });

      // Map backend snake_case to frontend camelCase if needed
      const normalized = fullPerms.map((p) => ({
        department: p.department,
        canRead: p.canRead ?? p.can_read ?? false,
        canWrite: p.canWrite ?? p.can_write ?? false,
        canRecompute: p.canRecompute ?? p.can_recompute ?? false,
      }));

      setPermissions(normalized);
    } catch (error) {
      const message = formatApiError(error, "Failed to load user permissions");
      setStatus(message);
      console.error("PermissionsPage loadUserPermissions error:", error);
    } finally {
      setIsLoadingPerms(false);
    }
  }

  function handleTogglePermission(dept, field) {
    setPermissions((prev) =>
      prev.map((p) => {
        if (p.department === dept) {
          return { ...p, [field]: !p[field] };
        }
        return p;
      }),
    );
  }

  async function handleSave() {
    if (!selectedUserId) return;
    try {
      setIsSaving(true);
      await putJson(`/admin/users/${selectedUserId}/permissions`, {
        permissions,
      });
      setStatus("Permissions updated successfully!");
      setTimeout(() => setStatus(""), 3000);
    } catch (error) {
      const message = formatApiError(error, "Failed to update permissions");
      setStatus(message);
      console.error("PermissionsPage savePermissions error:", error);
    } finally {
      setIsSaving(false);
    }
  }

  const filteredUsers = users.filter(
    (u) =>
      String(u.fullName || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      String(u.email || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="text-black" />
            User Permissions
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Control granular data access and operational rights for departmental
            admins.
          </p>
        </div>

        {status && (
          <div className="rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-xs font-bold text-black animate-in slide-in-from-right-4">
            {status}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* User List Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-900/5 focus:border-slate-900 outline-none transition-all"
            />
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm h-[600px] flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Active Users
              </span>
              {isLoadingUsers && (
                <RotateCw size={14} className="animate-spin text-slate-400" />
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {filteredUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user.id)}
                  className={`w-full text-left p-4 flex items-center justify-between group transition-all border-b border-slate-50 last:border-0 ${
                    selectedUserId === user.id
                      ? "bg-slate-900 text-white"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
                        selectedUserId === user.id
                          ? "bg-white/10 text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {user.fullName.charAt(0)}
                    </div>
                    <div>
                      <div
                        className={`text-sm font-bold ${selectedUserId === user.id ? "text-white" : "text-slate-900"}`}
                      >
                        {user.fullName}
                      </div>
                      <div
                        className={`text-[10px] font-medium ${selectedUserId === user.id ? "text-white/60" : "text-slate-500"}`}
                      >
                        {user.email}
                      </div>
                    </div>
                  </div>
                  <ChevronRight
                    size={14}
                    className={
                      selectedUserId === user.id
                        ? "text-white/40"
                        : "text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
                    }
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Permissions Management Panel */}
        <div className="lg:col-span-8">
          {selectedUser ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col h-full min-h-[600px]">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/30">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white text-lg font-bold">
                    {selectedUser.fullName.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      {selectedUser.fullName}
                    </h2>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-widest">
                      {selectedUser.role.replace("_", " ")}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleSave}
                  disabled={isSaving || isLoadingPerms}
                  className="flex items-center gap-2 rounded-xl bg-black px-6 py-2.5 text-sm font-bold text-white hover:bg-gray-800 transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg shadow-black/10"
                >
                  {isSaving ? (
                    <RotateCw size={18} className="animate-spin" />
                  ) : (
                    <Save size={18} />
                  )}
                  Save Permissions
                </button>
              </div>

              <div className="flex-1 p-6 relative">
                {isLoadingPerms && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                    <RotateCw
                      size={32}
                      className="animate-spin text-slate-400"
                    />
                  </div>
                )}

                <div className="space-y-6">
                  <div className="flex items-center gap-2 text-slate-400">
                    <ShieldAlert size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-widest">
                      Departmental Data Access Control
                    </span>
                  </div>

                  <div className="border border-slate-100 rounded-2xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50">
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                            Department
                          </th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] text-center">
                            Read Access
                          </th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] text-center">
                            Write Access
                          </th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] text-center">
                            Recompute
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {permissions.map((perm) => (
                          <tr
                            key={perm.department}
                            className="hover:bg-slate-50/30 transition-colors"
                          >
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                <div className="h-2 w-2 rounded-full bg-slate-300" />
                                <span className="text-sm font-bold text-slate-700 capitalize">
                                  {perm.department.replace("_", " ")}
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-5 text-center">
                              <PermissionToggle
                                checked={perm.canRead}
                                onChange={() =>
                                  handleTogglePermission(
                                    perm.department,
                                    "canRead",
                                  )
                                }
                              />
                            </td>
                            <td className="px-6 py-5 text-center">
                              <PermissionToggle
                                checked={perm.canWrite}
                                onChange={() =>
                                  handleTogglePermission(
                                    perm.department,
                                    "canWrite",
                                  )
                                }
                              />
                            </td>
                            <td className="px-6 py-5 text-center">
                              <PermissionToggle
                                checked={perm.canRecompute}
                                onChange={() =>
                                  handleTogglePermission(
                                    perm.department,
                                    "canRecompute",
                                  )
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {selectedUser.role === "super_admin" && (
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 flex items-start gap-3">
                      <Lock
                        className="text-amber-500 flex-shrink-0 mt-0.5"
                        size={16}
                      />
                      <p className="text-xs text-amber-800 font-medium leading-relaxed">
                        <strong>Super Admin Bypass:</strong> This user has
                        global access permissions. Any restrictions defined here
                        will be bypassed as long as their role is set to Super
                        Admin.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-3xl h-full flex flex-col items-center justify-center p-12 text-center text-slate-400">
              <User size={48} className="mb-4 opacity-20" />
              <p className="font-bold text-sm">
                Select a user to manage their system permissions
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PermissionToggle({ checked, onChange }) {
  return (
    <button
      onClick={onChange}
      className={`h-6 w-11 rounded-full relative transition-all duration-300 focus:outline-none ring-offset-2 focus:ring-2 focus:ring-slate-200 ${
        checked ? "bg-black shadow-inner" : "bg-slate-200"
      }`}
    >
      <div
        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
