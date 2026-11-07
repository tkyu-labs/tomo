// Local OpenAI-compatible stub model for tests and offline development (never shipped).
// - GET  /v1/models                → one model, "stub-model"
// - POST /v1/chat/completions      → streams (SSE) or returns JSON
// Behaviour of a turn:
//   * last message is a tool result        → text "Tool finished: <first 60 chars of the result>"
//   * last user text ends with "TOOL:<name> ARGS:<json>" → that tool call
//   * last user text contains "use a tool" → one tool call (todo_list if offered, else the first tool, args {})
//   * anything else                        → text "Stub answer: <echo of the user text>"
// Every request body is recorded so tests can assert what reached "the model" (e.g. no real identifiers).
// failStatus (e.g. 429): every chat / responses request fails with that status (a provider that can't answer).
import { createServer } from 'node:http'

export async function startStubModel({ port = 0, failStatus = 0 } = {}) {
  const requests = []
  // Optional scripted turn plan for main requests (requests that offer tools): each entry is
  // { tool, args } or { text }; consumed one per request. Title / auxiliary calls never consume it.
  const script = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    // the key "sk-empty" plays a GakuenAI key with no balance left (the relay's real answer)
    if (req.method === 'GET' && req.url?.endsWith('/models') && req.headers.authorization === 'Bearer sk-empty') {
      res.writeHead(403, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ code: 'INSUFFICIENT_BALANCE', message: 'Insufficient account balance' }))
    }
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      return json(res, { object: 'list', data: [{ id: 'stub-model', object: 'model', owned_by: 'tomo-test', context_length: 128000 }] })
    }
    if (failStatus && req.method === 'POST' && (req.url?.endsWith('/responses') || req.url?.endsWith('/chat/completions'))) {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}'), raw: body })
      res.writeHead(failStatus, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: 'stub: this provider cannot answer now', type: failStatus === 429 ? 'rate_limit_error' : 'api_error', code: failStatus } }))
    }
    if (req.method === 'POST' && req.url?.endsWith('/responses')) {
      const payload = JSON.parse(body || '{}')
      requests.push({ url: req.url, headers: req.headers, body: payload, raw: body })
      return respond(res, payload)
    }
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      const payload = JSON.parse(body || '{}')
      requests.push({ url: req.url, headers: req.headers, body: payload, raw: body })
      if (script.length && (payload.tools ?? []).length) {
        const step = script.shift()
        return complete(res, payload, step.tool ? { tool: { name: step.tool, args: step.args ?? {} } } : { text: step.text })
      }
      return complete(res, payload)
    }
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const { port: actual } = server.address()
  return {
    url: `http://127.0.0.1:${actual}/v1`,
    requests,
    script,
    close: () => new Promise((r) => server.close(r)),
  }
}

function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((p) => p?.text ?? '').join('')
  return ''
}

function decide(payload) {
  const messages = payload.messages ?? []
  const last = messages[messages.length - 1] ?? {}
  if (last.role === 'tool') return { text: `Tool finished: ${textOf(last.content).slice(0, 60)}`, toolResult: textOf(last.content) }
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const userText = textOf(lastUser?.content)
  const tools = payload.tools ?? []
  // Explicit directive for tests: "TOOL:<name> ARGS:<json>" calls exactly that tool with those arguments.
  const directive = userText.match(/TOOL:(\S+)\s+ARGS:(\{[^\n]*\})/)
  if (directive) return { tool: { name: directive[1], args: JSON.parse(directive[2]) } }
  if (/use a tool/i.test(userText) && tools.length) {
    const tool = tools.find((t) => t.function?.name === 'todo_list') ?? tools[0]
    return { tool: { name: tool.function.name, args: {} } }
  }
  return { text: `Stub answer: ${userText.slice(0, 200)}` }
}

function complete(res, payload, forced) {
  const d = forced ?? decide(payload)
  const id = 'chatcmpl-stub-' + Math.random().toString(16).slice(2)
  const created = Math.floor(Date.now() / 1000)
  const model = payload.model ?? 'stub-model'
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  if (!payload.stream) {
    const message = d.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: d.tool.name, arguments: JSON.stringify(d.tool.args) } }] }
      : { role: 'assistant', content: d.text }
    return json(res, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: d.tool ? 'tool_calls' : 'stop' }], usage })
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const send = (delta, finish = null, extra = {}) =>
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`)
  if (d.tool) {
    send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: d.tool.name, arguments: '' } }] })
    send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(d.tool.args) } }] })
    send({}, 'tool_calls')
  } else {
    send({ role: 'assistant', content: '' })
    // split into a few chunks so streaming is exercised
    const parts = d.text.match(/.{1,8}/gs) ?? ['']
    for (const p of parts) send({ content: p })
    send({}, 'stop')
  }
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage })}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

// OpenAI Responses API (text only), enough for a turn through Hermes' codex_responses transport.
function respond(res, payload) {
  const input = Array.isArray(payload.input) ? payload.input : [{ role: 'user', content: String(payload.input ?? '') }]
  const lastUser = [...input].reverse().find((m) => m.role === 'user')
  const userText = Array.isArray(lastUser?.content) ? lastUser.content.map((c) => c.text ?? '').join('') : String(lastUser?.content ?? '')
  const text = `Stub answer: ${userText.slice(0, 200)}`
  const id = 'resp_stub_' + Math.random().toString(16).slice(2)
  const msg = { id: 'msg_' + id, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
  const response = (status, output) => ({ id, object: 'response', created_at: Math.floor(Date.now() / 1000), status, model: payload.model ?? 'stub-model', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } })
  if (!payload.stream) return json(res, response('completed', [msg]))
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  let seq = 0
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`)
  ev('response.created', { response: response('in_progress', []) })
  ev('response.output_item.added', { output_index: 0, item: { ...msg, status: 'in_progress', content: [] } })
  ev('response.content_part.added', { output_index: 0, item_id: msg.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } })
  for (const part of text.match(/.{1,8}/gs) ?? []) ev('response.output_text.delta', { output_index: 0, item_id: msg.id, content_index: 0, delta: part })
  ev('response.output_text.done', { output_index: 0, item_id: msg.id, content_index: 0, text })
  ev('response.output_item.done', { output_index: 0, item: msg })
  ev('response.completed', { response: response('completed', [msg]) })
  res.end()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startStubModel({ port: Number(process.env.PORT ?? 0) })
  console.log(stub.url)
}
