# Simple V1 authentication

Only Sign in and Sign up, with email and password. Signup opens the library immediately. No magic links, password-reset forms, or email-confirmation screens are included.

## One required Supabase setting

Open Authentication > Sign In / Providers > Email. Keep the Email provider enabled, turn Confirm email OFF, and save. Disable signup/password-change email notifications if you enabled them. The app checks the confirmation setting before signup and blocks account creation if confirmation is enabled, avoiding confirmation mail from V1.

Supabase stores account emails and password hashes. Existing book/storage ownership rules remain in place. The application does not store plaintext passwords or call email/reset APIs.

## Restart

For development: npm run dev.
For the existing production server: stop it, run npm run build, then npm start. Keep the tunnel running.

## Test

Sign up with a new account; the library should open immediately without email. Sign out, sign back in, and try a wrong password. Open the same account on your phone/iPad to check books and reading progress.

Existing accounts created with email links may not have a password. For V1, manage those accounts manually in Supabase; changing the setting does not give them a password or reliably resolve an already-unconfirmed account. Do not create a second account expecting it to own the first account's books. There is no user-facing password recovery in V1.

Full live signup depends on your Supabase settings and still requires a device check.

Reference: https://supabase.com/docs/guides/auth/general-configuration
