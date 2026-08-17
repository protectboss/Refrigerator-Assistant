import { KNOWLEDGE, FALLBACK, lookup, suggest } from './shelfLife.js';
import * as store from './store.js';
import { recommend } from './recipes.js';
import * as ai from './ai.js';
import * as voice from './voice.js';

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

let currentView = 'inventory';

function switchView(view) {
  currentView = view;
  if (view !== 'inventory') exitBatchMode();
  $('#view-inventory').classList.toggle('hidden', view !== 'inventory');
  $('#view-recipes').classList.toggle('hidden', view !== 'recipes');
  $('#view-chat').classList.toggle('hidden', view !== 'chat');
  $('#fab').classList.toggle('hidden', view !== 'inventory');
  $('#scan-fab').classList.toggle('hidden', view !== 'inventory');
  $('#voice-fab').classList.toggle('hidden', view !== 'inventory');
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });
  if (view === 'inventory') renderInventory();
  else if (view === 'recipes') renderRecipes();
  else renderChat();
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => switchView(t.dataset.view));
});

// ---------- 冰箱库存 ----------

let batchMode = false;
const batchSelected = new Set();

function exitBatchMode() {
  batchMode = false;
  batchSelected.clear();
  $('#batch-bar').classList.add('hidden');
}

function renderInventory() {
  const items = store.getDecoratedItems();
  const expired = items.filter((it) => it.level === 'expired').length;
  const expiring = items.filter((it) => it.level === 'expiring').length;
  if (items.length === 0) exitBatchMode();

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
    </div>
    <div class="list-tools">
      <button id="batch-toggle" class="link-btn">${batchMode ? '退出批量' : '批量管理'}</button>
    </div>`;

  // 批量模式下隐藏悬浮按钮、显示底部操作栏
  $('#fab').classList.toggle('hidden', batchMode);
  $('#scan-fab').classList.toggle('hidden', batchMode);
  $('#voice-fab').classList.toggle('hidden', batchMode);
  $('#batch-bar').classList.toggle('hidden', !batchMode);
  $('#batch-count').textContent = `已选 ${batchSelected.size}`;
  $('#batch-all').textContent =
    items.length > 0 && batchSelected.size === items.length ? '取消全选' : '全选';
  ['#batch-eaten', '#batch-wasted', '#batch-delete'].forEach((sel) => {
    $(sel).disabled = batchSelected.size === 0;
  });

  const list = $('#inventory-list');
  if (items.length === 0) {
    list.innerHTML = '<div class="empty">冰箱还是空的<br />点右下角按钮,把买回来的菜记进来吧</div>';
    return;
  }
  list.innerHTML = `<div class="list">${items.map((it) => `
    <div class="item card" data-id="${it.id}">
      ${batchMode ? `<input type="checkbox" class="item-check" ${batchSelected.has(it.id) ? 'checked' : ''} />` : ''}
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

$('#summary').addEventListener('click', (e) => {
  if (e.target.id === 'batch-toggle') {
    batchMode = !batchMode;
    batchSelected.clear();
    renderInventory();
  }
});

$('#inventory-list').addEventListener('click', (e) => {
  const itemEl = e.target.closest('.item');
  if (!itemEl) return;
  if (batchMode) {
    const { id } = itemEl.dataset;
    if (batchSelected.has(id)) batchSelected.delete(id);
    else batchSelected.add(id);
    renderInventory();
  } else {
    openSheet(itemEl.dataset.id);
  }
});

// ---------- 批量操作 ----------

$('#batch-all').addEventListener('click', () => {
  const items = store.getDecoratedItems();
  if (batchSelected.size === items.length) batchSelected.clear();
  else items.forEach((it) => batchSelected.add(it.id));
  renderInventory();
});

function batchFinish(result) {
  const ids = [...batchSelected];
  if (ids.length === 0) return;
  ids.forEach((id) => store.finishItem(id, result));
  exitBatchMode();
  renderInventory();
  toast(result === 'eaten' ? `已标记 ${ids.length} 样吃完` : `已记录扔掉 ${ids.length} 样`);
}

$('#batch-eaten').addEventListener('click', () => batchFinish('eaten'));
$('#batch-wasted').addEventListener('click', () => batchFinish('wasted'));

$('#batch-delete').addEventListener('click', () => {
  const ids = [...batchSelected];
  if (ids.length === 0) return;
  if (!confirm(`确定删除选中的 ${ids.length} 样吗?删除不计入消耗历史。`)) return;
  ids.forEach((id) => store.deleteItem(id));
  exitBatchMode();
  renderInventory();
  toast(`已删除 ${ids.length} 样`);
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

/** 菜谱卡片底部:详细做法 + B站/小红书教程直达 */
function recipeLinks(name) {
  const q = encodeURIComponent(name);
  return `<div class="rec-links">
    <button class="tag tag-green" data-detail="${escapeHtml(name)}">详细做法</button>
    <a class="tag tag-gray" href="https://search.bilibili.com/all?keyword=${q}" target="_blank" rel="noopener">B站教程</a>
    <a class="tag tag-gray" href="https://www.xiaohongshu.com/search_result?keyword=${q}" target="_blank" rel="noopener">小红书</a>
  </div>`;
}

/** 缺料标签(可点击加入购物清单),AI 推荐和内置菜谱共用 */
function missingTag(name, shopping) {
  const inList = shopping.includes(name);
  return `<button class="tag ${inList ? 'tag-gray' : 'tag-red'}" data-buy="${escapeHtml(name)}" ${inList ? 'disabled' : ''}>${escapeHtml(name)}${inList ? ' · 已加购' : ' +'}</button>`;
}

const KEY_AI_RECIPES = 'ai_recipes';

/** 库存指纹:食材名排序拼接,用于判断"推荐后食材是否变过" */
function inventoryFingerprint(items) {
  return items.map((it) => it.name).sort().join('|');
}

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

  // ---- AI 推荐区 ----
  let aiCache = null;
  try {
    aiCache = JSON.parse(localStorage.getItem(KEY_AI_RECIPES) || 'null');
  } catch (e) {
    aiCache = null;
  }
  const fp = inventoryFingerprint(items);

  let html = `<div class="section-title">AI 按现有食材推荐
    <button id="ai-recipes-btn" class="link-btn" style="float:right">${aiCache ? '重新推荐' : '让 AI 想想'}</button>
  </div>`;

  if (aiCache && Array.isArray(aiCache.recipes) && aiCache.recipes.length > 0) {
    if (aiCache.fp !== fp) {
      html += '<div class="banner banner-orange">食材有变化,点"重新推荐"获取最新菜谱</div>';
    }
    html += `<div class="rec-list">${aiCache.recipes.map((r) => `
      <div class="rec card">
        <div class="rec-head">
          <span class="rec-name">${escapeHtml(r.name)}</span>
          <span class="tag tag-green">AI</span>
          ${r.time ? `<span class="rec-time">${escapeHtml(r.time)}</span>` : ''}
        </div>
        ${r.use.length > 0 ? `
        <div class="ing-row">
          <span class="ing-label">用到</span>
          <div class="ing-tags">${r.use.map((n) => `<span class="tag tag-green">${escapeHtml(n)}</span>`).join('')}</div>
        </div>` : ''}
        ${r.missing.length > 0 ? `
        <div class="ing-row">
          <span class="ing-label">还缺</span>
          <div class="ing-tags">${r.missing.map((n) => missingTag(n, shopping)).join('')}</div>
        </div>` : ''}
        ${r.brief ? `<div class="rec-brief">${escapeHtml(r.brief)}</div>` : ''}
        ${recipeLinks(r.name)}
      </div>`).join('')}</div>`;
    if (aiCache.at) {
      html += `<div class="section-title" style="font-weight:400">推荐于 ${escapeHtml(aiCache.at)}</div>`;
    }
  } else {
    html +=
      '<div class="settings-note">点"让 AI 想想",千问会根据冰箱里的菜(优先消耗临期食材)推荐今天做什么,不受内置菜谱库限制。</div>';
  }

  // ---- 内置菜谱区(无网络兜底) ----
  html += '<div class="section-title" style="margin-top:16px">内置菜谱匹配</div>';
  if (recs.length === 0) {
    html += '<div class="empty">现有食材还配不出内置菜谱,试试上面的 AI 推荐</div>';
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
          <div class="ing-tags">${r.missing.map((n) => missingTag(n, shopping)).join('')}</div>
        </div>` : ''}
        <div class="rec-brief">${escapeHtml(r.brief)}</div>
        ${recipeLinks(r.name)}
      </div>`).join('')}</div>`;
  }

  if (shopping.length > 0) {
    html += `
      <div class="section-title">购物清单<span class="section-sub">买到后点击移除</span>
        <button class="link-btn" data-clear-shopping style="float:right">全部移除</button>
      </div>
      <div class="shopping card">${shopping.map((n) => `
        <div class="shopping-item" data-remove="${escapeHtml(n)}">
          <span>${escapeHtml(n)}</span>
          <span class="shopping-remove">移除</span>
        </div>`).join('')}</div>`;
  }

  wrap.innerHTML = html;
}

