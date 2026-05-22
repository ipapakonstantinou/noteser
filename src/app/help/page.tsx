import { redirect } from 'next/navigation'

// Bare /help redirects to the first help page. The actual content lives
// under /help/[slug]. Keeps the URL convention "every help page has a
// slug" without forcing the user to know the slug.
export default function HelpIndex() {
  redirect('/help/getting-started')
}
