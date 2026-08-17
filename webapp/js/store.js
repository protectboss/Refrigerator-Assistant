/**
 * 库存与购物清单的存储层:localStorage 保证本地即时读写,
 * 配置了"家庭共享码"后,每个操作会同步上报到云端(Durable Object),
 * 多台设备共用同一份数据;操作失败会进离线队列,下次联网补发。
 */
const KEY_ITEMS = 'fridge_items';
const KEY_HISTORY = 'fridge_history';
const KEY_SHOPPING = 'shopping_list';
const KEY_CODE = 'family_code';
const KEY_QUEUE = 'sync_queue';

/** 临期阈值:剩余 N 天以内视为临期 */
export const EXPIRING_DAYS = 2;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- 日期工具(只按自然日计算,避免时区/时刻误差) ----------

export function todayStr() {
  return formatDate(new Date());
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDate(new Date(y, m - 1, d + days));
}

/** expireDate 距今天的天数:0 = 今天到期,负数 = 已过期 */
export function remainingDays(expireDate) {
  const [y1, m1, d1] = todayStr().split('-').map(Number);
  const [y2, m2, d2] = expireDate.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((b - a) / 86400000);
}

// ---------- 库存 ----------

export function getItems() {
  return read(KEY_ITEMS, []);
}

export function getItem(id) {
  return getItems().find((it) => it.id === id) || null;
}

export function addItem(data) {
  const items = getItems();
  const item = {
    id: `${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    name: data.name,
    category: data.category,
    location: data.location,
    advice: data.advice,
    addDate: todayStr(),
    expireDate: data.expireDate,
  };
  items.push(item);
  write(KEY_ITEMS, items);
  postOp({ type: 'add', item });
  return item;
}

export function updateItem(id, patch) {
  const items = getItems();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return;
  items[idx] = Object.assign({}, items[idx], patch);
  write(KEY_ITEMS, items);
  postOp({ type: 'update', id, patch });
}

/** 直接删除(误录入的场景),不记入消耗历史 */
export function deleteItem(id) {
  write(KEY_ITEMS, getItems().filter((it) => it.id !== id));
  postOp({ type: 'delete', id });
}

/**
 * 结束一个菜品的生命周期并记入历史。
 * result: 'eaten'(吃完了) | 'wasted'(扔掉了)
 * 历史数据留给后续做浪费统计。
 */
export function finishItem(id, result) {
  const items = getItems();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return;
  const [item] = items.splice(idx, 1);
  write(KEY_ITEMS, items);
  const history = read(KEY_HISTORY, []);
  const finishDate = todayStr();
  history.push(Object.assign({}, item, { result, finishDate }));
  write(KEY_HISTORY, history);
  postOp({ type: 'finish', id, result, finishDate });
}

/** 给库存项附加展示字段:剩余天数、状态文案与样式级别 */
export function decorate(item) {
  const remaining = remainingDays(item.expireDate);
  let level;
  let statusText;
  if (remaining < 0) {
    level = 'expired';
    statusText = `已过期 ${-remaining} 天`;
  } else if (remaining === 0) {
    level = 'expired';
    statusText = '今天到期';
  } else if (remaining <= EXPIRING_DAYS) {
    level = 'expiring';
    statusText = `还剩 ${remaining} 天`;
  } else {
    level = 'fresh';
    statusText = `还剩 ${remaining} 天`;
  }
  return Object.assign({}, item, { remaining, level, statusText });
}

/** 全部库存,按剩余天数从少到多排序(最急的在最上面) */
export function getDecoratedItems() {
  return getItems()
    .map(decorate)
    .sort((a, b) => a.remaining - b.remaining);
}

// ---------- 购物清单 ----------

export function getShopping() {
  return read(KEY_SHOPPING, []);
}

export function addShopping(name) {
  const list = getShopping();
  if (!list.includes(name)) {
    list.push(name);
    write(KEY_SHOPPING, list);
    postOp({ type: 'shop_add', name });
  }
}

export function removeShopping(name) {
  write(KEY_SHOPPING, getShopping().filter((n) => n !== name));
  postOp({ type: 'shop_remove', name });
}

export function clearShopping() {
  write(KEY_SHOPPING, []);
  postOp({ type: 'shop_clear' });
}

// ---------- 家庭共享同步 ----------

export function getFamilyCode() {
  return localStorage.getItem(KEY_CODE) || '';
}

export function setFamilyCode(code) {
  localStorage.setItem(KEY_CODE, code.trim());
}

/** 上报一个操作到云端;失败时进离线队列,下次 pullRemote 前补发 */
function postOp(op) {
  const code = getFamilyCode();
  if (!code) return;
  fetch('/api/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, op }),
  }).catch(() => {
    const queue = read(KEY_QUEUE, []);
    queue.push(op);
    write(KEY_QUEUE, queue);
  });
}

/** 补发离线期间积压的操作 */
async function flushQueue(code) {
  const queue = read(KEY_QUEUE, []);
  if (queue.length === 0) return;
  const remaining = [...queue];
  for (const op of queue) {
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, op }),
      });
      if (!res.ok) break;
      remaining.shift();
    } catch (e) {
      break;
    }
  }
  write(KEY_QUEUE, remaining);
}

/** 拉取云端全量数据并覆盖本地。返回是否成功 */
export async function pullRemote() {
  const code = getFamilyCode();
  if (!code) return false;
  try {
    await flushQueue(code);
    const res = await fetch(`/api/sync?code=${encodeURIComponent(code)}`);
    if (!res.ok) return false;
    const state = await res.json();
    write(KEY_ITEMS, state.items || []);
    write(KEY_HISTORY, state.history || []);
    write(KEY_SHOPPING, state.shopping || []);
    return true;
  } catch (e) {
    return false;
  }
}

/** 首次开通共享:把本机现有数据与云端做并集合并,然后拉取合并结果 */
export async function bootstrapShare() {
  const code = getFamilyCode();
  if (!code) return false;
  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        op: {
          type: 'bootstrap',
          state: {
            items: getItems(),
            history: read(KEY_HISTORY, []),
            shopping: getShopping(),
          },
        },
      }),
    });
    if (!res.ok) return false;
    return pullRemote();
  } catch (e) {
    return false;
  }
}

// ---------- 通知辅助 ----------

const KEY_LAST_NOTIFY = 'last_notify_date';

/** 今天是否已经弹过系统通知(每天最多提醒一次) */
export function notifiedToday() {
  return localStorage.getItem(KEY_LAST_NOTIFY) === todayStr();
}

export function markNotified() {
  localStorage.setItem(KEY_LAST_NOTIFY, todayStr());
}
