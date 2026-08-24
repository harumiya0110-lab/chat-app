import React, { useEffect, useState } from 'react'

export default function PostForm({ defaultAuthor }: { defaultAuthor?: string }){
  const [regions, setRegions] = useState<any[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [regionCode, setRegionCode] = useState('')
  const [author, setAuthor] = useState(defaultAuthor||'')

  useEffect(()=>{
    fetch((process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000') + '/api/regions').then(r=>r.json()).then(j=>setRegions(j)).catch(()=>{})
  },[])

  async function submit(){
    if(!author || !title) return alert('名前とタイトルは必須')
    const res = await fetch((process.env.NEXT_PUBLIC_API_URL||'http://localhost:4000') + '/api/posts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title,body,authorUsername:author,regionCode})})
    if(res.ok){ alert('投稿しました'); setTitle(''); setBody('') }
    else alert('投稿に失敗')
  }

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold">新しい投稿</h4>
      <input placeholder="あなたの名前" value={author} onChange={e=>setAuthor(e.target.value)} className="w-full border p-2 mt-2 rounded" />
      <input placeholder="タイトル" value={title} onChange={e=>setTitle(e.target.value)} className="w-full border p-2 mt-2 rounded" />
      <textarea placeholder="本文" value={body} onChange={e=>setBody(e.target.value)} className="w-full border p-2 mt-2 rounded" />
      <select value={regionCode} onChange={e=>setRegionCode(e.target.value)} className="w-full border p-2 mt-2 rounded">
        <option value="">地域を選択（任意）</option>
        {regions.map(r=> <option key={r.id} value={r.code}>{r.name}</option>)}
      </select>
      <div className="flex gap-2 mt-2">
        <button onClick={submit} className="bg-indigo-600 text-white px-3 py-2 rounded">投稿</button>
      </div>
    </div>
  )
}
