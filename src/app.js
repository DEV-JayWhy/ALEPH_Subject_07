import { configured, allData, insert, update, rpc } from './api.js';
import { seoulToday, seoulDateTime, seoulInputNow, seoulInputToIso, dateLabel } from './date.js';

const $ = id => document.getElementById(id);
const state = { data: null, planId: null, view: 'plan', taskEditId: null, planEditId: null,
  logTaskId: null, summary: null, evidence: null, busy: false, pendingKeys: {} };
const taskTitles = [
  '카드 1 — 계획 세우기', '카드 2 — 할 일 다루기', '카드 3 — 실제로 한 일 적기',
  '카드 4 — 돌아보기, 그리고 다음 계획으로', '카드 5 — 내 것으로 채우고, 잃지 않게'
];
const labels = { low: '낮음', medium: '보통', high: '높음' };
const metrics = [
  ['plan_count', '계획 수', '건', '삭제되지 않은 할 일 전체'],
  ['completed_count', '완료 수', '건', '현재 완료 상태인 할 일'],
  ['overdue_count', '지연 수', '건', '서울 오늘보다 마감일이 지난 미완료 할 일'],
  ['blocked_count', '막힘 수', '건', '막힌 이유가 한 번이라도 있는 서로 다른 할 일'],
  ['estimated_minutes', '예상 시간', '분', '대상 할 일 예상 분의 합'],
  ['actual_minutes', '실제 시간', '분', '대상 할 일 실행 기록의 실제 분 합'],
  ['difference_minutes', '차이', '분', '실제 분 − 예상 분']
];

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = String(text);
  return n;
}
function clear(n) { n.replaceChildren(); return n; }
function button(text, fn, cls = 'outline') {
  const b = node('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b;
}
function line(label, value) {
  const d = node('div', 'detail-line'); d.append(node('span', '', label), node('strong', '', value)); return d;
}
function hint(text) { return node('p', 'muted', text); }
function show(id, visible = true) { $(id).classList.toggle('hidden', !visible); }
function fail(error) { $('error-banner').textContent = error.message || String(error); show('error-banner'); toast('요청을 완료하지 못했습니다.'); }
function toast(message) {
  $('toast').textContent = message; show('toast');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => show('toast', false), 4000);
}
function plan() { return state.data?.plans.find(p => p.id === state.planId); }
function tasks() { return (state.data?.tasks || []).filter(t => t.plan_id === state.planId && !t.deleted_at); }
function logsFor(taskId) { return state.data.work_logs.filter(w => w.task_id === taskId); }
function completionFor(taskId) { return state.data.task_completions.find(c => c.task_id === taskId && !c.undone_at); }
function isOverdue(t) { return !completionFor(t.id) && t.due_on < seoulToday(); }
function setBusy(value) { state.busy = value; document.body.classList.toggle('busy', value); }

async function action(fn, message) {
  if (state.busy) return;
  setBusy(true); show('error-banner', false);
  try { await fn(); await load(); if (message) toast(message); }
  catch (error) { fail(error); }
  finally { setBusy(false); }
}

async function load() {
  const data = await allData();
  state.data = data;
  if (!data.plans.some(p => p.id === state.planId)) state.planId = data.plans[0]?.id || null;
  state.summary = state.planId ? (await rpc('review_summary', { p_plan_id: state.planId }))[0] : null;
  render();
  $('connection-state').textContent = '서버 DB 연결됨';
  $('connection-state').classList.add('online');
}

function changeView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('.step')) tab.classList.toggle('active', tab.dataset.view === view);
  for (const v of ['plan', 'do', 'see']) show(`${v}-view`, v === view);
  document.querySelector('.step-nav').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function render() {
  show('loading', false); show('workspace');
  renderPlan(); renderTasks(); renderSee();
}

