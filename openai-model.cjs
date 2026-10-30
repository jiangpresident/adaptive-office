'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { Readable } = require('node:stream');
const { prepareInput, modelMessages, cleanFunctionSketches, mergeOutput, OUTPUT_SCHEMA, ModelError, replyPreview } = require('./local-model.cjs');
const CONFIG_PATH = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'Wishouse', 'openai.json');

function readConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code !== 'ENOENT') throw new ModelError(503, 'API_CONFIG', 'GPT 配置文件无法读取，请重新运行“配置GPT.cmd”。'); }
  const model = process.env.OPENAI_MODEL || file.model || 'gpt-5-mini';
  if (typeof model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model)) throw new ModelError(503, 'API_CONFIG', 'GPT 模型名称配置不正确。');
  return { apiKey: process.env.OPENAI_API_KEY || file.apiKey || '', model };
}

// Native HTTPS has no implicit five-minute fetch idle timeout. Caller controls cancellation.
function apiFetch(url, { method = 'GET', headers, body, signal } = {}) {
  if (new URL(url).origin !== 'https://api.openai.com') throw new Error('Unexpected API origin');
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, signal, timeout: 0 }, response => {
      resolve(new Response(Readable.toWeb(response), { status: response.statusCode }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

function strictSchema(source) {
  const result = structuredClone(source);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.properties) {
      const required = new Set(node.required || []);
      for (const [key, value] of Object.entries(node.properties)) {
        visit(value);
        if (!required.has(key)) node.properties[key] = { anyOf: [value, { type: 'null' }] };
      }
      node.required = Object.keys(node.properties);
      node.additionalProperties = false;
    }
    if (node.items) visit(node.items);
    for (const value of node.anyOf || []) visit(value);
  }
  visit(result);
  return result;
}

function apiError(status) {
  if (status === 401) return new ModelError(503, 'API_AUTH', 'API Key 无效或已失效，请重新配置 GPT。');
  if (status === 403 || status === 404) return new ModelError(503, 'API_MODEL', '当前 API 账户无法访问所配置的 GPT 模型，请检查模型名称与权限。');
  if (status === 429) return new ModelError(429, 'API_LIMIT', 'API 额度不足或请求过于频繁，请检查 API 余额与用量限制后重试。');
  return new ModelError(502, 'API_ERROR', `GPT API 请求失败（HTTP ${status}），请稍后重试。`);
}

async function readResponse(response, onProgress) {
  if (!response.body) throw new ModelError(502, 'STREAM_INTERRUPTED', 'GPT 回复连接已中断，平面未修改。');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', completed = null, last = 0;
  function receive(block) {
    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'error' || event.type === 'response.failed') throw new ModelError(502, 'API_ERROR', 'GPT 生成失败，请重试；平面未修改。');
    if (event.type === 'response.incomplete') throw new ModelError(502, 'INCOMPLETE_RESPONSE', 'GPT 回复未完成，请缩小本次需求后重试；平面未修改。');
    if (event.type === 'response.refusal.delta') throw new ModelError(422, 'MODEL_REFUSAL', 'GPT 未能处理这次请求，请调整描述后重试。');
    if (event.type === 'response.output_text.delta') {
      content += event.delta || '';
      if (content.length > 30000) throw new ModelError(502, 'INVALID_MODEL_OUTPUT', 'GPT 回复过长，平面未修改。');
      if (Date.now() - last > 150) { onProgress?.({ phase: 'generating', characters: content.length, preview: replyPreview(content) }); last = Date.now(); }
    }
    if (event.type === 'response.completed') completed = event.response;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) { receive(buffer.slice(0, index)); buffer = buffer.slice(index + 2); }
      if (buffer.length > 262144) throw new ModelError(502, 'INVALID_MODEL_OUTPUT', 'GPT 数据异常，平面未修改。');
    }
    buffer += decoder.decode();
    if (buffer.trim()) receive(buffer);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!completed || completed.status !== 'completed') throw new ModelError(502, 'STREAM_INTERRUPTED', 'GPT 回复尚未完成就中断了，平面未修改。');
  const parts = (completed.output || []).flatMap(item => item.content || []);
  if (parts.some(part => part.type === 'refusal')) throw new ModelError(422, 'MODEL_REFUSAL', 'GPT 未能处理这次请求，请调整描述后重试。');
  const finalText = parts.filter(part => part.type === 'output_text').map(part => part.text).join('') || content;
  if (!finalText || finalText.length > 30000) throw new ModelError(502, 'INVALID_MODEL_OUTPUT', 'GPT 回复内容异常，平面未修改。');
  let output;
  try { output = JSON.parse(finalText); } catch { throw new ModelError(502, 'INVALID_MODEL_OUTPUT', 'GPT 返回格式不完整，请重试；平面未修改。'); }
  return { output, usage: completed.usage };
}

