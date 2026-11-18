# CLAUDE.md

@AGENTS.md

[`AGENTS.md`](AGENTS.md), imported above, holds the rules and takes precedence. This file adds only how Claude should work here.

- Inspect before acting: `git status`, the branch, and the files involved. Recalled context about the archived music diary is not evidence of this application's state.
- The product is undefined. Ask the owner before designing data or features; give a short plan with acceptance criteria for multi-step work.
- The archived application's project skills (`refrain-security-review`, `refrain-db-change`) are kept in `archive/music-diary-v3/.claude/skills/` and are not active here. They describe v3's privacy model and schema, not this application's.
- Before reporting completion, run the checks that apply and read the diff.
