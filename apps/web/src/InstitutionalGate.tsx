import { FormEvent, useEffect, useMemo, useState } from 'react'
import App, { drawKitchenStyleReport } from './App'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const configuredApi = import.meta.env.VITE_API_URL?.trim() || '/api'
const API = configuredApi.endsWith('/') ? configuredApi.slice(0, -1) : configuredApi
type User = { sub: string; role: string; personId: string; fullName: string }
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const sessionHeaders = (token: string) => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' })
const formatMinutes = (value = 0) => `${Math.floor(value / 60)} h ${String(value % 60).padStart(2, '0')}`
const SCHOOL_TIME_ZONE = 'Africa/Kinshasa'
const schoolClockParts = (value: string) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: SCHOOL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
const schoolClockDecimal = (value: string) => { const parts = schoolClockParts(value); return Number(parts.hour) + Number(parts.minute) / 60 }
const formatSchoolTime = (value: string, language: Language) => new Date(value).toLocaleTimeString(language === 'fr' ? 'fr-FR' : 'en-US', { timeZone: SCHOOL_TIME_ZONE, hour: '2-digit', minute: '2-digit' })
type Language = 'fr' | 'en'
const copy = {
  fr: {
    today: "Aujourd’hui", week: '7 jours', month: '31 jours', year: 'Année', personal: 'ESPACE PERSONNEL', install: 'Installer Sentinel', logout: 'Déconnexion',
    attendanceDays: 'jour(s) de présence', entries: 'entrée(s)', analysis: 'ANALYSE PERSONNELLE', figures: 'Ma fréquentation en chiffres', punctuality: 'de ponctualité', presence: 'Présence',
    avgArrival: 'Arrivée moyenne', avgDeparture: 'Sortie moyenne', avgDuration: 'Durée moyenne', completeDays: 'Jours complets', trend: 'Tendance', date: 'Date', firstEntry: 'Première entrée',
    lastExit: 'Dernière sortie', duration: 'Durée', status: 'Statut', ongoing: 'En cours / incomplet', late: 'Retard', onTime: "À l’heure", noMovement: 'Aucun mouvement enregistré pour cette période.',
    visualTitle: 'Lecture scientifique de ma fréquentation', visualHelp: 'Les graphiques utilisent uniquement les mouvements Sentinel vérifiés.', durationChart: 'Durée de présence quotidienne', punctualityChart: 'Ponctualité',
    arrivalChart: "Évolution de l’heure d’arrivée", hours: 'heures', traceability: 'TRAÇABILITÉ', justify: 'Justifier une absence ou un retard', justifyHelp: 'Votre demande est transmise à KCS et reste traçable jusqu’à sa décision.',
    absence: 'Absence', detailedReason: 'Motif détaillé et vérifiable', sending: 'Envoi sécurisé…', send: 'Envoyer à KCS', myJustifications: 'Mes justificatifs', searchJustifications: 'Rechercher par date, type, statut ou motif…',
    allStatuses: 'Tous les statuts', pending: 'En attente', approved: 'Approuvé', rejected: 'Rejeté', noJustification: 'Aucun justificatif ne correspond à cette recherche.', secureAccess: 'ACCÈS SÉCURISÉ',
    institutionalLogin: 'Connexion institutionnelle', loginHelp: "Utilisez votre e-mail ou code d’accès KCS Orbit habituel.", identifier: "E-mail ou code d’accès", password: 'Mot de passe', showPassword: 'Afficher le mot de passe',
    hidePassword: 'Masquer le mot de passe', secureLogin: 'Connexion sécurisée…', enter: 'Entrer dans Sentinel', encrypted: 'Identité Orbit chiffrée · session auditée · aucune donnée de démonstration', campus: 'Sécurité du campus · KCS Orbit',
    tagline: 'Chaque entrée. Chaque sortie. Une preuve institutionnelle.', realtime: 'Registre temps réel', access: 'Accès institutionnel', auditable: 'Historique auditable'
  },
  en: {
    today: 'Today', week: '7 days', month: '31 days', year: 'Year', personal: 'PERSONAL SPACE', install: 'Install Sentinel', logout: 'Sign out',
    attendanceDays: 'attendance day(s)', entries: 'entry event(s)', analysis: 'PERSONAL ANALYSIS', figures: 'My attendance at a glance', punctuality: 'punctuality', presence: 'Attendance',
    avgArrival: 'Average arrival', avgDeparture: 'Average departure', avgDuration: 'Average duration', completeDays: 'Complete days', trend: 'Trend', date: 'Date', firstEntry: 'First entry',
    lastExit: 'Last exit', duration: 'Duration', status: 'Status', ongoing: 'Ongoing / incomplete', late: 'Late', onTime: 'On time', noMovement: 'No movement recorded for this period.',
    visualTitle: 'Scientific view of my attendance', visualHelp: 'Charts use verified Sentinel movements only.', durationChart: 'Daily attendance duration', punctualityChart: 'Punctuality',
    arrivalChart: 'Arrival-time trend', hours: 'hours', traceability: 'TRACEABILITY', justify: 'Explain an absence or late arrival', justifyHelp: 'Your submission is sent to KCS and remains traceable until a decision is made.',
    absence: 'Absence', detailedReason: 'Detailed and verifiable reason', sending: 'Sending securely…', send: 'Send to KCS', myJustifications: 'My justifications', searchJustifications: 'Search by date, type, status or reason…',
    allStatuses: 'All statuses', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', noJustification: 'No justification matches this search.', secureAccess: 'SECURE ACCESS',
    institutionalLogin: 'Institutional sign in', loginHelp: 'Use your usual KCS Orbit email address or access code.', identifier: 'Email or access code', password: 'Password', showPassword: 'Show password',
    hidePassword: 'Hide password', secureLogin: 'Signing in securely…', enter: 'Enter Sentinel', encrypted: 'Encrypted Orbit identity · audited session · no demonstration data', campus: 'Campus security · KCS Orbit',
    tagline: 'Every entry. Every exit. Institutional proof.', realtime: 'Live register', access: 'Institutional access', auditable: 'Auditable history'
  }
} as const

