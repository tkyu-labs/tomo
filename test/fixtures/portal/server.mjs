// Local stand-in for a school portal (fictional data, structure from the campussquare skill's references/pages.md).
// /login     sign-in form (user name + password) like CampusSquare's; POST marks the session signed in
// /form      one input (first interactive element → @e1); every input event is reported to /echo
// /grades    履修成績照会-style result table (signed-in only; otherwise the login page)
// /set, /check  a persistent cookie, to check that the browser profile keeps it across engine restarts
import { createServer } from 'node:http'

const page = (title, body) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${title}</title></head><body><article>${body}</article></body></html>`
const LOGIN = page('CAMPUSSQUARE', `<h6>ユーザ名（学籍番号）のアルファベットは大文字で入力してください。</h6>
<form method="post" action="/login"><input aria-label="ユーザー名" name="user"><input aria-label="パスワード" name="password" type="password"><button>ログイン</button></form>`)
const GRADES = page('履修成績照会', `<table><tr><th>学生氏名</th><td>Lin Mei</td><th>学籍番号</th><td>23B0001</td></tr></table>
<table><tr><th>No.</th><th>開講年度</th><th>開講区分</th><th>時間割コード</th><th>開講科目名</th><th>教員名 （主担当）</th><th>評価</th><th>評語</th><th>合否</th></tr>
<tr><td>1</td><td>2024</td><td>前学期</td><td>X10001</td><td>情報リテラシー</td><td>山田 太郎</td><td>88</td><td>Ａ</td><td>合</td></tr>
<tr><td>2</td><td>2024</td><td>後学期</td><td>X10002</td><td>日本語Ａ</td><td>佐藤 花子</td><td>N</td><td>認</td><td>合</td></tr></table>
<p>※2026年度前学期終了時点の結果です。</p>`)

export async function startPortal() {
  const echoes = []
  let signedIn = false
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const html = (s) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(s) }
    if (url.pathname === '/login' && req.method === 'POST') { signedIn = true; res.writeHead(302, { location: '/grades' }); return res.end() }
    if (url.pathname === '/login') return html(LOGIN)
    if (url.pathname === '/grades') return html(signedIn ? GRADES : LOGIN)
    if (url.pathname === '/form') return html(page('Form', `<label>学籍番号 <input id="sid" oninput="fetch('/echo?v='+encodeURIComponent(this.value))"></label>`))
    if (url.pathname === '/echo') { echoes.push(url.searchParams.get('v')); res.writeHead(204); return res.end() }
    if (url.pathname === '/set') { res.writeHead(200, { 'set-cookie': 'tomo_test=kept; Max-Age=86400; Path=/', 'content-type': 'text/html' }); return res.end(page('set', 'cookie set')) }
    if (url.pathname === '/check') return html(page('check', `<p id="c">cookie:${(req.headers.cookie ?? '').includes('tomo_test=kept') ? 'kept' : 'missing'}</p>`))
    res.writeHead(404).end()
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    altBase: `http://localhost:${port}`, // same server, different origin (for the origin check)
    echoes,
    signIn: () => { signedIn = true },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }),
  }
}