function renderPlan() {
  const select = clear($('plan-select'));
  if (!state.data.plans.length) select.append(new Option('아직 계획이 없습니다', ''));
  for (const p of state.data.plans) select.append(new Option(`${p.title} · ${p.starts_on} ~ ${p.ends_on}`, p.id));
  select.value = state.planId || '';
  const details = clear($('plan-details'));
  const p = plan();
  show('edit-plan-btn', !!p); show('history-btn', !!p);
  if (!p) details.append(hint('새 계획 만들기를 눌러 실제 계획을 저장하세요.'));
  else {
    details.append(node('h3', 'plan-title', p.title),
      line('계획 ID', p.id), line('기간', `${p.starts_on} → ${p.ends_on}`),
      line('우선순위', labels[p.priority]), line('예상 투자시간', `${p.estimated_minutes}분`),
      line('현재 버전', `v${p.revision_no}`), node('p', 'criteria-label', '성공 기준'),
      node('p', 'criteria', p.success_criteria));
  }
  const incoming = state.data.reviews.filter(r => r.next_plan_id === state.planId);
  const banner = clear($('incoming-improvement'));
  for (const r of incoming) banner.append(node('b', '', '이전 돌아보기에서 넘어온 개선점'), node('p', '', r.improvement));
  show('incoming-improvement', incoming.length > 0);
  const stat = clear($('plan-quick-stats'));
  stat.append(line('할 일', `${tasks().length}건`), line('실행 기록', `${tasks().reduce((n, t) => n + logsFor(t.id).length, 0)}건`),
    line('완료', `${tasks().filter(t => completionFor(t.id)).length}건`));
  renderHistory();
}

function renderHistory() {
  const list = clear($('revision-list'));
  const versions = state.data.plan_revisions.filter(r => r.plan_id === state.planId).sort((a, b) => a.revision_no - b.revision_no);
  if (!versions.length) { list.append(hint('저장된 버전이 없습니다.')); return; }
  for (const r of versions) {
    const card = node('article', 'revision');
    card.append(node('strong', '', `v${r.revision_no} · ${r.title}`),
      node('small', '', `기록 ${seoulDateTime(r.recorded_at)} · ${r.starts_on} ~ ${r.ends_on} · ${labels[r.priority]} · ${r.estimated_minutes}분`),
      node('p', '', `성공 기준: ${r.success_criteria}`));
    list.append(card);
  }
}

function sortedTasks() {
  const q = $('task-search').value.trim().toLocaleLowerCase('ko');
  const status = $('status-filter').value, priority = $('priority-filter').value, sort = $('task-sort').value;
  const rank = { high: 0, medium: 1, low: 2 };
  const filtered = tasks().filter(t => {
    const done = !!completionFor(t.id);
    return (!q || `${t.title} ${t.details} ${t.tag}`.toLocaleLowerCase('ko').includes(q)) &&
      (priority === 'all' || t.priority === priority) &&
      (status === 'all' || (status === 'done' && done) || (status === 'open' && !done) || (status === 'overdue' && isOverdue(t)));
  });
  const collator = new Intl.Collator('ko');
  filtered.sort((a, b) => {
    const primary = sort === 'priority' ? rank[a.priority] - rank[b.priority] :
      sort === 'title' ? collator.compare(a.title, b.title) : a.due_on.localeCompare(b.due_on);
    return primary || a.id.localeCompare(b.id);
  });
  $('sort-description').textContent = ({ due: '정렬: 마감일 빠른 순 → 같은 값이면 ID 오름차순',
    priority: '정렬: 높음 → 보통 → 낮음 → 같은 값이면 ID 오름차순',
    title: '정렬: 제목 가나다 순 → 같은 값이면 ID 오름차순' })[sort] + ' · 검색/필터/정렬은 현재 DB 조회 결과에 적용';
  return filtered;
}

