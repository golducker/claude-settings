import { expect, mock, test } from 'claude-code/testing'

import { findHardcodedKey, isSecretPath, judgeCommand } from '../hooks/rules'

test('secret file names', async () => {
  for (const p of ['.env', 'D:\\dashboard\\.env.local', 'backend/.env.production', 'server.pem', 'id_ed25519', 'anon.session', 'credentials.json']) {
    expect(isSecretPath(p)).toBe(true)
  }

  for (const p of ['.env.example', 'frontend/.env.sample', 'id_ed25519.pub', 'src/env.ts', 'README.md', 'keys.ts']) {
    expect(isSecretPath(p)).toBe(false)
  }

  expect(isSecretPath('prod.secret.json', ['*.secret.json'])).toBe(true)
})

test('shell commands', async () => {
  expect(judgeCommand('cat .env')).not.toBe(null)
  expect(judgeCommand('cd backend && type .env')).not.toBe(null)
  expect(judgeCommand('Get-Content D:\\dashboard\\.env.local')).not.toBe(null)
  expect(judgeCommand('printenv')).not.toBe(null)
  expect(judgeCommand('echo $GEMINI_API_KEY')).not.toBe(null)
  expect(judgeCommand('git add .env')).not.toBe(null)
  expect(judgeCommand('gci env:')).not.toBe(null)

  expect(judgeCommand('cp .env.example .env')).toBe(null)
  expect(judgeCommand('ls -la')).toBe(null)
  expect(judgeCommand('Test-Path .env')).toBe(null)
  expect(judgeCommand('echo .env >> .gitignore')).toBe(null)
  expect(judgeCommand('npm run dev')).toBe(null)
  expect(judgeCommand('echo $HOME')).toBe(null)
})

test('hardcoded keys', async () => {
  expect(findHardcodedKey('const k = "AIzaSyA1234567890abcdefghijklmnopqrstuv"')).toBe('a Google / Gemini API key')
  expect(findHardcodedKey('token: "123456789:AAH1234567890abcdefghijklmnopqrstuv"')).toBe('a Telegram bot token')
  expect(findHardcodedKey('const k = process.env.GEMINI_API_KEY')).toBe(null)
})

test('a Read of .env is refused, a normal Read passes', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'guard' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const blocked = await $.tool.call({ tool: 'Read', file_path: 'D:/dashboard/.env' })
  expect(typeof blocked.deny).toBe('string')

  const fine = await $.tool.call({ tool: 'Read', file_path: 'D:/dashboard/package.json' })
  expect(fine.deny).toBe(undefined)
})
