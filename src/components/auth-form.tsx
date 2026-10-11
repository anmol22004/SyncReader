'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Cloud, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { assertInstantSignup, credentialError, submitAuth, type AuthMode } from '@/lib/auth-actions';
export default function AuthForm({ initialError }: { initialError: string }) {
 const [mode, setMode] = useState<AuthMode>('signin');
 const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
 const [visible, setVisible] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [initialDismissed, setInitialDismissed] = useState(false);
 const submitting = useRef(false); const mounted = useRef(true);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
 function choose(next: AuthMode) { if (submitting.current) return; setMode(next); setPassword(''); setVisible(false); setError(''); setInitialDismissed(true); }
 async function submit(event: React.FormEvent) {
  event.preventDefault(); if (submitting.current || !supabase) return; setInitialDismissed(true);
  const validation = credentialError(mode, email, password); if (validation) { setError(validation); return; }
  submitting.current = true; setBusy(true); setError('');
  try {
   if (mode === 'signup') {
    // Check before creating an account so V1 does not trigger confirmation mail.
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, '')}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Could not check signup settings. Try again.');
    assertInstantSignup(await response.json());
   }
   await submitAuth(supabase.auth, mode, { email, password }); if (mounted.current) setPassword('');
  }
  catch(e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Please try again.'); }
  finally { submitting.current = false; if (mounted.current) setBusy(false); }
 }
 return <div className="auth-card"><span className="eyebrow">YOUR PERSONAL READING SPACE</span><h2>{mode === 'signup' ? 'Create your account.' : 'Welcome back.'}</h2><p>{mode === 'signup' ? 'One account. All your books.' : 'Sign in and keep reading.'}</p>
  <div className="auth-tabs" aria-label="Account access"><button type="button" aria-pressed={mode === 'signin'} disabled={busy} onClick={() => choose('signin')}>Sign in</button><button type="button" aria-pressed={mode === 'signup'} disabled={busy} onClick={() => choose('signup')}>Sign up</button></div>
  <form onSubmit={submit} aria-busy={busy}>
   <label htmlFor="auth-email">Email<input id="auth-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} maxLength={254} /></label>
   <label htmlFor="auth-password">Password</label><div className="auth-password"><input id="auth-password" type={visible ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signin' ? 'Your password' : 'At least 8 characters'} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === 'signup' ? 8 : undefined} disabled={busy} /><button type="button" className="password-toggle" onClick={() => setVisible(v => !v)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
   {(error || !initialDismissed && initialError) && <p className="auth-feedback error" role="alert">{error || initialError}</p>}
   <button className="primary auth-submit" disabled={busy}>{busy ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
  </form><small><Cloud size={14} /> Your books stay private to your account.</small>
 </div>;
}
