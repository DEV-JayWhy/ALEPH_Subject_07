const cfg = window.PDS_CONFIG || {};
const url = String(cfg.supabaseUrl || '').trim().replace(/\/$/, '');
const key = String(cfg.supabasePublishableKey || '').trim();

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

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (!configured) throw new Error('config.js에 올바른 프로젝트 URL과 공개용 키를 넣어주세요.');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      'Content-Type': 'application/json',
      ...headers
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
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
  const result = await request(table, { method: 'POST', body: value, headers: { Prefer: 'return=representation' } });
  return result[0];
}

export async function update(table, id, value) {
  const result = await request(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', body: value, headers: { Prefer: 'return=representation' }
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
  const entries = await Promise.all(tables.map(async table => [table, await rows(table, orderByTable[table])]));
  return Object.fromEntries(entries);
}
