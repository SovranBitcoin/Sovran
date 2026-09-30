# Robustness of the winning flow

300 samples. Each sample moves every context probability within a factor of 3 in odds and redraws the task mix from a Dirichlet around the guessed weights. Families ignore choices the model scores identically (lock placement, skipping).

## Send

Winner under the guessed weights: `entry=channel · nfc=armed/none/overpay · all=y · unreachable=queue_or_qr · entry → amount → method · confirm=tap_to_send · chips=y`

It is also the best family in **99.0%** of samples. Median lead over the runner-up family: 0.000 screens.

| Family | Samples won |
| --- | --- |
| `entry=channel · nfc=armed/none/overpay · all=y · unreachable=queue_or_qr · entry → amount → method · confirm=tap_to_send · chips=y` | 99.0% |
| `entry=channel · nfc=armed/none/overpay · all=n · unreachable=queue_or_qr · entry → amount → method · confirm=tap_to_send · chips=y` | 1.0% |

### Send: each decision against its best alternative

Lead = screens the best design with a different answer costs over the winner. 'Strictly better' excludes ties; 'never worse' includes them.

| Decision | Winning answer | Lead (guessed weights) | Strictly better | Never worse | Median lead |
| --- | --- | --- | --- | --- | --- |
| order | entry → amount → method | 0.008 | 100% | 100% | 0.006 |
| confirm | tap_to_send | 0.144 | 100% | 100% | 0.126 |
| amount_chips | True | 0.027 | 100% | 100% | 0.026 |
| send_all | True | 0.006 | 83% | 100% | 0.000 |
| nfc_arm | armed | 0.066 | 100% | 100% | 0.039 |
| nfc_review | none | 0.218 | 100% | 100% | 0.115 |
| nfc_overpay | True | 0.014 | 100% | 100% | 0.010 |
| unreachable | queue_or_qr | 0.139 | 100% | 100% | 0.117 |
| auto_skip | True | 0.258 | 100% | 100% | 0.256 |

## Receive

Winner under the guessed weights: `start=three_way · claim=auto_known · offline-unverified=hold · method → amount · bip321=y · nfc=passive · any-in-amount=n`

It is also the best family in **68.7%** of samples. Median lead over the runner-up family: 0.001 screens.

| Family | Samples won |
| --- | --- |
| `start=three_way · claim=auto_known · offline-unverified=hold · method → amount · bip321=y · nfc=passive · any-in-amount=n` | 68.7% |
| `start=three_way · claim=auto_known · offline-unverified=hold · method → amount · bip321=n · default-rail=y · nfc=passive · any-in-amount=n` | 31.3% |

### Receive: each decision against its best alternative

Lead = screens the best design with a different answer costs over the winner. 'Strictly better' excludes ties; 'never worse' includes them.

| Decision | Winning answer | Lead (guessed weights) | Strictly better | Never worse | Median lead |
| --- | --- | --- | --- | --- | --- |
| claim | auto_known | 0.176 | 92% | 92% | 0.147 |
| offline_unverified | hold | 0.443 | 97% | 97% | 0.400 |
| bip321 | True | 0.090 | 69% | 69% | 0.095 |

