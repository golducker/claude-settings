import { expect, test } from 'claude-code/testing'

import { dirName, failureTail, isCodeFile, npmPlan, projectName, summarize } from '../hooks/detect'

test('which edits count as code', async () => {
  expect(isCodeFile('D:\\dashboard\\src\\app\\page.tsx')).toBe(true)
  expect(isCodeFile('backend/main.py')).toBe(true)
  expect(isCodeFile('README.md')).toBe(false)
  expect(isCodeFile('D:\\dashboard\\node_modules\\x\\index.js')).toBe(false)
  expect(isCodeFile('app/.next/server/page.js')).toBe(false)
})

test('test command from package.json', async () => {
  expect(npmPlan('{"scripts":{"test":"vitest run"}}', true)?.argv).toEqual(['cmd', '/d', '/s', '/c', 'npm', 'test', '--silent'])
  expect(npmPlan('{"scripts":{"test":"node --test"}}', false)?.argv).toEqual(['npm', 'test', '--silent'])
  expect(npmPlan('{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}', true)).toBe(null)
  expect(npmPlan('{"scripts":{"dev":"next dev"}}', true)).toBe(null)
  expect(npmPlan('not json', true)).toBe(null)
})

test('runner summaries', async () => {
  expect(summarize(' Test Files  13 passed (13)\n      Tests  113 passed (113)', 0).text).toBe('113 passed')
  expect(summarize(' Tests  2 failed | 40 passed (42)', 1).text).toBe('2 failed, 40 passed')
  expect(summarize('ℹ tests 90\nℹ pass 90\nℹ fail 0', 0).text).toBe('90 passed')
  expect(summarize('==== 3 failed, 40 passed in 1.2s ====', 1).text).toBe('3 failed, 40 passed')
  expect(summarize('boom', 2).text).toBe('exit code 2')
  expect(failureTail('ok\nFAIL a.test.ts\nError: expected 1 to be 2\n  at x.ts:3:1').includes('expected 1')).toBe(true)
})

test('paths', async () => {
  expect(dirName('D:\\dashboard\\src\\a.ts')).toBe('D:/dashboard/src')
  expect(projectName('D:/Some Folder/hackathon')).toBe('hackathon')
})
