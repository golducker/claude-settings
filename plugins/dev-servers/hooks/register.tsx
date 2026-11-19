import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProjectRow, Server } from '../types'
import { WINDOWS_SCAN, isDevRuntime, normPath, parseLsof, parseWindows, projectLabel, projectOf, psQuote, shortCommand, truncate } from './scan'
import { C, headerSvg, serverSvg } from './art'

const PANE = 'dev-servers'
const STORE_PROJECTS = 'projects'
const STORE_LAUNCHED = 'launched'

// The person's own projects, offered until they remove them; ones that do not exist are skipped.
const SEEDS: string[] = [
  // add your own project folders here, e.g. 'D:\my-app'
]

const servers = atom({ plugin: 'dev-servers', key: 'servers' } as const, [] as Server[])
const projects = atom({ plugin: 'dev-servers', key: 'projects' } as const, [] as ProjectRow[])
const scannedAt = atom({ plugin: 'dev-servers', key: 'scannedAt' } as const, 0)
const pending = atom({ plugin: 'dev-servers', key: 'pending' } as const, [] as string[])

let isWindows = true
let isPaneOpen = false
let isScanning = false

type Launched = Record<string, string> // launcher pid → project path

async function launched($: EngineInterface): Promise<Launched> {
  const value = await $.store.get(STORE_LAUNCHED)

  return value && typeof value === 'object' ? (value as Launched) : {}
}

async function storedPaths($: EngineInterface): Promise<string[]> {
  const value = await $.store.get(STORE_PROJECTS)

  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : SEEDS
}

