/**
 * The UI kit.
 *
 * Everything the interface is assembled from lives here, and nothing here knows
 * anything about wallets, portfolios or chains — with one deliberate exception:
 * ChainBadge, which is the shared drawing of a network mark and travels with
 * the kit so every surface renders chains identically. Two rules keep the rest
 * that way:
 *
 *  1. A screen or a feature component imports from `@svinooh/ui` — never a
 *     `.ui-*` class name directly, and never a font size, radius or control
 *     height in pixels. Those are tokens (see tokens.css); if the token you
 *     need does not exist, the answer is usually that an existing one fits.
 *  2. When something is needed in a second place, it comes here — extended with
 *     a prop if it is a variation, added as a component if it is genuinely new.
 *     Copying it is what produced twenty font sizes and ten button classes.
 */
export { AppHeader } from './AppHeader';
export type { AppHeaderProps, AppTab } from './AppHeader';
export { Button, ButtonLink, IconButton, Spinner } from './Button';
export type { ButtonVariant, ControlSize } from './Button';
export { Tag, TagButton } from './Tag';
export type { TagVariant } from './Tag';
export { Input, NumberField } from './Input';
export { Select } from './Select';
export type { SelectOption } from './Select';
export { Checkbox } from './Checkbox';
export { Switch } from './Switch';
export { Segmented } from './Segmented';
export type { Segment } from './Segmented';
export { Card, Panel, MenuItem, Row } from './Surface';
export { Eyebrow, Note, Title, Display } from './Text';
export { Meter } from './Meter';
export { AnchoredMenu, useDismiss } from './Popover';
export { Tooltip, InfoTip } from './Tooltip';
export { Chevron } from './Disclosure';
export { Dialog, DialogActions } from './Dialog';
export { ChainBadge, networkName, badgedText } from './ChainBadge';
export * from './Logo';
