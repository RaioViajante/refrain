# Contributing to Refrain

Refrain is a **single-author personal music journal**, built and maintained by one person. Its scope, design, and roadmap are the author's. You are welcome to read it, learn from it, fork it under the [licence](#licences), and report problems.

## What helps most

- **A security problem:** report it privately, never in an issue or a pull request. See [SECURITY.md](SECURITY.md).
- **A bug:** open an issue with the steps to reproduce it on a local instance with synthetic data, what you expected, and what happened.
- **A documentation error,** such as a wrong command, a broken link, or a description that no longer matches the code: an issue, or a small pull request.

Larger changes, new features, redesigns, and new dependencies are not accepted without the author's agreement first. Open an issue to ask before you write code. Some things are out of scope by design: reader accounts, social features, streaming, recommendations, multiple authors, and machine translation ([Product](docs/product.md)).

## Before a pull request

1. Read [AGENTS.md](AGENTS.md). It is the canonical set of rules for anyone changing the repository, human or agent. The documents it links explain the architecture, the data model, the security model, and the design system.
2. Set up locally as described in [Development](docs/development.md#local-setup). Everything runs on your machine, with disposable databases and synthetic data. You need no account, secret, or hosted service.
3. Keep the change focused: one concern, on a branch named `<type>/<topic>`, with [Conventional Commits](https://www.conventionalcommits.org/).
4. Run the checks that apply, and report their actual results in the pull request: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and, with the test databases, `pnpm test:integration`, `pnpm test:http`, `pnpm test:e2e`, and `pnpm test:backup` ([Development § Commands](docs/development.md#commands)).
5. Every privacy rule needs a test ([Security § Required tests](docs/security.md#required-tests)). A change that touches a trust boundary gets a security review ([Security § Security reviews](docs/security.md#security-reviews)).
6. Never commit secrets, `.env` files, database dumps, or real personal writing. Use synthetic fixtures labeled `[Test]`.

Continuous integration runs on every pull request. It has read-only repository access and no secrets. A pull request from a fork runs only after the author approves its workflows.

## Licences

- **Your code and documentation** are contributed under the same [MIT License](LICENSE) as the rest of the source code.
- **Artwork** is not accepted as a contribution. The original artwork is all rights reserved ([LICENSE-ARTWORK.md](LICENSE-ARTWORK.md)).
- Contribute only work you have the right to contribute.

## Conduct

Be respectful and constructive. The author may close issues or pull requests that are off topic, abusive, or outside the project's scope, and may block accounts that harass anyone.
