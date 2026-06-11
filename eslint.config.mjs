import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next 15.x ships eslintrc-format presets only (the flat
// subpath exports like `eslint-config-next/core-web-vitals` arrive in
// Next 16), so the migration off the deprecated `next lint` keeps
// FlatCompat and just runs the ESLint CLI directly (`eslint .`).
const compat = new FlatCompat({
  baseDirectory: __dirname,
})

// Raw-HTML / XSS sink bans. These mirror the static-source security
// guards in src/__tests__/markdownXssGuard.test.tsx (no rehype-raw, no
// dangerouslySetInnerHTML, no `.innerHTML =`). The Jest guards stay as
// the belt; these lint rules are the suspenders — they surface the same
// regressions live in the editor / on every `npm run lint`, before a
// contributor even runs the suite.
//
// NB: this block lives in its OWN flat-config object (NOT inside the
// FlatCompat-wrapped next preset). Custom `rules` placed inside the
// compat.extends() output get silently dropped; a top-level object in
// the exported array applies cleanly to every linted file.
const xssSinkBans = {
  // Scope to production source only. Tests legitimately build DOM
  // fixtures via `.innerHTML =`, and the matching Jest guard
  // (markdownXssGuard.test.tsx) already excludes `__tests__` from its
  // walk — so the lint rule honours the same boundary.
  ignores: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message:
          'dangerouslySetInnerHTML is banned (XSS). Render through react-markdown or escape with escapeHTML first. See markdownXssGuard.test.tsx.',
      },
      {
        selector:
          "AssignmentExpression[left.type='MemberExpression'][left.property.name='innerHTML']",
        message:
          'Assigning .innerHTML is a raw-HTML XSS sink. Use textContent, or a sanitized render path. See markdownXssGuard.test.tsx.',
      },
    ],
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'rehype-raw',
            message:
              'rehype-raw re-enables raw HTML in markdown (XSS). It must never be added to the render pipeline. See markdownXssGuard.test.tsx.',
          },
        ],
      },
    ],
  },
}

const eslintConfig = [
  // Global ignores. `next lint` only covered the source dirs; the ESLint
  // CLI lints everything under `.`, so exclude build output and the
  // static assets dir (public/plugins holds built/vendored plugin
  // bundles, including minified third-party code).
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'public/**',
      'next-env.d.ts',
      // Cloudflare Worker with its own toolchain (wrangler + workers
      // types) — linted/typechecked from collab-server/, not here.
      'collab-server/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
  xssSinkBans,
]

export default eslintConfig
