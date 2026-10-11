'use client';
import { useEffect, useState } from 'react';
import type { Preferences } from '@/lib/types';
import { applyPreset, FONT_OPTIONS, fontFor, presetFor, READING_PRESETS } from '@/lib/reading-preferences';
import Modal from './modal';

export function PreferenceControls({ preferences: p, change }: { preferences: Preferences; change: (p: Preferences) => void }) {
  const range = (key: 'fontSize' | 'lineHeight' | 'letterSpacing' | 'wordSpacing' | 'margins' | 'brightness', label: string, min: number, max: number, step: number, display: string) => <label className="reading-slider" key={key}><span>{label}<output>{display}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={p[key]} onChange={e => change({ ...p, [key]: Number(e.target.value) })} /></label>;
  return <div className="reading-customize"><label className="reading-setting-row">Font<select value={p.font} onChange={e => change({ ...p, font: e.target.value as Preferences['font'] })}>{FONT_OPTIONS.map(font => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><label className="reading-setting-row">Bold text<input className="reading-switch" type="checkbox" role="switch" checked={p.bold} onChange={e => change({ ...p, bold: e.target.checked })} /></label>
    {range('fontSize', 'Text size', 12, 40, 1, `${p.fontSize}px`)}
    {range('lineHeight', 'Line spacing', 1.2, 2.4, .05, p.lineHeight.toFixed(2))}
    {range('letterSpacing', 'Character spacing', -.02, .12, .01, `${Math.round(p.letterSpacing * 100)}%`)}
    {range('wordSpacing', 'Word spacing', 0, .5, .02, `${Math.round(p.wordSpacing * 100)}%`)}
    {range('margins', 'Margins', 12, 72, 2, `${p.margins}px`)}
    <label className="reading-setting-row">Justify text<input className="reading-switch" type="checkbox" role="switch" checked={p.justify} onChange={e => change({ ...p, justify: e.target.checked })} /></label>
  </div>;
}

export default function ReadingSettings({ preferences, preview, save, close, excerpt, pdf = false }: { preferences: Preferences; preview: (p: Preferences) => void; save: (p: Preferences) => Promise<void>; close: () => void; excerpt?: string; pdf?: boolean }) {
  const [draft, setDraft] = useState(preferences); const [customize, setCustomize] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { preview(draft); }, [draft, preview]);
  const palette = presetFor(draft);
  async function apply() { setSaving(true); setError(''); try { await save(draft); close(); } catch { setError('This browser could not remember these settings. Please allow browser storage and try again.'); } finally { setSaving(false); } }
  return <Modal className="reading-settings-sheet" title={customize ? 'Customize theme' : 'Themes & settings'} close={() => { if (!saving) close(); }}>
    <div className="reading-preview" style={{ background: palette.background, color: palette.color, fontFamily: fontFor(draft), fontSize: draft.fontSize, lineHeight: draft.lineHeight, fontWeight: draft.bold ? 700 : 400, letterSpacing: `${draft.letterSpacing}em`, wordSpacing: `${draft.wordSpacing}em`, paddingInline: Math.min(draft.margins, 48), textAlign: draft.justify ? 'justify' : 'start', filter: `brightness(${draft.brightness / 100})` }}><span className="preview-label">LIVE PREVIEW</span><p>{excerpt || 'A good book gives us room to pause, notice the world, and return to a thought with fresh eyes. Make this space comfortable for the way you read.'}</p></div>
    {!customize && <><div className="reading-size-buttons"><button aria-label="Decrease text size" disabled={draft.fontSize <= 12} onClick={() => setDraft(p => ({ ...p, fontSize: Math.max(12, p.fontSize - 1) }))}>A<span>Smaller</span></button><button aria-label="Increase text size" disabled={draft.fontSize >= 40} onClick={() => setDraft(p => ({ ...p, fontSize: Math.min(40, p.fontSize + 1) }))}>A<span>Larger</span></button></div><label className="reading-slider"><span>Reading brightness<output>{draft.brightness}%</output></span><input aria-label="Reading brightness" type="range" min={60} max={110} value={draft.brightness} onChange={e => setDraft({ ...draft, brightness: Number(e.target.value) })} /></label><div className="reading-presets" aria-label="Reading theme presets">{READING_PRESETS.map(t => <button key={t.id} aria-pressed={draft.preset === t.id} className={draft.preset === t.id ? 'active' : ''} style={{ background: t.background, color: t.color }} onClick={() => setDraft(applyPreset(draft, t.id))}><strong style={{ fontWeight: t.id === 'bold' ? 800 : 400 }}>Aa</strong><span>{t.label}</span></button>)}</div><button className="customize-reading" onClick={() => setCustomize(true)}>Customize font & layout</button></>}
    {customize && <><button className="text-button" onClick={() => setCustomize(false)}>← Theme presets</button><PreferenceControls preferences={draft} change={setDraft} /></>}
    <p className="muted small">Remembered in this browser. Your other devices keep their own settings.{pdf ? ' PDF text keeps its original layout; typography controls apply to EPUBs.' : ''}</p>
    {error && <p role="alert" className="reading-settings-error">{error}</p>}<div className="reading-settings-actions"><button className="secondary" disabled={saving} onClick={close}>Cancel</button><button className="primary" disabled={saving} onClick={() => void apply()}>{saving ? 'Saving…' : 'Done'}</button></div>
  </Modal>;
}
