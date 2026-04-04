'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

const BACKEND = process.env.NEXT_PUBLIC_RPAGOS_BACKEND_URL || 'http://localhost:8000'

export interface SweepEvent {
  type: string
  data: Record<string, any>
  timestamp: string
}

export interface WsStats {
  totalEvents: number
  reconnects: number
}

export function useSweepWebSocket(address: string | undefined) {
  const [events, setEvents] = useState<SweepEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [wsStats, setWsStats] = useState<WsStats>({ totalEvents: 0, reconnects: 0 })
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connect = useCallback(() => {
    if (!address) return
    const wsUrl = BACKEND.replace(/^http/, 'ws') + `/ws/sweep-feed/${address}`

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        retryRef.current = 0
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'heartbeat' || msg.type === 'stats') return
          setEvents(prev =>
            [{ type: msg.type, data: msg.data ?? msg, timestamp: msg.timestamp || new Date().toISOString() }, ...prev].slice(0, 50)
          )
          setWsStats(prev => ({ ...prev, totalEvents: prev.totalEvents + 1 }))
        } catch { /* malformed message */ }
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        setWsStats(prev => ({ ...prev, reconnects: prev.reconnects + 1 }))
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000)
        retryRef.current++
        timerRef.current = setTimeout(connect, delay)
      }

      ws.onerror = () => ws.close()
    } catch {
      const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30000)
      retryRef.current++
      timerRef.current = setTimeout(connect, delay)
    }
  }, [address])

  useEffect(() => {
    connect()
    return () => {
      if (wsRef.current) wsRef.current.close()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [connect])

  const reconnect = useCallback(() => {
    if (wsRef.current) wsRef.current.close()
    retryRef.current = 0
    connect()
  }, [connect])

  return { events, connected, reconnect, wsStats }
}
