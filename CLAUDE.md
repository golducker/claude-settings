# Global rules for Claude Code

Put this file at `~/.claude/CLAUDE.md`. Edit freely; these are defaults, not laws.

## Environment
- Windows 10. PowerShell 5.1 is primary (no `&&`; use `;` or `if ($?) { ... }`). Git Bash is also available.
- Folder names can contain spaces and Vietnamese letters: always quote paths.

## How to work
- Smallest complete change. Standard library and existing code first; no new dependency for a few lines; no features nobody asked for.
- New non-trivial logic gets a small test or `assert` self-check.
- Text handling keeps Vietnamese/Unicode letters (`str.isalnum()`, not `[a-z0-9]`).
- Replies to the user are in Vietnamese. Code, identifiers and commit messages stay in English.
- Ask the user before deleting anything, before committing or pushing, and before changing config outside the project.
- If the project has an `AGENTS.md`, read it too for project conventions.

## Model delegation
Main session runs on Opus. Delegate to save cost, using the savvy agents (they show in the Savvy Progress panel):
- Searching/reading/summarizing or trivial edits -> `savvy-light` (Haiku).
- Implementing a decided plan, ordinary bugs, tests, boilerplate -> `savvy-medium` (Sonnet); delicate refactors or many edge cases -> `savvy-careful` (Sonnet, high).
- Unclear root cause or messy unfamiliar code -> `savvy-heavy` (Opus) to investigate.
- Keep planning, architecture, design and final review on the main Opus session (`architect` only for a second opinion).
- Multi-step tasks follow the `savvy-flow` skill.
- When a savvy worker finishes a step of a multi-step task, make sure HANDOFF.md reflects it.

## Handoff: HANDOFF.md
A session may stop mid-task (quota, crash); the next one must be able to continue from files alone.
1. **At start:** if the project root has `HANDOFF.md`, read it before anything else. Run `git status` and `git diff` (when it is a git repo) and check whether "Next step" already happened. Then continue from the real next step. Do not redo finished steps.
2. **While working:** update `HANDOFF.md` after every finished step and before any risky or long edit. Create it at the project root on the first step of a multi-step task. Skip it for one-shot questions and single quick edits.
3. "Last verified" records the exact command that last succeeded and its real result, never a failed attempt next to a "done" status.
4. Ask the user before deleting `HANDOFF.md`. When the task is done, set Status to `done` instead of deleting.

Format (keep it short; replace, don't append history):

```markdown
# HANDOFF
Last update: <YYYY-MM-DD HH:MM>
Status: in progress | blocked | done
Branch / HEAD: <branch> @ <short hash>   (or "not a git repo")

## Goal
<what the user wants> — Done when: <2-4 checks>

## Next step
<one concrete action the next session should do first>

## Done so far
- <step> — files: <paths>

## Decisions
- <decision> — because <reason> (rejected: <option>)

## Last verified
`<command>` -> <result>

## Open questions / needs the user
- <item>
```
