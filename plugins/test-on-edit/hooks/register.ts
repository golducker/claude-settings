import type { EngineInterface, Register } from 'claude-code'

import { dirName, failureTail, isCodeFile, isWindowsPath, npmPlan, projectName, pytestPlan, summarize } from './detect'
import type { Plan } from './detect'

type Timer = { cancel: () => void }
type Result = { ok: boolean; text: string; tail: string; ms: number }
type Project = {
  root: string
  plan: Plan
  timer?: Timer
  isRunning: boolean
  isDirty: boolean
  last?: Result
  /** The loop whose edit queued the run, so the note reaches the agent that made it. */
  agentId?: string
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const DEBOUNCE_MS = 7000
const ENABLED = 'enabled'

const projects = new Map<string, Project>()
const noPlan = new Set<string>()

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED)) !== false
}

async function pythonFor($: EngineInterface, root: string, windows: boolean): Promise<string> {
  const candidates = windows
    ? [`${root}/.venv/Scripts/python.exe`, `${root}/venv/Scripts/python.exe`]
    : [`${root}/.venv/bin/python`, `${root}/venv/bin/python`]

  for (const c of candidates) {
    if (await $.fs.exists(c)) {
      return c
    }
  }

  return windows ? 'python' : 'python3'
}

/** Walks up from the edited file to the nearest folder that knows how to test itself. */
async function findProject($: EngineInterface, file: string): Promise<Project | null> {
  const windows = isWindowsPath(file)
  let dir = dirName(file)

  for (let depth = 0; depth < 8 && dir !== '' && !noPlan.has(dir); depth += 1) {
    const known = projects.get(dir)

    if (known) {
      return known
    }

    if (await $.fs.exists(`${dir}/package.json`)) {
      const plan = npmPlan(String(await $.fs.read(`${dir}/package.json`)), windows)

      if (plan) {
        const project: Project = { root: dir, plan, isRunning: false, isDirty: false }
        projects.set(dir, project)

        return project
      }
    }

    const pyMarkers = ['pytest.ini', 'conftest.py', 'tests/conftest.py', 'pyproject.toml', 'setup.cfg']

    for (const marker of pyMarkers) {
      if (!(await $.fs.exists(`${dir}/${marker}`))) {
        continue
      }

      const text = marker.endsWith('.toml') || marker.endsWith('.cfg') ? String(await $.fs.read(`${dir}/${marker}`)) : ''

      if (text !== '' && !/pytest/.test(text)) {
        continue
      }

      const project: Project = { root: dir, plan: pytestPlan(await pythonFor($, dir, windows)), isRunning: false, isDirty: false }
      projects.set(dir, project)

      return project
    }

    // Stop at a repository root or a drive root.
    if (await $.fs.exists(`${dir}/.git`)) {
      break
    }

    const parent = dirName(dir)

    if (parent === dir) {
      break
    }

    dir = parent
  }

  noPlan.add(dirName(file))

  return null
}

function showStatus($: EngineInterface, project: Project) {
  const name = projectName(project.root)

  if (project.isRunning) {
    $.ui.status(`Tests  ${name}  running…`)

    return
  }

  const last = project.last

  if (last) {
    const secs = (last.ms / 1000).toFixed(1)
    $.ui.status(last.ok ? `Tests  ${name}  ✓ ${last.text}  ${secs}s` : `Tests  ${name}  ✕ ${last.text}`)
  }
}

async function tellClaude($: EngineInterface, project: Project, text: string) {
  const message = { type: 'user' as const, content: [{ type: 'text' as const, text }] }

  try {
    await $.session.append({ message, agentId: project.agentId })
  } catch {
    // The agent that made the edit has finished: tell the main conversation instead.
    await $.session.append({ message }).catch(() => undefined)
  }
}

