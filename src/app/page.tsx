import { redirect } from 'next/navigation'

/**
 * The board is the front page. Signing in is only needed to act, so a visitor
 * lands on the ranking rather than on a login form.
 */
export default function HomePage() {
  redirect('/dashboard')
}
