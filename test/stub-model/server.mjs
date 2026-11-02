// Local OpenAI-compatible stub model for tests and offline development (never shipped).
// - GET  /v1/models                → one model, "stub-model"
// - POST /v1/chat/completions      → streams (SSE) or returns JSON
// Behaviour of a turn:
//   * last message is a tool result        → text "Tool finished: <first 60 chars of the result>"
//   * last user text ends with "TOOL:<name> ARGS:<json>" → that tool call
//   * last user text contains "use a tool" → one tool call (todo_list if offered, else the first tool, args {})
//   * anything else                        → text "Stub answer: <echo of the user text>"
// Every request body is recorded so tests can assert what reached "the model" (e.g. no real identifiers).
import { createServer } from 'node:http'

export async function startStubModel({ port = 0 } = {}) {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      return json(res, { object: 'list', data: [{ id: 'stub-model', object: 'model', owned_by: 'tomo-test', context_length: 128000 }] })
    }
    if (req.method === 'POST' && req.url?.endsWith('/chat/completions')) {
      const payload = JSON.parse(body || '{}')
      requests.push({ url: req.url, headers: req.headers, body: payload, raw: body })
      return complete(res, payload)
    }
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  const { port: actual } = server.address()
  return {
    url: `http://127.0.0.1:${actual}/v1`,
    requests,
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

function complete(res, payload) {
  const d = decide(payload)
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const stub = await startStubModel({ port: Number(process.env.PORT ?? 0) })
  console.log(stub.url)
}
