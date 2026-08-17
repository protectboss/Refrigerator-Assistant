/**
 * 库存与购物清单的本地存储层(localStorage)。
 * 后续接入云端同步时,只需替换本文件的读写实现。
 */
const KEY_ITEMS = 'fridge_items';
const KEY_HISTORY = 'fridge_history';
const KEY_SHOPPING = 'shopping_list';

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
    id: `${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: data.name,
    category: data.category,
    location: data.location,
    advice: data.advice,
    addDate: todayStr(),
    expireDate: data.expireDate,
  };
  items.push(item);
  write(KEY_ITEMS, items);
  return item;
}

export function updateItem(id, patch) {
  const items = getItems();
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return;
  items[idx] = Object.assign({}, items[idx], patch);
  write(KEY_ITEMS, items);
}

/** 直接删除(误录入的场景),不记入消耗历史 */
export function deleteItem(id) {
  write(KEY_ITEMS, getItems().filter((it) => it.id !== id));
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
  history.push(Object.assign({}, item, { result, finishDate: todayStr() }));
  write(KEY_HISTORY, history);
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
  }
}

export function removeShopping(name) {
  write(KEY_SHOPPING, getShopping().filter((n) => n !== name));
}

export function clearShopping() {
  write(KEY_SHOPPING, []);
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
