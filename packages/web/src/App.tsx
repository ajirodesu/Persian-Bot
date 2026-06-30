import { RouterProvider } from 'react-router-dom'
import { router } from '@/routes/router'

/**
 * App component serves as the RouterProvider wrapper.
 * It connects the router configuration to the React app,
 * enabling all route definitions from routes/router.tsx.
 */
export default function App() {
  return <RouterProvider router={router} />
}
