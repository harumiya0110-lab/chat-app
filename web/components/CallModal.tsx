import React, { useEffect, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

export default function CallModal(){
  const [open, setOpen] = useState(false)
  const [caller, setCaller] = useState<{id:string, username?:string}|null>(null)
  const [offer, setOffer] = useState<any>(null)
  const audioCtxRef = useRef<AudioContext|null>(null)
  const gainRef = useRef<GainNode|null>(null)

  useEffect(()=>{
    const onIncoming = (e:any)=>{
      setCaller({ id: e.detail.from, username: e.detail.username })
      setOffer(e.detail.offer)
      setOpen(true)
      startRingtone()
    }
    const onEnded = ()=>{ stopRingtone(); setOpen(false); setCaller(null); setOffer(null) }
    window.addEventListener('webrtc-incoming', onIncoming as EventListener)
    window.addEventListener('webrtc-ended', onEnded as EventListener)
    return ()=>{ window.removeEventListener('webrtc-incoming', onIncoming as EventListener); window.removeEventListener('webrtc-ended', onEnded as EventListener) }
  }, [])

  function startRingtone(){
    try{
      if(!audioCtxRef.current){
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        audioCtxRef.current = ctx
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        gain.gain.value = 0.03
        osc.type = 'sine'
        osc.frequency.value = 440
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        gainRef.current = gain
        ;(osc as any)._started = true
        ;(osc as any)._stop = () => osc.stop();
        (audioCtxRef.current as any)._osc = osc
      }
    }catch(e){}
  }
  function stopRingtone(){
    try{ if((audioCtxRef.current as any)?._osc) { (audioCtxRef.current as any)._osc.stop(); (audioCtxRef.current as any)._osc = null } }catch(e){}
    try{ audioCtxRef.current = null; gainRef.current = null }catch(e){}
  }

  async function accept(){
    stopRingtone()
    setOpen(false)
    // handle incoming offer by delegating to webrtc helper
    const lib = await import('../lib/webrtc')
    const local = await lib.getLocalStream(true, false)
    lib.handleIncomingOffer(caller!.id, offer, local)
  }
  function decline(){
    stopRingtone()
    setOpen(false)
    getSocket().emit('end-call', { targetId: caller?.id })
    setCaller(null); setOffer(null)
  }

  if(!open || !caller) return null
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      <div className="absolute inset-0 bg-black/40" onClick={()=>{ stopRingtone(); setOpen(false) }}></div>
      <div className="bg-white rounded p-6 z-10 w-80">
        <div className="text-lg font-semibold">着信</div>
        <div className="mt-2">{caller.username || caller.id} からの通話</div>
        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={decline} className="px-3 py-2 bg-gray-200 rounded">拒否</button>
          <button onClick={accept} className="px-3 py-2 bg-green-600 text-white rounded">応答</button>
        </div>
      </div>
    </div>
  )
}
