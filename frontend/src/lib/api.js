import axios from "axios";

function normalizeApiBaseUrl(rawBaseUrl) {
  const value = String(rawBaseUrl || "").trim();

  if (!value) {
    return "/api/v1";
  }

  // Keep fully-qualified URLs untouched.
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  // Ensure local/proxied base paths are absolute.
  return value.startsWith("/") ? value : `/${value}`;
}

const api = axios.create({
  baseURL: normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("district_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const statusCode = error?.response?.status;
    const hasStoredToken =
      typeof window !== "undefined" &&
      Boolean(localStorage.getItem("district_token"));

    if (statusCode === 401 && hasStoredToken) {
      setAuthToken(null);
    }

    return Promise.reject(error);
  },
);

const AUTH_EVENT_NAME = "district-auth-changed";

function emitAuthChange(token) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(AUTH_EVENT_NAME, {
      detail: { token: token || null },
    }),
  );
}

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    localStorage.setItem("district_token", token);
    emitAuthChange(token);
    return;
  }

  delete api.defaults.headers.common.Authorization;
  localStorage.removeItem("district_token");
  emitAuthChange(null);
}

export function hydrateAuthToken() {
  const token = localStorage.getItem("district_token");
  if (token) {
    setAuthToken(token);
  }
  return token;
}

export async function fetchJson(path, config) {
  const response = await api.get(path, config);
  return response.data?.data ?? response.data;
}

export async function postJson(path, payload, config) {
  const response = await api.post(path, payload, config);
  return response.data;
}

export async function putJson(path, payload, config) {
  const response = await api.put(path, payload, config);
  return response.data;
}

export async function patchJson(path, payload, config) {
  const response = await api.patch(path, payload, config);
  return response.data;
}

export async function deleteJson(path, config) {
  const response = await api.delete(path, config);
  return response.data;
}

export async function uploadForm(path, formData) {
  const response = await api.post(path, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
}

export default api;
export { AUTH_EVENT_NAME };
