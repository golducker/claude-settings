import { expect, mock, test } from 'claude-code/testing'

import { parseWindows, projectLabel, projectOf, shortCommand } from '../hooks/scan'

const PANE = {
  plugin: 'dev-servers',
  component: 'Pane',
  requestId: 'dev-servers',
  props: { title: 'Dev servers', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SCAN = JSON.stringify([
  { pid: 4242, ports: [3000], name: 'node.exe', cmd: '"C:\\Program Files\\nodejs\\node.exe" D:\\dashboard\\node_modules\\next\\dist\\server\\lib\\start-server.js', ppid: 1, pname: 'cmd.exe', chain: [1, 2] },
])

test('parsing and labels', async () => {
  const rows = parseWindows(SCAN)
  expect(rows[0]?.ports).toEqual([3000])
  expect(rows[0]?.name).toBe('node')
  expect(projectOf(rows[0]!.command, ['D:\\dashboard', 'D:\\dash'])).toBe('D:\\dashboard')
  expect(shortCommand(rows[0]!.command)).toBe('node next')
  expect(projectLabel('D:\\Some Project\\frontend')).toBe('Some Project/frontend')
  expect(parseWindows('')).toEqual([])
  expect(parseWindows(JSON.stringify({ pid: 1, ports: 5173, name: 'node.exe', cmd: 'vite' }))[0]?.ports).toEqual([5173])
})

test('the panel lists a running server with open and stop', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'dev' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: 'D:\\dashboard' }))
  on('fs.exists', (_, e) => ({ value: /dashboard/.test(String((e as { path?: string }).path ?? JSON.stringify(e))) }))
  on('fs.read', () => ({ value: '{"scripts":{"dev":"next dev"}}' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: SCAN, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))

  await $.session.start({ cwd: 'D:\\dashboard', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'dev', args: '' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const tree = JSON.stringify(await ui.drawn())
    expect(tree).toContain(':3000')
    expect(tree).toContain('1 running')
    expect((await ui.find({ key: 'stop-4242' }))).toBeDefined()
    expect((await ui.find({ key: 'open-4242-3000' }))).toBeDefined()
    await ui.unmount()
  }
})
