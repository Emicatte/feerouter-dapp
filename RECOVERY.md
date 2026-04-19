# Emergency Recovery

If the visual refactor goes wrong, run ONE of these to restore the site:

## Option 1 — Hard reset current branch to backup (destroys uncommitted changes)

```bash
git fetch origin
git reset --hard backup-pre-refactor-20260418-172545
git push origin main --force
```

This wipes main and replaces it with the pre-refactor state. Vercel will auto-deploy the original site within 2-3 minutes.

## Option 2 — Create a new branch from backup for review

```bash
git checkout -b recovery-$(date +%Y%m%d) backup-pre-refactor-20260418-172545
```

This creates a new branch at the backup point without touching main. Use this if you want to compare before vs after.

## Option 3 — Revert specific commits

```bash
git log --oneline backup-pre-refactor-20260418-172545..HEAD
# identify the commit(s) to revert
git revert <commit-sha>
git push origin main
```

## Verify backup exists

```bash
git branch -a | grep backup/pre-refactor-20260418-172545
git tag | grep backup-pre-refactor-20260418-172545
```

## Created

- Date: 2026-04-18
- Commit: 3f53c1d8ad4c798d12e32678d5052d3ac1b70f1f
- Branch at backup: main
- Backup branch: backup/pre-refactor-20260418-172545
- Backup tag: backup-pre-refactor-20260418-172545
