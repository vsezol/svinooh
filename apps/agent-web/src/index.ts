// Async boundary required by Module Federation: shared modules (react,
// react-dom) can only be negotiated behind a dynamic import. A static import
// here would pull react eagerly and break the share scope, so this file
// stays a single line.
import('./standalone');
