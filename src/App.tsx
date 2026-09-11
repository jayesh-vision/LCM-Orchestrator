import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import Dashboard from '@/pages/Dashboard'
import ProvisioningRequests from '@/pages/ProvisioningRequests'
import OrderDetail from '@/pages/OrderDetail'
import NewServiceWizard from '@/pages/NewServiceWizard'
import ServiceInventory from '@/pages/ServiceInventory'
import ServiceDetail from '@/pages/ServiceDetail'
import ChangeCease from '@/pages/ChangeCease'
import Workflows from '@/pages/Workflows'
import WorkflowBuilder from '@/pages/WorkflowBuilder'
import ProfileTypes from '@/pages/ProfileTypes'
import ResourcePools from '@/pages/ResourcePools'
import Evidence from '@/pages/Evidence'
import Reports from '@/pages/Reports'
import NotFound from '@/pages/NotFound'

/**
 * The Execution queue is folded into Provisioning Requests, but its links
 * are not: dashboards, Change & Cease and old bookmarks still say
 * /execution?state=… — send them to the unified screen with their filters
 * intact. Those links expect to land on a grid of orders, so default the
 * view to Listing unless the link asked for something else.
 */
function ExecutionRedirect() {
  const { search } = useLocation()
  const p = new URLSearchParams(search)
  if (!p.has('view')) p.set('view', 'listing')
  return <Navigate to={`/requests?${p}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="requests" element={<ProvisioningRequests />} />
        <Route path="requests/new" element={<NewServiceWizard />} />
        <Route path="requests/:id" element={<OrderDetail />} />
        <Route path="execution" element={<ExecutionRedirect />} />
        <Route path="execution/:id" element={<OrderDetail />} />
        <Route path="inventory" element={<ServiceInventory />} />
        <Route path="inventory/:id" element={<ServiceDetail />} />
        <Route path="change" element={<ChangeCease />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="workflows/new" element={<WorkflowBuilder />} />
        <Route path="workflows/:id" element={<WorkflowBuilder />} />
        <Route path="profile-types" element={<ProfileTypes />} />
        <Route path="pools" element={<ResourcePools />} />
        <Route path="evidence" element={<Evidence />} />
        <Route path="reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
