import { configured, getSession, signIn, signUp, signOut, currentUser } from './api.js';

const style = document.createElement('style');
style.textContent = `
  .auth-gate{position:fixed;inset:0;z-index:9999;background:#f7f4ed;display:grid;place-items:center;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .auth-card{width:min(430px,100%);background:#fff;border:1px solid #d9d4c8;border-radius:18px;padding:28px;box-shadow:0 18px 60px rgba(40,35,25,.12)}
  .auth-card h1{margin:0 0 6px;font-size:25px}.auth-card .sub{margin:0 0 22px;color:#666}
  .auth-tabs{display:flex;gap:8px;margin-bottom:18px}.auth-tabs button{flex:1;padding:10px;border-radius:10px;border:1px solid #bbb;background:#fff;cursor:pointer}
  .auth-tabs button.active{background:#222;color:#fff;border-color:#222}
  .auth-card label{display:block;margin:12px 0 5px;font-size:13px;font-weight:700}
  .auth-card input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:10px;font-size:15px}
  .auth-submit{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:#222;color:#fff;font-weight:700;cursor:pointer}
  .auth-msg{min-height:22px;margin:12px 0 0;font-size:13px;color:#a22}
  .auth-note{font-size:12px;color:#777;line-height:1.5;margin-top:14px}
  .auth-userbox{display:flex;align-items:center;gap:8px;margin-left:8px;font-size:12px}
  .auth-logout{padding:7px 10px;border:1px solid #bbb;border-radius:8px;background:#fff;cursor:pointer}
`;
document.head.append(style);

function gate() {
  document.querySelector('.auth-gate')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'auth-gate';
  wrap.innerHTML = `
    <section class="auth-card">
      <h1>플랜두씨 다이어리 2</h1>
      <p class="sub">ALEPH 과제 7 · 내 계획과 실제를 안전하게 기록합니다.</p>
      <div class="auth-tabs">
        <button type="button" data-mode="login" class="active">로그인</button>
        <button type="button" data-mode="signup">회원가입</button>
      </div>
      <form id="auth-form">
        <label for="auth-email">이메일</label>
        <input id="auth-email" type="email" autocomplete="email" required />
        <label for="auth-password">비밀번호</label>
        <input id="auth-password" type="password" autocomplete="current-password" minlength="6" required />
        <button class="auth-submit" type="submit">로그인</button>
        <p id="auth-msg" class="auth-msg"></p>
      </form>
      <p class="auth-note">로그인하지 않은 상태에서는 다이어리 기록을 불러오지 않습니다. 비밀번호·세션 토큰은 화면에 표시하지 않습니다.</p>
    </section>`;
  document.body.append(wrap);

  let mode = 'login';
  const buttons = [...wrap.querySelectorAll('[data-mode]')];
  const submit = wrap.querySelector('.auth-submit');
  const password = wrap.querySelector('#auth-password');

  buttons.forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    buttons.forEach(x => x.classList.toggle('active', x === btn));
    submit.textContent = mode === 'login' ? '로그인' : '회원가입';
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    wrap.querySelector('#auth-msg').textContent = '';
  }));

  wrap.querySelector('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = wrap.querySelector('#auth-msg');
    const email = wrap.querySelector('#auth-email').value.trim();
    const pw = password.value;
    submit.disabled = true;
    msg.textContent = mode === 'login' ? '로그인 중…' : '가입 중…';
    try {
      if (mode === 'login') await signIn(email, pw);
      else await signUp(email, pw);
      location.reload();
    } catch (err) {
      msg.textContent = err?.message || '인증에 실패했습니다.';
      submit.disabled = false;
    }
  });
}

function installLoggedInHeader() {
  const user = currentUser();
  const actions = document.querySelector('.header-actions');
  if (!actions || !user) return;
  const box = document.createElement('div');
  box.className = 'auth-userbox';
  const email = document.createElement('span');
  email.textContent = user.email || '로그인됨';
  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'auth-logout';
  logout.textContent = '로그아웃';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try { await signOut(); } finally { location.reload(); }
  });
  box.append(email, logout);
  actions.append(box);
}

async function start() {
  document.title = '플랜두씨 다이어리 2 · ALEPH 과제 7';

  if (!configured) {
    gate();
    document.querySelector('#auth-msg').textContent = 'Supabase 공개 설정을 확인해 주세요.';
    return;
  }

  if (!getSession()) {
    gate();
    return;
  }

  document.querySelector('.brand-name small')?.replaceChildren(document.createTextNode('다이어리 2'));
  const eyebrow = document.querySelector('.hero-copy .eyebrow');
  if (eyebrow) eyebrow.textContent = 'PLAN / DO / SEE · ALEPH 07';
  const intro = document.querySelector('.hero-copy .intro');
  if (intro) intro.textContent = '로그인한 사용자 본인의 계획과 실행 기록을 저장하는 비공개 다이어리.';
  const notice = document.querySelector('.public-notice p');
  if (notice) notice.textContent = '로그인 사용자 본인의 기록만 조회·수정할 수 있습니다.';
  const footer = document.querySelector('footer span');
  if (footer) footer.textContent = '플랜두씨 다이어리 2 · 내 기록';
  installLoggedInHeader();

  try {
    await import('./app.js');
  } catch (err) {
    console.error(err);
    if (/로그인|세션|401/i.test(String(err?.message || err))) {
      gate();
      document.querySelector('#auth-msg').textContent = '세션이 만료되었습니다. 다시 로그인해 주세요.';
    }
  }
}

start();
