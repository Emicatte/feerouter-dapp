'use client'

import dynamic from 'next/dynamic'

const FooterGlobe = dynamic(() => import('./FooterGlobe'), { ssr: false })

export default function FooterMount() {
  return <FooterGlobe />
}
