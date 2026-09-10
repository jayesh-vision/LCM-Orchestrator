import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useStore } from '@/store/useStore'
import type { Service } from '@/types'
import {
  Button, Drawer, Field, KV, Modal, Mono, Note, TextInput,
} from '@/components/ui'

/**
 * Modify and Cease both used to raise a provisioning request the instant the
 * button was clicked, with a canned delta nobody typed. These dialogs put a
 * real step in front of that: enter what should change (or why it should
 * cease), see exactly what will be submitted, and only then confirm.
 */

const TEXTAREA_CLS = 'w-full px-3 py-2.5 border border-line rounded-md text-[13px] outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 resize-y'

/** Every attribute except the "Purchase order" placeholder, which has no
 *  source system and nothing to request a change against. */
function editableAttributes(service: Service) {
  return service.attributes.filter((a) => a.source !== 'No source system')
}

/** Only Bandwidth can be requested through this form today — every other
 *  attribute is shown for context (current value) but locked, not editable. */
const MODIFIABLE_ATTRS = new Set(['Bandwidth'])

interface ModifyServiceDrawerProps {
  service: Service | null
  onClose: () => void
}

export function ModifyServiceDrawer({ service, onClose }: ModifyServiceDrawerProps) {
  const raiseChange = useStore((s) => s.raiseChange)
  const nav = useNavigate()
  const [phase, setPhase] = useState<'edit' | 'summary'>('edit')
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!service) return
    setPhase('edit')
    setReason('')
    setError(null)
    setValues(Object.fromEntries(editableAttributes(service).map((a) => [a.name, a.intent])))
  }, [service])

  const attrs = service ? editableAttributes(service) : []
  const changed = attrs.filter((a) => (values[a.name] ?? a.intent).trim() !== a.intent)

  const handleReview = () => {
    if (changed.length === 0) { setError('Change at least one value before continuing.'); return }
    if (!reason.trim()) { setError('A reason for the modification is required.'); return }
    setError(null)
    setPhase('summary')
  }

  const handleConfirm = () => {
    if (!service) return
    const delta = changed.map((a) => ({ attribute: a.name, current: a.intent, requested: values[a.name] }))
    const params = changed.map((a) => ({ name: a.name, value: values[a.name], source: 'user' as const }))
    const order = raiseChange(service.id, 'Modify', delta, params, reason.trim())
    onClose()
    nav(`/requests/${order.id}`)
  }

  return (
    <Drawer
      open={!!service} onClose={onClose}
      title={phase === 'edit' ? 'Modify service' : 'Confirm change'}
      sub={service ? `${service.id} · ${service.name}` : undefined}
      width={640}
      footer={service && (
        phase === 'edit' ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleReview}>Review changes</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setPhase('edit')}>Back</Button>
            <Button variant="primary" onClick={handleConfirm}><CheckCircle2 size={15} />Confirm &amp; create request</Button>
          </>
        )
      )}
    >
      {service && phase === 'edit' && (
        <div className="flex flex-col gap-4">
          <Note>Enter a new value only for what needs to change. Anything left as-is is not included in the request.</Note>
          <div className="flex flex-col gap-3">
            {attrs.map((a) => {
              const editable = MODIFIABLE_ATTRS.has(a.name)
              return (
                <Field key={a.name} label={a.name} hint={editable ? `Current: ${a.intent}` : `Current: ${a.intent} · not editable in this form`}>
                  <TextInput
                    value={editable ? (values[a.name] ?? '') : a.intent}
                    readOnly={!editable}
                    tabIndex={editable ? undefined : -1}
                    className={editable ? '' : 'bg-plane text-ink-2 cursor-not-allowed'}
                    onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                  />
                </Field>
              )
            })}
          </div>
          <Field label="Reason for modification" required hint="Recorded on the order and shown on the approval trail.">
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Customer requested higher throughput ahead of a traffic increase…"
              className={TEXTAREA_CLS}
            />
          </Field>
          {error && <Note tone="crit">{error}</Note>}
        </div>
      )}

      {service && phase === 'summary' && (
        <div className="flex flex-col gap-4">
          <Note tone="warn">A provisioning request is only created once you confirm below.</Note>
          <div className="border border-line rounded-lg overflow-hidden">
            <table className="w-full text-[13px]">
              <thead><tr className="bg-plane">
                {['Attribute', 'Current', 'Requested'].map((h) => (
                  <th key={h} scope="col" className="text-left px-3.5 py-2 text-[11px] uppercase tracking-wide text-ink-3 font-semibold">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {changed.map((a) => (
                  <tr key={a.name} className="border-t border-line-soft">
                    <td className="px-3.5 py-2 font-medium">{a.name}</td>
                    <td className="px-3.5 py-2 font-mono text-ink-3">{a.intent}</td>
                    <td className="px-3.5 py-2 font-mono font-semibold text-brand-600">{values[a.name]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <KV items={[['Reason', reason], ['Service', <Mono key="s">{service.id}</Mono>]]} />
        </div>
      )}
    </Drawer>
  )
}

interface CeaseServiceModalProps {
  service: Service | null
  onClose: () => void
}

export function CeaseServiceModal({ service, onClose }: CeaseServiceModalProps) {
  const raiseChange = useStore((s) => s.raiseChange)
  const nav = useNavigate()
  const [reason, setReason] = useState('')

  useEffect(() => { setReason('') }, [service])

  return (
    <Modal
      open={!!service} onClose={onClose}
      title="Cease service" sub={service ? `${service.id} · ${service.name}` : undefined}
      footer={service && (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger" disabled={!reason.trim()}
            onClick={() => {
              const order = raiseChange(service.id, 'Cease', undefined, undefined, reason.trim())
              onClose()
              nav(`/requests/${order.id}`)
            }}
          >
            <XCircle size={15} />Confirm cease &amp; create request
          </Button>
        </>
      )}
    >
      {service && (
        <div className="flex flex-col gap-4">
          <Note tone="crit">
            Ceasing is traffic-affecting and final. Resources move to quarantine, not straight back to the pool.
            A provisioning request is only created once you confirm below.
          </Note>
          <Field label="Reason for cease" required hint="Recorded on the order and shown on the approval trail.">
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="Customer churn — contract ended 30 Sep…"
              className={TEXTAREA_CLS}
            />
          </Field>
        </div>
      )}
    </Modal>
  )
}
