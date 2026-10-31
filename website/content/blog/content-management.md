# Nerea can manage its own stories

Nerea's website now has an Italian administration area for projects, events, news and donation campaigns. The association can prepare a story, choose its photograph and publish it without editing website files. Drafts give the team a place to finish the text before visitors see it.

The original showcase introduced the association and its work through a fixed editorial layout. That works for an introduction, but ongoing activity needs a way to change. A new workshop, a project photograph or an event announcement should not require a developer to update HTML. The administration area provides that workflow while keeping the public site's visual identity.

## A familiar editing workflow

The administrator signs in at `/admin` and chooses a content type. Each collection has a list of its records and a button to create another. The editor accepts a title, description, category, date and related link. Events can also include a location. An ordering field lets the association decide which records appear first.

Photographs come directly from the administrator's device. The editor previews the selected image and accepts JPEG, PNG or WebP files up to 5 MB. A cover is stored in Airtable's attachment field, so the association can also inspect its content in the database. Replacing a photo updates the record's cover rather than requiring a separate media-hosting account.

Publication is explicit. When the checkbox is off, a story stays in the administration area. Turning it on makes it eligible for the public website. A photo save first creates or updates a draft, then uploads the attachment, then publishes if requested. If uploading fails, the editor explains what happened and keeps the record reference for a retry. This avoids a second record being created just because a photo needed another attempt.

## Four collections in Airtable

Project photographs now form a gallery rather than a single cover. The administrator can select multiple files, keep existing photographs, choose the cover and remove individual images before saving. Each project supports up to twenty photographs, with the first image used on the public project card. The gallery remains in the existing Airtable attachment field.

Visitors can browse thumbnails and move through the images with previous and next buttons. An enlarged viewer preserves the photograph's proportions and supports arrow-key navigation and Escape to close. Uploads run sequentially, and successful attachments are tracked before the next file starts, so ordinary retries continue with the files still waiting. A stale-gallery check detects when the attachment list changed in another browser window. Automated backend tests and local browser checks cover gallery persistence, cover changes, navigation and the enlarged viewer.

Projects, Events, News and Donations are separate tables in the supplied base. They share a small set of field names, which keeps the backend straightforward while giving each content type its own collection. The existing projects were migrated using the association's supplied descriptions. Events and news start empty, so visitors are not shown invented appointments or announcements.

The Node server is the only part of the website that receives the Airtable token. It validates submitted fields and forwards authorized requests to Airtable. The public API requests published records and checks publication again before returning them. Attachment URLs are refreshed when records are read, since these URLs are not permanent media identifiers.

## Donation information, controlled by the association

The support section can display an association-approved campaign description, an IBAN, an external donation link, or both. A visitor can copy the IBAN or continue to the configured payment provider. The website does not take card details or represent an incomplete payment integration as a working checkout. Until actual donation instructions are published, the section invites visitors to contact the association.

## Getting started

The repository includes `.env.example` with the base and table IDs already filled in. Add a personal access token with record-read and record-write access to the supplied base, then start the server:

```sh
npm run dev
```

The requested `admin / admin` credentials work locally. Production requires a different password and a session secret, configured on the server. The current implementation uses signed session cookies, same-origin write checks and login throttling. It is designed for one running server instance.

Automated tests cover the backend workflow with a simulated Airtable service. Live saves still require the deployment's own token. The README documents configuration, hosting and the distinction between the earlier static preview and the full Node application. The next operational step is to add that token, verify a draft and photo against Airtable, then publish real updates as the association is ready.
