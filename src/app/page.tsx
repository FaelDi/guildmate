import { redirect } from 'next/navigation'
import { SignInCard } from '@/components/sign-in-card'
import { PublicHeader } from '@/components/vx/public-header'
import { getDictionary } from '@/lib/i18n'
import { getSessionContext } from '@/lib/session'

export default async function HomePage() {
  const session = await getSessionContext()
  if (session) redirect('/dashboard')

  const t = await getDictionary()

  return (
    <main>
      <PublicHeader signInLabel={t.vx.memberAccess} joinLabel={t.auth.createAccount} />
      <SignInCard />
    </main>
  )
}
