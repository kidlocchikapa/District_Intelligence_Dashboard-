import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
    localStorage.setItem('district_token', token);
    return;
  }

  delete api.defaults.headers.common.Authorization;
  localStorage.removeItem('district_token');
}

export function hydrateAuthToken() {
  const token = localStorage.getItem('district_token');
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

export async function uploadForm(path, formData) {
  const response = await api.post(path, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

export default api;
