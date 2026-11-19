import type { EngineInterface, Register } from 'claude-code'

import { findHardcodedKey, gitInvocation, gitSweeps, isSecretPath, judgeCommand, splitCommand, tokens } from './rules'

type Block = { at: number; tool: string; target: string; why: string }

const STORE_BLOCKS = 'blocks'
const STORE_EXTRA = 'extraPatterns'
const PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])

async function extraPatterns($: EngineInterface): Promise<string[]> {
  const value = await $.store.get(STORE_EXTRA)

  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

async function remember($: EngineInterface, block: Block): Promise<void> {
  const value = await $.store.get(STORE_BLOCKS)
  const list = Array.isArray(value) ? (value as Block[]) : []
  await $.store.set(STORE_BLOCKS, [...list, block].slice(-50))
}

function refuse($: EngineInterface, tool: string, target: string, why: string) {
  $.ui.toast(`Blocked: ${why}`)
  // Logged in the background; a log that cannot be written (the module reloading) is dropped.
  void $.clock.now().then(at => remember($, { at, tool, target, why })).catch(() => undefined)

  return {
    deny:
      `secrets-guard: ${why}. Secret files (.env, keys, sessions) are off-limits to Claude. ` +
      'If you need a value, ask the user to set it themselves, or read the matching .env.example instead.',
  }
}

/** Files `git add .` / `git commit -a` would sweep in that look like secrets. */
async function secretsGitWouldStage($: EngineInterface, cwd: string | undefined, extra: string[]) {
  try {
    const { exitCode, stdout } = await $.process.run(
      ['git', 'status', '--porcelain=v1', '--untracked-files=all'],
      { cwd, timeoutMs: 8000 },
    )

    if (exitCode !== 0) {
      return []
    }

    return stdout
      .split('\n')
      .map(line => line.slice(3).trim().replace(/^"|"$/g, ''))
      .filter(path => path !== '' && isSecretPath(path, extra))
  } catch {
    return []
  }
}

function cdTarget(command: string): string | undefined {
  const m = /^\s*(?:cd|Set-Location|sl|pushd)\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/i.exec(command)

  return m?.[1]?.replace(/^["']|["']$/g, '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: 'secrets-guard: show recent blocks, or `add <glob>` / `remove <glob>` a protected file pattern',
      argumentHint: '[add <glob> | remove <glob>]',
    })

    return next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const glob = rest.join(' ')
    const extra = await extraPatterns($)

    if (verb === 'add' && glob !== '') {
      await $.store.set(STORE_EXTRA, [...new Set([...extra, glob])])

      return { text: `Now also protecting \`${glob}\`.` }
    }

    if (verb === 'remove' && glob !== '') {
      await $.store.set(STORE_EXTRA, extra.filter(g => g !== glob))

      return { text: `No longer protecting \`${glob}\`.` }
    }

    const value = await $.store.get(STORE_BLOCKS)
    const blocks = (Array.isArray(value) ? (value as Block[]) : []).slice(-10).reverse()
    const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    const lines = [
      '### Secrets guard is on',
      '',
      '| Protects | |',
      '|---|---|',
      '| Files | `.env*` (except `.env.example`), `*.pem`, `*.key`, `id_rsa`, `credentials.json`, service-account JSON, `secrets.*`, `*.session`, `.netrc` |',
      ...(extra.length > 0 ? [`| Yours | ${extra.map(g => `\`${g}\``).join(', ')} |`] : []),
      '| Commands | Printing env vars or secret files, `git add .` that would sweep a secret in |',
      '| Edits | Hardcoding a live-looking API key into source |',
      '',
      ...(blocks.length === 0
        ? ['Nothing blocked yet.']
        : ['#### Recent blocks', '', '| When | Tool | What |', '|---|---|---|', ...blocks.map(b => `| ${when(b.at)} | ${b.tool} | ${b.why} |`)]),
      '',
      '`/guard add <glob>` to protect more files   `/guard remove <glob>` to undo',
    ]

    return { text: lines.join('\n') }
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const extra = await extraPatterns($)

    if (PATH_TOOLS.has(tool)) {
      const target = String(input.file_path ?? input.notebook_path ?? input.path ?? '')
      const glob = String(input.pattern ?? input.glob ?? '')

      if (target !== '' && isSecretPath(target, extra)) {
        return refuse($, tool, target, `${tool} on ${target}`)
      }

      // Grep/Glob aimed straight at a secret file name.
      if ((tool === 'Glob' || tool === 'Grep') && glob !== '' && isSecretPath(glob, extra)) {
        return refuse($, tool, glob, `${tool} for ${glob}`)
      }

      if (WRITE_TOOLS.has(tool)) {
        const text = [input.content, input.new_string, JSON.stringify(input.edits ?? '')]
          .filter((v): v is string => typeof v === 'string')
          .join('\n')
        const key = findHardcodedKey(text)

        if (key !== null) {
          return refuse($, tool, target, `that edit hardcodes ${key} into ${target}; keep it in .env`)
        }
      }
    }

    if (SHELL_TOOLS.has(tool)) {
      const command = String(input.command ?? '')
      const verdict = judgeCommand(command, extra)

      if (verdict !== null) {
        return refuse($, tool, command.slice(0, 80), verdict.deny)
      }

      // Each `git ...` in the line, with the folder it runs in (`cd x &&` or `-C x`).
      for (const seg of splitCommand(command)) {
        const git = gitInvocation(tokens(seg.trim()))

        if (!git || !gitSweeps(git)) {
          continue
        }

        const base = cdTarget(command)
        const cwd = git.cwd === undefined ? base : base === undefined || /^([A-Za-z]:|[\\/])/.test(git.cwd) ? git.cwd : `${base}/${git.cwd}`
        const found = await secretsGitWouldStage($, cwd, extra)

        if (found.length > 0) {
          return refuse(
            $,
            tool,
            command.slice(0, 80),
            `\`${command.trim().slice(0, 40)}\` would commit ${found.join(', ')}; add ${found.length > 1 ? 'them' : 'it'} to .gitignore first`,
          )
        }
      }
    }

    return next(e)
  }).catch(($, e, next) => {
    // Fail open: a bug in the guard must never freeze every tool call.
    $.ui.log('secrets-guard: the guard itself failed; letting the call through', { to: 'debug' })

    return next(e)
  })
}
