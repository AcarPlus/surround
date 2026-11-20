import type { Device } from '../api/types'
import { Card } from './ui'

/** Bulunan çıkış cihazları, işaret kutusuyla (Ölçmeden başla ve Kolay kurulum ortak). */
export function DeviceChecklist({
  list,
  excluded,
  onToggle,
}: {
  list: Device[]
  excluded: ReadonlySet<string>
  onToggle: (deviceId: string) => void
}) {
  return (
    <Card className="divide-y divide-line">
      {list.map((d) => (
        <label key={d.id} className="flex cursor-pointer items-center gap-3 p-3.5">
          <input
            type="checkbox"
            checked={!excluded.has(d.id)}
            onChange={() => onToggle(d.id)}
            className="h-4 w-4 accent-[rgb(var(--accent))]"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{d.name}</span>
            <span className="block text-xs text-muted">
              {d.channels > 2 ? `${d.channels} kanallı sistem` : d.channels === 1 ? 'Tek hoparlör' : 'Sol + sağ hoparlör çifti'}
              {d.kind === 'bluetooth' ? ' · Bluetooth (gecikmesi ölçümle eşitlenir)' : ''}
            </span>
          </span>
        </label>
      ))}
    </Card>
  )
}

/** Set'te öğeyi açıp kapatır (yeni Set döner). */
export function toggleInSet(set: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(set)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}
