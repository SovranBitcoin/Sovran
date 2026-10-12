Where is an action menu opened from inside a native modal or an Expo modal route, and which host renders that menu?

Find each opener, how its screen is presented, and the menu host with the native window it draws in.
A root menu host without full-window overlay support cannot present above an iOS native modal, so
the menu is obscured or unreachable. A modal-safe sheet lane, or a host inside the active modal, is
correct. Judge iOS and Android separately. A component name or the word modal alone is not evidence.
