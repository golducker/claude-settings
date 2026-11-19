import { expect, mock, test } from 'claude-code/testing'

import { gitInvocation, gitSweeps, judgeCommand, tokens } from '../hooks/rules'

const call = (line: string) => gitInvocation(tokens(line))

test('git options before the subcommand', async () => {
  expect(call('git -C demo-project add -A')).toEqual({ sub: 'add', args: ['-A'], cwd: 'demo-project' })
  expect(call('git -c core.quotePath=false --no-pager add .')?.sub).toBe('add')
  expect(call('git --git-dir=.git status')?.sub).toBe('status')
  expect(call('npm test')).toBe(null)
})

test('what counts as staging everything', async () => {
  for (const line of ['git add .', 'git -C x add -A', 'git add --all', 'git add -u', 'git commit -am "x"', 'git -C repo commit -a -m x', 'git stage .']) {
    expect(gitSweeps(call(line)!)).toBe(true)
  }

  for (const line of ['git add src/a.ts', 'git commit -m "fix"', 'git status', 'git -C x log']) {
    expect(gitSweeps(call(line)!)).toBe(false)
  }
})

test('quoted text never splits a command or trips the guard', async () => {
  expect(judgeCommand('git commit -q -m "stop staging .env by accident\n\nalso; fixes | pipes && more"')).toBe(null)
  expect(judgeCommand('git log --grep ".env"')).toBe(null)
  expect(judgeCommand('echo "remember to fill .env" && npm test')).toBe(null)
  expect(judgeCommand('git commit -m "x" && cat .env')).not.toBe(null)
})

test('explicitly staging a secret is refused, wherever git runs', async () => {
  expect(judgeCommand('git -C demo-project add .env')).not.toBe(null)
  expect(judgeCommand('git -c x=y add backend/.env.local')).not.toBe(null)
  expect(judgeCommand('git -C demo-project rm --cached .env')).toBe(null)
})

test('a sweep is checked in the -C folder and refused when it holds a secret', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const seen: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: 'guard' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    seen.push((e as { init?: { cwd?: string } }).init?.cwd)

    return { value: { exitCode: 0, stdout: '?? .env\n?? src/a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const blocked = await $.tool.call({ tool: 'Bash', command: 'git -C demo-project add -A' })
  expect(typeof blocked.deny).toBe('string')
  expect(seen).toContain('demo-project')

  const chained = await $.tool.call({ tool: 'Bash', command: 'cd D:/app && git -C web add .' })
  expect(typeof chained.deny).toBe('string')
  expect(seen).toContain('D:/app/web')
})