const periodLabel = (period: string, t: typeof copy.fr | typeof copy.en) => ({ daily: t.today, weekly: t.week, monthly: t.month, yearly: t.year }[period] || period)
const statusLabel = (status: string, t: typeof copy.fr | typeof copy.en) => ({ PENDING: t.pending, APPROVED: t.approved, REJECTED: t.rejected }[status] || status)

function AttendanceVisuals({ details, punctuality, language }: { details: any[]; punctuality: number; language: Language }) {
  const t = copy[language]
  const points = [...details].slice(0, 14).reverse()
  const maxDuration = Math.max(480, ...points.map(day => Number(day.durationMinutes || 0)))
  const arrivals = points.map(day => day.firstEntry ? schoolClockDecimal(day.firstEntry) : null)
  const linePoints = arrivals.map((hour, index) => `${points.length <= 1 ? 50 : (index / (points.length - 1)) * 100},${hour == null ? 88 : Math.max(8, Math.min(92, ((hour - 5) / 6) * 84 + 8))}`).join(' ')
  return <section className="mt-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:p-7" aria-label={t.visualTitle}>
    <div><small className="font-bold tracking-widest text-cyan-300">DATA VISUALIZATION</small><h2 className="mt-2 text-2xl font-black">{t.visualTitle}</h2><p className="mt-1 text-sm text-slate-300">{t.visualHelp}</p></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
      <article className="rounded-2xl border border-white/10 bg-[#042f4d]/75 p-4"><h3 className="font-extrabold">{t.durationChart}</h3><div className="mt-5 flex h-44 items-end gap-1.5 sm:gap-2" role="img" aria-label={t.durationChart}>{points.map((day, index) => { const minutes = Number(day.durationMinutes || 0); const height = minutes ? Math.max(8, (minutes / maxDuration) * 100) : 3; return <div key={`${day.date}-${index}`} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><span className="pointer-events-none hidden text-[10px] font-bold text-cyan-100 sm:block">{minutes ? `${Math.round(minutes / 60 * 10) / 10}h` : '—'}</span><div title={`${day.date}: ${minutes ? formatMinutes(minutes) : '—'}`} className={`w-full max-w-8 rounded-t-md transition-all duration-500 group-hover:brightness-125 ${day.late ? 'bg-amber-400' : 'bg-gradient-to-t from-cyan-600 to-teal-300'}`} style={{ height: `${height}%` }} /><span className="max-w-full truncate text-[9px] text-slate-400">{String(day.date || '').slice(5)}</span></div>})}{!points.length && <div className="m-auto text-sm text-slate-400">{t.noMovement}</div>}</div></article>
      <article className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#042f4d]/75 p-5 text-center"><h3 className="font-extrabold">{t.punctualityChart}</h3><div className="relative mt-5 grid h-40 w-40 place-items-center rounded-full shadow-[0_0_45px_rgba(34,211,238,.16)]" style={{ background: `conic-gradient(#2dd4bf 0 ${Math.max(0, Math.min(100, punctuality))}%, rgba(255,255,255,.1) ${Math.max(0, Math.min(100, punctuality))}% 100%)` }}><div className="grid h-28 w-28 place-items-center rounded-full bg-[#042f4d]"><strong className="text-3xl">{punctuality}%</strong></div></div><div className="mt-4 flex gap-4 text-xs"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-teal-400" />{t.onTime}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />{t.late}</span></div></article>
    </div>
    <article className="mt-4 rounded-2xl border border-white/10 bg-[#042f4d]/75 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-extrabold">{t.arrivalChart}</h3><span className="text-xs text-slate-400">05:00–11:00</span></div><div className="mt-4 h-36 w-full"><svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-label={t.arrivalChart}><defs><linearGradient id="sentinelLine" x1="0" x2="1"><stop stopColor="#22d3ee"/><stop offset="1" stopColor="#2dd4bf"/></linearGradient></defs>{[8,36,64,92].map(y=><line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(255,255,255,.1)" strokeWidth=".5"/>)}{points.length > 0 && <polyline points={linePoints} fill="none" stroke="url(#sentinelLine)" strokeWidth="2.4" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>}</svg></div><div className="flex justify-between text-[10px] text-slate-400"><span>{points[0]?.date || '—'}</span><span>{points.at(-1)?.date || '—'}</span></div></article>
  </section>
}

export default function InstitutionalGate() {
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('sentinel-language') as Language) || 'fr')
  const [token, setToken] = useState(() => sessionStorage.getItem('sentinel-token') || '')
  const [user, setUser] = useState<User | null>(() => { try { return JSON.parse(sessionStorage.getItem('sentinel-user') || 'null') } catch { return null } })
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<any>(null)
  const [incidentType, setIncidentType] = useState('LATE')
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('monthly')
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null)
  const [installNotice, setInstallNotice] = useState('')
  const [justificationQuery, setJustificationQuery] = useState('')
  const [justificationStatus, setJustificationStatus] = useState('ALL')
  const [reportFrom, setReportFrom] = useState(() => { const date = new Date(); date.setDate(1); return date.toISOString().slice(0, 10) })
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [reportBusy, setReportBusy] = useState(false)
  const t = copy[language]

  const changeLanguage = (next: Language) => { setLanguage(next); localStorage.setItem('sentinel-language', next); document.documentElement.lang = next }
  const filteredJustifications = useMemo(() => {
    const query = justificationQuery.trim().toLocaleLowerCase(language === 'fr' ? 'fr' : 'en')
    return (data?.justifications || []).filter((item: any) => {
      if (justificationStatus !== 'ALL' && item.status !== justificationStatus) return false
      if (!query) return true
      return [item.incident_date, item.incident_type, item.status, statusLabel(item.status, t), item.reason, item.review_note].filter(Boolean).join(' ').toLocaleLowerCase(language === 'fr' ? 'fr' : 'en').includes(query)
    })
  }, [data?.justifications, justificationQuery, justificationStatus, language, t])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    const installed = () => { setInstallPrompt(null); setInstallNotice('KCS Sentinel est installé sur cet appareil.') }
    window.addEventListener('beforeinstallprompt', capture)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', installed) }
  }, [])

  useEffect(() => {
    if (!token || user?.role !== 'entity') return
    Promise.all([
      fetch(API + '/me', { headers: sessionHeaders(token) }),
      fetch(API + '/justifications', { headers: sessionHeaders(token) }),
    ]).then(async ([profile, justifications]) => {
      if (!profile.ok || !justifications.ok) throw new Error()
      setData({ ...(await profile.json()), ...(await justifications.json()) })
    }).catch(() => setError('La synchronisation est temporairement indisponible. Réessayez dans un instant.'))
  }, [token, user])

  const login = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message || 'Connexion institutionnelle refusée')
      sessionStorage.setItem('sentinel-token', body.token)
      sessionStorage.setItem('sentinel-user', JSON.stringify(body.user))
      if (body.user?.role === 'entity' && !localStorage.getItem('sentinel-language')) changeLanguage('en')
      setToken(body.token); setUser(body.user); setPassword('')
    } catch (reason: any) { setError(reason.message || 'Connexion impossible') }
    finally { setBusy(false) }
  }

  const sendJustification = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(API + '/justifications', { method: 'POST', headers: sessionHeaders(token), body: JSON.stringify({ incidentType, incidentDate, reason }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message)
      setReason('')
      const refreshed = await fetch(API + '/justifications', { headers: sessionHeaders(token) }).then(item => item.json())
      setData((current: any) => ({ ...current, ...refreshed }))
    } catch (reason: any) { setError(reason.message || 'Envoi impossible') }
    finally { setBusy(false) }
  }

  const logout = () => {
    sessionStorage.removeItem('sentinel-token'); sessionStorage.removeItem('sentinel-user')
    setToken(''); setUser(null); setData(null)
  }

  const install = async () => {
    if (window.matchMedia('(display-mode: standalone)').matches) { setInstallNotice('Sentinel fonctionne déjà comme application installée.'); return }
    if (!installPrompt) { setInstallNotice('Installation : ouvrez le menu du navigateur puis choisissez « Installer KCS Sentinel » ou « Ajouter à l’écran d’accueil ».'); return }
    await installPrompt.prompt(); const choice = await installPrompt.userChoice
    setInstallNotice(choice.outcome === 'accepted' ? 'Installation Sentinel acceptée.' : 'Installation annulée. Vous pourrez la relancer ici.')
    setInstallPrompt(null)
  }

  const printPersonalReport = async () => {
    if (!user || !reportFrom || !reportTo || reportFrom > reportTo) return
    setReportBusy(true); setError('')
    try {
      const response = await fetch(`${API}/reports/${encodeURIComponent(user.personId)}?from=${reportFrom}&to=${reportTo}`, { headers: sessionHeaders(token) })
      const report = await response.json()
      if (!response.ok) throw new Error(report.message || 'Report unavailable')
      const summary = report.custom || {}
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const documentId = `KCS-SEN-${Date.now().toString(36).toUpperCase()}-${user.personId.slice(-6).toUpperCase()}`
      await drawKitchenStyleReport(pdf, language === 'fr' ? 'RAPPORT OFFICIEL DE FRÉQUENTATION' : 'OFFICIAL ATTENDANCE REPORT', documentId)
      pdf.setTextColor(3, 41, 66); pdf.setFontSize(16); pdf.text(user.fullName, 16, 66); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.text(`${reportFrom} — ${reportTo}  |  ORBIT ID: ${user.personId}`, 16, 74)
      autoTable(pdf, { startY: 82, head: [[t.presence, t.punctualityChart, t.avgArrival, t.avgDeparture, t.avgDuration]], body: [[`${summary.attendanceDays || 0} ${t.attendanceDays}`, `${summary.punctualityRate || 0}%`, summary.averageArrival || '—', summary.averageDeparture || '—', formatMinutes(summary.averagePresenceMinutes || 0)]], headStyles: { fillColor: [7, 90, 123] }, styles: { fontSize: 9, cellPadding: 3 } })
      autoTable(pdf, { startY: ((pdf as any).lastAutoTable?.finalY || 88) + 8, head: [[t.date, t.firstEntry, t.lastExit, t.duration, t.status]], body: (summary.dayDetails || []).map((day: any) => [day.date, day.firstEntry ? formatSchoolTime(day.firstEntry, language) : '—', day.lastExit ? formatSchoolTime(day.lastExit, language) : '—', day.durationMinutes == null ? t.ongoing : formatMinutes(day.durationMinutes), day.late ? t.late : t.onTime]), headStyles: { fillColor: [45, 212, 191], textColor: [3, 41, 66] }, styles: { fontSize: 8.5, cellPadding: 2.5 } })
      pdf.setDrawColor(226, 169, 47); pdf.setLineWidth(.7); pdf.line(16, 277, 194, 277); pdf.setFontSize(8); pdf.setTextColor(90, 110, 125); pdf.text('Kinshasa Christian School · Macampagne, Ngaliema · Kinshasa, RDC', 16, 283); pdf.text(`${documentId} · ${report.timezone || 'Africa/Kinshasa'}`, 194, 283, { align: 'right' })
      pdf.save(`kcs-sentinel-${user.fullName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${reportFrom}-${reportTo}.pdf`)
    } catch (reason: any) { setError(reason.message || 'Report unavailable') }
    finally { setReportBusy(false) }
  }

  if (token && user?.role !== 'entity') return <div className="sentinel-kitchen-surface relative min-h-screen">
    <App language={language} onLanguageChange={changeLanguage} onLogout={logout} />
  </div>

  if (token && user) {
    const periods = data?.statistics?.periods || {}
    const selected = periods[selectedPeriod] || {}
    return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#0d7bbb_0,#06365f_42%,#031d32_100%)] p-3 font-display text-white sm:p-6">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col gap-4 rounded-3xl border border-cyan-300/20 bg-[#073d5e]/90 p-5 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-center gap-4"><img src="./icons/kcs-logo.jpg" alt="Kinshasa Christian School" className="h-16 w-16 rounded-full border-2 border-cyan-300 object-cover" /><div><small className="font-bold tracking-[.22em] text-cyan-300">KCS SENTINEL · {t.personal}</small><h1 className="mt-1 text-2xl font-black sm:text-3xl">{user.fullName}</h1></div></div>
        <div className="flex flex-wrap gap-2"><div className="flex rounded-xl border border-cyan-300/40 bg-[#032942]/90 p-1"><button type="button" onClick={() => changeLanguage('fr')} className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${language === 'fr' ? 'bg-cyan-300 text-slate-950 shadow' : 'text-white hover:bg-white/15'}`}>FR</button><button type="button" onClick={() => changeLanguage('en')} className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${language === 'en' ? 'bg-cyan-300 text-slate-950 shadow' : 'text-white hover:bg-white/15'}`}>EN</button></div><button onClick={() => void install()} className="sentinel-action rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-bold text-cyan-100">{t.install}</button><button onClick={logout} className="sentinel-action rounded-xl border border-rose-200/30 bg-rose-400/10 px-4 py-2 text-sm font-bold text-rose-50">{t.logout}</button></div>
      </header>
      {installNotice && <p className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-50">{installNotice}</p>}
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(periods).map(([period, value]: any) => <button onClick={() => setSelectedPeriod(period)} className={`sentinel-action rounded-2xl border p-5 text-left shadow-xl backdrop-blur ${selectedPeriod === period ? 'border-cyan-300 bg-cyan-300/20 ring-2 ring-cyan-300/20' : 'border-cyan-300/15 bg-white/10 hover:bg-white/15'}`} key={period}><b className="uppercase text-cyan-300">{periodLabel(period, t)}</b><strong className="mt-2 block text-3xl">{value.attendanceDays}</strong><span className="text-sm text-slate-300">{t.attendanceDays} · {value.entries} {t.entries}</span></button>)}</section>
      <section className="mt-5 flex flex-col gap-4 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur lg:flex-row lg:items-end lg:justify-between"><div><small className="font-bold tracking-widest text-cyan-300">PDF · KCS SENTINEL</small><h2 className="mt-2 text-xl font-black">{language === 'fr' ? 'Imprimer mon rapport officiel' : 'Print my official report'}</h2><p className="mt-1 text-sm text-slate-300">{language === 'fr' ? 'Choisissez précisément la période à certifier.' : 'Select the exact period to certify.'}</p></div><div className="grid gap-3 sm:grid-cols-[150px_150px_auto]"><label className="text-xs font-bold text-slate-300">{language === 'fr' ? 'Du' : 'From'}<input type="date" value={reportFrom} onChange={event => setReportFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-cyan-300/20 bg-[#032942] p-3 text-white" /></label><label className="text-xs font-bold text-slate-300">{language === 'fr' ? 'Au' : 'To'}<input type="date" value={reportTo} onChange={event => setReportTo(event.target.value)} className="mt-1 w-full rounded-xl border border-cyan-300/20 bg-[#032942] p-3 text-white" /></label><button type="button" disabled={reportBusy || !reportFrom || !reportTo || reportFrom > reportTo} onClick={() => void printPersonalReport()} className="sentinel-primary-action self-end rounded-xl bg-gradient-to-r from-cyan-300 to-teal-300 px-5 py-3 font-black text-[#032942] disabled:opacity-50"><span className={reportBusy ? 'sentinel-button-label is-busy' : 'sentinel-button-label'}>{reportBusy ? (language === 'fr' ? 'Génération…' : 'Generating…') : (language === 'fr' ? 'Imprimer / PDF' : 'Print / PDF')}</span></button></div></section>
      <section className="mt-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:p-7">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><small className="font-bold tracking-widest text-cyan-300">{t.analysis} · {periodLabel(selectedPeriod, t)}</small><h2 className="mt-2 text-2xl font-black">{t.figures}</h2></div><span className={`w-fit rounded-full px-4 py-2 text-sm font-black ${Number(selected.punctualityRate || 0) >= 80 ? 'bg-emerald-400/20 text-emerald-200' : 'bg-amber-300/20 text-amber-100'}`}>{selected.punctualityRate || 0}% {t.punctuality}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {[[t.presence, `${selected.presenceRate || 0}%`],[t.avgArrival, selected.averageArrival || '—'],[t.avgDeparture, selected.averageDeparture || '—'],[t.avgDuration, formatMinutes(selected.averagePresenceMinutes)],[t.completeDays, selected.completeDays || 0],[t.trend, `${Number(selected.trendDays || 0) >= 0 ? '+' : ''}${selected.trendDays || 0} ${t.attendanceDays}`]].map(([label,value])=><article key={String(label)} className="rounded-2xl border border-white/10 bg-[#042f4d]/75 p-4"><span className="text-xs font-bold uppercase tracking-wider text-slate-300">{label}</span><strong className="mt-2 block text-xl text-white">{value}</strong></article>)}
        </div>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-[#032942]/90 text-xs uppercase text-cyan-200"><tr><th className="p-3">{t.date}</th><th className="p-3">{t.firstEntry}</th><th className="p-3">{t.lastExit}</th><th className="p-3">{t.duration}</th><th className="p-3">{t.status}</th></tr></thead><tbody>{(selected.dayDetails || []).slice(0,31).map((day:any)=><tr key={day.date} className="border-t border-white/10"><td className="p-3 font-bold">{day.date}</td><td className="p-3">{day.firstEntry ? formatSchoolTime(day.firstEntry, language) : '—'}</td><td className="p-3">{day.lastExit ? formatSchoolTime(day.lastExit, language) : '—'}</td><td className="p-3">{day.durationMinutes == null ? t.ongoing : formatMinutes(day.durationMinutes)}</td><td className="p-3"><span className={`rounded-full px-3 py-1 text-xs font-bold ${day.late ? 'bg-amber-300/20 text-amber-100' : 'bg-emerald-400/20 text-emerald-200'}`}>{day.late ? t.late : t.onTime}</span></td></tr>)}{!(selected.dayDetails || []).length && <tr><td colSpan={5} className="p-6 text-center text-sm text-slate-300">{t.noMovement}</td></tr>}</tbody></table></div>
      </section>
      <AttendanceVisuals details={selected.dayDetails || []} punctuality={Number(selected.punctualityRate || 0)} language={language} />
      <form onSubmit={sendJustification} className="mt-5 grid gap-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:grid-cols-2 md:p-7">
        <div><small className="font-bold tracking-widest text-cyan-300">{t.traceability}</small><h2 className="mt-2 text-xl font-black">{t.justify}</h2><p className="mt-2 text-sm text-slate-300">{t.justifyHelp}</p></div>
        <div className="grid gap-3"><select value={incidentType} onChange={event => setIncidentType(event.target.value)} className="rounded-xl bg-sky-50 p-3 text-slate-900"><option value="LATE">{t.late}</option><option value="ABSENCE">{t.absence}</option></select><input type="date" value={incidentDate} onChange={event => setIncidentDate(event.target.value)} className="rounded-xl bg-sky-50 p-3 text-slate-900" /><textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} required placeholder={t.detailedReason} className="min-h-28 rounded-xl bg-sky-50 p-3 text-slate-900" /><button disabled={busy} className="sentinel-primary-action rounded-xl bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 p-3.5 font-black text-[#032942] shadow-[0_12px_32px_rgba(45,212,191,.28)] disabled:opacity-60"><span className={busy ? 'sentinel-button-label is-busy' : 'sentinel-button-label'}>{busy ? t.sending : t.send}</span></button></div>
      </form>
      <section className="mt-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:p-7"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><h2 className="font-black">{t.myJustifications}</h2><div className="grid w-full gap-2 sm:max-w-2xl sm:grid-cols-[1fr_170px]"><label className="relative"><span className="sr-only">{t.searchJustifications}</span><svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 fill-none stroke-cyan-300" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input value={justificationQuery} onChange={event => setJustificationQuery(event.target.value)} placeholder={t.searchJustifications} className="w-full rounded-xl border border-cyan-300/20 bg-[#032942]/80 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10" /></label><select value={justificationStatus} onChange={event => setJustificationStatus(event.target.value)} className="rounded-xl border border-cyan-300/20 bg-[#032942] px-3 py-3 text-sm text-white"><option value="ALL">{t.allStatuses}</option><option value="PENDING">{t.pending}</option><option value="APPROVED">{t.approved}</option><option value="REJECTED">{t.rejected}</option></select></div></div>{filteredJustifications.length === 0 && <p className="mt-4 rounded-xl border border-dashed border-white/15 p-5 text-center text-sm text-slate-300">{t.noJustification}</p>}{filteredJustifications.map((item: any) => <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3" key={item.id}><div className="flex flex-wrap items-center gap-2"><b>{item.incident_date} · {item.incident_type === 'LATE' ? t.late : t.absence}</b><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${item.status === 'APPROVED' ? 'bg-emerald-400/20 text-emerald-200' : item.status === 'REJECTED' ? 'bg-rose-400/20 text-rose-100' : 'bg-amber-300/20 text-amber-100'}`}>{statusLabel(item.status, t)}</span></div><p className="mt-2 text-sm text-slate-300">{item.reason}</p>{item.review_note && <p className="mt-2 rounded-lg bg-white/5 p-2 text-xs text-cyan-100">KCS: {item.review_note}</p>}</div>)}</section>
      {error && <p className="mt-4 rounded-xl bg-red-950/70 p-3 text-amber-200">{error}</p>}
    </div>
  </main>}

  return <main className="sentinel-login-page relative grid min-h-screen overflow-x-hidden bg-[#031d32] font-display lg:grid-cols-[1.05fr_.95fr]">
    <section className="sentinel-login-visual relative hidden min-h-screen flex-col justify-between overflow-hidden p-12 text-white lg:flex lg:p-16">
      <div className="relative flex items-center gap-4"><img src="./icons/kcs-logo.jpg" alt="KCS" className="h-20 w-20 rounded-full border-2 border-cyan-300 object-cover shadow-2xl" /><div><b className="block text-xl">KINSHASA CHRISTIAN SCHOOL</b><span className="text-sm text-cyan-200">KCS Orbit Ecosystem</span></div></div>
      <div className="relative my-8 max-w-2xl"><small className="font-black tracking-[.28em] text-cyan-300">SMART CAMPUS SECURITY</small><h1 className="mt-4 text-5xl font-black leading-none sm:text-7xl">KCS<br/><span className="text-cyan-300">SENTINEL</span></h1><p className="mt-5 max-w-xl text-base text-slate-200 sm:text-lg">{t.tagline}</p></div>
      <div className="relative grid gap-3 text-sm text-slate-300 sm:grid-cols-3"><span>● {t.realtime}</span><span>● {t.access}</span><span>● {t.auditable}</span></div>
    </section>
    <section className="sentinel-login-form-panel relative flex min-h-screen items-center justify-center p-4 sm:p-7 lg:p-10">
      <form onSubmit={login} autoComplete="off" className="sentinel-login-card relative w-full max-w-md overflow-hidden rounded-[1.6rem] border border-white/80 bg-[#f9fcfe]/95 p-5 shadow-[0_30px_80px_rgba(0,39,67,.22)] backdrop-blur-xl sm:p-8 lg:p-10">
        <div className="sentinel-login-shimmer pointer-events-none absolute inset-x-0 top-0 h-1" />
        <div className="mb-5 flex items-center gap-3 lg:hidden"><img src="./icons/icon-192.png" alt="KCS Sentinel" className="h-14 w-14 rounded-2xl object-cover shadow-lg"/><div><b className="block text-sm text-[#053665]">KCS SENTINEL</b><span className="text-xs text-slate-500">{t.campus}</span></div></div>
        <div className="flex items-center justify-between gap-3"><small className="font-black tracking-[.2em] text-cyan-700">{t.secureAccess}</small><div className="flex rounded-lg border border-cyan-700/15 bg-[#073d5e] p-1 shadow-inner"><button type="button" onClick={() => changeLanguage('fr')} className={`rounded-md px-2.5 py-1 text-[11px] font-black transition ${language === 'fr' ? 'bg-cyan-200 text-[#053665] shadow' : 'text-white hover:bg-white/15'}`}>FR</button><button type="button" onClick={() => changeLanguage('en')} className={`rounded-md px-2.5 py-1 text-[11px] font-black transition ${language === 'en' ? 'bg-cyan-200 text-[#053665] shadow' : 'text-white hover:bg-white/15'}`}>EN</button></div></div><h2 className="mt-3 text-3xl font-black text-[#053665]">{t.institutionalLogin}</h2><p className="mt-2 text-sm text-slate-600">{t.loginHelp}</p>
        <label className="mt-5 block text-xs font-bold text-slate-700">{t.identifier}</label><input name="sentinelInstitutionalIdentity" value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required className="sentinel-login-input mt-2 w-full rounded-xl border border-sky-200 bg-white p-3 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
        <label className="mt-4 block text-xs font-bold text-slate-700">{t.password}</label><div className="relative mt-2"><input name="sentinelPrivatePassphrase" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required className="sentinel-login-input w-full rounded-xl border border-sky-200 bg-white p-3 pr-14 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? t.hidePassword : t.showPassword} title={showPassword ? t.hidePassword : t.showPassword} className="absolute inset-y-1 right-1 grid w-11 place-items-center rounded-lg text-cyan-800 transition hover:bg-cyan-50 active:scale-90"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth="1.9"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.8"/>{showPassword && <path d="m4 4 16 16"/>}</svg></button></div>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button disabled={busy} className="sentinel-primary-action mt-5 w-full rounded-xl bg-gradient-to-r from-[#075b91] via-[#087a86] to-[#099c87] p-3.5 font-black text-white shadow-[0_16px_35px_rgba(8,122,134,.3)] disabled:opacity-60"><span className={busy ? 'sentinel-button-label is-busy' : 'sentinel-button-label'}><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 fill-none stroke-current" strokeWidth="2"><path d="M7 10V8a5 5 0 0 1 10 0v2"/><rect x="5" y="10" width="14" height="11" rx="3"/><path d="m9 15 2 2 4-4"/></svg>{busy ? t.secureLogin : t.enter}</span></button><button type="button" onClick={() => void install()} className="sentinel-action mt-3 w-full rounded-xl border border-cyan-700/20 bg-cyan-50 p-3 text-sm font-black text-cyan-900">{t.install}</button>{installNotice && <p className="mt-3 rounded-xl bg-sky-50 p-3 text-xs font-semibold text-sky-900">{installNotice}</p>}<p className="mt-5 text-center text-xs text-slate-500">{t.encrypted}</p>
      </form>
    </section>
  </main>
}
