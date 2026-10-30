# OmniScholar authentication + Supabase backend

## Included
- `index.html`: existing OmniScholar workspace preserved, with an authentication gate, signup/login/password recovery, activity logging, and user-specific Scopus key integration.
- `supabase/schema.sql`: profiles, activity logs, RLS policies and private encrypted Scopus key table.
- `supabase/functions/scopus-search/index.ts`: server-side Scopus key save/status/delete/search function.
- `admin.html`: separate admin-only account and usage dashboard.

## Required setup before deployment
1. Create a Supabase project.
2. In Authentication > URL Configuration, set the Site URL to `https://clbrsnc-python.github.io/omni/` and add `https://clbrsnc-python.github.io/omni/` to Redirect URLs. The admin page will be `https://clbrsnc-python.github.io/omni/admin.html`.
3. In Authentication > Providers > Email, enable email confirmations. Configure SMTP for reliable production email delivery (the built-in mail service is rate-limited).
4. Run `supabase/schema.sql` in the Supabase SQL Editor.
5. In `index.html` and `admin.html`, replace `YOUR_SUPABASE_PROJECT_URL` and `YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`. Use the publishable/anon key only. Never place the service_role key in HTML.
6. Install Supabase CLI, link your project, and deploy: `supabase functions deploy scopus-search`.
7. Set Edge Function secrets: `supabase secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SCOPUS_ENCRYPTION_SECRET=...`. The encryption secret must be a strong random string of at least 32 characters. Do not reuse the service role key as the encryption secret.
8. Register your own user through the website, verify the email, then promote it to administrator in SQL Editor: `update public.profiles set is_admin = true where email = 'YOUR_ADMIN_EMAIL';`
9. Upload `index.html` as the repository's `index.html`. Upload `admin.html` alongside it. The `supabase` folder is backend deployment material and does not need to be public on GitHub Pages.

## Important notes
- Supabase Auth enforces verified-email sign-in when email confirmations are enabled.
- User Scopus API keys are encrypted with AES-GCM by the Edge Function and are not readable by browser-side database queries.
- Existing browser-stored `omni_scopus_api_key` values are removed from localStorage on startup. If your previous personal key has been exposed to users, revoke/rotate it in the Elsevier Developer Portal.
- Activity logging records authentication and usage events, resource IDs, result counts, and citation actions. It intentionally does not store full search queries. External search logging only records the click from OmniScholar, not activity on the external site.
- This is a deployable integration template, but it is not live until you complete the Supabase configuration and deploy the Edge Function.
- Minification/obfuscation can deter casual copying but cannot hide client-side HTML/JavaScript. This package keeps privileged Scopus credential handling server-side.
