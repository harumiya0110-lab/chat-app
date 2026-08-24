import Head from 'next/head'
import { useState } from 'react'
import Header from '../components/Header'
import FeedPanel from '../components/FeedPanel'

export default function PostsPage() {
  const [username, setUsername] = useState('')

  return (
    <div className="min-h-screen bg-slate-50">
      <Head><title>投稿 | Rural-Urban Connect</title></Head>
      <Header />
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-6">
        {!username && (
          <div className="mb-4 w-full rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="post-username">投稿者名</label>
            <div className="flex gap-2">
              <input id="post-username" value={username} onChange={event => setUsername(event.target.value)} placeholder="名前を入力" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" />
              <button onClick={() => setUsername(username.trim())} className="rounded-xl bg-indigo-600 px-4 py-2 font-semibold text-white">開始</button>
            </div>
            <p className="mt-2 text-xs text-slate-400">名前を入力すると投稿できます。投稿一覧はそのまま閲覧できます。</p>
          </div>
        )}
        <div className="w-full overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <FeedPanel username={username} />
        </div>
      </div>
    </div>
  )
}