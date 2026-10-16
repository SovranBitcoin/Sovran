// Entry point - polyfills MUST be imported before anything else
import './shim';

// E2e-only mint-fault interceptor (no-op without the harness env gate) must
// patch fetch before any module can issue a mint request.
import './shared/lib/e2e/mintFaults/install';

// Android-only e2e clipboard bridge (no-op without the harness env). The
// emulator's `cmd clipboard` shell command is unimplemented, so the harness
// delivers/reads clipboard content through a file this reflects into the
// real system clipboard.
import './shared/lib/e2e/clipboard/install';

// E2e-only map of the controls on screen (inert outside the test build). It
// reads React's tree through the hook a renderer reports to at start-up, so it
// must be in place before expo-router loads the renderer.
import './shared/lib/e2e/elementMap';

// Now load expo-router
import 'expo-router/entry';