function createOpenAIModel({ fetchImpl = apiFetch, config = readConfig } = {}) {
  const provider = 'openai';
  return {
    provider,
    get model() { return config().model; },
    async status() {
      try {
        const { apiKey, model } = config();
        if (!apiKey) return { ready: false, provider, model, message: '请先双击“配置GPT.cmd”设置 API Key，然后点击重新连接。' };
        const response = await fetchImpl('https://api.openai.com/v1/models/' + encodeURIComponent(model), {
          headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000)
        });
        await response.body?.cancel();
        if (!response.ok) throw apiError(response.status);
        return { ready: true, provider, model, message: 'GPT API 已连接；聊天及所选方案上下文发送至 OpenAI，按 API 用量计费。' };
      } catch (error) { return { ready: false, provider, message: error instanceof ModelError ? error.message : '无法连接 GPT API，请检查网络及配置。' }; }
    },
    async chat(rawInput, { signal, onProgress } = {}) {
      const started = Date.now(), input = prepareInput(rawInput);
      const { apiKey, model } = config();
      if (!apiKey) throw new ModelError(503, 'API_KEY_MISSING', '尚未配置 API Key，请先运行“配置GPT.cmd”。');
      const messages = modelMessages(input);
      const skillRoot = path.join(__dirname, 'skills', 'wishouse-design');
      const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
      const rules = fs.readFileSync(path.join(skillRoot, 'references', 'design-rules.md'), 'utf8');
      const instructions = skill + '\n\n' + rules + '\n\n宿主已提供本次输入上下文和输出 schema。请直接返回符合 schema 的完整结果，不请求读取文件。未提供的历史需求不可虚构。';
      try {
        onProgress?.({ phase: 'preparing', characters: 0, preview: '' });
        const response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ model, instructions, input: messages.slice(1), stream: true, store: false,
            max_output_tokens: 6000, text: { format: { type: 'json_schema', name: 'wishouse_design', strict: true, schema: strictSchema(OUTPUT_SCHEMA) } } })
        });
        if (!response.ok) { await response.body?.cancel(); throw apiError(response.status); }
        const { output, usage } = await readResponse(response, onProgress);
        if (signal?.aborted) throw signal.reason;
        onProgress?.({ phase: 'validating', characters: 0, preview: '' });
        const functionSketches = cleanFunctionSketches(input, output || {});
        return { conversation: mergeOutput(input, output, functionSketches), functionSketches, model, provider, elapsedMs: Date.now() - started,
          timings: { inputTokens: usage?.input_tokens || 0, outputTokens: usage?.output_tokens || 0 } };
      } catch (error) {
        if (signal?.aborted) throw new ModelError(499, 'CANCELLED', '已停止本次回复。');
        if (error instanceof ModelError) throw error;
        throw new ModelError(503, 'API_UNAVAILABLE', 'GPT 连接或回复处理失败，请重试；平面未修改。');
      }
    }
  };
}
module.exports = { createOpenAIModel, readConfig, strictSchema, readResponse };
