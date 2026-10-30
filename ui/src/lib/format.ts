export const fmt = (v: number, dp = 2) => v.toFixed(dp).replace('-0.00', '0.00')
export const fmtSigned = (v: number, dp = 1) => (v > 0 ? '+' : '') + v.toFixed(dp)
export const fmtRate = (hz: number) => `${(hz / 1000).toString().replace('.', ',')} kHz`
