# Monetization spec — Noteser, 2026-05-22

Written overnight per the maintainer's request: "How can I make this
app billable?" This doc is **spec-only**. No code lands in this pass.

## Constraints

- Solo maintainer, low ops appetite.
- Project is browser-first (Next.js on Vercel). Notes live in
  localStorage + optional GitHub repo / local folder. Zero server-side
  user state today.
- BYO-key AI features already shipped — users pay their own provider
  bills for Anthropic / OpenAI.
- GitHub OAuth is the only identity we have. Some users (anonymous
  local-only) have no identity at all.
- The product is open-source (MIT) and will stay open-source. Paid
  features must be the kind users opt into, not gates on existing
  functionality.

## Goals

1. Generate enough recurring revenue to offset hosting (Vercel + any
   paid email/KV service) — call it $50/mo break-even, $200/mo
   sustainable solo income.
2. Don't burn the open-source goodwill — the free tier MUST remain
   credible and useful.
3. Minimize new server-side complexity. One Stripe webhook + one
   KV-backed customer record is the line; anything more invites
   on-call work the maintainer doesn't want.

## What competing apps do

- **Obsidian** — Free for personal use. Paid tiers: Sync ($5/mo,
  encrypted sync to their servers) + Publish ($10/mo, hosted public
  notes) + Catalyst (one-off donation tiers). License for
  commercial use ($50/yr).
- **Logseq** — Free + accepts donations. Hosted Logseq Sync coming.
- **Notion** — Freemium with hard limits on blocks/members for the
  free tier. Paid tiers at $10/$20/$25.
- **Reflect** — $10/mo, no free tier beyond a 14-day trial. AI-first.
- **Bear** — One-time iOS app purchase + optional Pro for sync ($15/yr).
- **Capacities / Tana** — Both have generous free tiers + a $10/mo
  paid tier for sync/collab.

**Pattern**: pure-OSS apps lean on donations + a hosted commercial
tier. Closed-source / Notion-style apps gate features and members.
Obsidian's model — free core, paid sync/publish add-ons — is the
closest analogue to noteser.

## Proposed monetization shape

Two-tier model, both opt-in:

### Free (status quo)

Everything noteser ships today:
- Markdown editor + live preview
- Local-only notes
- GitHub sync (using the user's own repo)
- Local folder sync + in-browser git
- BYO-key AI features
- Encryption
- Mobile responsive layout

### Noteser Plus — $4/mo or $40/yr

Add-on features that need server-side infrastructure or premium
service:

1. **Hosted vault sync** — for users who don't want to manage a
   GitHub repo. Noteser provides a managed encrypted vault on our
   infra (Vercel KV / Cloudflare R2 / Tigris). Sync to noteser
   servers instead of GitHub. ~$2/mo cost for typical vault size.
2. **Sharing public notes** — gated subset of the existing
   share/publish flow. Public-by-default URL at noteser.app/p/<slug>
   that survives without the user keeping their browser open. Bare
   shares stay in the free tier; permanent published pages move to
   Plus.
3. **Custom domain for shared notes** — `notes.<your-domain>` as a
   CNAME to noteser. Common pattern with Hosted publishing services.
4. **Priority issue handling + Discord access** — soft benefit. The
   community Discord stays free; Plus members get a "supporters"
   channel that gets monitored more closely.

### Lifetime + sponsor tiers

- **Founding supporter — $99 one-time** — lifetime Plus for early
  adopters. Caps at 100 supporters; signals "I want this to succeed."
- **GitHub Sponsor** — tip jar at any level. Already discussed
  in task #24. Independent of Plus.

## Technical shape

Server-side surface required (lowest-cost path):

1. **Stripe Checkout + Billing Portal** — handles the entire payment
   UX off-platform. Users hit /checkout/plus, Stripe collects card,
   Stripe sends us a webhook on subscription.lifecycle events.
2. **Vercel KV** — one record per Stripe customer:
   `{ githubUserId, stripeCustomerId, plan, status, validThrough }`.
   Keyed on GitHub user id so existing OAuth identity carries
   straight through.
3. **Webhook route** — `/api/stripe/webhook` receives `checkout.
   session.completed`, `customer.subscription.updated`, `customer.
   subscription.deleted`. Updates the KV record.
4. **Plan check** — a thin `useUserPlan()` hook hits `/api/me/plan`
   (which reads KV via the GitHub user id) and caches the result
   for 5 min. The Plus features check this hook before rendering
   their UI.

That's the whole serverside footprint. No database, no Auth0, no
queues. Stripe and KV between them carry the entire billing story.

## What ships first

If/when the maintainer says go, the order:

1. **Plus tier scaffolding** (1-2 days): /api/stripe/webhook,
   useUserPlan hook, Settings → Plus section showing the
   checkout button + current plan status.
2. **First gated feature: hosted vault sync** (1-2 weeks): KV-
   backed encrypted note storage with a sync protocol that mirrors
   the GitHub sync's shape. Encryption uses the same vault crypto
   layer that's already shipped — server only stores ciphertext.
3. **Public published pages** (1 week): /api/publish + /p/[slug]
   route. Plus-gated on the "permanent" tier; bare shares stay free.
4. **Custom domain** (3-5 days): a config row in KV mapping CNAME →
   user-id, served via a Vercel rewrite.

Founding supporter promo is a one-time payment that creates a Plus
subscription with `valid_through = null` (never expires).

## Open questions for the maintainer

1. **Is the $4/mo number right?** Obsidian Sync is $5. Going under
   undercuts them; going over invites comparison. $4 splits the
   difference. Could also try $5 to match Obsidian and reduce
   psychological friction.
2. **Should the hosted vault sync USE GitHub repos under the hood
   (managed by us) or our own R2 buckets?** Managed GitHub is
   cheaper to operate (their CDN, their durability guarantee) but
   feels weird for paying users. R2/Tigris is more native but
   adds an ops surface.
3. **Founding supporter cap — 100? 250?** Lower = more exclusive,
   easier to honour lifetime obligations. Higher = more launch
   revenue.
4. **What's the trial story?** Obsidian Sync doesn't have one.
   Reflect has 14 days. Capacities has a generous free tier.
   Noteser's free tier IS already generous; no trial may be the
   right call.

## Cost ceiling

Stripe: 2.9% + 30¢ per transaction. ~$0.42 per $4/mo subscription.
Vercel KV (Upstash Redis): free tier 10k commands/day. Comfortably
covers the first 200 paying users.
Vercel Pro hosting: $20/mo when noteser outgrows the hobby tier.

Break-even at ~15 Plus users.

## Decision needed before any code

The maintainer needs to choose between:

- **A. Pure donations** — GitHub Sponsors + Ko-fi. Zero infra. Zero
  recurring obligation. Capped upside.
- **B. Stripe-backed Plus tier** — Spec above. Real recurring
  revenue, but commits the maintainer to running the billing layer.
- **C. One-time license fee for commercial use** — Obsidian's
  parallel revenue stream. $50/yr for organisations. Browser-app
  hard to enforce; honour-system pricing.

This doc assumes B is the eventual answer because it's the only
option that scales the maintainer's time investment. But A is
shippable today; B is a 2-3 week project.

---

**Next concrete step**: maintainer signs off on B (or chooses A/C),
then I scaffold the Stripe webhook + KV record + useUserPlan hook
on a feat branch.
