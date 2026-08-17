import { KNOWLEDGE, FALLBACK, lookup, suggest } from './shelfLife.js';
import * as store from './store.js';
import { recommend } from './recipes.js';

const $ = (sel) => document.querySelector(sel);

const LOCATIONS = ['冷藏', '冷冻', '常温'];
const LEVEL_TAG = { expired: 'tag-red', expiring: 'tag-orange', fresh: 'tag-green' };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}

// ---------- 视图切换 ----------

function switchView(view) {
  $('#view-inventory').classList.toggle('hidden', view !== 'inventory');
  $('#view-recipes').classList.toggle('hidden', view !== 'recipes');
  $('#fab').classList.toggle('hidden', view !== 'inventory');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  if (view === 'inventory') renderInventory();
  else renderRecipes();
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchView(t.dataset.view));
});

// ---------- 冰箱库存 ----------

function renderInventory() {
  const items = store.getDecoratedItems();
  const expired = items.filter((it) => it.level === 'expired').length;
  const expiring = items.filter((it) => it.level === 'expiring').length;

  const banner = $('#banner');
  if (expired > 0) {
    banner.innerHTML = `<div class="banner banner-red">有 ${expired} 样菜品已过期,建议尽快检查处理,避免污染冰箱</div>`;
  } else if (expiring > 0) {
    banner.innerHTML = `<div class="banner banner-orange">有 ${expiring} 样菜品即将到期,今明两天优先吃掉它们</div>`;
  } else {
    banner.innerHTML = '';
  }

  renderNotifyTip(items.length > 0);

  $('#summary').innerHTML = items.length === 0 ? '' : `
    <div class="summary card">
      <div class="summary-item"><span class="summary-num">${items.length}</span><span class="summary-label">库存</span></div>
      <div class="summary-item"><span class="summary-num ${expiring > 0 ? 'orange' : ''}">${expiring}</span><span class="summary-label">临期</span></div>
      <div class="summary-item"><span class="summary-num ${expired > 0 ? 'red' : ''}">${expired}</span><span class="summary-label">过期</span></div>
    </div>`;

  const list = $('#inventory-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">冰箱还是空的<br />点右下角按钮,把买回来的菜记进来吧</div>';
    return;
  }
  list.innerHTML = `<div class="list">${items.map((it) => `
    <div class="item card" data-id="${it.id}">
      <div class="item-main">
        <div class="item-title-row">
          <span class="item-name">${escapeHtml(it.name)}</span>
          <span class="tag tag-gray">${escapeHtml(it.category)}</span>
          <span class="tag tag-gray">${escapeHtml(it.location)}</span>
        </div>
        ${it.advice ? `<span class="item-advice">${escapeHtml(it.advice)}</span>` : ''}
        <span class="item-date">${it.addDate} 放入 · ${it.expireDate} 到期</span>
      </div>
      <div class="item-status"><span class="tag ${LEVEL_TAG[it.level]}">${it.statusText}</span></div>
    </div>`).join('')}</div>`;
}

$('#inventory-list').addEventListener('click', (e) => {
  const itemEl = e.target.closest('.item');
  if (itemEl) openSheet(itemEl.dataset.id);
});

// ---------- 菜品操作菜单 ----------

let sheetItemId = null;

function openSheet(id) {
  const item = store.getItem(id);
  if (!item) return;
  sheetItemId = id;
  $('#sheet-title').textContent = item.name;
  $('#sheet-mask').classList.remove('hidden');
}

$('#sheet-mask').addEventListener('click', (e) => {
  const action = e.target.dataset && e.target.dataset.action;
  if (e.target === $('#sheet-mask') || action === 'cancel') {
    $('#sheet-mask').classList.add('hidden');
    return;
  }
  if (!action || !sheetItemId) return;
  $('#sheet-mask').classList.add('hidden');
  if (action === 'eaten') {
    store.finishItem(sheetItemId, 'eaten');
    toast('已吃完,真棒');
    renderInventory();
  } else if (action === 'wasted') {
    store.finishItem(sheetItemId, 'wasted');
    toast('已记录扔掉');
    renderInventory();
  } else if (action === 'edit') {
    openForm(sheetItemId);
  }
});

