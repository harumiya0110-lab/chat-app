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

    fetch((process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + '/api/regions')
      .then(r=>r.json())
      .then((regions) => {
        regions.forEach((reg:any) => {
          const el = document.createElement('div');
          el.className = 'marker';
          el.style.background = '#f97316';
          el.style.width = '16px';
          el.style.height = '16px';
          el.style.borderRadius = '8px';
          new mapboxgl.Marker(el).setLngLat([reg.lng, reg.lat]).setPopup(new mapboxgl.Popup().setText(reg.name + ' — 投稿: ' + (reg.posts?.length||0))).addTo(map);
        });
      });

    return () => map.remove();
  }, [])

  return (
    <div style={{height: '100vh'}}>
      <div id="map" style={{width:'100%', height:'100%'}}></div>
    </div>
  )
}
