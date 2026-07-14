import { useCallback, useEffect, useState } from 'react'
import supabase, { getSession, initAuth, isSupabaseConfigured } from '../api/supabaseClient'
import { fetchProfile, upsertProfileAfterAuth } from '../api/supabaseDb'

export function useAuth() {
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  const loadProfile = useCallback(async (user) => {
    if (!user?.id) {
      setProfile(null)
      return null
    }
    try {
      const row = await fetchProfile(user.id)
      setProfile(row)
      return row
    } catch {
      setProfile(null)
      return null
    }
  }, [])

  const refreshAuth = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      setSession(null)
      setProfile(null)
      return
    }

    setLoading(true)
    try {
      await initAuth()
      const nextSession = await getSession()
      setSession(nextSession)
      if (nextSession?.user) {
        await loadProfile(nextSession.user)
      } else {
        setProfile(null)
      }
    } finally {
      setLoading(false)
    }
  }, [loadProfile])

  useEffect(() => {
    refreshAuth()
  }, [refreshAuth])

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined

    const { data } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      }
      setSession(nextSession)
      if (nextSession?.user) {
        await loadProfile(nextSession.user)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    return () => {
      data?.subscription?.unsubscribe?.()
    }
  }, [loadProfile])

  const clearPasswordRecovery = useCallback(() => {
    setPasswordRecovery(false)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
  }, [])

  const completeAuth = useCallback(
    async (user, options = {}) => {
      if (!user?.id) return null
      const row = await upsertProfileAfterAuth(user, options)
      setSession(await getSession())
      setProfile(row)
      return row
    },
    [],
  )

  return {
    loading,
    session,
    profile,
    user: session?.user ?? null,
    isAuthenticated: Boolean(session?.user),
    isAdmin: profile?.role === 'admin',
    email: profile?.email || session?.user?.email || '',
    refreshAuth,
    completeAuth,
    signOut,
    passwordRecovery,
    clearPasswordRecovery,
    authRequired: isSupabaseConfigured,
  }
}
