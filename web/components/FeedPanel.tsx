import { ChangeEvent, useEffect, useState } from 'react'

type Post = {
  id: string
  title: string
  body: string
  mediaUrl?: string | null
  likes: number
  createdAt: string
  author?: { username: string }
  region?: { name: string } | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const MAX_LENGTH = 280

function relativeTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}時間前`
  return `${Math.floor(seconds / 86400)}日前`
}

export default function FeedPanel({ username }: { username: string }) {
  const [posts, setPosts] = useState<Post[]>([])
  const [body, setBody] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)

  async function loadPosts() {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/posts`)
      if (!response.ok) throw new Error('投稿を取得できませんでした')
      setPosts(await response.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPosts().catch(() => setLoading(false)) }, [])

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return alert('画像ファイルを選択してください')
    if (file.size > 5 * 1024 * 1024) return alert('画像は5MB以内にしてください')
    const reader = new FileReader()
    reader.onload = () => setMediaUrl(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  async function publish() {
    const text = body.trim()
    if (!text || posting) return
    setPosting(true)
    try {
      const response = await fetch(`${API_URL}/api/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: text.split('\n')[0].slice(0, 80),
          body: text,
          mediaUrl: mediaUrl || undefined,
          authorUsername: username
        })
      })
      if (!response.ok) throw new Error('投稿できませんでした')
      setBody('')
      setMediaUrl('')
      await loadPosts()
    } catch {
      alert('投稿に失敗しました')
    } finally {
      setPosting(false)
    }
  }

  async function like(id: string) {
    setPosts(current => current.map(post => post.id === id ? { ...post, likes: post.likes + 1 } : post))
    const response = await fetch(`${API_URL}/api/posts/${id}/like`, { method: 'POST' })
    if (!response.ok) await loadPosts()
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-white">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Community feed</p>
            <h2 className="text-xl font-bold text-slate-950">ホーム</h2>
          </div>
          <button onClick={() => loadPosts()} className="rounded-full px-3 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">更新</button>
        </div>
      </div>

      <section className="border-b border-slate-200 px-5 py-5">
        <div className="flex gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white">{username.slice(0, 1).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <textarea
              value={body}
              onChange={event => setBody(event.target.value.slice(0, MAX_LENGTH))}
              placeholder="いまどうしてる？地域の出来事を共有しよう"
              rows={3}
              className="w-full resize-none border-0 bg-transparent text-lg text-slate-900 outline-none placeholder:text-slate-400"
            />
            {mediaUrl && <img src={mediaUrl} alt="添付画像のプレビュー" className="mb-3 max-h-60 rounded-2xl object-cover" />}
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2">
                <label className="cursor-pointer rounded-full p-2 text-indigo-600 hover:bg-indigo-50" title="画像を添付">
                  画像
                  <input type="file" accept="image/*" className="hidden" onChange={chooseImage} />
                </label>
                <span className={`text-xs ${body.length === MAX_LENGTH ? 'font-bold text-rose-600' : 'text-slate-400'}`}>{body.length}/{MAX_LENGTH}</span>
              </div>
              <button disabled={!username || !body.trim() || posting} onClick={publish} className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40">{posting ? '投稿中...' : 'ポストする'}</button>
            </div>
          </div>
        </div>
      </section>

      <section>
        {loading && <div className="px-5 py-8 text-center text-sm text-slate-400">投稿を読み込んでいます...</div>}
        {!loading && posts.length === 0 && <div className="px-5 py-12 text-center text-sm text-slate-400">最初のポストを投稿してみましょう。</div>}
        {posts.map(post => (
          <article key={post.id} className="border-b border-slate-200 px-5 py-5 transition hover:bg-slate-50">
            <div className="flex gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 font-bold text-white">{(post.author?.username || '?').slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm"><strong className="text-slate-950">{post.author?.username || 'ユーザー'}</strong><span className="text-slate-400">@{post.author?.username || 'user'} · {relativeTime(post.createdAt)}</span></div>
                <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-slate-800">{post.body}</p>
                {post.mediaUrl && <img src={post.mediaUrl} alt="投稿画像" className="mt-3 max-h-96 w-full rounded-2xl border border-slate-200 object-cover" />}
                {post.region && <span className="mt-3 inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{post.region.name}</span>}
                <div className="mt-3 flex items-center"><button onClick={() => like(post.id)} className="rounded-full px-3 py-1 text-sm text-rose-600 hover:bg-rose-50">いいね {post.likes}</button></div>
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
