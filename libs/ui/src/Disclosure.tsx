/**
 * The mark that says a row opens, and which way it currently is.
 *
 * Two borders on a rotated square rather than an SVG: it inherits its weight
 * from the type around it and there is no file to load.
 */
export function Chevron({ open }: { open: boolean }) {
  return <span className="ui-chevron" data-open={open ? 'true' : undefined} aria-hidden />;
}
