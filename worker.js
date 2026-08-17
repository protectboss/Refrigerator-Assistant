/**
 * Cloudflare Worker:静态资源 + 阿里云百炼(DashScope)代理。
 * 浏览器把用户自己的 API Key 放在 Authorization 头里发到 /api/chat,
 * Worker 原样转发给 DashScope 的 OpenAI 兼容接口——Key 不落库、不进代码。
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

    return env.ASSETS.fetch(request);
  },
};

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
