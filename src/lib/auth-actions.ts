export type AuthMode = 'signin' | 'signup';
type Result = { error: { message: string; code?: string } | null; data?: { session?: unknown; user?: unknown } | null };
export type AuthApi = {
 signInWithPassword(input: { email: string; password: string }): Promise<Result>;
 signUp(input: { email: string; password: string }): Promise<Result>;
};
export function assertInstantSignup(settings: { mailer_autoconfirm?: boolean; disable_signup?: boolean }) {
 if (settings.disable_signup) throw new Error('Enable new user signup in Supabase Authentication settings.');
 if (settings.mailer_autoconfirm !== true) throw new Error('Turn off Confirm email in Supabase Authentication > Email settings to enable instant V1 signup.');
}
export function credentialError(mode: AuthMode, email: string, password: string): string | null {
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
 if (!password) return 'Enter your password.';
 if (mode === 'signup' && password.length < 8) return 'Use a password with at least 8 characters.';
 return null;
}
export function authError(error: { message: string; code?: string }): string {
 if (error.code === 'invalid_credentials') return 'The email or password is incorrect.';
 if (error.code === 'email_not_confirmed') return 'This account is unconfirmed. Confirm it manually in Supabase Authentication > Users for V1.';
 if (error.code === 'over_request_rate_limit' || error.code === 'over_email_send_rate_limit') return 'Too many attempts. Wait a few minutes and try again.';
 if (error.code === 'weak_password') return 'Choose a stronger password.';
 if (error.code === 'user_already_exists') return 'This account already exists. Choose Sign in.';
 return 'Unable to sign in or create your account. Check your connection and try again.';
}
export async function submitAuth(api: AuthApi, mode: AuthMode, input: { email: string; password: string }) {
 const validation = credentialError(mode, input.email, input.password);
 if (validation) throw new Error(validation);
 const credentials = { email: input.email.trim(), password: input.password };
 const result = mode === 'signin' ? await api.signInWithPassword(credentials) : await api.signUp(credentials);
 if (result.error) throw new Error(authError(result.error));
 if (!result.data?.session) throw new Error(mode === 'signup' ? 'Turn off Confirm email in Supabase Authentication > Email settings to enable instant V1 signup.' : 'Sign-in did not create a session. Please try again.');
}