// ---------- 录入 / 编辑 ----------

let editId = null;
let kbApplied = false;

function openForm(id) {
  editId = id || null;
  kbApplied = false;
  const today = store.todayStr();
  $('#f-date').min = editId ? '' : today;
  $('#kb-hint').classList.add('hidden');
  $('#suggestions').classList.add('hidden');

  if (editId) {
    const item = store.getItem(editId);
    $('#form-title').textContent = '编辑菜品';
    $('#form-save').textContent = '保存修改';
    $('#f-name').value = item.name;
    $('#f-location').value = LOCATIONS.includes(item.location) ? item.location : '冷藏';
    $('#f-date').value = item.expireDate;
    $('#f-advice').value = item.advice || '';
  } else {
    $('#form-title').textContent = '记一样菜';
    $('#form-save').textContent = '放入冰箱';
    $('#f-name').value = '';
    $('#f-location').value = '冷藏';
    $('#f-date').value = store.addDays(today, 7);
    $('#f-advice').value = '';
  }
  $('#form-panel').classList.remove('hidden');
  if (!editId) $('#f-name').focus();
}

function closeForm() {
  $('#form-panel').classList.add('hidden');
}

/** 用知识库条目填充分类、位置、到期日与保存建议 */
function applyKnowledge(entry) {
  const kb = entry || FALLBACK;
  kbApplied = !!entry;
  $('#f-location').value = kb.location;
  $('#f-date').value = store.addDays(store.todayStr(), kb.days);
  $('#f-advice').value = kb.advice;
  const hint = $('#kb-hint');
  hint.textContent = entry
    ? `已按知识库自动设置:${kb.location}保存约 ${kb.days} 天,到期日和建议都可以修改`
    : '知识库暂无此菜品,已按默认冷藏 7 天设置,可手动调整';
  hint.classList.remove('hidden');
}

$('#f-name').addEventListener('input', () => {
  kbApplied = false;
  const matches = suggest($('#f-name').value);
  const box = $('#suggestions');
  if (matches.length === 0) {
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = matches.map((k) => `
    <div class="suggestion" data-name="${escapeHtml(k.name)}">
      <span>${escapeHtml(k.name)}</span>
      <span class="suggestion-meta">${k.location} · 约 ${k.days} 天</span>
    </div>`).join('');
  box.classList.remove('hidden');
});

// pointerdown 先于 input 的 blur 触发,保证联想点击生效
$('#suggestions').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.suggestion');
  if (!el) return;
  e.preventDefault();
  const entry = KNOWLEDGE.find((k) => k.name === el.dataset.name);
  $('#f-name').value = entry.name;
  $('#suggestions').classList.add('hidden');
  applyKnowledge(entry);
});

$('#f-name').addEventListener('blur', () => {
  setTimeout(() => {
    $('#suggestions').classList.add('hidden');
    if (!kbApplied && $('#f-name').value.trim() && !editId) {
      applyKnowledge(lookup($('#f-name').value));
    }
  }, 150);
});

$('#form-save').addEventListener('click', () => {
  const name = $('#f-name').value.trim();
  if (!name) {
    toast('请填写菜品名称');
    return;
  }
  const payload = {
    name,
    category: (lookup(name) || FALLBACK).category,
    location: $('#f-location').value,
    expireDate: $('#f-date').value || store.addDays(store.todayStr(), 7),
    advice: $('#f-advice').value.trim(),
  };
  if (editId) {
    store.updateItem(editId, payload);
    toast('已保存');
  } else {
    store.addItem(payload);
    toast('已放入冰箱');
  }
  closeForm();
  switchView('inventory');
});

$('#form-back').addEventListener('click', closeForm);
$('#fab').addEventListener('click', () => openForm(null));

// ---------- 今日吃什么 ----------

