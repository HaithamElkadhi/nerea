# Nerea APS

Italian showcase website with a Node.js backend and an Airtable content manager. The admin manages projects, events, news, photographs and donation campaigns.

## Run locally

Requires Node.js 22 or newer. There are no npm dependencies to install.

1. Copy `.env.example` to `.env` if `.env` does not already exist.
2. Add your Airtable personal access token as `AIRTABLE_TOKEN`.
3. Run `npm run dev`.
4. Open [the website](http://localhost:4173) or [the admin](http://localhost:4173/admin).

The requested local credentials are username `admin`, password `admin`. Without an Airtable token, login still works and the dashboard explains the missing configuration; saving is disabled by the backend. It never pretends that content was saved locally. Restart the server after changing environment variables.

## Airtable setup

The following tables were created in [the supplied base](https://airtable.com/appczw9TmpSoUqw3g). The original `Table 1` is preserved.

- `Projects`: `tblEqE1zASY5nMIrD`
- `Events`: `tblNz6Tc8tgOrI8fY`
- `News`: `tblTroq5fVUXNLlJL`
- `Donations`: `tblcMGqDNEzyTRCUH`

Each table has `Title`, `Description`, `Category`, `Date`, `Location`, `Image` (attachments), `Published` (checkbox), `Link`, `IBAN`, `ButtonLabel`, and `SortOrder`. Keep these field names intact. Table IDs and the base ID are already populated in `.env.example` and the backend defaults. The three original projects have been migrated to `Projects`; no sample events, news or donation details were published.

Create an [Airtable personal access token](https://airtable.com/create/tokens) with `data.records:read` and `data.records:write`, and grant it access to this base. Runtime access does not need schema-write permissions. Keep the token in `.env` or your hosting provider's secret settings, never in browser files. The connected Airtable plugin used to create the schema does not automatically authenticate the running website.

## Editing content

1. Log into `/admin` and choose Progetti, Eventi, Notizie or Donazioni.
2. Select a record to edit, or create a new one.
3. Enter the title and description, optionally a category, date, location and HTTPS link.
4. Choose JPEG, PNG or WebP photos, up to 5 MB each, from your device. Projects accept a gallery of up to 20 photographs; other content types keep a single cover.
5. Leave the publication checkbox off to save a draft. Turn it on to publish.

For photo changes, the admin first saves a draft, uploads the photos one at a time, then publishes if requested. Successful uploads are tracked so a retry continues with the remaining files. In project galleries, existing photographs remain when you add more. Use **Copertina** to choose the first photo and **Rimuovi** to remove a photo, then save. For other content types, a new photo replaces the cover. To remove a story from the public site, edit it and switch publication off. There is no destructive delete button.

The project detail view includes thumbnails, previous/next buttons and an enlarged viewer. Arrow keys navigate and Escape closes the enlarged photo. Galleries use the existing Airtable `Image` attachment field; no new table or credentials are needed. Gallery ordering requests check the known attachment list to detect edits from a stale browser tab.

The public API returns published content only. Admin writes invalidate the server's content cache immediately; changes made directly in Airtable can take up to 30 seconds to appear on a newly loaded page. Reload the public page after saving. Attachment URLs are read fresh from Airtable, rather than stored as permanent image URLs.

For donations, enter the association's verified IBAN and/or its existing HTTPS donation-provider link and an optional button label. The website displays these instructions or opens the provider's page. It does not collect card details, process payments, issue receipts, or store donor records. Until a campaign is published, the section shows a general invitation to support the association.

## Configuration and hosting

All available variables are documented in `.env.example`. Only `AIRTABLE_TOKEN` is needed to connect the existing tables in local development. Set `SESSION_SECRET` to a random string of at least 32 characters for sessions that survive server restarts.

For production, set:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=4173
PUBLIC_ORIGIN=https://your-domain.example
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-a-unique-password
SESSION_SECRET=replace-with-a-random-secret-of-at-least-32-characters
AIRTABLE_TOKEN=your-token
```

Use an HTTPS reverse proxy or Node hosting service. Production startup requires a non-default password of at least 12 characters and a session secret of at least 32 characters. `PUBLIC_ORIGIN` must match the site origin and have no trailing slash. Essential admin session cookies are HttpOnly and SameSite Strict, and Secure in production. Login attempts are rate limited; writes require same-origin requests and a custom CSRF header.

For Node hosting, deploy the repository and run `npm start`; uploading only `dist/` does not deploy the backend. For Vercel, `vercel.json` routes the website and API through `api/index.js`, which bundles the public files and uses the same backend. The production site is [nerea-aps.vercel.app](https://nerea-aps.vercel.app), with the admin at `/admin`. Production environment variables are stored in Vercel; local `.env` files are excluded from source uploads.

The production admin password is generated separately from the local `admin / admin` login. Its local handoff file is `outputs/admin-access.txt` (ignored by Git and deployment uploads). Larger photographs are optimized in the browser before upload to fit Vercel's request-body limit. The earlier static Sites preview has not been changed.

Sessions are signed and expire after eight hours. Login throttling, logout revocations and caching are held in memory for a single server instance. Use a shared session/rate-limit store before running multiple instances. Set a stable secret and use one instance for this version.

## Verification

```sh
npm run check
npm test
```

Tests exercise the real HTTP server with a simulated Airtable upstream: authentication, CSRF, login throttling, publication, drafts, image uploads, separate content tables, pagination, missing configuration and static file access. A real token is needed to verify live website-to-Airtable writes.

## Files

- `dist/`: public website and admin interface.
- `backend/app.cjs`: HTTP routing, authentication, session cookies and static files.
- `backend/airtable.cjs`: validation, Airtable records and attachment upload.
- `backend/config.cjs`: environment variables and table IDs.
- `tests/backend.test.cjs`: backend integration tests.

The Naples photograph is by [Eric Seddon on Pexels](https://www.pexels.com/photo/vibrant-street-scene-in-naples-italy-36817240/). The association logo was supplied by the user.
