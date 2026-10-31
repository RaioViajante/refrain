# CLAUDE.md

@AGENTS.md

[`AGENTS.md`](AGENTS.md), imported above, contains the canonical rules. It takes precedence if anything here seems to conflict. This file adds only how Claude should work in this repository.

## Starting a task

1. Inspect before acting: `git status`, the current branch, and the actual files involved. Recalled context or earlier conversations are not evidence of the repository's current state.
2. Read the documents and ADRs relevant to the task (index in [`README.md`](README.md#read-next)). For UI work, also read [Design System](docs/design-system.md) and, when available locally, the matching screen in `reference/`, which is not in the repository.
3. For multi-step work, give a brief plan with the acceptance criteria, then work in small, reviewable increments: one concern per commit, one milestone per branch.
4. Do not start a milestone the author has not authorized ([Roadmap](docs/roadmap.md)).

## While working

- Follow decisions that have already been made. If you think one is wrong, say so and propose an ADR. Do not quietly diverge.
- Ask only when the answer changes what you will do and the repository does not settle it. Otherwise pick the documented default and mention it.
- Treat `reference/` and anything that looks like personal writing as read-only. `reference/` is local-only and never tracked; never link to it or load it from code or documentation ([`AGENTS.md` § 6](AGENTS.md#6-design-system-boundaries)). Never generate the author's words, ratings, or memories.
- Do not add dependencies, scaffolding, or configuration beyond what the task requires.
- Before reporting completion, run the checks that apply and read the diff yourself.

## Skills

The repository has two project skills in `.claude/skills/`. Both apply the documents and never override them.

- **`/refrain-security-review [PR | branch | path]`** is a read-only security review. Use it on any change that touches a trust boundary ([Security § Security reviews](docs/security.md#security-reviews)). It reports findings with evidence and changes nothing. A passing test suite is not an approval.
- **`/refrain-db-change [description]`** is the procedure for any change to `src/db/schema.ts` or `src/db/migrations/` ([Development § Database changes](docs/development.md#database-changes)).

For an independent review, run the security review in a context separate from the one that wrote the change, such as a fresh session or a review agent. Add a skill only for a specialized, recurring workflow that the documents cannot cover.

## Reporting

Use the handoff format in [`AGENTS.md` § 12](AGENTS.md#12-handoff). Keep it short, report actual command results, and state plainly what was not verified.