function renderRecipes() {
  const wrap = $('#recipes-wrap');
  const items = store.getDecoratedItems();
  if (items.length === 0) {
    wrap.innerHTML = `
      <div class="empty">
        <div>冰箱还是空的,先去记几样菜</div>
        <button class="primary-btn" id="go-add" style="max-width:200px;margin:16px auto 0;">去添加菜品</button>
      </div>`;
    $('#go-add').addEventListener('click', () => {
      switchView('inventory');
      openForm(null);
    });
    return;
  }

  const stockNames = items.map((it) => it.name);
  const expiringNames = items
    .filter((it) => it.level === 'expired' || it.level === 'expiring')
    .map((it) => it.name);
  const shopping = store.getShopping();
  const recs = recommend(stockNames, expiringNames, 5);

  let html = '<div class="section-title">根据冰箱现有食材推荐</div>';
  if (recs.length === 0) {
    html += '<div class="empty">现有食材还配不出菜谱,再添加一些常见食材试试</div>';
  } else {
    html += `<div class="rec-list">${recs.map((r) => `
      <div class="rec card">
        <div class="rec-head">
          <span class="rec-name">${escapeHtml(r.name)}</span>
          ${r.usesExpiring ? '<span class="tag tag-orange">消耗临期食材</span>' : ''}
          <span class="rec-time">${r.time}</span>
        </div>
        <div class="ing-row">
          <span class="ing-label">已有</span>
          <div class="ing-tags">${r.have.map((n) => `<span class="tag tag-green">${escapeHtml(n)}</span>`).join('')}</div>
        </div>
        ${r.missing.length > 0 ? `
        <div class="ing-row">
          <span class="ing-label">还缺</span>
          <div class="ing-tags">${r.missing.map((n) => {
            const inList = shopping.includes(n);
            return `<button class="tag ${inList ? 'tag-gray' : 'tag-red'}" data-buy="${escapeHtml(n)}" ${inList ? 'disabled' : ''}>${escapeHtml(n)}${inList ? ' · 已加购' : ' +'}</button>`;
          }).join('')}</div>
        </div>` : ''}
        <div class="rec-brief">${escapeHtml(r.brief)}</div>
      </div>`).join('')}</div>`;
  }

  if (shopping.length > 0) {
    html += `
      <div class="section-title">购物清单<span class="section-sub">买到后点击移除</span></div>
      <div class="shopping card">${shopping.map((n) => `
        <div class="shopping-item" data-remove="${escapeHtml(n)}">
          <span>${escapeHtml(n)}</span>
          <span class="shopping-remove">移除</span>
        </div>`).join('')}</div>`;
  }

  wrap.innerHTML = html;
}

$('#recipes-wrap').addEventListener('click', (e) => {
  const buyEl = e.target.closest('[data-buy]');
  if (buyEl && !buyEl.disabled) {
    store.addShopping(buyEl.dataset.buy);
    toast(`${buyEl.dataset.buy} 已加入购物清单`);
    renderRecipes();
    return;
  }
  const removeEl = e.target.closest('[data-remove]');
  if (removeEl) {
    store.removeShopping(removeEl.dataset.remove);
    renderRecipes();
  }
});

// ---------- 到期通知(打开应用时检查,每天最多一次) ----------

function urgentItems() {
  return store.getDecoratedItems().filter((it) => it.level !== 'fresh');
}

function renderNotifyTip(hasStock) {
  const tip = $('#notify-tip');
  if (hasStock && 'Notification' in window && Notification.permission === 'default') {
    tip.innerHTML = `
      <div class="notify-tip">
        <span>开启通知后,打开应用时会自动提醒临期菜品</span>
        <button id="notify-grant">开启</button>
      </div>`;
    $('#notify-grant').addEventListener('click', async () => {
      await Notification.requestPermission();
      renderInventory();
      checkNotify();
    });
  } else {
    tip.innerHTML = '';
  }
}

function checkNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (store.notifiedToday()) return;
  const urgent = urgentItems();
  if (urgent.length === 0) return;
  const names = urgent.slice(0, 3).map((it) => it.name).join('、');
  new Notification('冰箱助手', {
    body: `有 ${urgent.length} 样菜临期或已过期:${names}${urgent.length > 3 ? ' 等' : ''},记得优先吃掉`,
    icon: 'icons/icon-192.png',
  });
  store.markNotified();
}

// ---------- 启动 ----------

renderInventory();
checkNotify();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 本地 file:// 或不支持的环境下静默失败,不影响使用
  });
}