/** 让 AI 根据当前库存重新推荐,并缓存结果与库存指纹 */
async function refreshAiRecipes() {
  if (!requireApiKey()) return;
  const items = store.getDecoratedItems();
  showLoading('AI 正在想今天吃什么…');
  try {
    const recipes = await ai.recommendRecipes(items);
    hideLoading();
    if (recipes.length === 0) {
      toast('AI 没有给出有效推荐,请再试一次');
      return;
    }
    const now = new Date();
    localStorage.setItem(
      KEY_AI_RECIPES,
      JSON.stringify({
        fp: inventoryFingerprint(items),
        recipes,
        at: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      })
    );
    renderRecipes();
  } catch (err) {
    hideLoading();
    toast(err.code === 'NO_KEY' ? '请先在设置里填写 API Key' : `AI 推荐失败:${err.message}`);
  }
}

// ---------- 详细做法(AI 联网总结,按菜名缓存) ----------

const KEY_RECIPE_DETAILS = 'recipe_details';

async function showRecipeDetail(name) {
  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(KEY_RECIPE_DETAILS) || '{}');
  } catch (e) {
    cache = {};
  }
  if (!cache[name]) {
    if (!requireApiKey()) return;
    showLoading('AI 正在查找教程并总结…');
    try {
      const text = await ai.recipeDetail(name);
      hideLoading();
      if (!text) {
        toast('没有拿到做法,请再试一次');
        return;
      }
      cache[name] = text;
      localStorage.setItem(KEY_RECIPE_DETAILS, JSON.stringify(cache));
    } catch (err) {
      hideLoading();
      toast(err.code === 'NO_KEY' ? '请先在设置里填写 API Key' : `获取做法失败:${err.message}`);
      return;
    }
  }
  $('#detail-title').textContent = name;
  $('#detail-body').textContent = cache[name];
  $('#detail-panel').classList.remove('hidden');
}

