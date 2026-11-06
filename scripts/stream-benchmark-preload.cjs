// This fake kernel is installed before the app, including on Vite reloads.
const sessionID = 'benchmark-session'
window.benchDefaultWorkspace = 'E:\\工作空间\\项目 A'
window.benchWorkspace = window.benchDefaultWorkspace
window.benchSources = []
window.api = {
  getWorkspacePath: async () => window.benchWorkspace,
  chooseWorkspacePath: async () => {
    if (window.benchChoiceError) throw new Error('测试选择失败')
    const next = window.benchNextWorkspace ?? null
    window.benchNextWorkspace = null
    if (next) window.benchWorkspace = next
    return next
  },
  getServerInfo: async () => ({ status: 'ready', url: 'http://127.0.0.1:1', port: 1 }),
  onServerStatus: () => () => {},
  window: {
    getState: async () => ({ maximized: false, fullScreen: false }),
    onState: () => () => {},
    minimize() {},
    maximize() {},
    close() {}
  }
}
window.benchSessions = [
  { id: sessionID, title: 'Streaming benchmark', directory: window.benchWorkspace },
  { id: 'other-session', title: 'Other session', directory: window.benchWorkspace },
  { id: 'foreign-session', title: 'Foreign workspace', directory: 'E:\\工作空间\\项目 B' },
  { id: 'nested-session', title: 'Nested workspace', directory: window.benchWorkspace + '\\子目录' }
]
window.benchRequests = []
window.benchMessages = {}
window.benchQuestions = []
window.benchPermissions = []
window.benchClipboard = ''
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
  writeText: async text => { window.benchClipboard = text }
} })
let created = 0
window.fetch = async (url, options) => {
  const requestUrl = new URL(typeof url === 'string' ? url : url.url, 'http://127.0.0.1:1')
  const path = requestUrl.pathname
  const method = options?.method ?? (typeof url === 'string' ? 'GET' : url.method)
  const headers = new Headers(options?.headers ?? (typeof url === 'string' ? undefined : url.headers))
  const directory = requestUrl.searchParams.get('directory') ?? decodeURIComponent(headers.get('x-opencode-directory') ?? '')
  const body = method === 'POST' ? JSON.parse((options?.body ?? (typeof url === 'string' ? '{}' : await url.text())) || '{}') : undefined
  window.benchRequests.push({ method, path, directory, query: Object.fromEntries(requestUrl.searchParams), body })
  if (path === '/session' && method === 'POST') {
    if (window.benchHoldCreate === directory) await new Promise(resolve => { window.benchReleaseCreate = resolve })
    const session = { id: `created-${++created}`, title: body.title ?? `New session - ${new Date().toISOString()}`, directory }
    window.benchSessions.push(session)
    return new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/prompt_async')) return new Response(null, { status: 204 })
  if (path.endsWith('/command') && method === 'POST') {
    const id = path.split('/')[2]
    return new Response(JSON.stringify({ info: { id: 'command-message', sessionID: id, role: 'assistant' }, parts: [] }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/summarize') && method === 'POST') {
    if (window.benchHoldSummarize) await new Promise(resolve => { window.benchReleaseSummarize = resolve })
    return new Response('true', { headers: { 'Content-Type': 'application/json' } })
  }
  if (path === '/question' && method === 'GET') return new Response(JSON.stringify(window.benchQuestions), { headers: { 'Content-Type': 'application/json' } })
  if (path === '/permission' && method === 'GET') return new Response(JSON.stringify(window.benchPermissions), { headers: { 'Content-Type': 'application/json' } })
  if (/^\/permission\/[^/]+\/reply$/.test(path)) {
    if (window.benchPermissionFailure) return new Response(JSON.stringify({ message: '测试授权失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    if (window.benchHoldPermission) await new Promise(resolve => { window.benchReleasePermission = resolve })
    window.benchPermissions = window.benchPermissions.filter(request => request.id !== path.split('/')[2])
    return new Response('true', { headers: { 'Content-Type': 'application/json' } })
  }
  if (/^\/question\/[^/]+\/(reply|reject)$/.test(path)) {
    const id = decodeURIComponent(path.split('/')[2])
    window.benchQuestions = window.benchQuestions.filter(question => question.id !== id)
    return new Response('true', { headers: { 'Content-Type': 'application/json' } })
  }
  if (path.endsWith('/abort')) return new Response('true', { headers: { 'Content-Type': 'application/json' } })
  if (path === '/session/status') return new Response('{}', { headers: { 'Content-Type': 'application/json' } })
  if (/^\/session\/[^/]+\/revert$/.test(path) && method === 'POST') {
    if (window.benchRevertFailure) return new Response(JSON.stringify({ message: '测试撤回失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    const session = window.benchSessions.find(item => item.id === path.split('/')[2])
    session.revert = { messageID: body.messageID }
    return new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json' } })
  }
  if (/^\/session\/[^/]+\/unrevert$/.test(path) && method === 'POST') {
    const session = window.benchSessions.find(item => item.id === path.split('/')[2])
    delete session.revert
    return new Response(JSON.stringify(session), { headers: { 'Content-Type': 'application/json' } })
  }
  if (method === 'DELETE') {
    if (window.benchDeleteFailure) return new Response(JSON.stringify({ message: '测试删除失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    if (window.benchHoldDelete) await new Promise(resolve => { window.benchReleaseDelete = resolve })
    const id = decodeURIComponent(path.split('/').at(-1))
    if (window.benchMissingID === id) return new Response(JSON.stringify({ message: '不存在' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    window.benchSessions = window.benchSessions.filter(session => session.id !== id)
    return new Response('true', { headers: { 'Content-Type': 'application/json' } })
  }
  let data = []
  if (path === '/session') {
    data = (window.benchNextList ?? window.benchSessions).map(session => ({ directory: window.benchDefaultWorkspace, ...session }))
    window.benchNextList = null
    if (window.benchHoldList === directory) await new Promise(resolve => { window.benchReleaseList = resolve })
  }
  else if (/^\/session\/[^/]+$/.test(path) && method === 'GET') {
    data = window.benchSessions.find(session => session.id === path.split('/')[2]) ?? null
  }
  else if (/^\/session\/[^/]+\/message$/.test(path)) {
    if (window.benchMessagesFailure) throw new Error('Cursor cannot be combined with order')
    const id = path.split('/')[2]
    data = window.benchMessages[id] ?? []
    if (window.benchHoldMessages === id) await new Promise(resolve => { window.benchReleaseMessages = resolve })
  }
  else if (path === '/config/providers') data = { providers: [{ id: 'test', name: '测试模型', models: {
    alpha: { name: 'Alpha', limit: { context: 200000, output: 32000 } },
    beta: { name: 'Beta', limit: { context: 128000, output: 16000 } }
  } }] }
  else if (path === '/app/agents') data = [{ name: 'build', mode: 'primary' }, { name: 'plan', mode: 'primary' }]
  else if (path === '/config') data = {}
  else if (path === '/command') data = [
    { name: 'init', description: '分析项目并生成 AGENTS.md', template: '' },
    { name: 'compact', description: '压缩当前会话的上下文', template: '' },
    { name: 'review', description: '审查当前改动', template: '' }
  ]
  else if (path === '/file') data = [
    { name: 'docs', path: 'docs', absolute: 'x', type: 'directory', ignored: false },
    { name: 'src', path: 'src', absolute: 'x', type: 'directory', ignored: false },
    { name: 'README.md', path: 'README.md', absolute: 'x', type: 'file', ignored: false },
    { name: 'package.json', path: 'package.json', absolute: 'x', type: 'file', ignored: false },
    { name: 'node_modules', path: 'node_modules', absolute: 'x', type: 'directory', ignored: true }
  ]
  else if (path === '/find/file') {
    const query = (requestUrl.searchParams.get('query') ?? '').toLowerCase()
    data = ['README.md', 'docs/guide.md', 'src/App.tsx', 'src/main.ts', 'markdown-notes.md', 'src/matrix-download.ts'].filter(item => item.toLowerCase().includes(query))
  }
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}
window.EventSource = class {
  constructor(url) {
    this.url = url; window.benchSources.push(this); window.benchSource = this
    // A real EventSource reports its initial successful handshake, after handlers are registered.
    queueMicrotask(() => { if (!this.closed) this.onopen?.() })
  }
  close() { this.closed = true }
}
window.benchEmit = (type, properties) => {
  // Mirror the real kernel by persisting streamed messages. Without this a
  // post-idle message refetch would replace client state with an empty snapshot
  // and discard anything a test pushed over SSE.
  const sessionID = properties?.sessionID ?? properties?.info?.sessionID ?? properties?.part?.sessionID
  if (sessionID) {
    const list = window.benchMessages[sessionID] ?? (window.benchMessages[sessionID] = [])
    if (type === 'message.updated' && properties?.info?.id) {
      const i = list.findIndex(message => message.info?.id === properties.info.id)
      if (i === -1) list.push({ info: { ...properties.info }, parts: [] })
      else list[i] = { ...list[i], info: { ...list[i].info, ...properties.info } }
    } else if (type === 'message.part.updated' && properties?.part?.messageID) {
      const messageID = properties.part.messageID
      let i = list.findIndex(message => message.info?.id === messageID)
      if (i === -1) { list.push({ info: { id: messageID, sessionID, role: 'assistant' }, parts: [] }); i = list.length - 1 }
      const j = list[i].parts.findIndex(part => part.id === properties.part.id)
      if (j === -1) list[i].parts.push({ ...properties.part })
      else list[i].parts[j] = { ...properties.part }
    } else if (type === 'message.part.delta' && properties?.messageID && properties?.partID && typeof properties.field === 'string') {
      const messageID = properties.messageID
      let i = list.findIndex(message => message.info?.id === messageID)
      if (i === -1) { list.push({ info: { id: messageID, sessionID, role: 'assistant' }, parts: [] }); i = list.length - 1 }
      const j = list[i].parts.findIndex(part => part.id === properties.partID)
      if (j === -1) list[i].parts.push({ id: properties.partID, messageID, sessionID, type: properties.field === 'text' ? 'text' : properties.field, [properties.field]: properties.delta })
      else list[i].parts[j] = { ...list[i].parts[j], [properties.field]: (list[i].parts[j][properties.field] ?? '') + properties.delta }
    } else if (type === 'message.part.removed' && properties?.messageID) {
      const i = list.findIndex(message => message.info?.id === properties.messageID)
      if (i !== -1) list[i] = { ...list[i], parts: list[i].parts.filter(part => part.id !== properties.partID) }
    } else if (type === 'message.removed' && properties?.messageID) {
      const i = list.findIndex(message => message.info?.id === properties.messageID)
      if (i !== -1) list.splice(i, 1)
    }
  }
  window.benchSource.onmessage({ data: JSON.stringify({ type, properties }) })
}
