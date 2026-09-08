import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

// Raw-HTML / XSS sink bans. These mirror the static-source security
// guards in src/__tests__/markdownXssGuard.test.tsx (no rehype-raw, no
// dangerouslySetInnerHTML, no `.innerHTML =`). The Jest guards stay as
// the belt; these lint rules are the suspenders — they surface the same
// regressions live in the editor / on every `npm run lint`, before a
// contributor even runs the suite.
//
// NB: this block lives in its OWN flat-config object (NOT merged into the
// next preset's objects). Custom `rules` placed inside one of those
// objects can get shadowed by a later, more specific one; a top-level
// object in the exported array applies cleanly to every linted file.
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

// eslint-config-next 16 bumps eslint-plugin-react-hooks 5.x -> 7.x, which
// ships the new React Compiler rule set (rules-of-hooks/exhaustive-deps
// are unaffected and still enforced). Adopting those rules means
// reviewing ~90 pre-existing call sites for real behavior changes, which
// is out of scope for this dependency-version fix — tracked separately.
const reactCompilerRulesNotYetAdopted = {
  rules: {
    'react-hooks/set-state-in-effect': 'off',
    'react-hooks/refs': 'off',
    'react-hooks/static-components': 'off',
    'react-hooks/immutability': 'off',
    'react-hooks/purity': 'off',
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
  ...nextCoreWebVitals,
  reactCompilerRulesNotYetAdopted,
  xssSinkBans,
]

export default eslintConfig
