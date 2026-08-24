import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

export default function MapPage() {
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [139.6917, 35.6895],
      zoom: 5
    });

    let markers: any[] = []

    async function load(){
      const [regionsRes, postsRes] = await Promise.all([
        fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + '/api/regions'),
        fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + '/api/posts')
      ])
      const regions = await regionsRes.json()
      const posts = postsRes.ok ? await postsRes.json() : []
      const postsByRegion: Record<string, any[]> = {}
      posts.forEach((p:any)=>{ if(p.regionId) { postsByRegion[p.regionId] = postsByRegion[p.regionId] || []; postsByRegion[p.regionId].push(p) } })

      regions.forEach((reg:any) => {
        const el = document.createElement('div');
        el.className = 'marker';
        el.style.background = '#f97316';
        el.style.width = '16px';
        el.style.height = '16px';
        el.style.borderRadius = '8px';
        const marker = new mapboxgl.Marker(el).setLngLat([reg.lng, reg.lat])
        const postsHtml = (postsByRegion[reg.id]||[]).map((p:any)=> `<div class="p-1"><strong>${p.title}</strong><div class="text-xs">${p.body||''}</div><div class="text-xs text-gray-500">by ${p.authorUsername}</div></div>`).join('')
        const popup = new mapboxgl.Popup().setHTML(`<div style="min-width:160px"><h4>${reg.name}</h4><div>投稿: ${(postsByRegion[reg.id]||[]).length}</div><div>${postsHtml}</div></div>`)        
        marker.setPopup(popup).addTo(map)
        markers.push({ id: reg.id, marker, hasPosts: (postsByRegion[reg.id]||[]).length>0 })
      })

      // add simple filter UI
      const controls = document.createElement('div')
      controls.style.position = 'absolute'
      controls.style.top = '10px'
      controls.style.left = '10px'
      controls.style.background = 'white'
      controls.style.padding = '8px'
      controls.style.borderRadius = '6px'
      controls.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)'
      controls.innerHTML = `<div style="font-weight:600;margin-bottom:6px">フィルタ</div><label><input type="checkbox" id="onlyWithPosts"/> 投稿のある地域のみ表示</label>`
      map.getContainer().appendChild(controls)
      const checkbox = controls.querySelector('#onlyWithPosts') as HTMLInputElement
      checkbox.addEventListener('change', ()=>{
        const only = checkbox.checked
        markers.forEach(m=>{
          const el = m.marker.getElement()
          el.style.display = (!only || m.hasPosts) ? '' : 'none'
        })
      })
    }
    load().catch(()=>{})

    return () => { markers.forEach(m=>m.marker.remove()); map.remove(); }
  }, [])

  return (
    <div style={{height: '100vh', position: 'relative'}}>
      <div id="map" style={{width:'100%', height:'100%'}}></div>
    </div>
  )
}
