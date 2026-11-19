# dev-servers

`/dev` opens a panel of the dev servers running on this machine.

- **Running**: every node / python / deno / bun… process holding a port: `:3000  dashboard  node next`, with Open (browser) and Stop.
- **Projects**: your project folders with their start command (`npm run dev`, or uvicorn for a FastAPI `main.py`) and a Start button. Servers start minimised in their own window titled `dev · <project>`, so you can still read their logs.
- Stop on a server it started closes its window too; a server you started yourself loses only the server process, never your terminal.
- `/dev add` adds the current folder (or `/dev add <path>`), `/dev remove <path>` drops one.
- Refreshes every 8 seconds while the panel is open. Windows (netstat + PowerShell) and macOS/Linux (lsof).
