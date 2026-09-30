# Payment flow brute force

2304 send designs and 360 receive designs, each walked through 1536 contexts × 17 send / 7 receive tasks. Score = expected screens the user must act on, plus screens spent before learning a task is impossible.

## Send: best designs

| Rank | Expected steps | Dead-end steps | Design |
| --- | --- | --- | --- |
| 1 | 1.95 | 0.625 | entry=channel · nfc=armed/none/overpay · all=y · unreachable=queue_or_qr · entry → amount → method · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 2 | 1.95 | 0.625 | entry=channel · nfc=armed/none/overpay · all=n · unreachable=queue_or_qr · entry → amount → method · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 3 | 1.95 | 0.625 | entry=channel · nfc=armed/none/overpay · all=y · unreachable=queue_or_qr · entry → method → amount · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 4 | 1.94 | 0.640 | entry=channel · nfc=armed/none/exact · all=y · unreachable=queue_or_qr · entry → amount → method · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 5 | 1.96 | 0.625 | entry=channel · nfc=armed/none/overpay · all=n · unreachable=queue_or_qr · entry → method → amount · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 6 | 1.95 | 0.640 | entry=channel · nfc=armed/none/exact · all=n · unreachable=queue_or_qr · entry → amount → method · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 7 | 1.95 | 0.640 | entry=channel · nfc=armed/none/exact · all=y · unreachable=queue_or_qr · entry → method → amount · skip=y · lock=review_slider · confirm=tap_to_send · chips=y |
| 8 | 1.97 | 0.625 | entry=channel · nfc=armed/none/overpay · all=y · unreachable=queue_or_qr · entry → amount → method · skip=y · lock=review_slider · confirm=tap_to_send · chips=n |

### Send: baselines

| Flow | Expected steps | Dead-end steps | Design |
| --- | --- | --- | --- |
| cashu.me (method first) | 3.00 | 0.826 | entry=channel · nfc=button/none/exact · all=n · unreachable=dead_end · method → entry → amount · skip=n · lock=review_slider · confirm=separate · chips=n |
| Cashu Wallet native (destination first) | 2.52 | 0.826 | entry=channel · nfc=button/none/exact · all=n · unreachable=dead_end · entry → amount → method · skip=y · lock=review_slider · confirm=separate · chips=n |
| Sovran today | 2.60 | 0.826 | entry=channel · nfc=armed/none/exact · all=y · unreachable=dead_end · entry → amount → method · skip=n · lock=sheet_after_method · confirm=melt_only · chips=n |
| Macadamia | 2.52 | 0.826 | entry=channel · nfc=button/none/exact · all=n · unreachable=dead_end · entry → amount → method · skip=y · lock=review_slider · confirm=separate · chips=n |
| Minibits | 3.00 | 0.826 | entry=channel · nfc=button/none/exact · all=n · unreachable=dead_end · method → entry → amount · skip=n · lock=review_slider · confirm=separate · chips=n |
| Zeus | 2.62 | 0.826 | entry=channel · nfc=button/none/exact · all=n · unreachable=dead_end · method → entry → amount · skip=y · lock=method_option · confirm=melt_only · chips=n |

### Send: best design per task

| Task | Steps online | Steps offline | Possible offline |
| --- | --- | --- | --- |
| Send ecash to a contact | 2.95 | 2.00 | queued, or in person |
| Send locked ecash to a contact | 2.95 | 2.00 | queued, or in person |
| Pay a contact over Lightning | 2.90 | 2.00 | queued, or in person |
| Share a token (link, copy) | 2.00 | 2.00 | yes |
| Pay a scanned Lightning invoice | 1.95 | 1.00 | no |
| Pay a Lightning address | 1.95 | 1.00 | no |
| Pay a Lightning offer | 1.28 | 1.00 | no |
| Pay a bitcoin address | 1.19 | 1.00 | no |
| Pay a Cashu payment request | 1.80 | 1.00 | no |
| Pay a unified (BIP-321) QR | 1.99 | 1.00 | no |
| Tap to pay a terminal | 0.19 | 0.00 | 56% |
| Tap a Lightning-only tag | 0.95 | 0.00 | no |
| Write a token to an NFC card | 3.00 | 3.00 | yes |
| Send everything at a mint as ecash | 2.00 | 2.00 | yes |
| Empty a mint to a Lightning address | 1.95 | 1.00 | no |
| Pay a pasted P2PK key | 2.00 | 2.00 | queued, or in person |
| Share a token in person (they scan) | 2.00 | 2.00 | yes |

