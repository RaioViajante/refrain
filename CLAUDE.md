# CLAUDE.md

@AGENTS.md

[`AGENTS.md`](AGENTS.md), imported above, holds the rules and takes precedence. This file adds only how Claude should work here.

- Inspect before acting: `git status`, the branch, and the files involved. Recalled context about the archived music diary is not evidence of this application's state.
- The product model and the visual direction are undefined ([decision 0001](docs/decisions/0001-rebuild-foundation.md)). Ask the owner before designing data, screens, or features. For multi-step work, give a short plan with acceptance criteria first.
- Before reporting completion, run the checks that apply and read the diff.

## Skills

Project skills in `.claude/skills/`. Each applies `AGENTS.md` and the decisions, and never overrides them.

- **`/refrain-database`**: any change to `src/db/schema.ts`, `src/db/migrations/`, or database queries.
- **`/refrain-quality`**: before opening or approving a PR, for a security review, and before any deployment discussion. For an independent review, run it in a separate context from the one that wrote the change.
- **`/refrain-design`**: any interface work. Its visual direction is empty until the owner approves one; its accessibility and artwork rules bind now.

The archived music diary's skills (`archive/music-diary-v3/.claude/skills/`) describe v3 only and are not active here.