function renderTasks() {
  show('do-empty', !plan()); show('do-content', !!plan());
  const list = clear($('task-list'));
  if (!plan()) return;
  const visible = sortedTasks();
  if (!visible.length) { list.append(node('div', 'card empty-state', tasks().length ? '조건에 맞는 할 일이 없습니다.' : '할 일을 추가해 실제 계획을 채우세요.')); return; }
  for (const t of visible) {
    const done = completionFor(t.id), logs = logsFor(t.id), card = node('article', `task-card card${done ? ' completed' : ''}`);
    card.id = `task-${t.id}`;
    const head = node('div', 'task-head'), title = node('div');
    title.append(node('p', 'eyebrow', `${t.tag} · ${labels[t.priority]}`), node('h3', '', t.title));
    head.append(title, node('span', `pill ${done ? 'done' : isOverdue(t) ? 'late' : ''}`, done ? '완료' : isOverdue(t) ? '지연' : '진행 중'));
    card.append(head);
    if (t.details) card.append(node('p', 'task-details', t.details));
    const facts = node('div', 'task-facts');
    facts.append(node('span', '', `마감 ${dateLabel(t.due_on)}`), node('span', '', `예상 ${t.estimated_minutes}분`),
      node('span', '', `실제 ${logs.reduce((n, w) => n + w.actual_minutes, 0)}분`), node('span', '', `실행 ${logs.length}건`));
    card.append(facts);
    const controls = node('div', 'task-controls');
    controls.append(button(done ? '완료 취소' : '완료', () => changeCompletion(t), done ? 'outline' : 'primary'),
      button('실행 기록 +', () => openLogForm(t.id)), button('수정', () => openTaskForm(t)),
      button('삭제', () => deleteTask(t), 'danger-button'));
    card.append(controls);
    if (!done && sessionStorage.getItem(`pds-pending-${t.id}`)) card.append(hint('완료 요청의 결과가 불확실합니다. 완료를 다시 누르면 같은 요청 키로 재시도합니다.'));
    if (logs.length) {
      const section = node('details', 'log-details'), summary = node('summary', '', `실행 기록 ${logs.length}건 · 원본 보기`);
      section.append(summary);
      for (const w of logs) {
        const row = node('div', 'log-row'); row.id = `log-${w.id}`;
        row.append(node('strong', '', `${seoulDateTime(w.started_at)} → ${seoulDateTime(w.ended_at)} · ${w.actual_minutes}분`),
          node('small', '', `기록 ID ${w.id}`));
        if (w.blocker_reason.trim()) row.append(node('p', '', `막힌 이유: ${w.blocker_reason}`));
        if (w.note) row.append(node('p', '', w.note));
        section.append(row);
      }
      card.append(section);
    }
    list.append(card);
  }
}

function renderSee() {
  show('see-empty', !plan()); show('see-content', !!plan());
  if (!plan()) return;
  const grid = clear($('metric-grid'));
  for (const [key, title, unit] of metrics) {
    const b = node('button', `metric card${state.evidence === key ? ' selected' : ''}`);
    b.type = 'button'; b.append(node('span', 'metric-label', title), node('strong', '', `${state.summary?.[key] ?? 0}`),
      node('span', 'metric-unit', `${unit} · 근거 보기 ↗`));
    b.addEventListener('click', () => { state.evidence = key; renderEvidence(); renderMetricSelection(); }); grid.append(b);
  }
  renderEvidence(); renderReviews();
}
function renderMetricSelection() {
  [...$('metric-grid').children].forEach((b, i) => b.classList.toggle('selected', metrics[i][0] === state.evidence));
}

