async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

export const api = {
  state: () => request('/api/state'),
  inspect: (url) => request('/api/inspect', { method: 'POST', body: JSON.stringify({ url }) }),
  createTask: (options) => request('/api/tasks', { method: 'POST', body: JSON.stringify(options) }),
  action: (id, action) => request(`/api/tasks/${id}/action`, { method: 'POST', body: JSON.stringify({ action }) }),
  remove: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  settings: (patch) => request('/api/settings', { method: 'POST', body: JSON.stringify(patch) }),
  accountAction: (site, action) => request(`/api/accounts/${site}/${action}`, { method: 'POST' }),
  chooseFolder: () => request('/api/system/choose-folder', { method: 'POST' }),
  open: (id, reveal = false) => request(`/api/tasks/${id}/open`, { method: 'POST', body: JSON.stringify({ reveal }) }),
  subscribe({ onState, onOpen, onError }) {
    const events = new EventSource('/api/events');
    events.addEventListener('state', (event) => onState(JSON.parse(event.data)));
    events.onopen = onOpen;
    events.onerror = onError;
    return events;
  },
};