async function run($: EngineInterface, project: Project): Promise<void> {
  if (project.isRunning) {
    project.isDirty = true

    return
  }

  project.isRunning = true
  project.isDirty = false
  showStatus($, project)
  const started = await $.clock.now()
  const before = project.last
  let result: Result

  try {
    const { exitCode, stdout, stderr } = await $.process.run(project.plan.argv, {
      cwd: project.root,
      timeoutMs: 180_000,
      env: { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    })
    const output = `${stdout}\n${stderr}`
    // pytest exit 5: nothing collected. Not a failure, just no tests yet.
    const ok = exitCode === 0 || (project.plan.runner === 'pytest' && exitCode === 5)
    result = { ok, text: summarize(output, exitCode).text, tail: ok ? '' : failureTail(output), ms: (await $.clock.now()) - started }
  } catch (error) {
    result = { ok: false, text: 'timed out or could not start', tail: String(error).slice(0, 400), ms: (await $.clock.now()) - started }
  }

  project.isRunning = false
  project.last = result
  showStatus($, project)
  const name = projectName(project.root)

  if (!result.ok && (before?.ok !== false || before.tail !== result.tail)) {
    $.ui.toast(`${name}: tests started failing, ${result.text}`)
    await tellClaude(
      $,
      project,
      `[test-on-edit] After your last edits, the tests in ${project.root} are FAILING (${result.text}). ` +
        `Command: ${project.plan.argv.join(' ')}\n\n${result.tail}\n\n` +
        'Fix this before moving on, unless the failure is expected mid-change.',
    )
  } else if (result.ok && before?.ok === false) {
    $.ui.toast(`${name}: tests pass again`)
    await tellClaude($, project, `[test-on-edit] Tests in ${project.root} pass again (${result.text}).`)
  }

  if (project.isDirty) {
    schedule($, project)
  }
}

function schedule($: EngineInterface, project: Project) {
  project.timer?.cancel()
  project.timer = $.clock.after(DEBOUNCE_MS, () => {
    project.timer = undefined
    void run($, project)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tests',
      description: 'test-on-edit: run tests now, or turn auto-testing `on` / `off`',
      argumentHint: '[on | off | status]',
    })

    return next(e)
  })

  on('command.run', { command: 'tests' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'on') {
      await $.store.set(ENABLED, arg === 'on')
      $.ui.status(arg === 'on' ? 'Tests  on' : undefined)

      return { text: arg === 'on' ? 'Tests run after each edit again.' : 'Tests paused. `/tests on` to resume.' }
    }

    if (arg === 'status') {
      const rows = [...projects.values()].map(p => {
        const result = p.isRunning ? 'running…' : p.last ? `${p.last.ok ? '✓' : '✕'} ${p.last.text}` : 'not run yet'
        const took = p.last && !p.isRunning ? `${(p.last.ms / 1000).toFixed(1)}s` : ''

        return `| ${projectName(p.root)} | \`${p.plan.label}\` | ${result} | ${took} |`
      })
      const state = (await isEnabled($)) ? 'on' : 'paused'

      return {
        text: [
          `### Tests are ${state}`,
          '',
          ...(rows.length
            ? ['| Project | Runs | Last result | Took |', '|---|---|---|--:|', ...rows]
            : ['Nothing tested yet this session. Tests run about 7 seconds after Claude edits code.']),
        ].join('\n'),
      }
    }

    const cwd = await $.session.cwd()
    const project = await findProject($, `${cwd}/__probe__.ts`)

    if (!project) {
      return { text: `No tests found in ${cwd}. Looked for a \`test\` script in package.json, or a pytest config.` }
    }

    project.timer?.cancel()
    await run($, project)
    const last = project.last

    if (!last) {
      return { text: 'Done.' }
    }

    const head = `${last.ok ? '✓' : '✕'} ${projectName(project.root)}  ${last.text}  in ${(last.ms / 1000).toFixed(1)}s`

    return { text: last.ok ? head : `${head}\n\n\`\`\`\n${last.tail}\n\`\`\`` }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)

    if (!EDIT_TOOLS.has(tool) || ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const input = e as unknown as Record<string, unknown>
    const file = String(input.file_path ?? input.notebook_path ?? '')

    if (file === '' || !isCodeFile(file) || !(await isEnabled($))) {
      return ran
    }

    const project = await findProject($, file)

    if (project) {
      project.agentId = e.agentId
      schedule($, project)
      $.ui.status(`Tests  ${projectName(project.root)}  queued`)
    }

    return ran
  })
}
