# Email delivery and authentication verification

## Development

The local Supabase configuration uses Inbucket instead of sending real email. Start
the local stack with the pinned CLI, then open <http://127.0.0.1:54324> to inspect
confirmation and password-reset messages:

```sh
npx --yes supabase@2.95.3 start
```

Email confirmations remain enabled in
[supabase/config.toml](../../supabase/config.toml). Use a disposable local account
for testing; local messages are not delivered to an external inbox.

## Hosted development project

The hosted project currently uses Supabase's default email service. This is suitable
for development verification only and is subject to Supabase's rate and delivery
limits. Configure the following in Supabase Dashboard:

1. **Authentication → URL Configuration**
   - Set **Site URL** to the deployed frontend origin.
   - Add the deployed frontend origin and its trailing-slash variant to
     **Redirect URLs**.
2. **Authentication → Providers → Email**
   - Keep email signups and email confirmations enabled.
3. Use a disposable test account to verify signup confirmation, resend, password
   reset, recovery, and invalid/expired links.

Do not add provider credentials to this repository or chat. If reliable production
delivery is required, configure a dedicated SMTP provider in the dashboard and
record the provider, sender domain, and tested redirect URLs in the deployment
handoff without recording secrets.

## Acceptance checklist

- [ ] Signup displays a confirmation message and sends an email.
- [ ] A valid confirmation link enables sign-in.
- [ ] An invalid or expired confirmation link fails safely.
- [ ] Resend confirmation is rate-limited and reports a safe message.
- [ ] Password reset sends an email and opens the recovery screen.
- [ ] An invalid or expired reset link fails safely.
- [ ] The deployed frontend origin is the only non-local redirect origin.
- [ ] No service-role key, SMTP password, or provider token is present in Git.
