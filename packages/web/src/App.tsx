import { RouterProvider } from 'react-router-dom'
import { useEffect } from 'react'
import { router } from '@/routes/router'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { onSlowFirstRequest } from '@/lib/cold-start.lib'

/**
 * Listens for the API client's slow-first-request signal (backend waking
 * from cold start) and surfaces a transient notice. Renders nothing.
 */
function ColdStartNotice() {
  const { snackbar } = useSnackbar()

  useEffect(
    () =>
      onSlowFirstRequest(() => {
        snackbar({
          message:
            'Waking up the server — first load can take a few seconds.',
          duration: 6000,
        })
      }),
    [snackbar],
  )

  return null
}

/**
 * App component serves as the RouterProvider wrapper.
 * It connects the router configuration to the React app,
 * enabling all route definitions from routes/router.tsx.
 */
export default function App() {
  return (
    <>
      <RouterProvider router={router} />
      <ColdStartNotice />
    </>
  )
}
