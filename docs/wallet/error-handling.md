# Error handling

The wallet package handles `neverthrow` `Result` and `ZodError` **internally** —
screens don't see them. Failures surface two ways:

1. `useScreenActions` returns a plain `error: string` field.
2. `machine.scan(...)` / `machine.execute(...)` are awaited inside `try/catch` and
   return a **progress-shaped result object** for normal cases (e.g. an
   unsupported input is not a thrown error). The `catch` is for unexpected
   failures only.

The one named error helper the package exposes is `isMintOfflineError(err)`
(from `wallet`).

```tsx
// app/features/camera/screens/CameraScreen/CameraScreen.tsx
try {
  const result = await machine.scan?.(data.data, { source: data.type ?? 'qr' });
  applyScanResult(result, setProgress, setLoading, isProcessingRef); // reads result.progress / .urInProgress
} catch (err) {
  log.error('camera.scan.failed', {
    error: err instanceof Error ? err : new Error(String(err)),
  });
  setLoading(false);
}
```

For terminal screens, render the `error` string directly:

```tsx
// app/features/receive/screens/ReceiveTokenScreen.tsx
const { entry, error, actions } = useScreenActions('receiveToken', receiveHistoryEntry);
if (error) return <ScreenErrorState message={error} onGoBack={() => void actions.back.execute()} />;
```

This keeps screens free of `Result` plumbing: await the machine, read the
progress result, and show `error` when present.
