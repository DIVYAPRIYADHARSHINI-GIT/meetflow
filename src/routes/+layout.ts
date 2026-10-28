// Static site: prerender every route, no SSR. All scheduling, notes and media work is
// browser-only, so there is nothing meaningful to render on a server.
//
// `trailingSlash: 'always'` matches vercel.json and keeps deep links (/calendar/,
// /room/?code=...) working identically on Vercel, Netlify and a plain static server.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