/** What Start should run in a folder: its dev script, or uvicorn for a FastAPI app. */
async function startCommand($: EngineInterface, dir: string): Promise<string | null> {
  if (await $.fs.exists(`${dir}/package.json`)) {
    try {
      const pkg = JSON.parse(String(await $.fs.read(`${dir}/package.json`))) as { scripts?: Record<string, string> }
      const scripts = pkg.scripts ?? {}

      for (const name of ['dev', 'start', 'studio', 'serve', 'preview']) {
        if (typeof scripts[name] === 'string') {
          return name === 'start' ? 'npm start' : `npm run ${name}`
        }
      }
    } catch {
      return null
    }
  }

  if (await $.fs.exists(`${dir}/main.py`)) {
    const main = String(await $.fs.read(`${dir}/main.py`))

    if (/FastAPI\s*\(/.test(main)) {
      for (const venv of ['.venv', 'venv']) {
        const py = isWindows ? `${dir}\\${venv}\\Scripts\\python.exe` : `${dir}/${venv}/bin/python`

        if (await $.fs.exists(py)) {
          return `"${py}" -m uvicorn main:app --reload --port 8000`
        }
      }

      return 'python -m uvicorn main:app --reload --port 8000'
    }
  }

  return null
}

async function loadProjects($: EngineInterface): Promise<void> {
  const paths = await storedPaths($)
  const rows: ProjectRow[] = []

  for (const path of paths) {
    if (await $.fs.exists(path)) {
      rows.push({ path, name: projectLabel(path), command: await startCommand($, path) })
    }
  }

  await update($, projects, () => rows)
}

async function scan($: EngineInterface): Promise<void> {
  if (isScanning) {
    return
  }

  isScanning = true

  try {
    const [rows, launchedBy] = await Promise.all([read($, projects), launched($)])
    const paths = rows.map(r => r.path)
    let found: Server[] = []

    if (isWindows) {
      const { stdout } = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCAN], { timeoutMs: 20_000 })
      found = parseWindows(stdout).map(s => {
        const viaLaunch = s.chain.map(p => launchedBy[String(p)]).find(Boolean)
        const { chain, ...server } = s
        void chain

        return { ...server, project: viaLaunch ?? projectOf(s.command, paths) }
      })
    } else {
      const lsof = await $.process.run(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'], { timeoutMs: 10_000 })
      const byPid = parseLsof(lsof.stdout)
      const pids = [...byPid.keys()].filter(p => isDevRuntime(byPid.get(p)!.name))

      if (pids.length > 0) {
        const ps = await $.process.run(['ps', '-o', 'pid=,ppid=,command=', '-p', pids.join(',')], { timeoutMs: 10_000 })

        for (const line of ps.stdout.split('\n')) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)

          if (!m) continue

          const pid = Number(m[1])
          const info = byPid.get(pid)

          if (!info) continue

          const command = m[3] ?? ''
          found.push({ pid, ports: info.ports, name: info.name, command, parentPid: Number(m[2]), project: projectOf(command, paths) })
        }
      }
    }

    found.sort((a, b) => (a.ports[0] ?? 0) - (b.ports[0] ?? 0))
    await update($, servers, () => found)
    await update($, scannedAt, () => Date.now())

    // A start is done once its project shows up listening.
    const live = new Set(found.map(s => s.project).filter(Boolean))
    await update($, pending, list => list.filter(p => !live.has(p)))
  } catch (error) {
    $.ui.log(`dev-servers: scan failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isScanning = false
  }
}

async function start($: EngineInterface, row: ProjectRow): Promise<void> {
  if (!row.command) {
    return
  }

  await update($, pending, list => [...new Set([...list, row.path])])

  try {
    if (isWindows) {
      const title = `dev · ${row.name}`.replace(/[&|<>^"]/g, '')
      const script =
        `$p = Start-Process cmd -WindowStyle Minimized -PassThru -WorkingDirectory ${psQuote(row.path)} ` +
        `-ArgumentList '/k', ${psQuote(`title ${title} && ${row.command}`)}; $p.Id`
      const { stdout, exitCode, stderr } = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 20_000 })

      if (exitCode !== 0) {
        throw new Error(stderr.trim() || `exit ${exitCode}`)
      }

      const pid = stdout.trim()
      const map = await launched($)
      await $.store.set(STORE_LAUNCHED, { ...map, [pid]: row.path })
    } else {
      const log = `/tmp/dev-${row.name.replace(/[^\w-]/g, '_')}.log`
      await $.process.run(['sh', '-c', `cd ${JSON.stringify(row.path)} && nohup ${row.command} > ${log} 2>&1 &`], { timeoutMs: 10_000 })
    }

    $.ui.toast(`Starting ${row.name}: ${row.command}`)
  } catch (error) {
    await update($, pending, list => list.filter(p => p !== row.path))
    $.ui.toast(`Couldn't start ${row.name}: ${String(error).slice(0, 120)}`)

    return
  }

  // Look again as it boots; Next and Vite take a few seconds.
  for (const ms of [2500, 6000, 12000, 25000]) {
    $.clock.after(ms, () => void scan($))
  }

  $.clock.after(40_000, () => void update($, pending, list => list.filter(p => p !== row.path)))
}

async function stop($: EngineInterface, server: Server): Promise<void> {
  const key = `pid:${server.pid}`
  await update($, pending, list => [...list, key])

  try {
    if (isWindows) {
      // A server we started dies with its window; one started elsewhere loses only the server.
      const launchedBy = await launched($)
      const scanned = await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCAN], { timeoutMs: 20_000 })
      const chain = parseWindows(scanned.stdout).find(s => s.pid === server.pid)?.chain ?? []
      const root = chain.find(p => launchedBy[String(p)] !== undefined) ?? server.pid
      await $.process.run(['taskkill', '/PID', String(root), '/T', '/F'], { timeoutMs: 15_000 })

      if (root !== server.pid) {
        const { [String(root)]: _gone, ...rest } = launchedBy
        void _gone
        await $.store.set(STORE_LAUNCHED, rest)
      }
    } else {
      await $.process.run(['kill', String(server.pid)], { timeoutMs: 5000 })
    }

    $.ui.toast(`Stopped ${server.project ? projectLabel(server.project) : server.name} on :${server.ports.join(', :')}`)
  } catch (error) {
    $.ui.toast(`Couldn't stop pid ${server.pid}: ${String(error).slice(0, 120)}`)
  }

  await update($, pending, list => list.filter(p => p !== key))
  await scan($)
}

