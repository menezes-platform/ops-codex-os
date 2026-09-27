# Incident log: Railway ephemeral worker implementation tooling failures

Date: 2026-09-27

Scope: implementation and verification of the Railway anonymous ephemeral worker provider and successor handoff loop.

No production PersistFlow runtime or Railway account deployment was changed by these failures.

## 1. Remote-bash composition failed before execution

Observed error:

```text
SyntaxError: Unexpected identifier 'ssh'
```

Cause: a large shell heredoc was embedded inside a JavaScript template literal used to orchestrate a remote-bash tool call. Backticks inside the planned Markdown content terminated the JavaScript template early, so the shell command never ran.

Resolution: stopped composing the patch through one giant JavaScript template and wrote repository files through the GitHub connector with explicit file content. Subsequent repository writes succeeded.

## 2. Shallow-clone merge-base validation failed

Observed error:

```text
fatal: FETCH_HEAD...HEAD: no merge base
```

Cause: the verification checkout was cloned with `--depth 1` on the feature branch. Fetching `main` with depth 1 did not provide enough ancestry for a three-dot merge-base diff.

Resolution: changed the verification strategy to fetch sufficient branch history and an explicit remote-tracking `origin/main` reference before running the diff check.

## 3. GitHub code-search query parser rejected an over-composed query

Observed error:

```text
GitHub API error 422: ERROR_TYPE_QUERY_PARSING_FATAL unable to parse query
```

Cause: a compound semantic phrase was passed to the GitHub code-search wrapper while looking for the repository's existing incident-log convention.

Resolution: split discovery into simple repository-scoped searches (`incident` and `git diff`). This found the established `persistd/docs/incidents/` convention.

## 4. Commit-count diff failed in a shallow checkout

Observed error:

```text
fatal: ambiguous argument 'HEAD~7..HEAD': unknown revision or path not in the working tree
```

Cause: the checkout still did not contain seven ancestors even though the remote branch itself was seven commits ahead of `main`.

Resolution: abandoned commit-count-relative validation and fetched repository history instead.

## 5. `origin/main` was absent after unshallowing a single-branch clone

Observed error:

```text
fatal: ambiguous argument 'origin/main..HEAD': unknown revision or path not in the working tree
```

Cause: `git fetch --unshallow origin` expanded the history for the configured single-branch refspec but did not create an `origin/main` remote-tracking ref.

Resolution:

```bash
git fetch origin main:refs/remotes/origin/main
git diff --check origin/main..HEAD
```

Final result: `git diff --check origin/main..HEAD` passed with no output, and the checkout was clean.
