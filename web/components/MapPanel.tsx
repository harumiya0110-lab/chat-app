import dynamic from 'next/dynamic'
import React from 'react'

const MapBox = dynamic(() => import('../pages/map'), { ssr: false })

export default function MapPanel(){
  return (
    <div className="w-96 border-l p-2 bg-white">
      <h3 className="text-sm font-semibold mb-2">地域マップ</h3>
      <div style={{height: '60vh'}}>
        <MapBox />
      </div>
    </div>
  )
}
