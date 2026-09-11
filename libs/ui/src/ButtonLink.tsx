/**
 * The one component in the kit that knows what framework it is in.
 *
 * Imported by its own path and deliberately absent from the barrel: the agent's
 * frontend bundles this kit with webpack and has no Next, so a barrel that
 * reaches `next/link` fails its build at resolve time — which is how it failed,
 * on a deploy, after an unrelated component was imported through the barrel.
 */
import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { ButtonVariant, ControlSize } from './Button';

interface ButtonLinkProps extends Omit<ComponentPropsWithRef<typeof Link>, 'children'> {
  variant?: ButtonVariant;
  size?: ControlSize;
  block?: boolean;
  children?: ReactNode;
}

/**
 * A Button that is really a link.
 *
 * Navigation dressed as an action used to be a real <button> with router.push
 * inside, which looked identical and behaved worse: nothing for a crawler to
 * follow, nothing for a middle-click or a long-press to open. Same classes as
 * Button, so the two are told apart by what they do, never by how they look.
 */
export function ButtonLink({ variant = 'accent', size = 'md', block, children, ...rest }: ButtonLinkProps) {
  return (
    <Link
      {...rest}
      className={['ui-btn', rest.className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      data-block={block ? 'true' : undefined}
    >
      {children}
    </Link>
  );
}
