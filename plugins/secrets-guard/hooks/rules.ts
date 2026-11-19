// Pure rules: what counts as a secret file, a secret-dumping command, or a
// key pasted into source. No `$` here so the tests can exercise it directly.

const SAFE_SUFFIXES = ['example', 'sample', 'template', 'dist', 'defaults', 'schema']

const SECRET_NAMES: readonly RegExp[] = [
  /^\.env$/i,
  /^\.env\.[\w.-]+$/i, // .env.local, .env.production (safe suffixes excluded below)
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)$/i,
  /^credentials(\.json)?$/i,
  /^service[-_]?account.*\.json$/i,
  /^secrets?\.(json|ya?ml|toml)$/i,
  /\.session$/i, // Telegram (gramjs) session strings
  /^\.netrc$/i,
  /^\.pgpass$/i,
]

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')

  return parts[parts.length - 1] ?? path
}

/** True when the file name looks like it holds secrets. */
export function isSecretPath(path: string, extra: readonly string[] = []): boolean {
  const name = baseName(path.trim().replace(/^["']|["']$/g, ''))

  if (name === '') {
    return false
  }

  const lower = name.toLowerCase()

  if (SAFE_SUFFIXES.some(s => lower.endsWith(`.${s}`) || lower.endsWith(`-${s}`))) {
    return false
  }

  if (lower.endsWith('.pub')) {
    return false
  }

  if (SECRET_NAMES.some(re => re.test(name))) {
    return true
  }

  return extra.some(glob => globToRegExp(glob).test(name))
}

export function globToRegExp(glob: string): RegExp {
  const body = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')

  return new RegExp(`^${body}$`, 'i')
}

/** Splits a shell line into rough word tokens, quotes stripped. */
export function tokens(command: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|([^\s;|&<>()]+)/g
  let m: RegExpExecArray | null

  while ((m = re.exec(command)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }

  return out
}

// Verbs that only look at a file's existence or metadata, never its content.
const HARMLESS = /^(ls|dir|test|\[|test-path|git-check-ignore|stat|file|rm|del|remove-item|mv|move|move-item|ren)$/i
// Copy verbs: copying an example into place is fine, copying a secret out is not.
const COPY = /^(cp|copy|copy-item)$/i
const SECRET_VAR = /\$(env:)?\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|PRIVATE)[A-Z0-9_]*\}?/i

export type Verdict = { deny: string } | null

export type GitCall = { sub: string; args: string[]; cwd?: string }

/**
 * The subcommand of a `git ...` word list, past git's own options:
 * `git -C repo add -A` is `add` run in `repo`, not a subcommand called `-C`.
 */
export function gitInvocation(words: readonly string[]): GitCall | null {
  if ((words[0] ?? '').toLowerCase() !== 'git') return null

  let cwd: string | undefined
  let i = 1

  while (i < words.length) {
    const w = words[i]!

    if (w === '-C') {
      cwd = cwd === undefined ? words[i + 1] : `${cwd}/${words[i + 1]}`
      i += 2
    } else if (w === '-c' || w === '--git-dir' || w === '--work-tree' || w === '--namespace') {
      i += 2
    } else if (w.startsWith('-')) {
      i += 1 // --no-pager, --git-dir=x, -p, --bare, ...
    } else {
      break
    }
  }

  const sub = (words[i] ?? '').toLowerCase()

  return sub === '' ? null : { sub, args: words.slice(i + 1), cwd }
}

/** True when a git call stages or commits everything rather than named files. */
export function gitSweeps(call: GitCall): boolean {
  const args = call.args.map(a => a.toLowerCase())

  if (call.sub === 'add' || call.sub === 'stage') {
    return args.some(a => a === '.' || a === '-a' || a === '--all' || a === '-u' || a === '--update' || a === '*' || a === ':/' || a === './')
  }

  return call.sub === 'commit' && args.some(a => /^-[a-z]*a[a-z]*$/.test(a) || a === '--all')
}

/**
 * Splits a command line into its commands at `&&`, `||`, `;`, `|` and new
 * lines, but never inside quotes: a commit message or an echoed string that
 * mentions `.env` stays part of the command it belongs to.
 */
export function splitCommand(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!

    if (quote) {
      if (ch === quote && command[i - 1] !== '\\') quote = null
      cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
    } else if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      out.push(cur)
      cur = ''
      if (command[i + 1] === ch) i += 1
    } else {
      cur += ch
    }
  }

  out.push(cur)

  return out.map(s => s.trim()).filter(Boolean)
}

// git subcommands whose arguments are messages or refs, never files to read.
const GIT_NO_FILES = new Set(['commit', 'tag', 'log', 'show', 'push', 'pull', 'fetch', 'branch', 'switch', 'checkout', 'merge', 'rebase', 'reset', 'stash', 'remote', 'config', 'init', 'clone'])

/** Judges a Bash or PowerShell command line. */
export function judgeCommand(command: string, extra: readonly string[] = []): Verdict {
  const segments = splitCommand(command)

  for (const raw of segments) {
    const seg = raw.trim()
    const words = tokens(seg)
    const verb = (words[0] ?? '').toLowerCase()
    const second = (words[1] ?? '').toLowerCase()

    if (verb === '') {
      continue
    }

    // Whole-environment dumps.
    if (
      /^(printenv|env|export)$/.test(verb) && words.length === 1 ||
      /^(get-childitem|gci|dir|ls)$/.test(verb) && /^env:/i.test(second) ||
      verb === 'set' && words.length === 1
    ) {
      return { deny: 'prints every environment variable, which includes your API keys' }
    }

    // echo $GEMINI_API_KEY, Write-Output $env:TOKEN, ...
    if (/^(echo|printf|write-output|write-host|print)$/.test(verb) && SECRET_VAR.test(seg)) {
      return { deny: 'prints a secret environment variable' }
    }

    const secretWords = words.slice(1).filter(w => isSecretPath(w, extra))

    if (secretWords.length === 0) {
      continue
    }

    const git = gitInvocation(words)

    if (git) {
      if (git.sub === 'add' || git.sub === 'stage') {
        return { deny: `would stage ${secretWords[0]} into git` }
      }

      if (git.sub === 'check-ignore' || git.sub === 'rm' || git.sub === 'status' || GIT_NO_FILES.has(git.sub)) {
        continue
      }
    }

    const verbKey = git ? `git-${git.sub}` : verb

    if (HARMLESS.test(verbKey)) {
      continue
    }

    if (COPY.test(verb)) {
      const sources = words.slice(1).filter(w => !w.startsWith('-'))
      const source = sources[0] ?? ''

      if (!isSecretPath(source, extra)) {
        continue // e.g. cp .env.example .env
      }
    }

    // `echo X >> .gitignore` style lines mention the name harmlessly.
    if (/\.gitignore/.test(seg) && /^(echo|add-content|write-output)$/.test(verb)) {
      continue
    }

    return { deny: `reads or exposes ${secretWords[0]}` }
  }

  return null
}

// Shapes of live keys. Kept tight so ordinary code rarely trips them.
const KEY_SHAPES: readonly { name: string; re: RegExp }[] = [
  { name: 'an Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'an OpenAI API key', re: /sk-(proj-)?[A-Za-z0-9]{32,}/ },
  { name: 'a Google / Gemini API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'a GitHub token', re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'an AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'a Telegram bot token', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  { name: 'a Stripe live key', re: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: 'a Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'a database URL with a password', re: /postgres(ql)?:\/\/[^:\s/]+:[^@\s]{6,}@[^\s'"]+\.(neon\.tech|supabase\.co|rds\.amazonaws\.com)/ },
]

/** Finds a live-looking key in text about to be written to a source file. */
export function findHardcodedKey(text: string): string | null {
  for (const shape of KEY_SHAPES) {
    if (shape.re.test(text)) {
      return shape.name
    }
  }

  return null
}