async function openBrowser($: EngineInterface, port: number): Promise<void> {
  const url = `http://localhost:${port}`

  if (isWindows) {
    await $.process.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', `Start-Process ${psQuote(url)}`], { timeoutMs: 10_000 })
  } else {
    await $.process.run(['sh', '-c', `(command -v open >/dev/null && open ${url}) || xdg-open ${url}`], { timeoutMs: 10_000 })
  }
}

async function openPane($: EngineInterface): Promise<void> {
  isPaneOpen = true
  await $.ui.open({ id: PANE, title: 'Dev servers' })
  await loadProjects($)
  await scan($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    isWindows = /^[A-Za-z]:[\\/]/.test(e.cwd) || e.cwd.startsWith('\\\\')
    await $.command.register({
      name: 'dev',
      description: 'dev-servers: open the Dev servers panel, or `add` / `remove` a project folder',
      argumentHint: '[add [path] | remove <path>]',
    })

    // Refresh while the panel is open; one PowerShell run every few seconds is cheap.
    $.clock.every(8000, () => {
      if (isPaneOpen) {
        void scan($)
      }
    })

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if ((e as { id?: string }).id === PANE) {
      isPaneOpen = false
    }

    return next(e)
  })

  on('command.run', { command: 'dev' }, async ($, e) => {
    const args = e.args.trim()
    const [verb = '', ...rest] = args.split(/\s+/)
    const target = rest.join(' ').replace(/^["']|["']$/g, '') || (await $.session.cwd())
    const paths = await storedPaths($)

    if (verb === 'add') {
      if (!(await $.fs.exists(target))) {
        return { text: `No folder at ${target}.` }
      }

      if (!paths.some(p => normPath(p) === normPath(target))) {
        await $.store.set(STORE_PROJECTS, [...paths, target])
      }

      await openPane($)

      return { text: `Added **${projectLabel(target)}** to Dev servers.` }
    }

    if (verb === 'remove') {
      await $.store.set(STORE_PROJECTS, paths.filter(p => normPath(p) !== normPath(target)))
      await loadProjects($)

      return { text: `Removed ${projectLabel(target)} from Dev servers.` }
    }

    await openPane($)

    return { text: 'Dev servers panel opened.' }
  })

  // Catppuccin: desktop draws a header and one animated card per server
  // (art.ts); the terminal gets the same table in coloured text. Actions are
  // solid chips so they read as buttons on any background.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [list, rows, when, busy] = await Promise.all([read($, servers), read($, projects), read($, scannedAt), read($, pending)])
    const now = await $.clock.now()
    const cols = Math.max(30, e.props.bodyColumns)
    const runningPaths = new Map<string, Server>()

    for (const s of list) {
      if (s.project) runningPaths.set(normPath(s.project), s)
    }

    const secs = Math.max(0, Math.round((now - when) / 1000))
    const ago = when === 0 ? 'Looking…' : secs < 3 ? 'Updated just now' : `Updated ${secs}s ago`
    const chip = (label: string, bg: string) => <Text backgroundColor={bg} color={C.crust} bold>{` ${label} `}</Text>

    const actions = (s: Server, isStopping: boolean) => (
      <Box flexDirection="row" gap={2}>
        <Button key={`open-${s.pid}-${s.ports[0]}`} plain onPress={() => openBrowser($, s.ports[0]!)}>{chip('Open ›', C.blue)}</Button>
        <Button key={`stop-${s.pid}`} plain onPress={() => stop($, s)}>{chip(isStopping ? 'Stopping…' : 'Stop', isStopping ? C.yellow : C.red)}</Button>
      </Box>
    )

    const projectRows = (
      <Box flexDirection="column">
        <Text color={C.mauve} bold>PROJECTS</Text>
        {rows.length === 0 && <Text dimColor>No projects yet. Run /dev add in a project folder.</Text>}
        {rows.map((r, i) => {
          const live = runningPaths.get(normPath(r.path))
          const isStarting = busy.includes(r.path) && !live

          return (
            <Box key={`p-${r.path}`} flexDirection="row" justifyContent="space-between" marginTop={i > 0 ? 1 : 0}>
              <Box flexDirection="column" flexShrink={1}>
                <Text bold={live !== undefined} color={live ? C.green : undefined} dimColor={!r.command} wrap="truncate-end">{truncate(r.name, cols - 14)}</Text>
                <Text dimColor wrap="truncate-end" size="footnote">{r.command ?? 'No dev script found'}</Text>
              </Box>
              {live ? (
                chip(`● :${live.ports[0]}`, C.green)
              ) : isStarting ? (
                chip('Starting…', C.yellow)
              ) : r.command ? (
                <Button key={`start-${r.path}`} plain onPress={() => start($, r)}>{chip('Start ›', C.mauve)}</Button>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )

    const footer = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor size="footnote">{'/dev add · /dev remove <path>'}</Text>
        <Button key="refresh" plain dimColor onPress={() => scan($)}>Refresh</Button>
      </Box>
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      const width = Math.round(cols * 7.6)

      return (
        <Box flexDirection="column" gap={1} width={cols}>
          <Svg source={headerSvg({ width, now, running: list.length, ports: list.map(s => s.ports[0]!), ago })} alt={`${list.length} dev servers running`} />
          {list.map(s => {
            const isStopping = busy.includes(`pid:${s.pid}`)

            return (
              <Box key={`s-${s.pid}`} flexDirection="column">
                <Svg
                  source={serverSvg({
                    width, now, port: s.ports[0]!, extraPorts: s.ports.slice(1), pid: s.pid, isStopping,
                    name: s.project ? projectLabel(s.project) : s.name,
                    command: shortCommand(s.command) || s.name,
                  })}
                  alt={`${s.project ? projectLabel(s.project) : s.name} on port ${s.ports[0]}`}
                />
                <Box flexDirection="row" justifyContent="flex-end">{actions(s, isStopping)}</Box>
              </Box>
            )
          })}
          {projectRows}
          {footer}
        </Box>
      )
    }

    const rule = '─'.repeat(cols)
    const gutter = 9

    return (
      <Box flexDirection="column" width={cols}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text color={list.length > 0 ? C.green : C.overlay}>● </Text>
            <Text bold>{list.length > 0 ? `${list.length} running` : 'Nothing running'}</Text>
            {cols >= 42 && <Text dimColor>{`   ${ago}`}</Text>}
          </Text>
          <Button key="refresh" plain dimColor onPress={() => scan($)}>Refresh</Button>
        </Box>

        {list.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={C.green} bold>RUNNING</Text>
            {list.map((s, i) => {
              const isStopping = busy.includes(`pid:${s.pid}`)
              const label = s.project ? projectLabel(s.project) : s.name

              return (
                <Box key={`s-${s.pid}`} flexDirection="column">
                  {i > 0 && <Text color={C.surface1}>{rule}</Text>}
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text wrap="truncate-end">
                      {chip(`:${s.ports[0]}`, isStopping ? C.yellow : C.green)}
                      <Text bold>{`  ${truncate(label, cols - gutter - String(s.pid).length - 8)}`}</Text>
                    </Text>
                    <Text dimColor>{`pid ${s.pid}`}</Text>
                  </Box>
                  <Text dimColor wrap="truncate-end">{`${' '.repeat(gutter)}${truncate(shortCommand(s.command) || s.name, cols - gutter)}`}</Text>
                  <Box flexDirection="row">
                    <Text>{' '.repeat(gutter)}</Text>
                    {actions(s, isStopping)}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}

        <Box marginTop={1}>{projectRows}</Box>
        <Box marginTop={1}>
          <Text dimColor>{'/dev add · /dev remove <path>'}</Text>
        </Box>
      </Box>
    )
  })
}
