'use client';
import { useEffect, useState } from 'react';
import type { ReaderTrace } from '@/lib/reader-trace';

export default function ReaderDebug({ trace }: { trace: ReaderTrace }) {
  const [captured, setCaptured] = useState(false);
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  useEffect(() => { setCaptured(!trace.recording); setMessage(''); setFallback(''); }, [trace]);
  function capture() { trace.capture(); setCaptured(true); }
  function download() {
    const url = URL.createObjectURL(new Blob([trace.json()], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `folio-reader-trace-${Date.now()}.json`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(trace.json()); setMessage('Trace copied.'); }
    catch { setFallback(trace.json()); setMessage('Select and copy the trace below.'); }
  }
  return <aside className="reader-debug" aria-label="Reader diagnostics">
    <small>Debug 1 · {trace.meta.build.slice(0, 12)} · {captured ? 'Captured' : 'Recording'}</small>
    {!captured ? <button onClick={capture}>Capture jump</button> : <div>
      <button onClick={download}>Save trace</button><button onClick={() => void copy()}>Copy trace</button>
      <button onClick={() => { trace.restart(); setCaptured(false); setMessage(''); setFallback(''); }}>Restart</button>
    </div>}
    {message && <small role="status">{message}</small>}
    {fallback && <textarea aria-label="Diagnostic trace to copy" readOnly value={fallback} rows={4} onFocus={event => event.target.select()} />}
  </aside>;
}
