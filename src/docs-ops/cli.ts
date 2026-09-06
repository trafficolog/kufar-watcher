#!/usr/bin/env node
/**
 * docs-ops CLI — zero-dependency documentation tooling for spec-driven planning.
 * Node built-ins only. Parses frontmatter of docs/phases|epics|tasks, regenerates
 * status rollups (docs/operations/status/*.md) and the autoblocks inside phase/epic
 * files. Project-agnostic: drop into any project as src/docs-ops/cli.ts.
 *
 * Commands:
 *   refresh         rebuild docs/operations/status/*.md and autoblocks in phases/epics
 *   check           validate frontmatter, duplicate IDs, phase/epic parents, depends_on graph
 *   new-session     create a session file from template
 *   new-iteration   create an iteration file from template
 *
 * Run: tsx src/docs-ops/cli.ts <command> [context]
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DOCS = join(process.cwd(), 'docs')
const PHASES = join(DOCS, 'phases')
const EPICS = join(DOCS, 'epics')
const TASKS = join(DOCS, 'tasks')
const STATUS = join(DOCS, 'operations', 'status')
const TEMPLATES = join(DOCS, 'operations', 'templates')

const STATUS_EMOJI: Record<string, string> = {
  todo: '⬜', in_progress: '🔄', done: '✅', blocked: '⛔', cancelled: '🚫',
}
const SYNC_EMOJI: Record<string, string> = { aligned: '🟢', drifted: '🟡' }

interface Doc { file: string; path: string; fm: Record<string, any>; body: string }

function parseFrontmatter(raw: string): { fm: Record<string, any>; body: string } {
  if (!raw.startsWith('---')) return { fm: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { fm: {}, body: raw }
  const block = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\n/, '')
  const fm: Record<string, any> = {}
  let currentKey: string | null = null
  for (const line of block.split('\n')) {
    const li = line.match(/^\s+-\s+(.*)$/)
    if (li && currentKey) { (fm[currentKey] = fm[currentKey] || []).push(li[1].trim()); continue }
    const kv = line.match(/^([\w_]+):\s*(.*)$/)
    if (kv) {
      const [, k, v] = kv
      if (v === '') { fm[k] = []; currentKey = k }
      else if (/^\[.*\]$/.test(v.trim())) {
        // inline YAML array: roles: [BACK, DB] / depends_on: ["1.3.1", "0.3.2"]
        const inner = v.trim().slice(1, -1).trim()
        fm[k] = inner === '' ? [] : inner.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        currentKey = null
      }
      else { fm[k] = v.replace(/^["']|["']$/g, ''); currentKey = null }
    }
  }
  return { fm, body }
}

function readDocs(dir: string): Doc[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('NOTES') && f !== 'README.md')
    .map((f) => {
      const path = join(dir, f)
      const { fm, body } = parseFrontmatter(readFileSync(path, 'utf8'))
      return { file: f, path, fm, body }
    })
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function replaceBlock(content: string, name: string, inner: string): string {
  const begin = `<!-- docs:ops:begin ${name} -->`
  const end = `<!-- docs:ops:end ${name} -->`
  const re = new RegExp(`${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}`)
  return re.test(content) ? content.replace(re, `${begin}\n${inner}\n${end}`) : content
}

function title(d: Doc): string {
  const m = d.body.match(/^#\s+(.+)$/m)
  return m ? m[1].replace(/^Фаза \d+ — |^Эпик [\d.]+ — |^Задача [\d.]+ — /, '') : d.file
}
const se = (s: string) => `${STATUS_EMOJI[s] || ''} ${s}`
const ss = (s: string) => `${SYNC_EMOJI[s] || ''} ${s}`

function cmdRefresh() {
  const phases = readDocs(PHASES), epics = readDocs(EPICS), tasks = readDocs(TASKS)

  for (const p of phases) {
    const pid = String(p.fm.id)
    const kids = epics.filter((e) => String(e.fm.phase) === pid)
    const rows = kids.map((e) =>
      `| \`${e.fm.id}\` | [${title(e)}](../epics/${e.file}) | ${se(e.fm.status)} | ${ss(e.fm.sync_state)} | ${e.fm.status_note || ''} |`).join('\n')
    const done = kids.filter((e) => e.fm.status === 'done').length
    const table = `**Эпиков:** ${kids.length} · **done:** ${done} · **в работе/план:** ${kids.length - done}\n\n` +
      `| ID | Эпик | Статус | Sync | Ист. |\n|----|------|--------|------|------|\n${rows}`
    writeFileSync(p.path, replaceBlock(readFileSync(p.path, 'utf8'), `phase-${pid}-epics`, table))
  }

  for (const e of epics) {
    const eid = String(e.fm.id)
    const kids = tasks.filter((t) => String(t.fm.epic) === eid)
    let table: string
    if (!kids.length) { table = `**Задач:** 0 (карточки ещё не созданы)` }
    else {
      const rows = kids.map((t) =>
        `| \`${t.fm.id}\` | [${title(t)}](../tasks/${t.file}) | ${se(t.fm.status)} | ${ss(t.fm.sync_state)} |`).join('\n')
      const done = kids.filter((t) => t.fm.status === 'done').length
      table = `**Задач:** ${kids.length} · **done:** ${done}\n\n` +
        `| ID | Задача | Статус | Sync |\n|----|--------|--------|------|\n${rows}`
    }
    writeFileSync(e.path, replaceBlock(readFileSync(e.path, 'utf8'), `epic-${eid}-tasks`, table))
  }

  writeStatusRollups(phases, epics, tasks)
  console.log(`refresh: phases=${phases.length} epics=${epics.length} tasks=${tasks.length} — обновлено`)
}

function writeStatusRollups(phases: Doc[], epics: Doc[], tasks: Doc[]) {
  const stamp = new Date().toISOString().slice(0, 10)
  const head = (t: string) =>
    `<!-- AUTO-GENERATED — не править вручную. Регенерация: npm run docs:ops:refresh -->\n\n# ${t}\n\n_Сгенерировано ${stamp}_\n\n`

  writeFileSync(join(STATUS, 'phases.md'), head('Rollup: фазы') +
    '| Фаза | Название | Статус | Sync |\n|------|----------|--------|------|\n' +
    phases.map((p) => `| \`${p.fm.id}\` | ${title(p)} | ${se(p.fm.status)} | ${ss(p.fm.sync_state)} |`).join('\n') + '\n')

  writeFileSync(join(STATUS, 'epics.md'), head('Rollup: эпики') +
    '| ID | Эпик | Фаза | Статус | Sync | Ист. |\n|----|------|------|--------|------|------|\n' +
    epics.map((e) => `| \`${e.fm.id}\` | ${title(e)} | ${e.fm.phase} | ${se(e.fm.status)} | ${ss(e.fm.sync_state)} | ${e.fm.status_note || ''} |`).join('\n') + '\n')

  writeFileSync(join(STATUS, 'tasks.md'), head('Rollup: задачи') +
    (tasks.length === 0 ? 'Карточки задач ещё не созданы.\n' :
      '| ID | Задача | Эпик | Статус | Sync |\n|----|--------|------|--------|------|\n' +
      tasks.map((t) => `| \`${t.fm.id}\` | ${title(t)} | ${t.fm.epic} | ${se(t.fm.status)} | ${ss(t.fm.sync_state)} |`).join('\n') + '\n'))

  const drifted = [...phases, ...epics, ...tasks].filter((d) => d.fm.sync_state === 'drifted')
  writeFileSync(join(STATUS, 'drift-report.md'), head('Drift-report') +
    '`sync_state: drifted` = карточка опережает реализацию. Это не ошибка.\n\n' +
    drifted.map((d) => `- \`${d.fm.id}\` ${title(d)} — ${d.fm.status_note || ''}`).join('\n') + '\n')

  const doneE = epics.filter((e) => e.fm.status === 'done').length
  writeFileSync(join(STATUS, 'current-state.md'), head('Текущее состояние') +
    `## Сводка\n\n- Фаз: ${phases.length}\n- Эпиков: ${epics.length} (done: ${doneE})\n- Задач: ${tasks.length}\n`)
}

function cmdCheck() {
  const phases = readDocs(PHASES), epics = readDocs(EPICS), tasks = readDocs(TASKS)
  const errors: string[] = []
  const REQUIRED = ['id', 'status', 'sync_state', 'last_reviewed']
  const VS = ['todo', 'in_progress', 'done', 'blocked', 'cancelled']
  const VSY = ['aligned', 'drifted']
  const ids = new Set<string>()
  for (const d of [...phases, ...epics, ...tasks]) {
    for (const f of REQUIRED) if (!(f in d.fm)) errors.push(`${d.file}: нет frontmatter '${f}'`)
    if (d.fm.status && !VS.includes(d.fm.status)) errors.push(`${d.file}: неверный status '${d.fm.status}'`)
    if (d.fm.sync_state && !VSY.includes(d.fm.sync_state)) errors.push(`${d.file}: неверный sync_state '${d.fm.sync_state}'`)
    const id = String(d.fm.id)
    if (ids.has(id)) errors.push(`${d.file}: дубликат id '${id}'`)
    ids.add(id)
  }
  const phaseIds = new Set(phases.map((p) => String(p.fm.id)))
  for (const e of epics) if (!phaseIds.has(String(e.fm.phase))) errors.push(`${e.file}: phase '${e.fm.phase}' не найдена`)
  const epicIds = new Set(epics.map((e) => String(e.fm.id)))
  for (const t of tasks) if (!epicIds.has(String(t.fm.epic))) errors.push(`${t.file}: epic '${t.fm.epic}' не найден`)

  // граф зависимостей: существование, отсутствие самоссылок и циклов
  const taskIds = new Set(tasks.map((t) => String(t.fm.id)))
  const graph = new Map<string, string[]>()
  for (const t of tasks) {
    const id = String(t.fm.id)
    const deps = Array.isArray(t.fm.depends_on) ? t.fm.depends_on.map(String) : []
    if (t.fm.depends_on !== undefined && !Array.isArray(t.fm.depends_on))
      errors.push(`${t.file}: depends_on должен быть списком, получено '${t.fm.depends_on}'`)
    for (const d of deps) {
      if (d === id) errors.push(`${t.file}: задача зависит сама от себя`)
      else if (!taskIds.has(d)) errors.push(`${t.file}: depends_on '${d}' — такой задачи нет`)
    }
    graph.set(id, deps.filter((d) => taskIds.has(d) && d !== id))
  }
  const WHITE = 0, GREY = 1, BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []
  const visit = (id: string) => {
    if (color.get(id) === BLACK) return
    if (color.get(id) === GREY) {
      const at = stack.indexOf(id)
      errors.push(`цикл зависимостей: ${[...stack.slice(at), id].join(' → ')}`)
      return
    }
    color.set(id, GREY); stack.push(id)
    for (const d of graph.get(id) || []) visit(d)
    stack.pop(); color.set(id, BLACK)
  }
  for (const id of graph.keys()) visit(id)

  if (errors.length) { console.error(`check: ${errors.length} проблем\n` + errors.map((e) => '  ✗ ' + e).join('\n')); process.exit(1) }
  console.log(`check: OK — phases=${phases.length} epics=${epics.length} tasks=${tasks.length}`)
}

const pad = (n: number) => String(n).padStart(3, '0')
function cmdNewSession(ctx: string) {
  const stamp = new Date().toISOString().slice(0, 10)
  const dir = join(DOCS, 'operations', 'sessions', stamp.slice(0, 4))
  mkdirSync(dir, { recursive: true })
  const tpl = readFileSync(join(TEMPLATES, 'session.md'), 'utf8')
  const out = join(dir, `${stamp}-${ctx || 'session'}.md`)
  writeFileSync(out, tpl.replace(/{{date}}/g, stamp).replace(/{{context}}/g, ctx || ''))
  console.log('создано: ' + out)
}
function cmdNewIteration(ctx: string) {
  const stamp = new Date().toISOString().slice(0, 10)
  const dir = join(DOCS, 'operations', 'iterations', stamp.slice(0, 4))
  const existing = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(stamp)) : []
  const seq = pad(existing.length + 1)
  mkdirSync(dir, { recursive: true })
  const tpl = readFileSync(join(TEMPLATES, 'iteration.md'), 'utf8')
  const out = join(dir, `${stamp}-${seq}-${ctx || 'iteration'}.md`)
  writeFileSync(out, tpl.replace(/{{date}}/g, stamp).replace(/{{seq}}/g, seq).replace(/{{context}}/g, ctx || ''))
  console.log('создано: ' + out)
}

const [cmd, arg] = process.argv.slice(2)
switch (cmd) {
  case 'refresh': cmdRefresh(); break
  case 'check': cmdCheck(); break
  case 'new-session': cmdNewSession(arg); break
  case 'new-iteration': cmdNewIteration(arg); break
  default:
    console.log('Использование: tsx src/docs-ops/cli.ts <refresh|check|new-session|new-iteration> [context]')
    process.exit(cmd ? 1 : 0)
}