$('#detail-back').addEventListener('click', () => {
  $('#detail-panel').classList.add('hidden');
});

$('#recipes-wrap').addEventListener('click', (e) => {
  const detailEl = e.target.closest('[data-detail]');
  if (detailEl) {
    showRecipeDetail(detailEl.dataset.detail);
    return;
  }
  if (e.target.closest('#ai-recipes-btn')) {
    refreshAiRecipes();
    return;
  }
  if (e.target.closest('[data-clear-shopping]')) {
    store.clearShopping();
    renderRecipes();
    return;
  }
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

// ---------- 设置(API Key) ----------

$('#open-settings').addEventListener('click', () => {
  $('#f-apikey').value = ai.getApiKey();
  $('#f-familycode').value = store.getFamilyCode();
  $('#settings-panel').classList.remove('hidden');
});

$('#settings-back').addEventListener('click', () => {
  $('#settings-panel').classList.add('hidden');
});

$('#settings-save').addEventListener('click', async () => {
  ai.setApiKey($('#f-apikey').value);

  const newCode = $('#f-familycode').value.trim();
  if (newCode && newCode.length < 4) {
    toast('家庭共享码至少 4 个字符');
    return;
  }
  const oldCode = store.getFamilyCode();
  store.setFamilyCode(newCode);
  $('#settings-panel').classList.add('hidden');

  if (newCode && newCode !== oldCode) {
    showLoading('正在开启家庭共享…');
    const ok = await store.bootstrapShare();
    hideLoading();
    toast(ok ? '家庭共享已开启,本机数据已合并到云端' : '共享开通失败,请检查网络后重试');
    switchView('inventory');
    return;
  }
  if (!newCode && oldCode) {
    toast('已关闭共享,数据仅保存在本机');
    return;
  }
  toast('设置已保存');
});

/** 需要 Key 的功能统一走这里:没配置就引导去设置 */
function requireApiKey() {
  if (ai.getApiKey()) return true;
  toast('请先在设置里填写阿里云 API Key');
  $('#f-apikey').value = '';
  $('#settings-panel').classList.remove('hidden');
  return false;
}

// ---------- 拍照 / 小票识别 ----------

function showLoading(text, soft) {
  $('#loading-text').textContent = text;
  $('#loading-mask').classList.toggle('soft', !!soft);
  $('#loading-mask').classList.remove('hidden');
}

function hideLoading() {
  $('#loading-mask').classList.add('hidden');
  $('#loading-mask').classList.remove('soft');
}

$('#scan-fab').addEventListener('click', () => {
  if (!requireApiKey()) return;
  $('#scan-file').value = '';
  $('#scan-file').click();
});

$('#scan-file').addEventListener('change', async () => {
  const file = $('#scan-file').files[0];
  if (!file) return;
  showLoading('正在识别图片,请稍候…');
  try {
    const dataUrl = await ai.fileToDataUrl(file);
    const names = await ai.recognizeFood(dataUrl);
    hideLoading();
    if (names.length === 0) {
      toast('没有识别到食材,换个角度再拍一张试试');
      return;
    }
    openConfirmPanel(
      resolveOps(names.map((name) => ({ kind: 'add', name }))),
      '识别到这些食材',
      '取消勾选不需要的,确认后按知识库自动设置保质期放入冰箱。'
    );
  } catch (e) {
    hideLoading();
    toast(e.code === 'NO_KEY' ? '请先在设置里填写 API Key' : `识别失败:${e.message}`);
  }
});

// 确认面板:拍照(纯入库)和语音(入库/出库/改期混合)共用
const KIND_LABEL = { add: '放入', eaten: '吃完', wasted: '扔掉', expire: '改期' };
const KIND_TAG = { add: 'tag-green', eaten: 'tag-gray', wasted: 'tag-red', expire: 'tag-orange' };
let pendingOps = [];

/** 补全每条操作的展示信息;出库/改期操作在当前库存里定位具体条目 */
function resolveOps(ops) {
  const items = store.getDecoratedItems();
  return ops.map((op) => {
    if (op.kind === 'add') {
      const kb = lookup(op.name);
      return Object.assign({}, op, {
        meta: op.date
          ? `到期 ${op.date}(语音指定)`
          : kb
            ? `${kb.location} · 约 ${kb.days} 天`
            : `默认冷藏 ${FALLBACK.days} 天`,
        disabled: false,
      });
    }
    const hit =
      items.find((it) => it.name === op.name) ||
      items.find((it) => it.name.includes(op.name) || op.name.includes(it.name));
    if (op.kind === 'expire') {
      return Object.assign({}, op, {
        id: hit ? hit.id : null,
        meta: hit ? `${hit.name} 到期改为 ${op.date}` : '冰箱里没找到,已忽略',
        disabled: !hit,
      });
    }
    return Object.assign({}, op, {
      id: hit ? hit.id : null,
      meta: hit ? `现有:${hit.name}` : '冰箱里没找到,已忽略',
      disabled: !hit,
    });
  });
}

function openConfirmPanel(ops, title, note) {
  pendingOps = ops;
  $('#scan-title').textContent = title;
  $('#scan-note').textContent = note;
  $('#scan-list').innerHTML = ops
    .map(
      (op, i) => `
        <label class="scan-item">
          <input type="checkbox" ${op.disabled ? 'disabled' : 'checked'} data-idx="${i}" />
          <span class="tag ${KIND_TAG[op.kind]} scan-kind">${KIND_LABEL[op.kind]}</span>
          <span>${escapeHtml(op.name)}</span>
          <span class="scan-item-meta">${escapeHtml(op.meta)}</span>
        </label>`
    )
    .join('');
  $('#scan-panel').classList.remove('hidden');
}

$('#scan-back').addEventListener('click', () => {
  $('#scan-panel').classList.add('hidden');
});

$('#scan-confirm').addEventListener('click', () => {
  const checked = [...document.querySelectorAll('#scan-list input:checked')];
  if (checked.length === 0) {
    toast('没有勾选任何操作');
    return;
  }
  let added = 0;
  let removed = 0;
  let redated = 0;
  checked.forEach((el) => {
    const op = pendingOps[Number(el.dataset.idx)];
    if (!op || op.disabled) return;
    if (op.kind === 'add') {
      const kb = lookup(op.name) || FALLBACK;
      store.addItem({
        name: op.name,
        category: kb.category,
        location: kb.location,
        expireDate: op.date || store.addDays(store.todayStr(), kb.days),
        advice: kb.advice,
      });
      added += 1;
    } else if (op.kind === 'expire' && op.id) {
      store.updateItem(op.id, { expireDate: op.date });
      redated += 1;
    } else if (op.id) {
      store.finishItem(op.id, op.kind);
      removed += 1;
    }
  });
  $('#scan-panel').classList.add('hidden');
  const parts = [];
  if (added > 0) parts.push(`放入 ${added} 样`);
  if (removed > 0) parts.push(`出库 ${removed} 样`);
  if (redated > 0) parts.push(`改期 ${redated} 样`);
  toast(parts.length > 0 ? `已${parts.join(',')}` : '没有可执行的操作');
  switchView('inventory');
});

// ---------- 按住说话(库存记账 + 聊天提问共用) ----------

/** 给按钮绑定"按住录音、松手转写"的交互;转写文本交给 onText 处理 */
function bindHoldToTalk(btn, onText) {
  let pressed = false;

  btn.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    if (pressed) return;
    if (!requireApiKey()) return;
    pressed = true;
    try {
      await voice.startRecording();
      if (!pressed) {
        voice.cancelRecording();
        return;
      }
      btn.classList.add('recording');
      showLoading('正在录音,松开手指结束…', true);
    } catch (err) {
      pressed = false;
      hideLoading();
      toast('无法使用麦克风,请检查浏览器权限');
    }
  });

  const end = async () => {
    if (!pressed) return;
    pressed = false;
    btn.classList.remove('recording');
    try {
      const rec = await voice.stopRecording();
      if (!rec) {
        hideLoading();
        toast('说话时间太短,按住按钮说完再松手');
        return;
      }
      showLoading('正在识别语音…');
      const text = await voice.transcribe(rec.dataUrl);
      if (!text) {
        hideLoading();
        toast('没有听清,请再试一次');
        return;
      }
      await onText(text);
    } catch (err) {
      hideLoading();
      toast(err.code === 'NO_KEY' ? '请先在设置里填写 API Key' : `语音识别失败:${err.message}`);
    }
  };

  btn.addEventListener('pointerup', end);
  btn.addEventListener('pointercancel', end);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

// 库存页麦克风:解析成入库/出库/改期操作
bindHoldToTalk($('#voice-fab'), async (text) => {
  showLoading('正在理解指令…');
  const names = store.getDecoratedItems().map((it) => it.name);
  const ops = await voice.parseVoiceOps(text, names, store.todayStr());
  hideLoading();
  if (ops.length === 0) {
    toast(`听到了「${text}」,但没有解析出操作`);
    return;
  }
  openConfirmPanel(resolveOps(ops), '听到这些操作', `你说的是:「${text}」,取消勾选不对的再确认。`);
});

// ---------- 问问 AI(做饭参谋) ----------

const CHAT_CHIPS = ['今晚吃什么?', '快过期的菜怎么处理?', '来个 15 分钟的快手菜'];
let chatHistory = [];
let chatBusy = false;

function inventorySummary() {
  const items = store.getDecoratedItems();
  if (items.length === 0) return '用户冰箱目前是空的。';
  const lines = items.map((it) => `${it.name}(${it.statusText})`).join('、');
  const shopping = store.getShopping();
  return (
    `用户冰箱现有食材:${lines}。` +
    (shopping.length > 0 ? `购物清单上已有:${shopping.join('、')}。` : '')
  );
}

function renderChat() {
  const box = $('#chat-messages');
  if (chatHistory.length === 0) {
    box.innerHTML = `
      <div class="chat-bubble chat-ai">我是你的做饭参谋,已经看过你的冰箱了。想吃什么类型的菜,或者让我直接推荐?</div>
      <div class="chat-chips">${CHAT_CHIPS.map(
        (c) => `<button class="chat-chip">${c}</button>`
      ).join('')}</div>`;
  } else {
    box.innerHTML =
      chatHistory
        .map(
          (m) =>
            `<div class="chat-bubble ${m.role === 'user' ? 'chat-user' : 'chat-ai'}">${escapeHtml(m.content)}</div>`
        )
        .join('') +
      (chatBusy ? '<div class="chat-bubble chat-ai chat-thinking">正在想菜谱…</div>' : '');
  }
  box.scrollTop = box.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
}

async function sendChat(text) {
  const content = text.trim();
  if (!content || chatBusy) return;
  if (!requireApiKey()) return;
  chatHistory.push({ role: 'user', content });
  chatBusy = true;
  $('#chat-send').disabled = true;
  $('#chat-input').value = '';
  renderChat();
  try {
    const reply = await ai.askChef(chatHistory.slice(-12), inventorySummary());
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (e) {
    chatHistory.pop();
    toast(e.code === 'NO_KEY' ? '请先在设置里填写 API Key' : `AI 回复失败:${e.message}`);
  }
  chatBusy = false;
  $('#chat-send').disabled = false;
  renderChat();
}

$('#chat-send').addEventListener('click', () => sendChat($('#chat-input').value));
$('#chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat($('#chat-input').value);
});
$('#chat-messages').addEventListener('click', (e) => {
  const chip = e.target.closest('.chat-chip');
  if (chip) sendChat(chip.textContent);
});

// 聊天输入:微信式语音/键盘切换,偏好记住在本机
const KEY_CHAT_MODE = 'chat_input_mode';
let chatVoiceMode = localStorage.getItem(KEY_CHAT_MODE) === 'voice';

function applyChatInputMode() {
  $('#chat-input').classList.toggle('hidden', chatVoiceMode);
  $('#chat-send').classList.toggle('hidden', chatVoiceMode);
  $('#chat-hold').classList.toggle('hidden', !chatVoiceMode);
  $('#icon-to-voice').classList.toggle('hidden', chatVoiceMode);
  $('#icon-to-keyboard').classList.toggle('hidden', !chatVoiceMode);
}

$('#chat-mode-toggle').addEventListener('click', () => {
  chatVoiceMode = !chatVoiceMode;
  localStorage.setItem(KEY_CHAT_MODE, chatVoiceMode ? 'voice' : 'text');
  applyChatInputMode();
});

applyChatInputMode();

// 按住说话长条:转写后直接作为提问发送
bindHoldToTalk($('#chat-hold'), async (text) => {
  hideLoading();
  sendChat(text);
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

// ---------- 家庭共享:启动与回到前台时拉取云端数据 ----------

async function syncAndRender() {
  if (!store.getFamilyCode()) return;
  const ok = await store.pullRemote();
  if (ok) {
    if (currentView === 'inventory') renderInventory();
    else if (currentView === 'recipes') renderRecipes();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncAndRender();
});

// ---------- 启动 ----------

renderInventory();
checkNotify();
syncAndRender().then(() => checkNotify());

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // 本地 file:// 或不支持的环境下静默失败,不影响使用
  });
}