Unconstrained best receive design (fails the one-choice-per-screen rule): 1.27 · start=amount_first · claim=auto_known · offline-unverified=hold · amount → method · skip=n · bip321=y · nfc=passive · any-in-amount=y

## Receive: best designs

| Rank | Expected steps | Dead-end steps | Design |
| --- | --- | --- | --- |
| 1 | 1.77 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=passive · any-in-amount=n |
| 2 | 1.77 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=y · bip321=y · nfc=passive · any-in-amount=n |
| 3 | 1.77 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=qr_only · any-in-amount=n |
| 4 | 1.77 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=y · bip321=y · nfc=qr_only · any-in-amount=n |
| 5 | 1.78 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=button · any-in-amount=n |
| 6 | 1.78 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=y · bip321=y · nfc=button · any-in-amount=n |
| 7 | 1.86 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=n · default-rail=y · nfc=passive · any-in-amount=n |
| 8 | 1.86 | 0.090 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=y · bip321=n · default-rail=y · nfc=passive · any-in-amount=n |

### Receive: baselines

| Flow | Expected steps | Dead-end steps | Design |
| --- | --- | --- | --- |
| cashu.me (method first) | 2.13 | 0.090 | start=amount_first · claim=confirm · offline-unverified=hold · method → amount · skip=n · bip321=n · nfc=qr_only · any-in-amount=n |
| Cashu Wallet native (method first) | 2.14 | 0.090 | start=amount_first · claim=confirm · offline-unverified=hold · method → amount · skip=n · bip321=n · nfc=button · any-in-amount=n |
| Sovran today (hub, amount, Select option) | 3.13 | 0.090 | start=amount_first · claim=confirm · offline-unverified=hold · method → amount · skip=n · bip321=n · nfc=qr_only · any-in-amount=n |
| Macadamia | 1.77 | 0.090 | start=amount_first · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=n · nfc=button · any-in-amount=y |
| Minibits | 2.13 | 0.533 | start=amount_first · claim=confirm · offline-unverified=count · method → amount · skip=n · bip321=n · nfc=qr_only · any-in-amount=n |
| Zeus | 2.14 | 0.090 | start=amount_first · claim=confirm · offline-unverified=hold · method → amount · skip=n · bip321=n · nfc=button · any-in-amount=n |

### Receive: best design per task

| Task | Steps online | Steps offline | Possible offline |
| --- | --- | --- | --- |
| Claim a token I was given | 1.30 | 1.79 | yes |
| Claim a token from an NFC card | 1.30 | 1.79 | yes |
| Get paid by tap (phone acts as the tag) | 2.36 | 2.36 | yes |
| Get paid a set amount, any wallet | 2.00 | 2.00 | yes |
| Get paid any amount | 1.00 | 1.00 | yes |
| Get paid by a Cashu wallet | 3.00 | 3.00 | yes |
| Get a plain Lightning invoice | 2.85 | 0.00 | no |

### Receive: cost of mint quotes

Each set-amount Lightning invoice or onchain address is a mint quote (NUT-04). Price one quote in
screens; the ranking above is the 0 row. Quotes = expected quotes per receive.

| Quote cost (screens) | Best design | Unified QR | Score | Quotes |
| --- | --- | --- | --- | --- |
| 0 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=passive · any-in-amount=n | yes | 1.857 | 0.343 |
| 0.5 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=passive · any-in-amount=n | yes | 2.028 | 0.343 |
| 1.0 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=passive · any-in-amount=n | yes | 2.199 | 0.343 |
| 2.0 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=y · nfc=passive · any-in-amount=n | yes | 2.542 | 0.343 |
| 2.5 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=n · default-rail=y · nfc=passive · any-in-amount=n | no | 2.691 | 0.298 |
| 4.0 | start=three_way · claim=auto_known · offline-unverified=hold · method → amount · skip=n · bip321=n · default-rail=y · nfc=passive · any-in-amount=n | no | 3.138 | 0.298 |

Best unified: 1.857 screens, 0.343 quotes. Best asking the method: 1.946 screens, 0.298 quotes. Asking wins once a quote costs more than **2.01 screens**.

### Receive: being paid by tap

Guesses: 50% iPhones, 20% of them in the EEA (the only iPhones that can be tapped),
scanning a QR instead of tapping costs 0.5 screens, a lost tap 10% (one retry).

| Mode | Steps on 'Get paid by tap' |
| --- | --- |
| passive | 2.36 |
| button | 2.86 |
| qr_only | 2.50 |

A button on every phone beats showing the QR only once scanning costs the payer more than 1.10 screens;
passive listening beats it from 0.27. The tap pays off when it needs no press (Android, passive).

