# Security Policy

Refrain's source code is public, so its security never depends on keeping the code, the schema, or the route structure secret.

## Status

- **New application (repository root):** an unreleased scaffold with no features, no hosted database, and no deployment.
- **Archived music diary (v3):** retired, in [`archive/music-diary-v3/`](archive/music-diary-v3/ARCHIVE.md). Its own policy, which still describes its private test hosting, is [`archive/music-diary-v3/SECURITY.md`](archive/music-diary-v3/SECURITY.md). Its hosting is not a target: do not probe it.

There are no releases, so no version is supported.

## Reporting a vulnerability

**Do not report a suspected vulnerability in a public issue, pull request, discussion, or commit message.**

Use **GitHub's private vulnerability reporting**: open the repository's **Security** tab, choose **Report a vulnerability**, and fill in the form. Only the maintainer and you can see the report.

If the **Report a vulnerability** button is missing, do not describe the problem anywhere public. Open an issue titled "Security contact request", with no details, and the maintainer will reply with a private channel.

Include the affected commit, file, and line or behavior; steps to reproduce on a local instance with synthetic data; and the impact.
