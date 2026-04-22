'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  useUserTransactions,
  type CreateTxPayload,
} from '@/hooks/useUserTransactions'
import {
  useUserContacts,
  localToServer,
  type AddressContactLike,
  type CreateContactPayload,
} from '@/hooks/useUserContacts'

const STORAGE_KEY = 'rsends.pendingMerge'
const CONTACTS_LS_KEY = 'rp_address_book'
const MAX_PENDING = 200

export function stashPendingMerge(tx: CreateTxPayload) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const list: CreateTxPayload[] = raw ? JSON.parse(raw) : []
    list.push(tx)
    const trimmed = list.length > MAX_PENDING ? list.slice(-MAX_PENDING) : list
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // best-effort: storage full, quota exceeded, or JSON parse error
  }
}

function readPending(): CreateTxPayload[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clearPending() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

function readContacts(): AddressContactLike[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(CONTACTS_LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AddressContactLike[]) : []
  } catch {
    return []
  }
}

export function PostLoginMerge() {
  const { status } = useSession()
  const { bulkImport } = useUserTransactions()
  const { bulkImport: bulkImportContacts } = useUserContacts()
  const txDoneRef = useRef(false)
  const contactsDoneRef = useRef(false)

  // Tx merge (pre-existing behaviour — unchanged semantics)
  useEffect(() => {
    if (status !== 'authenticated' || txDoneRef.current) return
    const pending = readPending()
    if (pending.length === 0) {
      txDoneRef.current = true
      return
    }
    txDoneRef.current = true
    void (async () => {
      const res = await bulkImport(pending)
      if (res) clearPending()
      else txDoneRef.current = false
    })()
  }, [status, bulkImport])

  // Contacts merge (new — additive)
  useEffect(() => {
    if (status !== 'authenticated' || contactsDoneRef.current) return
    const local = readContacts()
    if (local.length === 0) {
      contactsDoneRef.current = true
      return
    }
    contactsDoneRef.current = true
    const payload: CreateContactPayload[] = local.map(localToServer)
    void (async () => {
      const res = await bulkImportContacts(payload)
      // Intentionally do NOT remove CONTACTS_LS_KEY: the unauth fallback in
      // AddressIntelligence reads it after logout. Retrying on the next session
      // is idempotent (upsert on UNIQUE(user_id, address)).
      if (!res) contactsDoneRef.current = false
    })()
  }, [status, bulkImportContacts])

  return null
}
