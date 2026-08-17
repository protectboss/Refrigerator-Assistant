/**
 * AI 能力层:通义千问对话 + 视觉识别(食材照片 / 购物小票)。
 * API Key 只保存在本机 localStorage,经同源 /api/chat 代理转发给阿里云。
 */
const KEY_API = 'dashscope_api_key';

const CHAT_MODEL = 'qwen-plus';
const VISION_MODEL = 'qwen-vl-max';

export function getApiKey() {
  return localStorage.getItem(KEY_API) || '';
}

export function setApiKey(key) {
  localStorage.setItem(KEY_API, key.trim());
}

/** 调用 OpenAI 兼容的 chat/completions,返回回复文本 */
async function callChat(payload) {
  const key = getApiKey();
  if (!key) {
    const err = new Error('还没有配置 API Key');
    err.code = 'NO_KEY';
    throw err;
  }
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    if (data && data.error && data.error.message) msg = data.error.message;
    if (res.status === 401) msg = 'API Key 无效或已过期,请在设置里检查';
    throw new Error(msg);
  }
  return data.choices[0].message.content;
}

/**
 * 做饭参谋对话。
 * @param {Array<{role:string,content:string}>} history 用户与 AI 的历史消息
 * @param {string} inventorySummary 当前库存摘要文本
 */
export async function askChef(history, inventorySummary) {
  const system = {
    role: 'system',
    content:
      '你是"冰箱助手"应用里的做饭参谋,帮用户决定用冰箱现有食材做什么菜。\n' +
      `${inventorySummary}\n` +
      '规则:\n' +
      '1. 优先建议消耗临期或已过期提示的食材;\n' +
      '2. 推荐家常做法,给出简要步骤;\n' +
      '3. 如果推荐的菜需要用户没有的关键食材,单独列一行"需要购买:...";\n' +
      '4. 用中文回答,口语化、简洁,不要使用 Markdown 符号(如 # * -),直接用纯文本和数字序号。',
  };
  return callChat({ model: CHAT_MODEL, messages: [system, ...history] });
}

/**
 * 识别图片中的食材(支持食材/蔬菜照片和超市购物小票)。
 * @param {string} dataUrl 压缩后的图片 base64 data URL
 * @returns {Promise<string[]>} 食材名列表
 */
export async function recognizeFood(dataUrl) {
  const prompt =
    '这张图片可能是食材/蔬菜/生鲜的照片,也可能是超市购物小票。' +
    '请识别其中的食材或食品,严格按此 JSON 格式输出:{"items":[{"name":"土豆"}]}。' +
    '要求:name 用中国家庭常用简称(如 土豆、西红柿、鸡蛋、猪肉、菠菜);' +
    '忽略非食品商品(纸巾、洗衣液、餐具等);小票上的同类商品合并为一项;' +
    '如果图中没有任何食材或食品,输出 {"items":[]}。只输出 JSON,不要任何其他文字。';

  const content = await callChat({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]);
    if (!Array.isArray(obj.items)) return [];
    const names = obj.items
      .map((it) => String((it && it.name) || '').trim())
      .filter(Boolean);
    return [...new Set(names)];
  } catch (e) {
    return [];
  }
}

/**
 * 按冰箱实时库存让 AI 推荐今日菜谱。
 * @param {Array<{name:string,statusText:string}>} items 带剩余天数的库存
 * @returns {Promise<Array<{name,time,brief,use:string[],missing:string[]}>>}
 */
export async function recommendRecipes(items) {
  const inventory = items.map((it) => `${it.name}(${it.statusText})`).join('、');
  const prompt =
    '你是家常菜推荐助手。用户冰箱现有食材(含剩余保质天数):\n' +
    `${inventory}\n` +
    '请推荐 3 道适合今天做的家常菜,严格输出 JSON:\n' +
    '{"recipes":[{"name":"酸辣土豆丝","time":"10 分钟","brief":"土豆切丝泡水,大火快炒,出锅前淋醋","use":["土豆"],"missing":["青椒"]}]}\n' +
    '要求:优先消耗临期或快过期的食材;use 只能从现有食材里选;' +
    'missing 只列缺少的主料(葱姜蒜、盐、酱油等常见调料不算);' +
    'brief 是不超过 40 字的做法要点;只输出 JSON,不要任何其他文字。';

  const content = await callChat({
    model: CHAT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]);
    if (!Array.isArray(obj.recipes)) return [];
    return obj.recipes
      .map((r) => ({
        name: String((r && r.name) || '').trim(),
        time: String((r && r.time) || '').trim(),
        brief: String((r && r.brief) || '').trim(),
        use: Array.isArray(r && r.use) ? r.use.map(String) : [],
        missing: Array.isArray(r && r.missing) ? r.missing.map(String) : [],
      }))
      .filter((r) => r.name);
  } catch (e) {
    return [];
  }
}

/**
 * 联网搜索并总结一道菜的详细做法(enable_search 让千问检索网络教程)。
 */
export async function recipeDetail(dishName) {
  const content = await callChat({
    model: CHAT_MODEL,
    enable_search: true,
    messages: [
      {
        role: 'user',
        content:
          `请参考网络上的家常做法教程,总结「${dishName}」的详细做法。` +
          '格式:第一行列主料和大致用量;然后分步骤,每行一步(1. 2. 3. …),每步一句话;' +
          '最后给 1-2 条关键技巧,以"技巧:"开头。' +
          '纯文本输出,不要使用 Markdown 符号,总共不超过 250 字。',
      },
    ],
  });
  return String(content || '').trim();
}

/**
 * 把用户选择的照片压缩成适合上传的 JPEG data URL。
 * 小票文字较小,保留 1600px 长边以保证 OCR 效果。
 */
export async function fileToDataUrl(file, maxSize = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
