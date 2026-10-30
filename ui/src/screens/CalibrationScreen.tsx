import { Badge, Button, Card, ScreenHeader, cx } from '../components/ui'
import { IconMic } from '../components/icons'

const STEPS = [
  {
    title: 'Mikrofonu yerleştir',
    text: 'Ölçüm mikrofonunu dinleme noktasına, kulak hizasına yerleştirin. Odadaki dinleyici konumu ile aynı noktada olmalı.',
    action: 'Mikrofonu seç',
  },
  {
    title: 'Ölçüm',
    text: 'Her hoparlörden sırayla ölçüm sinyali çalınır; gelen ses kaydedilerek varış zamanı ve seviye bulunur.',
    action: 'Ölçümü başlat',
  },
  {
    title: 'Sonuçlar',
    text: 'Ölçülen gecikme ve kazançlar, odadaki hesaplanan değerlerle karşılaştırılır; isterseniz uygulanır.',
    action: 'Sonuçları uygula',
  },
]

export function CalibrationScreen() {
  return (
    <div className="h-full overflow-y-auto p-5">
      <ScreenHeader
        title="Kalibrasyon"
        sub="Mikrofonla otomatik gecikme ve seviye ayarı."
        right={<Badge tone="accent">Yakında · Faz 3</Badge>}
      />

      <ol className="mx-auto max-w-[720px] space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Card className={cx('flex items-start gap-4 p-4', i > 0 && 'opacity-80')}>
              <div
                className={cx(
                  'num flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                  i === 0 ? 'border-accent text-accent' : 'border-line-strong text-faint',
                )}
              >
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold">{s.title}</h2>
                <p className="mt-1 text-[13px] text-muted">{s.text}</p>
                <Button className="mt-3" disabled>
                  {i === 0 && <IconMic width={14} height={14} />} {s.action}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <p className="mx-auto mt-6 max-w-[720px] rounded-lg border border-dashed border-line-strong p-4 text-[13px] text-muted">
        <span className="font-semibold text-fg">Yakında.</span> Kalibrasyon sonraki aşamada (Faz 3) eklenecek. Şimdilik
        gecikme ve kazançlar Oda ekranında mesafeden otomatik hesaplanır veya elle girilir.
      </p>
    </div>
  )
}
