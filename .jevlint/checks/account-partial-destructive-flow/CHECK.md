Where can an account flow that erases or replaces data stop part-way and hand the app back as if nothing happened?

Find the multi-step account flows: delete-all, profile removal, recovery, import, account switch
and restart (app/shared/lib/profile/profileSessionOrchestrator.ts, profileTransition.ts,
removeProfile.ts). For each step that can fail after the first irreversible change, find what the
failure branch does to the splash, the account lock and the mounted account providers. Before the
first deletion, giving the app back unchanged is correct. After it, the providers must stay down,
the lock must be kept and the app must ask to be reopened; a flow must finish or undo, never
leave providers mounted over a partly erased installation or flip accounts in memory.
