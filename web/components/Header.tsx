import React from 'react'

export default function Header() {
  return (
    <header className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 shadow">
      <div className="container flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 rounded-full w-10 h-10 flex items-center justify-center font-bold">RU</div>
          <h1 className="text-lg font-semibold">Rural-Urban Connect</h1>
        </div>
        <nav className="flex items-center gap-2 text-sm">
          <a className="rounded-full px-3 py-2 hover:bg-white/15" href="/">ホーム</a>
          <a className="rounded-full bg-white px-4 py-2 font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50" href="/posts">投稿を見る</a>
          <a className="rounded-full border border-white/60 px-4 py-2 font-semibold hover:bg-white/15" href="/map">地域マップ</a>
        </nav>
      </div>
    </header>
  )
}
