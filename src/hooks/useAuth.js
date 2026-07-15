import { useCallback, useEffect, useState } from 'react'
import supabase, { getSession, initAuth, isSupabaseConfigured } from '../api/supabaseClient'
import { fetchProfile, isAdminEmail, resolveProfileRoleForEmail, upsertProfileAfterAuth } from '../api/supabaseDb'

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
      // Ensure role/email stay in sync without wiping admin.
      const row = await upsertProfileAfterAuth(user, {
        email: user.email,
        fullName: user.user_metadata?.full_name || '',
      })
      setProfile(row)
      return row
    } catch {
      try {
        const row = await fetchProfile(user.id)
        setProfile(row)
        return row
      } catch {
        const email = String(user.email || '').trim()
        const fallback = {
          id: user.id,
          email,
          fullName: String(user.user_metadata?.full_name || '').trim(),
          role: resolveProfileRoleForEmail(email),
        }
        setProfile(fallback)
        return fallback
      }
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

      let row = null
      try {
        row = await upsertProfileAfterAuth(user, options)
      } catch (err) {
        console.warn('Не удалось сохранить профиль', err)
        try {
          row = await fetchProfile(user.id, { accessToken: options.accessToken })
        } catch {
          row = {
            id: user.id,
            email: String(user.email || options.email || '').trim(),
            fullName: String(options.fullName || user.user_metadata?.full_name || '').trim(),
            role: resolveProfileRoleForEmail(user.email || options.email),
          }
        }
      }

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
    isAdmin:
      profile?.role === 'admin' ||
      isAdminEmail(profile?.email || session?.user?.email || ''),
    email: profile?.email || session?.user?.email || '',
    refreshAuth,
    completeAuth,
    signOut,
    passwordRecovery,
    clearPasswordRecovery,
    authRequired: isSupabaseConfigured,
  }
}
