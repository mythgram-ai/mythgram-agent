import { useCallback, useEffect, useRef, useState } from 'react'

/** Poll a JSON endpoint on an interval while the consumer stays mounted. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | null; error: string | null; refresh: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  const tick = useCallback(async () => {
    try {
      const next = await fetcherRef.current()
      setData(next)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      await tick()
      if (!stop && intervalMs > 0) timer = setTimeout(run, intervalMs)
    }
    setLoading(true)
    void run()
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps])

  return { data, error, refresh: () => void tick(), loading }
}

/** One-shot fetch used for data that only changes on user action. */
export function useOnce<T>(fetcher: () => Promise<T>): {
  data: T | null
  error: string | null
  refresh: () => void
  loading: boolean
} {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    let stop = false
    setLoading(true)
    void (async () => {
      try {
        const next = await fetcherRef.current()
        if (!stop) {
          setData(next)
          setError(null)
        }
      } catch (err) {
        if (!stop) setError((err as Error).message)
      } finally {
        if (!stop) setLoading(false)
      }
    })()
    return () => {
      stop = true
    }
  }, [nonce])

  return { data, error, refresh: () => setNonce((n) => n + 1), loading }
}

/** True while the backend keeps answering /health. */
export function useBackendAlive(intervalMs = 20000): boolean {
  const [alive, setAlive] = useState(false)
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health')
        setAlive(res.ok)
      } catch {
        setAlive(false)
      }
    }
    void check()
    const t = setInterval(check, intervalMs)
    return () => {
      clearInterval(t)
    }
  }, [intervalMs])
  return alive
}
