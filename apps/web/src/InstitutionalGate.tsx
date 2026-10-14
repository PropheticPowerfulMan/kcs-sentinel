import { FormEvent, useEffect, useState } from 'react'
import App from './App'

const configuredApi = import.meta.env.VITE_API_URL?.trim() || '/api'
const API = configuredApi.endsWith('/') ? configuredApi.slice(0, -1) : configuredApi
type User = { sub: string; role: string; personId: string; fullName: string }
const sessionHeaders = (token: string) => ({ authorization: 'Bearer ' + token, 'content-type': 'application/json' })

export default function InstitutionalGate() {
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

  if (token && user?.role !== 'entity') return <div className="relative min-h-screen bg-[#020b16]">
    <button onClick={logout} className="fixed right-3 top-3 z-[100] rounded-xl border border-cyan-300/30 bg-[#06233b]/95 px-4 py-2 text-xs font-bold text-white shadow-xl backdrop-blur">Déconnexion</button>
    <App />
  </div>

  if (token && user) return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#0d6980_0,#031d30_42%,#020b16_100%)] p-3 text-white sm:p-6">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-col gap-4 rounded-3xl border border-cyan-300/20 bg-[#073d5e]/90 p-5 shadow-2xl backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-center gap-4"><img src="./icons/kcs-logo.jpg" alt="Kinshasa Christian School" className="h-16 w-16 rounded-full border-2 border-cyan-300 object-cover" /><div><small className="font-bold tracking-[.22em] text-cyan-300">KCS SENTINEL · ESPACE PERSONNEL</small><h1 className="mt-1 text-2xl font-black sm:text-3xl">{user.fullName}</h1></div></div>
        <button onClick={logout} className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white/10">Déconnexion</button>
      </header>
      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Object.entries(data?.statistics?.periods || {}).map(([period, value]: any) => <article className="rounded-2xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur" key={period}><b className="uppercase text-cyan-300">{period}</b><strong className="mt-2 block text-3xl">{value.entries}</strong><span className="text-sm text-slate-300">{value.exits} sortie(s)</span></article>)}</section>
      <form onSubmit={sendJustification} className="mt-5 grid gap-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:grid-cols-2 md:p-7">
        <div><small className="font-bold tracking-widest text-cyan-300">TRAÇABILITÉ</small><h2 className="mt-2 text-xl font-black">Justifier une absence ou un retard</h2><p className="mt-2 text-sm text-slate-300">Votre demande est transmise à KCS et reste traçable jusqu’à sa décision.</p></div>
        <div className="grid gap-3"><select value={incidentType} onChange={event => setIncidentType(event.target.value)} className="rounded-xl bg-sky-50 p-3 text-slate-900"><option value="LATE">Retard</option><option value="ABSENCE">Absence</option></select><input type="date" value={incidentDate} onChange={event => setIncidentDate(event.target.value)} className="rounded-xl bg-sky-50 p-3 text-slate-900" /><textarea value={reason} onChange={event => setReason(event.target.value)} minLength={10} required placeholder="Motif détaillé et vérifiable" className="min-h-28 rounded-xl bg-sky-50 p-3 text-slate-900" /><button disabled={busy} className="rounded-xl bg-cyan-400 p-3 font-black text-slate-950 disabled:opacity-60">{busy ? 'Envoi sécurisé…' : 'Envoyer à KCS'}</button></div>
      </form>
      <section className="mt-5 rounded-3xl border border-cyan-300/15 bg-white/10 p-5 shadow-xl backdrop-blur md:p-7"><h2 className="font-black">Mes justificatifs</h2>{(data?.justifications || []).length === 0 && <p className="mt-3 text-sm text-slate-300">Aucun justificatif enregistré.</p>}{(data?.justifications || []).map((item: any) => <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3" key={item.id}><b>{item.incident_date} · {item.incident_type} · {item.status}</b><p className="mt-1 text-sm text-slate-300">{item.reason}</p></div>)}</section>
      {error && <p className="mt-4 rounded-xl bg-red-950/70 p-3 text-amber-200">{error}</p>}
    </div>
  </main>

  return <main className="relative grid min-h-screen overflow-hidden bg-[#021625] lg:grid-cols-[1.15fr_.85fr]">
    <section className="relative flex min-h-[42vh] flex-col justify-between overflow-hidden bg-[radial-gradient(circle_at_80%_15%,#13b7bb55_0,transparent_32%),linear-gradient(145deg,#052f4d_0%,#031d30_58%,#020b16_100%)] p-7 text-white sm:p-12 lg:min-h-screen lg:p-16">
      <div className="absolute -right-24 top-20 h-80 w-80 rounded-full border border-cyan-300/15" /><div className="absolute -bottom-32 left-16 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex items-center gap-4"><img src="./icons/kcs-logo.jpg" alt="KCS" className="h-20 w-20 rounded-full border-2 border-cyan-300 object-cover shadow-2xl" /><div><b className="block text-xl">KINSHASA CHRISTIAN SCHOOL</b><span className="text-sm text-cyan-200">KCS Orbit Ecosystem</span></div></div>
      <div className="relative my-10 max-w-2xl"><small className="font-black tracking-[.28em] text-cyan-300">SMART CAMPUS SECURITY</small><h1 className="mt-4 text-5xl font-black leading-none sm:text-7xl">KCS<br/><span className="text-cyan-300">SENTINEL</span></h1><p className="mt-5 max-w-xl text-base text-slate-300 sm:text-lg">Entrées, sorties, ponctualité et sécurité scolaire alimentées par les identités réelles de KCS Orbit.</p></div>
      <div className="relative grid gap-3 text-sm text-slate-300 sm:grid-cols-3"><span>● Registre temps réel</span><span>● Accès institutionnel</span><span>● Historique auditable</span></div>
    </section>
    <section className="flex items-center justify-center bg-[linear-gradient(145deg,#dff3fa_0%,#bfe3ef_100%)] p-5 sm:p-10">
      <form onSubmit={login} className="w-full max-w-md rounded-[2rem] border border-white/70 bg-sky-50/95 p-7 shadow-2xl backdrop-blur sm:p-10">
        <small className="font-black tracking-[.2em] text-cyan-700">ACCÈS SÉCURISÉ</small><h2 className="mt-3 text-3xl font-black text-[#053665]">Connexion institutionnelle</h2><p className="mt-2 text-sm text-slate-600">Utilisez votre e-mail ou code d’accès KCS Orbit habituel.</p>
        <label className="mt-7 block text-xs font-bold text-slate-700">E-mail ou code d’accès</label><input value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" required className="mt-2 w-full rounded-xl border border-sky-200 bg-white p-3 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" />
        <label className="mt-4 block text-xs font-bold text-slate-700">Mot de passe</label><div className="relative mt-2"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required className="w-full rounded-xl border border-sky-200 bg-white p-3 pr-24 text-slate-900 outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100" /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-1 right-1 rounded-lg px-3 text-xs font-bold text-cyan-800 hover:bg-cyan-50">{showPassword ? 'Cacher' : 'Afficher'}</button></div>
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}<button disabled={busy} className="mt-5 w-full rounded-xl bg-gradient-to-r from-[#075b91] to-[#087a86] p-3.5 font-black text-white shadow-lg disabled:opacity-60">{busy ? 'Connexion sécurisée…' : 'Entrer dans Sentinel'}</button><p className="mt-5 text-center text-xs text-slate-500">Identité Orbit chiffrée · session auditée · aucune donnée de démonstration</p>
      </form>
    </section>
  </main>
}
