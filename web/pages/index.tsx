import Head from 'next/head'
import Header from '../components/Header'

export default function Home() {
  const destinations = [
    { href: '/chat', label: 'チャットルーム', kicker: 'LIVE ROOM', description: '今オンラインの人とリアルタイムで話す', tone: 'nav-card--night', icon: '吹' },
    { href: '/posts', label: '投稿', kicker: 'COMMUNITY FEED', description: '地域の出来事や気づきを共有する', tone: 'nav-card--coral', icon: '投' },
    { href: '/map', label: '地域マップ', kicker: 'LOCAL MAP', description: '地域ごとの投稿を地図から見つける', tone: 'nav-card--green', icon: '地' }
  ]

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-950">
      <Head><title>Rural-Urban Connect | ホーム</title></Head>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 sm:px-8 sm:pt-20">
        <section className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[.3em] text-indigo-600">Rural-Urban Connect</p>
          <h1 className="mt-5 text-4xl font-black leading-[1.08] tracking-tight sm:text-6xl">地域と人を、<br /><span className="text-indigo-600">もっと近くに。</span></h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-slate-500 sm:text-lg">話す、共有する、見つける。あなたの地域の日常が、誰かの新しい発見になります。</p>
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-3" aria-label="機能を選択">
          {destinations.map(destination => (
            <a key={destination.href} href={destination.href} className={`nav-card ${destination.tone}`}>
              <div className="flex items-start justify-between">
                <span className="nav-card__icon">{destination.icon}</span>
                <span className="nav-card__arrow" aria-hidden="true">↗</span>
              </div>
              <div className="mt-16 sm:mt-24">
                <p className="text-[10px] font-black tracking-[.22em] opacity-70">{destination.kicker}</p>
                <h2 className="mt-2 text-2xl font-black">{destination.label}</h2>
                <p className="mt-3 max-w-[18rem] text-sm leading-6 opacity-80">{destination.description}</p>
              </div>
            </a>
          ))}
        </section>

        <section className="mt-10 flex flex-col gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>あなたの地域の今を、ここから。</span>
          <span className="font-semibold text-slate-700">3つの場所から選んで始める</span>
        </section>
      </main>
    </div>
  )
}
