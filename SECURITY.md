# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

Use GitHub's private vulnerability reporting: on the repository, go to the
**Security** tab and choose **Report a vulnerability** (this opens a private
advisory only the maintainers can see). Include what you found, how to
reproduce it, and the impact you expect. You will get a response as the report
is reviewed.

## Trust model (important context)

Noteser runs entirely in your browser and talks directly to GitHub:

- Your notes live in the browser (`localStorage` / IndexedDB) and, if you turn
  on sync, in a GitHub repository you own. There is no Noteser server holding
  your notes.
- The GitHub access token is stored in the browser (`localStorage`), the same
  trust model as the Obsidian Git plugin. A successful cross-site-scripting
  (XSS) attack against the app could read that token, so reports of XSS or any
  way to inject script are taken seriously.
- The only server-side code is two thin OAuth proxy routes (`/api/github/*`)
  that forward to GitHub's OAuth endpoints; they store nothing and are
  rate-limited per IP.

## Please never include in a report or an issue

- A real GitHub token or any credential.
- Private note contents.

Redact those before sharing reproduction steps.
