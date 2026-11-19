# secrets-guard

Keeps Claude away from your secrets in every project.

- **Blocks** Read / Edit / Write / Grep / Glob on `.env*` (but not `.env.example`), `*.pem`, `*.key`, `id_rsa`, `credentials.json`, service-account JSON, `secrets.*`, Telegram `*.session`, `.netrc`.
- **Blocks** shell commands that print them: `cat .env`, `Get-Content .env.local`, `printenv`, `echo $GEMINI_API_KEY`, `gci env:`.
- **Blocks** `git add .` / `git commit -a` when that would sweep a secret file into git, and explicit `git add .env`.
- **Blocks** edits that hardcode a live-looking key (Anthropic, OpenAI, Gemini, GitHub, AWS, Telegram bot, Stripe, Slack, private keys, Neon/Supabase URLs with passwords).
- Every block shows a short toast and is logged. `/guard` shows the last blocks; `/guard add <glob>` protects more files.

If the guard itself ever errors it lets the call through rather than freezing Claude.
