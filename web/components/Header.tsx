import React from 'react'

export default function Header() {
  return (
    <header className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 px-4 shadow">
      <div className="container flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 rounded-full w-10 h-10 flex items-center justify-center font-bold">RU</div>
          <h1 className="text-lg font-semibold">Rural-Urban Connect</h1>
        </div>
        <nav className="flex items-center gap-4">
          <a className="hover:underline" href="/">ホーム</a>
          <a className="hover:underline" href="/map">地域マップ</a>
          <a className="hover:underline" href="#">投稿</a>
        </nav>
      </div>
    </header>
  )
}
