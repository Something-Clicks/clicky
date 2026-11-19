# Phase 2: Product shell and customer journey — report

**Status:** complete and verified (November 19, 2026).

## What was built
- All 15 reference screens (from Phase 1), plus `/about` and `/faq` in the reference's style. FAQ answers come from the product direction and say nothing the product does not do.
- Password reset: "Forgot your password?" on login, `/forgot-password` (same answer whether or not the email has an account), `/reset-password` from the emailed link, with an expired-link state.
- Settings → Security: change password.
- Specific sign-up errors (invalid email, existing account, rate limit, weak password).
- Loading state for the workspace; in-app not-found page.

## Journey check (live Supabase)
Sign up → confirm email → onboarding (business setup) → dashboard → every app screen → settings saves → activity → sign out. No dead ends. The steps after sign-up were verified end to end in Phase 1; sign-up and reset requests were verified against Supabase here (an invalid address is rejected with a clear message).

## Not built, needs approval
- `/privacy` and `/terms`: need approved legal text. They are not linked anywhere yet. **Launch blocker.**

## Known limitation until Resend is set up
Supabase's built-in email sends only to members of your Supabase organization and is heavily rate-limited, so outside customers cannot confirm sign-ups or reset passwords until custom SMTP (Resend) is configured in Supabase → Authentication → Emails. **Launch blocker.**
