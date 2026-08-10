// The real `server-only` package resolves to a module that throws outside a
// React Server Component. Under Vitest there is no RSC graph, so the guard has
// nothing to protect and is stubbed out. It still applies to `next build`,
// which is where it actually matters.
export {}
