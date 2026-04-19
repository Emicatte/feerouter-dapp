'use client'

import { ReactNode, useEffect, useRef } from 'react'
import Lenis from 'lenis'

export default function SmoothScroll({ children, paused = false }: { children: ReactNode; paused?: boolean }) {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const lenis = new Lenis({
      duration: 0.8,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      wheelMultiplier: 0.8,
      touchMultiplier: 1.5,
    })

    lenisRef.current = lenis

    // Temporary RAF until GSAP takes over
    let rafId: number
    let gsapActive = false
    const raf = (time: number) => {
      if (!gsapActive) lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }
    rafId = requestAnimationFrame(raf)

    // GSAP ScrollTrigger sync — replaces manual RAF loop
    import('gsap').then(({ gsap }) => {
      import('gsap/ScrollTrigger').then(({ ScrollTrigger }) => {
        gsap.registerPlugin(ScrollTrigger)
        lenis.on('scroll', ScrollTrigger.update)
        gsap.ticker.add((time) => lenis.raf(time * 1000))
        gsap.ticker.lagSmoothing(0)
        gsapActive = true
        cancelAnimationFrame(rafId)
      })
    })

    return () => {
      cancelAnimationFrame(rafId)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  useEffect(() => {
    const lenis = lenisRef.current
    if (!lenis) return
    if (paused) {
      lenis.stop()
    } else {
      lenis.start()
    }
  }, [paused])

  return <>{children}</>
}
