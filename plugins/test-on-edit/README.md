# test-on-edit

Runs your project's own tests ~7 seconds after Claude stops editing code, so broken changes are caught before you notice.

- Finds the nearest `package.json` with a real `test` script (Vitest, Jest, `node --test`) or pytest config, walking up from the edited file.
- Shows the result in the status line: `Tests  dashboard  ✓ 113 passed  24.4s`.
- When tests **start failing** it toasts you and hands Claude the failing output so it fixes the break right away; when they pass again it says so.
- Ignores docs, JSON and anything under `node_modules`, `.next`, `dist`, `venv`.
- `/tests` runs now · `/tests status` · `/tests off` / `/tests on`.
