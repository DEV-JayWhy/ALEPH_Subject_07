const cfg = window.PDS_CONFIG || {};
const url = String(cfg.supabaseUrl || '').trim().replace(/\/$/, '');
const key = String(cfg.supabasePublishableKey || '').trim();
const SESSION_KEY = 'aleph07_supabase_session';

function forbiddenKey(value) {
  if (/^(sb_secret_|YOUR_|SERVICE_ROLE)/i.test(value)) return true;
  if (value.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.role === 'service_role';
    } catch { /* The API will report an invalid public key. */ }
  }
  return false;
}

export const configured = /^https:\/\/[a-z0-9.-]+$/i.test(url) &&
  !url.includes('YOUR_PROJECT_REF') && !!key && !forbiddenKey(key);

export function getSession() {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (!value?.access_token || !value?.user?.id) return null;
    return value;
  } catch {
    return null;
  }
}

function saveSession(value) {
  if (value?.access_token && value?.user?.id) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(SESSION_KEY);
  }
}

async function authRequest(path, { method = 'POST', body, token } = {}) {
  if (!configured) throw new Error('config.js에 올바른 프로젝트 URL과 공개용 키를 넣어주세요.');
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  let data = null;
  try { data = await response.json(); } catch { /* no body */ }

  if (!response.ok) {
    throw new Error(data?.msg || data?.message || data?.error_description ||
      `인증 요청 실패 (${response.status})`);
  }
  return data;
}

export async function signUp(email, password) {
  const data = await authRequest('signup', { body: { email, password } });
  if (!data?.access_token) {
    throw new Error('가입은 되었지만 즉시 로그인 세션이 발급되지 않았습니다. Supabase의 Confirm email 설정을 확인하세요.');
  }
  saveSession(data);
  return data;
}

export async function signIn(email, password) {
  const data = await authRequest('token?grant_type=password', { body: { email, password } });
  saveSession(data);
  return data;
}

export async function signOut() {
  const session = getSession();
  try {
    if (session?.access_token) {
      await authRequest('logout', { body: {}, token: session.access_token });
    }
  } finally {
    saveSession(null);
  }
}

export function currentUser() {
  return getSession()?.user || null;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (!configured) throw new Error('config.js에 올바른 프로젝트 URL과 공개용 키를 넣어주세요.');

  const session = getSession();
  if (!session?.access_token) throw new Error('로그인이 필요합니다.');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });

  if (response.status === 401) {
    saveSession(null);
    throw new Error('로그인 세션이 만료되었습니다. 다시 로그인해 주세요.');
  }

  if (!response.ok) {
    let reason = `서버 요청 실패 (${response.status})`;
    try {
      const info = await response.json();
      reason = info.message || info.hint || reason;
    } catch { /* Keep the HTTP status. */ }
    throw new Error(reason);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function rows(table, order = 'created_at.asc') {
  const all = [];
  let offset = 0;
  while (true) {
    const batch = await request(`${table}?select=*&order=${encodeURIComponent(order)}`, {
      headers: { Range: `${offset}-${offset + 999}` }
    });
    all.push(...batch);
    if (batch.length < 1000) return all;
    offset += 1000;
  }
}

export async function insert(table, value) {
  let body = value;
  if (table === 'plans') {
    const user = currentUser();
    if (!user?.id) throw new Error('로그인이 필요합니다.');
    body = Array.isArray(value) ? value.map(item => ({ ...item, user_id: user.id })) : { ...value, user_id: user.id };
  }
  const result = await request(table, {
    method: 'POST',
    body,
    headers: { Prefer: 'return=representation' }
  });
  return Array.isArray(value) ? result : result[0];
}

export async function update(table, id, value) {
  const result = await request(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: value,
    headers: { Prefer: 'return=representation' }
  });
  if (result.length !== 1) throw new Error('수정할 기록을 찾지 못했습니다. 새로고침 후 다시 시도하세요.');
  return result[0];
}

export async function rpc(name, argumentsObject) {
  return request(`rpc/${name}`, { method: 'POST', body: argumentsObject });
}

export const tables = ['plans', 'plan_revisions', 'tasks', 'work_logs', 'task_completions', 'reviews'];

const orderByTable = {
  plans: 'created_at.asc',
  plan_revisions: 'plan_id.asc,revision_no.asc',
  tasks: 'created_at.asc',
  work_logs: 'created_at.asc',
  task_completions: 'completed_at.asc',
  reviews: 'created_at.asc'
};

export async function allData() {
  const entries = await Promise.all(
    tables.map(async table => [table, await rows(table, orderByTable[table])])
  );
  return Object.fromEntries(entries);
}
