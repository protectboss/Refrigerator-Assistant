/**
 * Cloudflare Worker:静态资源 + 阿里云百炼(DashScope)代理 + 家庭数据同步。
 *
 * /api/chat — 浏览器把用户自己的 API Key 放在 Authorization 头里发过来,
 *             Worker 原样转发给 DashScope 的 OpenAI 兼容接口,Key 不落库、不进代码。
 * /api/sync — 家庭共享:同一个"家庭共享码"对应一个 Durable Object 实例,
 *             GET 拉取全量数据,POST 提交一个操作(增删改),由 DO 串行应用,
 *             多台设备同时操作也不会互相覆盖。
 */
const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: { message: 'Method Not Allowed' } }, 405);
      }
      const auth = request.headers.get('authorization');
      if (!auth || !auth.startsWith('Bearer ')) {
        return jsonResponse({ error: { message: '缺少 API Key,请先在应用的设置里填写' } }, 401);
      }
      try {
        const upstream = await fetch(DASHSCOPE_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: auth,
          },
          body: request.body,
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      } catch (e) {
        return jsonResponse({ error: { message: `转发到阿里云失败:${e.message}` } }, 502);
      }
    }

    if (url.pathname === '/api/sync') {
      let code = url.searchParams.get('code') || '';
      let body = null;
      if (request.method === 'POST') {
        body = await request.json().catch(() => null);
        if (body && body.code) code = body.code;
      }
      code = String(code).trim();
      if (code.length < 4) {
        return jsonResponse({ error: { message: '家庭共享码至少 4 个字符' } }, 400);
      }
      const stub = env.FRIDGE_DO.get(env.FRIDGE_DO.idFromName(code));
      if (request.method === 'GET') {
        return stub.fetch('https://do/state', { method: 'GET' });
      }
      if (request.method === 'POST') {
        return stub.fetch('https://do/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: body && body.op }),
        });
      }
      return jsonResponse({ error: { message: 'Method Not Allowed' } }, 405);
    }

    return env.ASSETS.fetch(request);
  },
};

/** 每个家庭共享码对应一个实例,内部串行处理,天然避免并发覆盖 */
export class FridgeStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const state = (await this.ctx.storage.get('state')) || {
      items: [],
      history: [],
      shopping: [],
    };

    if (request.method === 'GET') {
      return jsonResponse(state, 200);
    }

    const body = await request.json().catch(() => null);
    const op = body && body.op;
    if (!op || typeof op.type !== 'string') {
      return jsonResponse({ error: { message: '无效的操作' } }, 400);
    }
    applyOp(state, op);
    await this.ctx.storage.put('state', state);
    return jsonResponse(state, 200);
  }
}

/** 把一个客户端操作应用到家庭数据上 */
function applyOp(state, op) {
  switch (op.type) {
    case 'add':
      if (op.item && op.item.id && !state.items.some((it) => it.id === op.item.id)) {
        state.items.push(op.item);
      }
      break;
    case 'update': {
      const idx = state.items.findIndex((it) => it.id === op.id);
      if (idx !== -1) state.items[idx] = Object.assign({}, state.items[idx], op.patch);
      break;
    }
    case 'finish': {
      const idx = state.items.findIndex((it) => it.id === op.id);
      if (idx !== -1) {
        const [item] = state.items.splice(idx, 1);
        state.history.push(
          Object.assign({}, item, { result: op.result, finishDate: op.finishDate })
        );
      }
      break;
    }
    case 'delete':
      state.items = state.items.filter((it) => it.id !== op.id);
      break;
    case 'shop_add':
      if (op.name && !state.shopping.includes(op.name)) state.shopping.push(op.name);
      break;
    case 'shop_remove':
      state.shopping = state.shopping.filter((n) => n !== op.name);
      break;
    case 'shop_clear':
      state.shopping = [];
      break;
    case 'bootstrap': {
      // 设备首次开通共享:把它的本地数据与云端做并集合并,谁都不丢
      const s = op.state || {};
      (s.items || []).forEach((item) => {
        if (item && item.id && !state.items.some((it) => it.id === item.id)) {
          state.items.push(item);
        }
      });
      (s.history || []).forEach((h) => {
        if (h && h.id && !state.history.some((x) => x.id === h.id && x.finishDate === h.finishDate)) {
          state.history.push(h);
        }
      });
      (s.shopping || []).forEach((n) => {
        if (n && !state.shopping.includes(n)) state.shopping.push(n);
      });
      break;
    }
    default:
      break;
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
