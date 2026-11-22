# Workflow handoff

- Canonical handoff: https://github.com/pyw31337/macmini-workflow-handoff
- Read the canonical repository `AGENTS.md` and latest `inventory/workflows.json` before changing automated jobs.
- Any change to `.github/workflows/`, collection cadence, deployment triggers, secrets names, or local scheduler replacements must update this file and the canonical handoff repository in the same change.
- Never commit secret values, `.env` files, tokens, cookies, or machine-specific paths.

The authoritative workflow files remain in this repository under `.github/workflows/`. GitHub-hosted Actions do not depend on the old Mac.

## 2026-11-18 operational update

- `pages.yml` retains its existing `push` and manual triggers and now also deploys after a successful `Megamart Price Monitor` run. This is required because a `GITHUB_TOKEN` push from the collector does not trigger another workflow.
- Pages waits briefly after uploading its artifact to avoid the intermittent Actions artifact-registration race seen on `workflow_run` deployments. The monitor uses a non-cancelling concurrency group so scheduled runs cannot race while pushing data commits.
- `megamart_monitor.yml` records non-secret notification health in `history/notification_status.json` and emits a visible workflow error when eligible prices are found but all configured channels fail. Data collection and history commits continue even when notification delivery fails.
- Notification secret names are `RECEIVER_EMAIL`, `NTFY_TOPIC`, `WEB_PUSH_DISPATCH_URL`, and `WEB_PUSH_DISPATCH_TOKEN`; values remain in GitHub Actions Secrets only.
