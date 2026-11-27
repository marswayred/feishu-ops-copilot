const SDK_URL = 'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.48.js';
let sdkPromise;

export function isFeishuClient() {
  return /Lark|Feishu/i.test(navigator.userAgent);
}

export async function api(path, body, { method } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const resolvedMethod = method || (body === undefined ? 'GET' : 'POST');
  try {
    const response = await fetch(path, {
      method: resolvedMethod,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('服务暂时不可用，请检查后端服务后重试。'); }
    if (!response.ok) {
      const error = new Error(data.error?.message || '请求失败，请稍后重试。');
      error.status = response.status;
      error.code = data.error?.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请缩小查询范围或稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接服务，请检查网络后重试。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const OAUTH_STARTED_KEY = 'ops-copilot-oauth-started-at';

export function clearOAuthFallback() {
  window.sessionStorage?.removeItem(OAUTH_STARTED_KEY);
}

export function oauthStartedRecently(windowMs = 20000) {
  const startedAt = Number(window.sessionStorage?.getItem(OAUTH_STARTED_KEY));
  return Number.isFinite(startedAt) && Date.now() - startedAt < windowMs;
}

export function startWebOAuthLogin(returnTo = window.location.pathname) {
  const safePath = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/';
  window.sessionStorage?.setItem(OAUTH_STARTED_KEY, String(Date.now()));
  window.location.assign(`/api/auth/oauth/start?returnTo=${encodeURIComponent(safePath)}`);
}

export function loadFeishuSDK() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('飞书 SDK 未就绪，请在飞书客户端中打开并检查网络。')), 15_000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(window.tt);
    }
    function ready() {
      if (!window.h5sdk) return finish(new Error('飞书 SDK 加载失败，请重新打开应用。'));
      window.h5sdk.ready(() => finish());
    }
    if (window.h5sdk && window.tt) return ready();
    const previous = document.querySelector('script[data-feishu-sdk]');
    previous?.remove();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.dataset.feishuSdk = 'true';
    script.onload = ready;
    script.onerror = () => finish(new Error('飞书 SDK 下载失败，请检查是否能访问飞书 CDN。'));
    document.head.appendChild(script);
  }).catch(error => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
}

export async function loginFeishu(_appId, returnTo = window.location.pathname, { force = false } = {}) {
  // 端内 requestAccess 会把当前页面当成 redirect_uri，和回调地址不一致时飞书返回 20029。
  // 统一走回调地址，只要求安全设置里有这一条。
  if (!force && oauthStartedRecently()) {
    throw new Error('飞书授权未完成。请确认重定向 URL 正好是 https://ops-copilot.aflowx.com/api/auth/oauth/callback（不要多斜杠、空格或换行），然后点击「登录飞书」。');
  }
  startWebOAuthLogin(returnTo);
  return null;
}

export async function chooseFeishuContacts(selectedUsers) {
  if (!isFeishuClient()) {
    throw new Error('飞书原生成员选择器仅支持在飞书客户端内调用；在普通浏览器中请改用「按工号指定」或「全员通讯录」。');
  }
  const tt = await loadFeishuSDK();
  const url = window.location.href.split('#')[0];
  const config = await api(`/api/feishu/js-config?url=${encodeURIComponent(url)}`);
  await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('选择器鉴权超时，请检查飞书安全域名与 JSAPI 鉴权配置。')), 15_000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    }
    const failMessage = err => {
      const detail = typeof err === 'string' ? err : (err?.errMsg || err?.errString || err?.message || '');
      return new Error(detail ? `选择器鉴权失败：${detail}` : '选择器鉴权失败，请检查应用安全域名和 JS SDK 配置。');
    };
    window.h5sdk.error(err => finish(failMessage(err)));
    window.h5sdk.config({
      appId: config.appId,
      timestamp: config.timestamp,
      nonceStr: config.nonceStr,
      signature: config.signature,
      jsApiList: ['chooseContact'],
      onSuccess: () => {},
      onFail: err => finish(failMessage(err)),
      success: () => {},
      fail: err => finish(failMessage(err)),
    });
    window.h5sdk.ready(() => finish());
  });
  return new Promise((resolve, reject) => {
    tt.chooseContact({
      multi: true,
      externalContact: false,
      enableChooseDepartment: true,
      chosenIds: selectedUsers.map(user => user.id),
      success: result => {
        const users = (result.data || []).map(user => ({ id: user.openId, name: user.name || '已选成员' }));
        const departments = (result.department_data || []).map(department => ({
          id: department.openDepartmentId,
          name: department.name || `已选部门 · ${String(department.openDepartmentId || '').slice(-6)}`,
        }));
        if ([...users, ...departments].some(item => !item.id)) return reject(new Error('飞书未返回可查询的成员或部门 ID，请升级客户端后重试。'));
        resolve({ users, departments });
      },
      fail: error => {
        if (/cancel/i.test(`${error?.errMsg || ''} ${error?.errString || ''}`)) resolve(null);
        else reject(new Error('无法打开飞书选择器，请在支持选人和选部门的飞书客户端中重试。'));
      },
    });
  });
}

export async function copyTextWithFallback(text, inputRef) {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, message: '' };
  } catch {
    if (inputRef?.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
    return {
      ok: false,
      message: '浏览器未允许自动复制，已选中文本，请按 Ctrl+C（Mac 使用 Cmd+C）手动复制。',
    };
  }
}