function evidenceTasks(key) {
  return tasks().filter(t => {
    if (key === 'completed_count') return !!completionFor(t.id);
    if (key === 'overdue_count') return isOverdue(t);
    if (key === 'blocked_count') return logsFor(t.id).some(w => w.blocker_reason.trim());
    if (key === 'actual_minutes') return logsFor(t.id).length > 0;
    return true;
  });
}
function renderEvidence() {
  const key = state.evidence, list = clear($('evidence-list'));
  if (!key) { $('evidence-title').textContent = '숫자를 선택해 주세요'; $('evidence-rule').textContent = '각 수치는 실제 할 일·완료·실행 기록으로 이어집니다.'; $('evidence-count').textContent = ''; return; }
  const [, title, unit, rule] = metrics.find(m => m[0] === key);
  $('evidence-title').textContent = `${title}의 근거`;
  $('evidence-rule').textContent = rule + (key === 'difference_minutes' ? ' · 예상과 실제 두 열을 함께 확인하세요.' : '');
  $('evidence-count').textContent = `${state.summary?.[key] ?? 0}${unit}`;
  const selected = evidenceTasks(key);
  if (!selected.length) { list.append(hint('해당 원본 기록이 없습니다.')); return; }
  for (const t of selected) {
    const row = node('div', 'evidence-row'), top = node('div', 'evidence-top');
    top.append(node('strong', '', t.title), button('할 일로 이동 ↗', () => jumpToTask(t.id), 'text-button'));
    row.append(top, node('small', '', `할 일 ID ${t.id} · 마감 ${t.due_on} · 예상 ${t.estimated_minutes}분`));
    const c = completionFor(t.id);
    if (key === 'completed_count' && c) row.append(node('p', '', `완료 ID ${c.id} · 완료 ${seoulDateTime(c.completed_at)}`));
    if (key === 'overdue_count') row.append(node('p', '', `미완료 · 서울 오늘 ${seoulToday()}보다 이전 마감`));
    if (['blocked_count', 'actual_minutes', 'difference_minutes'].includes(key)) {
      const selectedLogs = key === 'blocked_count' ? logsFor(t.id).filter(w => w.blocker_reason.trim()) : logsFor(t.id);
      if (!selectedLogs.length) row.append(hint('실행 기록 없음 · 실제 0분'));
      for (const w of selectedLogs) {
        const logLine = node('div', 'evidence-log');
        logLine.append(node('span', '', `실행 ID ${w.id} · ${w.actual_minutes}분 · ${seoulDateTime(w.started_at)} → ${seoulDateTime(w.ended_at)}`));
        if (w.blocker_reason.trim()) logLine.append(node('span', '', `막힌 이유: ${w.blocker_reason}`));
        row.append(logLine);
      }
    }
    if (key === 'difference_minutes') row.append(node('p', '', `이 할 일: 실제 ${logsFor(t.id).reduce((n, w) => n + w.actual_minutes, 0)}분 − 예상 ${t.estimated_minutes}분`));
    list.append(row);
  }
}

function renderReviews() {
  const list = clear($('reviews-list'));
  const related = state.data.reviews.filter(r => r.plan_id === state.planId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!related.length) { list.append(hint('아직 저장한 돌아보기가 없습니다.')); return; }
  for (const r of related) {
    const row = node('div', 'review-row');
    row.append(node('small', '', `${r.period_start} ~ ${r.period_end} · ${seoulDateTime(r.created_at)}`),
      node('strong', '', r.improvement), node('small', '', `돌아보기 ID ${r.id}`));
    if (r.next_plan_id) {
      const next = state.data.plans.find(p => p.id === r.next_plan_id);
      row.append(button(`연결된 다음 계획: ${next?.title || r.next_plan_id} ↗`, () => selectPlan(r.next_plan_id, 'plan'), 'text-button'));
    } else {
      const label = node('label', '', '다음 계획 연결'), select = node('select');
      select.append(new Option('다음 계획을 선택', ''));
      const used = new Set(state.data.reviews.map(v => v.next_plan_id).filter(Boolean));
      for (const p of state.data.plans.filter(p => p.id !== state.planId && !used.has(p.id))) select.append(new Option(p.title, p.id));
      label.append(select);
      row.append(label, button('개선점 넘기기', () => {
        if (!select.value) { toast('먼저 다음 계획을 만들고 선택하세요.'); return; }
        action(() => update('reviews', r.id, { next_plan_id: select.value }), '다음 계획에 개선점을 연결했습니다.');
      }, 'outline'));
    }
    list.append(row);
  }
}

function jumpToTask(id) {
  $('task-search').value = ''; $('status-filter').value = 'all'; $('priority-filter').value = 'all';
  renderTasks(); changeView('do');
  requestAnimationFrame(() => { const card = $(`task-${id}`); card?.scrollIntoView({ behavior: 'smooth', block: 'center' }); card?.classList.add('flash'); setTimeout(() => card?.classList.remove('flash'), 2400); });
}
async function selectPlan(id, view = state.view) {
  state.planId = id; state.evidence = null;
  try { state.summary = id ? (await rpc('review_summary', { p_plan_id: id }))[0] : null; render(); changeView(view); }
  catch (error) { fail(error); }
}

