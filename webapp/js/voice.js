/**
 * 语音录入:按住说话 → 16kHz 单声道 WAV → qwen3-asr-flash 转写
 * → qwen-plus 解析成入库/出库操作。全部经同源 /api/chat 代理,复用用户自己的 Key。
 */
import { getApiKey } from './ai.js';

const ASR_MODEL = 'qwen3-asr-flash';
const PARSE_MODEL = 'qwen-plus';
const TARGET_RATE = 16000;

// ---------- 录音器 ----------

let mediaStream = null;
let audioCtx = null;
let processor = null;
let sourceNode = null;
let chunks = [];
let recordingRate = 48000;
let startedAt = 0;

export async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // 不 await:个别浏览器在此挂起;由 pointerdown 手势保证可恢复
  audioCtx.resume().catch(() => {});
  recordingRate = audioCtx.sampleRate;
  chunks = [];
  startedAt = Date.now();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);
  processor = audioCtx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  sourceNode.connect(processor);
  processor.connect(audioCtx.destination);
}

/** 停止录音,返回 { dataUrl, durationMs };时长过短返回 null */
export async function stopRecording() {
  const durationMs = Date.now() - startedAt;
  if (processor) {
    processor.disconnect();
    sourceNode.disconnect();
  }
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) await audioCtx.close();
  const collected = chunks;
  mediaStream = null;
  audioCtx = null;
  processor = null;
  sourceNode = null;
  chunks = [];

  if (durationMs < 600 || collected.length === 0) return null;

  // 合并采样并重采样到 16kHz
  const total = collected.reduce((n, c) => n + c.length, 0);
  const pcm = new Float32Array(total);
  let offset = 0;
  collected.forEach((c) => {
    pcm.set(c, offset);
    offset += c.length;
  });
  const resampled = resample(pcm, recordingRate, TARGET_RATE);
  return { dataUrl: encodeWav(resampled, TARGET_RATE), durationMs };
}

export function cancelRecording() {
  if (processor) {
    processor.disconnect();
    sourceNode.disconnect();
  }
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  if (audioCtx) audioCtx.close();
  mediaStream = null;
  audioCtx = null;
  processor = null;
  sourceNode = null;
  chunks = [];
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

/** Float32 PCM → 16bit WAV data URL */
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (pos, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(pos + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// ---------- 转写与解析 ----------

async function callApi(payload) {
  const key = getApiKey();
  if (!key) {
    const err = new Error('还没有配置 API Key');
    err.code = 'NO_KEY';
    throw err;
  }
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
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

/** 语音转文字 */
export async function transcribe(wavDataUrl) {
  const content = await callApi({
    model: ASR_MODEL,
    messages: [
      {
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: wavDataUrl } }],
      },
    ],
    asr_options: { language: 'zh', enable_itn: false },
  });
  return String(content || '').trim();
}

/**
 * 把口语文本解析成操作列表。
 * @returns {Promise<Array<{kind:'add'|'eaten'|'wasted'|'expire', name:string, date?:string}>>}
 */
export async function parseVoiceOps(text, inventoryNames, todayStr) {
  const prompt =
    `今天是 ${todayStr}。你是冰箱助手的指令解析器,把用户的一句话解析成操作列表,严格输出 JSON:\n` +
    '{"actions":[\n' +
    ' {"kind":"add","name":"西红柿"},\n' +
    ' {"kind":"add","name":"猪肉","date":"2026-08-22"},\n' +
    ' {"kind":"eaten","name":"菠菜"},\n' +
    ' {"kind":"wasted","name":"豆腐"},\n' +
    ' {"kind":"expire","name":"土豆","date":"2026-08-19"}\n' +
    ']}\n' +
    'kind 取值:\n' +
    'add=放入冰箱(买了/放入/添加);说了能放几天或到期时间时才带 date,否则不带;\n' +
    'eaten=吃完取出(吃了/用完/做菜用掉);wasted=扔掉(坏了/扔了/倒掉);\n' +
    'expire=修改现有食材的保质期/到期日(如"土豆还能放三天""把菠菜改成明天到期"),必须带 date。\n' +
    `date 一律换算成 YYYY-MM-DD 具体日期:今天是 ${todayStr},"能放三天"=今天加3天,"明天到期"=今天加1天。\n` +
    'name 用中国家庭常用食材简称;说了数量也只输出一条(如"两个西红柿"→一条西红柿)。\n' +
    `当前冰箱里有:${inventoryNames.length > 0 ? inventoryNames.join('、') : '(空)'}。` +
    'eaten/wasted/expire 的 name 必须从上面的现有食材里选最接近的;冰箱里没有的就不要输出该条。\n' +
    '听不出任何操作时输出 {"actions":[]}。只输出 JSON,不要任何其他文字。\n' +
    `用户的话:「${text}」`;

  const content = await callApi({
    model: PARSE_MODEL,
    messages: [{ role: 'user', content: prompt }],
  });
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const obj = JSON.parse(match[0]);
    if (!Array.isArray(obj.actions)) return [];
    return obj.actions
      .map((a) => {
        const date = String((a && a.date) || '').trim();
        return {
          kind: a && a.kind,
          name: String((a && a.name) || '').trim(),
          date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
        };
      })
      .filter(
        (a) =>
          a.name &&
          ['add', 'eaten', 'wasted', 'expire'].includes(a.kind) &&
          (a.kind !== 'expire' || a.date)
      );
  } catch (e) {
    return [];
  }
}
