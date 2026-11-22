# Contributing to PlayGo Trading

Thank you for your interest in improving PlayGo Trading. This project is a prototype trading workspace, and contributions that improve safety, testability, and documentation are especially welcome.

## Development Setup

Requires Node.js 22+.

```bash
npm install
cp .env.example .env   # then fill in DERIV_CLIENT_ID
```

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Make your changes with clear, focused commits.
3. Ensure all checks pass before opening a pull request:

   ```bash
   npm test            # all 158+ tests must pass
   npm run lint        # ESLint must be clean
   npm run format:check # Prettier formatting must be clean
   npm run build       # frontend build must succeed
   ```

4. If you add a new feature, add or update tests covering it.
5. If you change security-relevant code (auth, cookies, SQL, input validation), describe the threat model in your PR description.

## Code Style

- JavaScript (ES modules) throughout. No TypeScript at present.
- Run `npm run format` to auto-format with Prettier before committing.
- Prefer explicit, readable code over dense single-line statements.
- Never swallow errors silently — at minimum log the message.

## Security

Review `SECURITY.md` before working on authentication, session handling, or any broker-adjacent code. **Never commit `.env`, access tokens, API secrets, or MT5 credentials.**

## Commit Messages

Use the imperative mood: "Add rate limiter to demo routes" rather than "Added rate limiter".

## Pull Requests

- Keep PRs focused on a single concern.
- Include a summary of changes and the motivation.
- Reference any related issue.
