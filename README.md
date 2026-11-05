# Parchment Next Bond: Community Ideas

A community brainstorming board for Parchment School District residents to
discuss ideas for the next school bond, in organized threads and comments.

This is NOT an official Parchment School District site. Ideas here are
resident suggestions, not district decisions. No organizer name or contact
information is published on the site.

## Features

- Threads by topic: Buildings and repairs, Classrooms and learning, Safety,
  Cost and taxes, Timeline and phasing, Other ideas
- Search, comments, and upvotes, with posts saved in Postgres on Render
- A neutral summary on each thread: main points, agreement, different views,
  and open questions. It never takes a side.
- Build a Bond Workshop: past-bond history (May 2025 $36.4M, Nov 2025 $32.35M,
  Nov 2026 $41M, all failed), seed sections built from the verified 2026
  project costs and the state facilities study, custom section builder,
  voting on sections, and a draft builder that totals priced sections and
  gives a rough tax estimate scaled from the 2026 ballot figures. A submitted
  draft becomes a proposal thread in the forum.
- Community guidelines on the site: focus on ideas, not people; no personal
  attacks; no personal information. Posts can be reported.

## Running on Render

Use the Render dashboard, New, Blueprint, and point it at this repo.
`render.yaml` creates the web service and a free Postgres database and
wires `DATABASE_URL` to the app.

Optional: in the Render dashboard, set `OPENAI_API_KEY` to use an AI
summary. Without it, the site falls back to an automatic summary built
only from that thread's own comments.

## Running locally

```
npm install
npm start
```

Without `DATABASE_URL`, the app uses an in-memory store for testing only.
Posts in that mode do not persist across restarts.
