// Pure parts: the scripts that list listening processes, and reading them back.

import type { Server } from '../types'

const DEV_NAMES = '^(node|python|python3|pythonw|py|deno|bun|java|php|ruby|dotnet|go|uvicorn|hugo|caddy|esbuild|air)(\\.exe)?$'

/** One PowerShell run: every dev runtime holding a listening TCP port, with its ancestry. */
export const WINDOWS_SCAN = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
  // netstat is ~50ms; Get-NetTCPConnection costs seconds loading its module cold.
  '$ports=@{}',
  "foreach($l in @(netstat -ano -p TCP) + @(netstat -ano -p TCPv6)){ if($l -match '^\\s*TCP\\s+\\S+:(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)'){ $o=[int]$matches[2]; if(-not $ports.ContainsKey($o)){ $ports[$o]=@() }; $ports[$o]+=[int]$matches[1] } }",
  '$all=Get-CimInstance Win32_Process -Property ProcessId,Name,CommandLine,ParentProcessId',
  '$by=@{}; foreach($x in $all){$by[[int]$x.ProcessId]=$x}',
  '$out=foreach($i in $ports.Keys){',
  '  $x=$by[[int]$i]',
  `  if($x -and $x.Name -match '${DEV_NAMES}'){`,
  '    $chain=@(); $p=[int]$x.ParentProcessId',
  '    for($k=0; $k -lt 6 -and $by.ContainsKey($p); $k++){ $chain+=$p; $p=[int]$by[$p].ParentProcessId }',
  '    $pp=$by[[int]$x.ParentProcessId]',
  '    [pscustomobject]@{pid=$i; ports=@($ports[$i] | Sort-Object -Unique); name=$x.Name; cmd=$x.CommandLine; ppid=[int]$x.ParentProcessId; pname=$pp.Name; chain=$chain}',
  '  }',
  '}',
  'ConvertTo-Json @($out) -Compress -Depth 3',
].join('\n')

export type Scanned = Server & { chain: number[] }

export function parseWindows(stdout: string): Scanned[] {
  const text = stdout.trim()

  if (text === '') {
    return []
  }

  let rows: unknown

  try {
    rows = JSON.parse(text)
  } catch {
    return []
  }

  const list = Array.isArray(rows) ? rows : [rows]

  return list
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map(r => ({
      pid: Number(r.pid),
      ports: (Array.isArray(r.ports) ? r.ports : [r.ports]).map(Number).filter(p => p > 0),
      name: String(r.name ?? '').replace(/\.exe$/i, ''),
      command: String(r.cmd ?? ''),
      parentPid: r.ppid === undefined ? undefined : Number(r.ppid),
      parentName: r.pname ? String(r.pname) : undefined,
      chain: (Array.isArray(r.chain) ? r.chain : r.chain === undefined || r.chain === null ? [] : [r.chain]).map(Number),
    }))
    .filter(s => s.ports.length > 0)
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` → pid, command name and ports. */
export function parseLsof(stdout: string): Map<number, { name: string; ports: number[] }> {
  const byPid = new Map<number, { name: string; ports: number[] }>()
  let pid = 0

  for (const line of stdout.split('\n')) {
    const tag = line[0]
    const value = line.slice(1)

    if (tag === 'p') {
      pid = Number(value)
      byPid.set(pid, byPid.get(pid) ?? { name: '', ports: [] })
    } else if (tag === 'c' && byPid.has(pid)) {
      byPid.get(pid)!.name = value
    } else if (tag === 'n' && byPid.has(pid)) {
      const port = Number(/:(\d+)$/.exec(value)?.[1])

      if (port > 0 && !byPid.get(pid)!.ports.includes(port)) {
        byPid.get(pid)!.ports.push(port)
      }
    }
  }

  return byPid
}

export function isDevRuntime(name: string): boolean {
  return new RegExp(DEV_NAMES, 'i').test(name)
}

export function normPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Which known project a command line runs inside, by its path appearing there. */
export function projectOf(command: string, projects: readonly string[]): string | undefined {
  const cmd = normPath(command)
  // Longest first, so D:/x/frontend wins over D:/x.
  const sorted = [...projects].sort((a, b) => b.length - a.length)

  return sorted.find(p => cmd.includes(`${normPath(p)}/`))
}

/** A short, readable form of a long command line: `node next dev`, `python uvicorn main:app`. */
export function shortCommand(command: string): string {
  const trimmed = command.trim()
  // The executable: a quoted path (spaces allowed) or the first word, by its file name.
  const exe = trimmed.startsWith('"') ? trimmed.slice(1, trimmed.indexOf('"', 1)) : trimmed.split(/\s+/)[0] ?? ''
  const runtime = (exe.split(/[\\/]/).pop() ?? exe).replace(/\.exe$/i, '')
  // The package a node_modules script belongs to (`next`, `vite`, `@remotion/cli`).
  const pkgs = [...trimmed.matchAll(/node_modules[\\/](?:\.bin[\\/]\.\.[\\/])?(@[^\\/\s"]+[\\/][^\\/\s"]+|[^\\/\s"]+)/gi)]
  const pkg = pkgs.length > 0 ? pkgs[pkgs.length - 1]![1]!.replace(/\\/g, '/') : undefined
  // Whatever follows the script file: the subcommand and flags.
  const after = /\.(?:m?js|cjs|ts|py)"?\s+(.*)$/i.exec(trimmed)?.[1]?.trim() ?? ''
  const script = /([\w.-]+\.(?:m?js|cjs|ts|py))"?(?:\s|$)/i.exec(trimmed)?.[1]

  if (pkg) {
    return [runtime, pkg, after].filter(Boolean).join(' ')
  }

  if (/^(python\d*|pythonw|py)$/i.test(runtime) && / -m \S/.test(trimmed)) {
    return `${runtime} ${/ -m (.*)$/.exec(trimmed)![1]}`
  }

  if (script) {
    return [runtime, script, after].filter(Boolean).join(' ')
  }

  return trimmed.replace(/\s+/g, ' ')
}

export function projectLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? path
  const parent = parts[parts.length - 2]

  return /^(frontend|backend|web|app|api|server|client)$/i.test(last) && parent ? `${parent}/${last}` : last
}

export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`
}
