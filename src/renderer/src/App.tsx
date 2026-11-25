import { useEffect, useState } from 'react'
import type { Preferences, Session } from '../../shared/ipc'
import { MergeApp } from './merge/MergeApp'
import { applyTheme } from './theme'

export default function App(): React.JSX.Element | null {
  const [session, setSession] = useState<Session | null>(null)
  const [prefs, setPrefs] = useState<Preferences | null>(null)

  useEffect(() => {
    void window.api.getSession().then((s) => {
      setSession(s)
      setPrefs(s.prefs)
    })
  }, [])

  useEffect(() => {
    if (prefs) applyTheme(prefs.theme)
  }, [prefs])

  if (!session) return null
  return <MergeApp host={window.api} session={session} onPrefs={setPrefs} />
}
