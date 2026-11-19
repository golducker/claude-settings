// Pure helpers: which files count as code, how a project runs its tests,
// and how to read a test runner's summary line.

const CODE_EXT = /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte|astro|py|go|rs|java|kt|cs|rb|php|sql)$/i
const IGNORED_DIR = /[\\/](node_modules|\.next|dist|build|out|coverage|\.git|\.venv|venv|__pycache__|\.turbo)[\\/]/i

export function isCodeFile(path: string): boolean {
  return CODE_EXT.test(path) && !IGNORED_DIR.test(path)
}

export function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

export function dirName(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = norm.lastIndexOf('/')

  return i <= 0 ? norm.slice(0, Math.max(i, 0) + 1) : norm.slice(0, i)
}

export function projectName(root: string): string {
  const parts = root.replace(/\\/g, '/').split('/').filter(Boolean)

  return parts[parts.length - 1] ?? root
}

export type Plan = { argv: string[]; label: string; runner: 'npm' | 'pytest' }

const NO_TEST = /no test specified/i

/** The test command for a package.json's text, or null when it has none. */
export function npmPlan(packageJson: string, windows: boolean): Plan | null {
  let scripts: Record<string, unknown> = {}

  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> }
    scripts = parsed.scripts ?? {}
  } catch {
    return null
  }

  const test = scripts.test

  if (typeof test !== 'string' || test.trim() === '' || NO_TEST.test(test)) {
    return null
  }

  const argv = ['npm', 'test', '--silent']

  return { argv: windows ? ['cmd', '/d', '/s', '/c', ...argv] : argv, label: test, runner: 'npm' }
}

export function pytestPlan(python: string): Plan {
  return { argv: [python, '-m', 'pytest', '-q', '-x', '--no-header', '-p', 'no:cacheprovider'], label: 'pytest', runner: 'pytest' }
}

export type Summary = { passed: number | null; failed: number | null; text: string }

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** Reads vitest, jest, node --test and pytest summaries. */
export function summarize(output: string, exitCode: number): Summary {
  const out = stripAnsi(output)
  const num = (re: RegExp): number | null => {
    const m = re.exec(out)

    return m?.[1] !== undefined ? Number(m[1]) : null
  }

  // vitest: "Tests  2 failed | 40 passed (42)"; jest: "Tests:       1 failed, 41 passed, 42 total"
  const vitestLine = /^\s*Tests:?\s+(.+)$/m.exec(out)?.[1]

  let passed: number | null = null
  let failed: number | null = null

  if (vitestLine !== undefined) {
    passed = num(/^\s*Tests:?\s+.*?(\d+) passed/m)
    failed = num(/^\s*Tests:?\s+.*?(\d+) failed/m)
  }

  // node --test: "# pass 12" / "# fail 0" (or "ℹ pass 12")
  if (passed === null) {
    passed = num(/^[#ℹ]\s*pass (\d+)/m)
    failed = num(/^[#ℹ]\s*fail (\d+)/m) ?? failed
  }

  // pytest: "3 failed, 40 passed in 1.2s"
  if (passed === null) {
    passed = num(/(\d+) passed/)
    failed = num(/(\d+) failed/) ?? failed
  }

  if (failed === null && exitCode !== 0) {
    failed = num(/(\d+) errors?/)
  }

  const ok = exitCode === 0
  const text =
    passed !== null || failed !== null
      ? [failed ? `${failed} failed` : null, passed !== null ? `${passed} passed` : null].filter(Boolean).join(', ')
      : ok ? 'passed' : `exit code ${exitCode}`

  return { passed, failed, text }
}

/** The last useful lines of a failing run, for Claude to read. */
export function failureTail(output: string, max = 1800): string {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
  const interesting = lines.filter(l => /fail|error|expected|received|assert|✗|×|FAIL|Error:|at .+:\d+/i.test(l))
  const pick = (interesting.length >= 3 ? interesting : lines).slice(-40).join('\n')

  return pick.length > max ? `…${pick.slice(-max)}` : pick
}
