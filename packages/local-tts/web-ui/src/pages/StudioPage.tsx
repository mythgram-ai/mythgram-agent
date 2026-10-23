import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api, type InstalledVoice, type TtsMeta } from '../lib/api'
import { fmtBytes, fmtSpeechSeconds } from '../lib/format'
import { useOnce, usePoll } from '../lib/hooks'
import { IconCheck, IconPause, IconPlay, IconWave } from '../components/icons'
import { EmptyState, Panel, Spinner } from '../components/ui'

const LS_VOICE = 'piperstudio.lastVoice'
const LS_ADV = 'piperstudio.showAdvanced'

interface TakeItem extends TtsMeta {
  id: number
}

export default function StudioPage() {
  const navigate = useNavigate()
  const { data: installed, loading } = useOnce(() => api.installed())
  const { data: status } = usePoll(() => api.piperStatus(), 15000)

  const [text, setText] = useState(
    'Hello, this is a speech synthesized locally by Piper running entirely on your machine.',
  )
  const [voiceKey, setVoiceKey] = useState<string>(() => localStorage.getItem(LS_VOICE) ?? '')
  const [speed, setSpeed] = useState(1.0)
  const [volume, setVolume] = useState(1.0)
  const [noiseScale, setNoiseScale] = useState(0.8)
  const [noiseWScale, setNoiseWScale] = useState(1.0)
  const [normalize, setNormalize] = useState(true)
  const [advanced, setAdvanced] = useState(() => localStorage.getItem(LS_ADV) === '1')
  const [speakerId, setSpeakerId] = useState(0)

  const [busy, setBusy] = useState(false)
  const [abort, setAbort] = useState<AbortController | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [takes, setTakes] = useState<TakeItem[]>([])
  const [current, setCurrent] = useState<TakeItem | null>(null)

  const nextId = useRef(1)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!voiceKey && installed?.voices.length) setVoiceKey(installed.voices[0].key)
  }, [installed, voiceKey])

  const voice: InstalledVoice | null = useMemo(
    () => installed?.voices.find((v) => v.key === voiceKey) ?? null,
    [installed, voiceKey],
  )

  useEffect(() => {
    setSpeakerId(0)
  }, [voiceKey])

  const selectVoice = (key: string) => {
    setVoiceKey(key)
    localStorage.setItem(LS_VOICE, key)
  }

  const generate = async () => {
    if (!voiceKey || !text.trim() || busy) return
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    setAbort(controller)
    try {
      const meta = await api.synthesize(
        {
          key: voiceKey,
          text: text.trim(),
          speed,
          volume,
          noise_scale: advanced ? noiseScale : undefined,
          noise_w_scale: advanced ? noiseWScale : undefined,
          normalize: advanced && normalize ? true : undefined,
          speaker_id: voice && voice.num_speakers > 1 ? speakerId : undefined,
        },
        controller.signal,
      )
      const take: TakeItem = { ...meta, id: nextId.current++ }
      setTakes((t) => [take, ...t].slice(0, 12))
      setCurrent(take)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setError('Generation cancelled.')
      } else {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : (err as Error).message)
      }
    } finally {
      setBusy(false)
      setAbort(null)
    }
  }

  const pickTake = (take: TakeItem) => {
    setCurrent(take)
    window.setTimeout(() => void audioRef.current?.play().catch(() => undefined), 50)
  }

  if (loading) {
    return (
      <div className="content-inner">
        <div className="page-head">
          <h1>Speech studio</h1>
        </div>
        <div className="empty-state">
          <Spinner size={18} />
          <div className="hint" style={{ marginTop: 10 }}>loading installed voices…</div>
        </div>
      </div>
    )
  }

  const noVoices = !installed || installed.voices.length === 0

  return (
    <div className="content-inner">
      <div className="page-head">
        <h1>Speech studio</h1>
        <p>
          Type text, pick a voice, generate.

 Everything runs on this machine — no cloud services involved.
        </p>
      </div>

      {status && !status.installed && (
        <div className="banner">
          <span className="ico"><IconWave size={15} /></span>
          <span>
            Piper TTS is not installed yet. <Link to="/voices">Install it on the Voices &amp; setup page.</Link>
          </span>
        </div>
      )}

      {noVoices && status?.installed && (
        <div className="banner">
          <span className="ico"><IconWave size={15} /></span>
          <span>
            No voices downloaded yet. <Link to="/voices">Grab one from the voice repository.</Link>
          </span>
        </div>
      )}

      <div className="studio-cols">
        <div className="stack gap-16">
          <Panel title="Text">
            <label className="field-name" htmlFor="tts-text">Source text</label>
            <textarea
              id="tts-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What should the voice read aloud?"
              spellCheck={false}
            />
            <div className="spread" style={{ marginTop: 12 }}>
              <div className="mono small mute">
                {text.length.toLocaleString()} chars · {text.trim() ? text.trim().split(/\s+/).length : 0} words
              </div>
              <div className="row">
                {busy ? (
                  <button className="btn danger" onClick={() => abort?.abort()}>
                    <span className="spin"><IconPause size={13} /></span> Stop
                  </button>
                ) : null}
                <button
                  className="btn primary"
                  disabled={busy || !text.trim() || !voiceKey}
                  onClick={generate}
                >
                  {busy ? <Spinner size={13} /> : <IconWave size={13} />}
                  {busy ? 'Synthesizing…' : 'Generate speech'}
                </button>
              </div>
            </div>
          </Panel>

          {error && (
            <div className="banner error">
              <span className="ico"><IconWave size={15} /></span>
              <span>{error}</span>
            </div>
          )}

          <Panel title="Result">
            {current ? (
              <div className="stack gap-12">
                <audio ref={audioRef} src={current.blobUrl} className="player" controls preload="auto" />
                <div className="spread">
                  <div className="gen-meta">
                    <span><b>{current.voiceKey}</b></span>
                    <span>dur {fmtSpeechSeconds(current.durationMs)}</span>
                    <span>{current.sampleRate} Hz</span>
                    <span>{fmtBytes(current.sizeBytes)}</span>
                    <span>dev {current.device}</span>
                    <span>took {fmtSpeechSeconds(current.elapsedMs)}</span>
                  </div>
                  <a className="btn sm" href={current.blobUrl} download={`piper-${current.voiceKey}.wav`}>
                    Save .wav
                  </a>
                </div>
              </div>
            ) : (
              <EmptyState icon={<IconWave size={26} />}>
                Generated speech will appear here.
                <div className="hint">You can play it back, keep previous takes on the right, or save the WAV file.</div>
              </EmptyState>
            )}
          </Panel>

          {takes.length > 0 && (
            <Panel title="This session's takes" tight>
              <div className="takes-list" style={{ padding: '0 12px' }}>
                {takes.map((take) => (
                  <div
                    key={take.id}
                    className={`take${current?.id === take.id ? ' on' : ''}`}
                    onClick={() => pickTake(take)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') pickTake(take)
                    }}
                  >
                    <div className="take-top">
                      <span className="take-play">{current?.id === take.id ? <IconPause size={14} /> : <IconPlay size={14} />}</span>
                      <span className="mono small" style={{ whiteSpace: 'nowrap' }}>{take.voiceKey}</span>
                      <span className="take-meta">
                        {fmtSpeechSeconds(take.durationMs)} · {fmtBytes(take.sizeBytes)}
                      </span>
                    </div>
                    <div className="take-text">{take.text}</div>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div className="stack gap-16">
          <Panel title="Voice" tight>
            {noVoices ? (
              <EmptyState icon={<IconWave size={22} />}>
                Nothing downloaded yet.
                <div className="hint">
                  <button className="btn sm" onClick={() => navigate('/voices')}>
                    Open voices &amp; setup
                  </button>
                </div>
              </EmptyState>
            ) : (
              <div style={{ margin: '0 -12px' }}>
                {installed!.voices.map((v) => (
                  <div
                    key={v.key}
                    className={`voice-row playable${v.key === voiceKey ? ' selected' : ''}`}
                    onClick={() => selectVoice(v.key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') selectVoice(v.key)
                    }}
                  >
                    <span className="lang-flag">{v.language}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="voice-name">{v.name}</div>
                      <div className="voice-meta">{v.quality} · {fmtBytes(v.size_bytes)}{v.sample_rate ? ` · ${v.sample_rate} Hz` : ''}</div>
                    </div>
                    {v.key === voiceKey && <IconCheck size={14} color="var(--accent)" />}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {voice && voice.num_speakers > 1 && (
            <Panel title="Speaker">
              <label className="field-name" htmlFor="speaker-id">Speaker</label>
              <select
                id="speaker-id"
                value={speakerId}
                onChange={(e) => setSpeakerId(Number(e.target.value))}
              >
                {Array.from({ length: voice.num_speakers }, (_, i) => (
                  <option key={i} value={i}>Speaker {i}</option>
                ))}
              </select>
              <div className="field-hint">this model carries {voice.num_speakers} speakers</div>
            </Panel>
          )}

          <Panel title="Delivery">
            <ParamSlider
              label="Speed"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              onChange={setSpeed}
              format={(v) => `${v.toFixed(2)}×`}
            />
            <ParamSlider
              label="Volume"
              min={0.1}
              max={1.5}
              step={0.05}
              value={volume}
              onChange={setVolume}
              format={(v) => `${v.toFixed(2)}`}
            />
            <div className="hr" />
            <label className="switch">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(e) => {
                  setAdvanced(e.target.checked)
                  localStorage.setItem(LS_ADV, e.target.checked ? '1' : '0')
                }}
              />
              <span className="track" />
              Show advanced prosody controls
            </label>
            {advanced && (
              <div style={{ paddingTop: 6 }}>
                <ParamSlider
                  label="Phoneme noise"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={noiseScale}
                  onChange={setNoiseScale}
                  format={(v) => v.toFixed(2)}
                />
                <ParamSlider
                  label="Cadence variation"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={noiseWScale}
                  onChange={setNoiseWScale}
                  format={(v) => v.toFixed(2)}
                />
                <div className="param-row">
                  <label className="switch">
                    <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} />
                    <span className="track" />
                    Normalize output loudness
                  </label>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function ParamSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  return (
    <div className="param-row">
      <div className="param-head">
        <label className="field-name" style={{ marginBottom: 0 }}>{label}</label>
        <span className="param-val">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}
