import { Link } from 'react-router-dom'
import { Card, CardBody } from '@/components/ui'

export default function NotFound() {
  return (
    <Card>
      <CardBody className="text-center py-16">
        <div className="text-[22px] font-semibold mb-2">Screen not found</div>
        <p className="text-ink-3 text-[13px] mb-5">That route does not exist in this prototype.</p>
        <Link to="/" className="text-brand-600 text-[13px] font-medium">Back to the dashboard</Link>
      </CardBody>
    </Card>
  )
}
