import { useStore } from '../store/useStore'
import { Card, ScreenHeader, SectionTitle, Switch } from '../components/ui'
import { CableSetup, Meters, SourcePanel } from './SourcePanels'
import { OutputsPanel } from './OutputsPanel'

/** Kaynak (VB-Cable) + çıkış cihazları + kanal seviyeleri: teknik bağlantı ayrıntıları tek yerde. */
export function ConnectionScreen() {
  const lowLatency = useStore((s) => s.lowLatency)
  const setLowLatency = useStore((s) => s.setLowLatency)
  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader
        title="Bağlantı"
        sub="Sesin nereden alındığı, hangi cihazlara gittiği ve canlı durum."
        right={
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted" title="Bluetooth/ağ cihazlarını devre dışı bırakır">
            <Switch checked={lowLatency} onChange={setLowLatency} label="Düşük gecikme" />
            Düşük gecikme
          </label>
        }
      />
      <CableSetup />
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <SourcePanel />
        <Card className="p-4">
          <Meters />
        </Card>
      </div>
      <div className="mt-6">
        <SectionTitle>Çıkış cihazları</SectionTitle>
        <p className="mb-3 text-xs text-muted">
          Tampon büyüdükçe kesinti azalır ama gecikme artar. “Ek gecikme”, bir cihazın tümüyle geç kaldığı durumlar içindir
          (ör. Bluetooth); kalibrasyon bunu zaten ölçer.
        </p>
        <OutputsPanel />
      </div>
    </div>
  )
}
