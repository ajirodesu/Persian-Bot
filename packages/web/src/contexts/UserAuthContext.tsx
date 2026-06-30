import React, { createContext, useContext } from 'react'
import { authUserClient } from '@/lib/better-auth-client.lib'

// Type definitions
interface User {
  id: string
  name: string
  email: string
  image?: string
  role: string
  createdAt: Date
  updatedAt: Date
}

interface Session {
  session: {
    userId: string
    expiresAt: Date
    token: string
    [key: string]: unknown
  }
  user: User
}

interface UserAuthContextType {
  session: Session | null
  user: User | null
  error: Error | null
  login: (
    email: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => void
  isAuthenticated: boolean
  isLoading: boolean
}

const UserAuthContext = createContext<UserAuthContextType | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export const useUserAuth = () => {
  const context = useContext(UserAuthContext)
  if (!context) {
    throw new Error('useUserAuth must be used within a UserAuthProvider')
  }
  return context
}

export const UserAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    data: session,
    isPending,
    error,
    refetch,
  } = authUserClient.useSession()

  const login = async (
    email: string,
    password: string,
    rememberMe: boolean = false,
  ) => {
    const result = await authUserClient.signIn.email(
      {
        email,
        password,
        rememberMe,
      },
      {
        onSuccess: () => {
          console.log('✅ User login successful')
        },
        onError: (ctx) => {
          console.error('❌ User login failed:', ctx.error)
          throw new Error(ctx.error.message || 'Login failed')
        },
      },
    )

    if (result.error) {
      throw new Error(result.error.message || 'Login failed')
    }

    // Refresh session after login
    await refetch()
  }

  const logout = async () => {
    try {
      const result = await authUserClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            console.log('✅ User logout successful')
          },
          onError: (ctx) => {
            console.error('❌ User logout failed:', ctx.error)
          },
        },
      })

      if (result.error) {
        console.error('Logout error:', result.error)
        throw new Error(result.error.message || 'Logout failed')
      }

      // Refresh session to clear the authenticated state
      await refetch()
    } catch (error) {
      console.error('Logout failed:', error)
      throw error
    }
  }

  const value: UserAuthContextType = {
    session: session as Session | null,
    user: (session as Session | null)?.user ?? null,
    error,
    isAuthenticated: !!session,
    isLoading: isPending,
    login,
    logout,
    refreshSession: refetch,
  }

  return (
    <UserAuthContext.Provider value={value}>
      {children}
    </UserAuthContext.Provider>
  )
}

// Export types for use in other files
export type { User, Session, UserAuthContextType }