function openPlanForm(edit = false) {
  state.planEditId = edit ? state.planId : null;
  $('plan-form').reset(); $('plan-form-title').textContent = edit ? '계획 수정 · 이전 버전은 보존됩니다' : '새 계획 만들기';
  if (edit) for (const key of ['title', 'starts_on', 'ends_on', 'priority', 'success_criteria', 'estimated_minutes']) $('plan-form').elements[key].value = plan()[key];
  show('plan-form-panel'); show('history-panel', false); $('plan-form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function openTaskForm(task = null) {
  if (!plan()) return toast('먼저 계획을 저장하세요.');
  state.taskEditId = task?.id || null; $('task-form').reset(); $('task-form-title').textContent = task ? '할 일 수정' : '할 일 추가';
  if (task) for (const key of ['title', 'details', 'due_on', 'priority', 'tag', 'estimated_minutes']) $('task-form').elements[key].value = task[key];
  show('task-form-panel'); show('batch-panel', false); $('task-form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function openLogForm(taskId) {
  state.logTaskId = taskId; $('log-form').reset();
  $('log-task-label').textContent = tasks().find(t => t.id === taskId)?.title || '';
  $('log-form').elements.started_at.value = seoulInputNow();
  show('log-form-panel'); $('log-form-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openBatch() {
  if (!plan()) return toast('먼저 계획을 저장하세요.');
  const rows = clear($('batch-rows')); let remaining = 0;
  for (const [index, title] of taskTitles.entries()) {
    if (tasks().some(t => t.title === title)) continue;
    remaining++;
    const item = node('fieldset', 'batch-row'), legend = node('legend', '', `${index + 1}. ${title}`);
    const grid = node('div', 'grid-four');
    for (const [label, key, type] of [['마감일', 'due_on', 'date'], ['태그', 'tag', 'text'], ['예상 · 분', 'estimated_minutes', 'number']]) {
      const wrapper = node('label', '', label), input = node('input'); input.name = `${key}-${index}`; input.type = type; input.required = true;
      if (type === 'number') { input.min = '0'; input.step = '1'; }
      wrapper.append(input); grid.append(wrapper);
    }
    const priority = node('label', '', '우선순위'), select = node('select'); select.name = `priority-${index}`;
    for (const [value, label] of [['low', '낮음'], ['medium', '보통'], ['high', '높음']]) select.append(new Option(label, value));
    priority.append(select); grid.append(priority); item.append(legend, grid); item.dataset.index = String(index); rows.append(item);
  }
  if (!remaining) { toast('정해둔 다섯 제목의 할 일이 이미 있습니다.'); return; }
  show('batch-panel'); show('task-form-panel', false); $('batch-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function changeCompletion(task) {
  if (completionFor(task.id)) {
    await action(async () => { await rpc('undo_task_completion', { p_task_id: task.id }); sessionStorage.removeItem(`pds-pending-${task.id}`); }, '완료를 취소했습니다.');
    return;
  }
  const storageKey = `pds-pending-${task.id}`;
  const requestKey = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, requestKey);
  await action(async () => { await rpc('complete_task', { p_task_id: task.id, p_request_key: requestKey }); sessionStorage.removeItem(storageKey); }, '완료했습니다. 같은 요청은 중복으로 쌓이지 않습니다.');
}
function deleteTask(task) {
  if (!confirm(`“${task.title}”을 목록에서 지울까요? 실행·완료 이력은 보존됩니다.`)) return;
  action(() => update('tasks', task.id, { deleted_at: new Date().toISOString() }), '할 일을 지웠습니다.');
}

async function exportData() {
  await action(async () => {
    const records = await allData();
    const payload = { format: 'pds-export-v1', exported_at: new Date().toISOString(),
      time_zone: 'Asia/Seoul', duration_unit: 'minutes', includes_soft_deleted: true, tables: records };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `pds-all-data-${seoulToday()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, '여섯 표의 전체 자료를 파일 하나로 내보냈습니다.');
}

function bind() {
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.jump)));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => show(b.dataset.close, false)));
  $('plan-select').addEventListener('change', e => selectPlan(e.target.value));
  $('new-plan-btn').addEventListener('click', () => openPlanForm());
  $('edit-plan-btn').addEventListener('click', () => openPlanForm(true));
  $('history-btn').addEventListener('click', () => { renderHistory(); show('history-panel'); $('history-panel').scrollIntoView({ behavior: 'smooth' }); });
  $('prefill-plan-btn').addEventListener('click', () => {
    const f = $('plan-form').elements;
    f.title.value = 'ALEPH 과제 6 완성하기'; f.starts_on.value = '2026-09-16'; f.ends_on.value = '2026-09-30';
    f.priority.value = 'low'; f.success_criteria.value = '카드 1~5의 통과 기준을 확인하고 최종 결과물을 배포한다.';
    f.estimated_minutes.value = '240';
  });
  $('plan-form').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    if (f.starts_on.value > f.ends_on.value) return toast('계획 종료일은 시작일 이후여야 합니다.');
    const value = Object.fromEntries(['title', 'starts_on', 'ends_on', 'priority', 'success_criteria'].map(k => [k, f[k].value.trim()]));
    value.estimated_minutes = Number(f.estimated_minutes.value);
    action(async () => { const saved = state.planEditId ? await update('plans', state.planEditId, value) : await insert('plans', value);
      state.planId = saved.id; show('plan-form-panel', false); }, state.planEditId ? '계획을 수정하고 이전 버전을 남겼습니다.' : '새 계획을 저장했습니다.');
  });
  $('new-task-btn').addEventListener('click', () => openTaskForm());
  $('five-tasks-btn').addEventListener('click', openBatch);
  $('task-form').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    const value = Object.fromEntries(['title', 'details', 'due_on', 'priority', 'tag'].map(k => [k, f[k].value.trim()]));
    value.estimated_minutes = Number(f.estimated_minutes.value);
    action(async () => { if (state.taskEditId) await update('tasks', state.taskEditId, value);
      else await insert('tasks', { ...value, plan_id: state.planId }); show('task-form-panel', false); }, '할 일을 저장했습니다.');
  });
  $('batch-form').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    const items = [...$('batch-rows').children].map(row => {
      const index = Number(row.dataset.index);
      return { plan_id: state.planId, title: taskTitles[index], details: '', due_on: f[`due_on-${index}`].value,
        tag: f[`tag-${index}`].value.trim(), priority: f[`priority-${index}`].value,
        estimated_minutes: Number(f[`estimated_minutes-${index}`].value) };
    });
    action(async () => { await insert('tasks', items); show('batch-panel', false); }, '입력한 실제 할 일을 저장했습니다.');
  });
  $('log-form').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    let start, end;
    try { start = seoulInputToIso(f.started_at.value); end = seoulInputToIso(f.ended_at.value); }
    catch (error) { return toast(error.message); }
    if (start >= end) return toast('종료 시각은 시작 시각보다 늦어야 합니다.');
    action(async () => { await insert('work_logs', { task_id: state.logTaskId, started_at: start, ended_at: end,
      actual_minutes: Number(f.actual_minutes.value), blocker_reason: f.blocker_reason.value.trim(), note: f.note.value.trim() });
      show('log-form-panel', false); }, '실행 기록을 저장했습니다. 계획 예상 값은 그대로입니다.');
  });
  $('review-form').addEventListener('submit', e => {
    e.preventDefault(); const f = e.currentTarget.elements;
    if (f.period_start.value > f.period_end.value) return toast('돌아보기 종료일을 확인하세요.');
    action(async () => { await insert('reviews', { plan_id: state.planId, period_start: f.period_start.value,
      period_end: f.period_end.value, improvement: f.improvement.value.trim() });
      f.improvement.value = ''; }, '개선점 한 줄을 저장했습니다. 다음 계획을 연결할 수 있습니다.');
  });
  for (const id of ['task-search', 'status-filter', 'priority-filter', 'task-sort']) {
    $(id).addEventListener(id === 'task-search' ? 'input' : 'change', renderTasks);
  }
  $('review-form').elements.period_start.value = seoulToday();
  $('review-form').elements.period_end.value = seoulToday();
  $('refresh-btn').addEventListener('click', () => action(async () => {}, '서버 자료를 다시 읽었습니다.'));
  $('see-refresh-btn').addEventListener('click', () => action(async () => {}, '집계를 다시 읽었습니다.'));
  $('export-btn').addEventListener('click', exportData);
}

bind();
if (!configured) {
  show('loading', false); show('setup'); $('connection-state').textContent = '공개 설정 필요';
} else {
  try { await load(); }
  catch (error) { show('loading', false); $('connection-state').textContent = '연결 오류'; fail(error); }
}
