/**
 * Next.js Route Handler shim. Only HTTP-verb exports are allowed in
 * `route.ts` (Next 15 strict route type-check), so the actual handler
 * implementations + their inner helpers live in `./route-impl.ts` where
 * tests can also import them.
 */

export { DELETE, GET, POST, PUT } from './route-impl';
