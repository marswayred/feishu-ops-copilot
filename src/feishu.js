const SDK_URL = 'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.48.js';
let sdkPromise;

export function isFeishuClient() {
  return /Lark|Feishu/i.test(navigator.userAgent);
}

export async function api(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
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
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('查询超时，请缩小查询范围后重试。');
    if (error instanceof TypeError) throw new Error('无法连接服务，请检查网络后重试。');
    throw error;
  } finally { clearTimeout(timer); }
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
  }).catch(error => { sdkPromise = undefined; throw error; });
  return sdkPromise;
}

export async function loginFeishu(appId) {
  if (!isFeishuClient()) throw new Error('请从飞书工作台打开此应用。普通浏览器无法使用飞书免登和原生选择器。');
  const tt = await loadFeishuSDK();
  if (!tt.requestAccess) throw new Error('请将飞书升级至 6.9 或以上版本后重试。');
  const state = crypto.randomUUID();
  const code = await new Promise((resolve, reject) => {
    tt.requestAccess({
      appID: appId,
      scopeList: [],
      state,
      success: result => {
        if (result.state !== state || !result.code) return reject(new Error('授权状态不一致，请重新登录。'));
        resolve(result.code);
      },
      fail: () => reject(new Error('未完成飞书授权，请重试并同意应用获取登录信息。')),
    });
  });
  await api('/api/auth/feishu', { code });
  return api('/api/bootstrap');
}

export async function chooseFeishuContacts(selectedUsers) {
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
    // 官方约定：config + error + ready；onSuccess/onFail 为鉴权结果，ready 表示可调 JSAPI
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
