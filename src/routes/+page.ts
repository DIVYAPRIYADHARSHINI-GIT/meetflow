// The landing page is the ONLY route rendered on the server at build time.
//
// The rest of the app opts out of SSR (see +layout.ts) because it reads `?code=`/`?id=`
// search params, which a prerenderer cannot know - SvelteKit fails the build with
// `url_search_unavailable_prerender` if they are prerendered with SSR on.
//
// This page has no query params and is the one URL that must contain real HTML: it is what
// a first-time visitor, a link preview and a search crawler see, so the hero headline and
// description belong in the served markup rather than in a JS-only shell.
export const ssr = true;
export const prerender = true;
