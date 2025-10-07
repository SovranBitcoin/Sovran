import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { memoizedGetSettings, setExperimental } from 'helper/redux/settings';
import { Card } from 'components/ui/Card';
import Container from 'components/blocks/Container';
import { Section as TableSection } from 'components/ui/Section';
import { RowButton, Section } from './index';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Tabs } from 'components/ui/Tabs';
import Icon, { icons } from 'assets/icons';
import { parseToHsl } from 'polished';
import { useTheme } from 'providers/ThemeProvider';
import { Checkbox } from 'expo-checkbox';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { ScrollView } from 'react-native';
import { Transaction } from 'components/blocks/Transaction';
import { PUBLIC_KEYS } from 'helper/constants';

function chunkArray(array: any[], size: number) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

export default function ModalScreen() {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const settings = useSelector(memoizedGetSettings);
  const [isChecked, setIsChecked] = React.useState(settings?.experimental);

  const dispatch = useDispatch();
  const toggleCheckbox = () => {
    const newValue = !isChecked;
    setIsChecked(newValue);
    dispatch(setExperimental(newValue));
  };

  return (
    <Container>
      <ScrollView>
        {[
          {
            amount: 5,
            date: '2025-06-16T15:59:00.087Z',
            type: 'ecash',
            token:
              'cashuBo2Ftd2h0dHBzOi8vODMzMy5zcGFjZTozMzM4YXVjc2F0YXSBomFpSADUzeNPraP9YXCCo2FhAWFzeEAzNTY0ZGZlYzUyNjA1ZGU5MTRlNDU0MDRlMmIxZjA3MGYyZjkxODhiNWUxMzU5ZmRhZmE4ZjE3ZjQ4NDIzMjJjYWNYIQJJYKWYhJgbFiNGmD80IMYudj6y_JHV4CVg_BvLYihUz6NhYQRhc3hAN2Y4ODI3MjU3MGIyZWEyOWJhMDQxYWNhMzJkYjA5ODA2MmYwNWVmNTQ4NDc3MTQwODJkODdhZmZkNjJlZjNkOGFjWCECP1Ii14NN5IDr9c2ZiiNP7QZl7bXeuxp_idr569TMXS8',
            transactionType: 'receive',
            unit: 'sat',
            mintUrl: 'https://8333.space:3338',
            paid: true,
            counter: 25,
            refund: true,
            isCancel: true,
          },
          {
            amount: '5',
            date: '2025-06-20T20:16:05.130Z',
            type: 'ecash',
            token:
              'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIADF8pijL33hhcIKjYWEBYXN4QGY3Yjc4MjJhZTk0ODAyYWVjNDNkNWViNWVhYzliNWE2Njg3ZTBmYzczZmEzZTk5ZGE0NGE0YWE4YTM4MTRjNTZhY1ghA0_vRm_Z5i6xF_HKCXWsnDS35jq6ZkMQQuKhaepeSNyfo2FhBGFzeEBjM2U2NmU4MzRjZmFjNGYyNDBiZDZmNWRiODAyNzFiYzY1OGQ3MDU5YzZjNDA3MGFiM2UxYzE0MjBmMDZiNzQ3YWNYIQPQFkVEVOtzqBp6Ho3YGPW-YhsoD7csYmYA4S3TBhHpVg',
            transactionType: 'send',
            unit: 'sat',
            paid: false,
            nostr: {},
            mintUrl: 'https://testnut.cashu.space',
            counter: 12,
            status: 'unspent',
          },
          {
            amount: '5',
            date: '2025-06-16T15:58:02.582Z',
            type: 'ecash',
            token:
              'cashuBo2Ftd2h0dHBzOi8vODMzMy5zcGFjZTozMzM4YXVjc2F0YXSBomFpSADUzeNPraP9YXCCo2FhAWFzeEAzNTY0ZGZlYzUyNjA1ZGU5MTRlNDU0MDRlMmIxZjA3MGYyZjkxODhiNWUxMzU5ZmRhZmE4ZjE3ZjQ4NDIzMjJjYWNYIQJJYKWYhJgbFiNGmD80IMYudj6y_JHV4CVg_BvLYihUz6NhYQRhc3hAN2Y4ODI3MjU3MGIyZWEyOWJhMDQxYWNhMzJkYjA5ODA2MmYwNWVmNTQ4NDc3MTQwODJkODdhZmZkNjJlZjNkOGFjWCECP1Ii14NN5IDr9c2ZiiNP7QZl7bXeuxp_idr569TMXS8',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            nostr: {},
            mintUrl: 'https://8333.space:3338',
            counter: 17,
            status: 'paid',
            completedAt: 1750089539414,
            isCancel: true,
          },
          {
            request:
              'lnbc100n1p59trzlpp5cp9kw8ze5hhgmujveuu2rwpqdflejy7a7mp06t4fck3p9500vapsdqjd3h8vmmvw3azu7re0gcqzpgxqyz5vqrzjqdrhkruk080xpvagqw68998r0dxpfgur2e90mmvhxy2px33r6tkgyrvt3sqqgpgqqyqqqqlgqqqqqqgq2qsp5sj9vvazk96h0fjsrgnp0wkr8xtxaeetftvxvrl9wjx9l404q30nq9qxpqysgqqdpl6m32w2n4turp3dhdcehj3xvn9s2spluss9hnp0efp9tpr5vj9rtw907gpry0xuwzv3fhrvl30rsj3rdvpel28gttstjpwk9yaqcpecwjhl',
            amount: '10',
            mintQuote: {
              quote: '--cpwAJktLvZWdVmgyyo3YkmevWBFNSnyTEPL9K1',
              request:
                'lnbc100n1p59trzlpp5cp9kw8ze5hhgmujveuu2rwpqdflejy7a7mp06t4fck3p9500vapsdqjd3h8vmmvw3azu7re0gcqzpgxqyz5vqrzjqdrhkruk080xpvagqw68998r0dxpfgur2e90mmvhxy2px33r6tkgyrvt3sqqgpgqqyqqqqlgqqqqqqgq2qsp5sj9vvazk96h0fjsrgnp0wkr8xtxaeetftvxvrl9wjx9l404q30nq9qxpqysgqqdpl6m32w2n4turp3dhdcehj3xvn9s2spluss9hnp0efp9tpr5vj9rtw907gpry0xuwzv3fhrvl30rsj3rdvpel28gttstjpwk9yaqcpecwjhl',
              amount: 10,
              unit: 'sat',
              state: 'UNPAID',
              expiry: 1750523359,
              pubkey: null,
              paid: false,
            },
            date: '2025-06-20T16:29:20.275Z',
            type: 'lightning',
            paid: false,
            transactionType: 'receive',
            unit: 'sat',
            mintUrl: 'https://mint.lnvoltz.com',
            paymentRequest:
              'creqAp2F0gaNhdGVub3N0cmFheEZucHJvZmlsZTFxcXM5eWM0bWY2YXBmZHRyZHY1dnNybGU4MHJ2bDh5cW4wemhrdjZwdDQ4M3B2Z3A1c2Q3bXVxbjl5dThjYWeBgmFuYjE3YWl4JGFhYTZjZTllLWQyMmUtNDc1YS1iODhiLWFjMTJkNjdjMmU5ZWFhYjEwYXVjc2F0YW2BeBhodHRwczovL21pbnQubG52b2x0ei5jb21hZHkBa2xuYmMxMDBuMXA1OXRyemxwcDVjcDlrdzh6ZTVoaGdtdWp2ZXV1MnJ3cHFkZmxlank3YTdtcDA2dDRmY2szcDk1MDB2YXBzZHFqZDNoOHZtbXZ3M2F6dTdyZTBnY3F6cGd4cXl6NXZxcnpqcWRyaGtydWswODB4cHZhZ3F3Njg5OThyMGR4cGZndXIyZTkwbW12aHh5MnB4MzNyNnRrZ3lydnQzc3FxZ3BncXF5cXFxcWxncXFxcXFxZ3EycXNwNXNqOXZ2YXprOTZoMGZqc3JnbnAwd2tyOHh0eGFlZXRmdHZ4dnJsOXdqeDlsNDA0cTMwbnE5cXhwcXlzZ3FxZHBsNm0zMncybjR0dXJwM2RoZGNlaGozeHZuOXMyc3BsdXNzOWhucDBlZnA5dHByNXZqOXJ0dzkwN2dwcnkweHV3enYzZmhydmwzMHJzajNyZHZwZWwyOGd0dHN0anB3azl5YXFjcGVjd2pobGFz9Q==',
            unifiedRequest:
              'creqAp2F0gaNhdGVub3N0cmFheEZucHJvZmlsZTFxcXM5eWM0bWY2YXBmZHRyZHY1dnNybGU4MHJ2bDh5cW4wemhrdjZwdDQ4M3B2Z3A1c2Q3bXVxbjl5dThjYWeBgmFuYjE3YWl4JGFhYTZjZTllLWQyMmUtNDc1YS1iODhiLWFjMTJkNjdjMmU5ZWFhYjEwYXVjc2F0YW2BeBhodHRwczovL21pbnQubG52b2x0ei5jb21hZHkBa2xuYmMxMDBuMXA1OXRyemxwcDVjcDlrdzh6ZTVoaGdtdWp2ZXV1MnJ3cHFkZmxlank3YTdtcDA2dDRmY2szcDk1MDB2YXBzZHFqZDNoOHZtbXZ3M2F6dTdyZTBnY3F6cGd4cXl6NXZxcnpqcWRyaGtydWswODB4cHZhZ3F3Njg5OThyMGR4cGZndXIyZTkwbW12aHh5MnB4MzNyNnRrZ3lydnQzc3FxZ3BncXF5cXFxcWxncXFxcXFxZ3EycXNwNXNqOXZ2YXprOTZoMGZqc3JnbnAwd2tyOHh0eGFlZXRmdHZ4dnJsOXdqeDlsNDA0cTMwbnE5cXhwcXlzZ3FxZHBsNm0zMncybjR0dXJwM2RoZGNlaGozeHZuOXMyc3BsdXNzOWhucDBlZnA5dHByNXZqOXJ0dzkwN2dwcnkweHV3enYzZmhydmwzMHJzajNyZHZwZWwyOGd0dHN0anB3azl5YXFjcGVjd2pobGFz9Q==',
          },
          {
            request:
              'lnbc100n1p59qsyhpp5sred8mv2s09h2f3ql2djleffv7ypfk3lh7w2xeakqxpnat2e9fmsdqjd3h8vmmvw3azu7re0gcqzpgxqyz5vqrzjqdrhkruk080xpvagqw68998r0dxpfgur2e90mmvhxy2px33r6tkgyrvt3sqqgpgqqyqqqqlgqqqqqqgq2qsp5djq4nq54dn22wyld660hldehyfgancqhfq35nju45ggqr45tf9xq9qxpqysgqz9m80l9339kvkvgdvz026egvz7r8ccmpqyk4w7y7ejzc2f7vn5mk7aax0h3qdf6sragfsdu894tkrvhcehsark0w9633ds9cpk2sw2qqdxegru',
            amount: 10,
            date: '2025-06-16T16:04:48.577Z',
            type: 'lightning',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            meltQuote: {
              quote: 's1JcJiiZtiWnJKJ1HiGUhg57sJNBWRU-VvWqInXQ',
              amount: 10,
              unit: 'sat',
              request:
                'lnbc100n1p59qsyhpp5sred8mv2s09h2f3ql2djleffv7ypfk3lh7w2xeakqxpnat2e9fmsdqjd3h8vmmvw3azu7re0gcqzpgxqyz5vqrzjqdrhkruk080xpvagqw68998r0dxpfgur2e90mmvhxy2px33r6tkgyrvt3sqqgpgqqyqqqqlgqqqqqqgq2qsp5djq4nq54dn22wyld660hldehyfgancqhfq35nju45ggqr45tf9xq9qxpqysgqz9m80l9339kvkvgdvz026egvz7r8ccmpqyk4w7y7ejzc2f7vn5mk7aax0h3qdf6sragfsdu894tkrvhcehsark0w9633ds9cpk2sw2qqdxegru',
              fee_reserve: 10,
              paid: false,
              state: 'UNPAID',
              expiry: 1750176279,
              payment_preimage: null,
              change: null,
            },
            fees: {
              lightning_fee: 10,
              keyset_fee: 2,
            },
            mintUrl: 'https://8333.space:3338',
            nostr: {
              pubkey: '',
            },
            counter: 26,
          },

          {
            request:
              'lnbc100n1p59rs3spp5c9zyk85l33sn9z3rdvcey670kyt6aejpkqmkzffg7jnny89cwm2qdq4gdshx6r4ypqkgerjv4ehxcqzpuxqrwzqsp5wny02peq0xups5m0qtvkyygtrn8m727mk5wgcwqpw79j3z6d9e4s9qxpqysgq7rf6lfud6rlytxl38vt2skqfcl0l9vlkeyzkvprfj0j6f7dnhkm80eqvpe95cu495775mcr52tfe74r8lnhcktqrknd48g2dkt7nrwcqyqx53r',
            amount: 10,
            date: '2025-06-17T19:30:01.221Z',
            type: 'lightning',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            meltQuote: {
              quote: 'P87U6lK5yMHkkCKsdeINex21Q3bdaUtUa2nHwDgK',
              amount: 10,
              unit: 'sat',
              request:
                'lnbc100n1p59rs3spp5c9zyk85l33sn9z3rdvcey670kyt6aejpkqmkzffg7jnny89cwm2qdq4gdshx6r4ypqkgerjv4ehxcqzpuxqrwzqsp5wny02peq0xups5m0qtvkyygtrn8m727mk5wgcwqpw79j3z6d9e4s9qxpqysgq7rf6lfud6rlytxl38vt2skqfcl0l9vlkeyzkvprfj0j6f7dnhkm80eqvpe95cu495775mcr52tfe74r8lnhcktqrknd48g2dkt7nrwcqyqx53r',
              fee_reserve: 2,
              paid: false,
              state: 'UNPAID',
              expiry: 1750202992,
              payment_preimage: null,
              change: null,
            },
            lud16: 'npub1ref7jqxrh0z74554y900ufajer2lh52lk0wczrdrqcm8fjmjzweqll64x3@npub.cash',
            fees: {
              lightning_fee: 2,
              keyset_fee: 52,
            },
            mintUrl: 'https://mint.bitcointxoko.com',
            nostr: {
              pubkey: PUBLIC_KEYS.SUPPORT,
            },
            counter: 63,
          },

          {
            request:
              'lnbc50n1p59g4jfpp5mpnwmmrxq7k67c9m2nmg0ycj8whzrr28k04jllzqcnxkgxavy0mqhp5x8svwrtx0cgr38440vdxsf9kt43c0tqahufmkg6psepgjuvxt7cscqzzsxqrrs0sp5umcqezwxdj8uq60wzp2h6w34v2mp8v8w0tltewh6qyvg9re3xpws9qxpqysgqxe6n4saeetk7pjxndch4m4ed56we8r7gp0a7x2vx39d0cl4jgzjjerz9y3qxdwrymxp8smydrfs7mtn3n5uusdflfqms23hvgdg6ttsq0zhtqh',
            amount: 5,
            date: '2025-06-19T18:26:29.704Z',
            type: 'lightning',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            meltQuote: {
              quote: 'yYDV6zTSFa4DSBDl8kHgVoas98uPkarg_pitAOqy',
              amount: 5,
              unit: 'sat',
              request:
                'lnbc50n1p59g4jfpp5mpnwmmrxq7k67c9m2nmg0ycj8whzrr28k04jllzqcnxkgxavy0mqhp5x8svwrtx0cgr38440vdxsf9kt43c0tqahufmkg6psepgjuvxt7cscqzzsxqrrs0sp5umcqezwxdj8uq60wzp2h6w34v2mp8v8w0tltewh6qyvg9re3xpws9qxpqysgqxe6n4saeetk7pjxndch4m4ed56we8r7gp0a7x2vx39d0cl4jgzjjerz9y3qxdwrymxp8smydrfs7mtn3n5uusdflfqms23hvgdg6ttsq0zhtqh',
              fee_reserve: 2,
              paid: false,
              state: 'UNPAID',
              expiry: 1750361176,
              payment_preimage: null,
              change: null,
            },
            lud16: 'quiethorse9@primal.net',
            fees: {
              lightning_fee: 2,
              keyset_fee: 121,
            },
            mintUrl: 'https://testnut.cashu.space',
            nostr: {
              pubkey: 'c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81',
            },
            counter: 1,
          },

          {
            request:
              'lnbc960n1p59g7g3dq9xqhrznp4qtyjfy99jhnpj8u9en49meskq8x08czk5axrh4cju64fvpcfenrfupp59jp5ujzx5esug8ucxy9atxlk35sg4dffexv42y9l9w7e8z502yzqsp57qk39ljcg236t8l4cmuvlr2fg9dhppc77ctuj2644703k23a3vvs9qyysgqcqpcxqyz5vqjhddgvxc2ft35f47gr40rlfey5pay5dxe6a0p8ra7zq0jj7q4jsje6yvz7xvn9ps2ltxffz4azkqthzf2036kqehccqd0cw6ekn2mhgp3yda5s',
            amount: 96,
            date: '2025-06-19T20:55:04.945Z',
            type: 'lightning',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            meltQuote: {
              quote: 'SvU7fYBlCiLsKbQvSj8Ze-vQVrJH_kVbIDwYP3OY',
              amount: 96,
              unit: 'sat',
              request:
                'lnbc960n1p59g7g3dq9xqhrznp4qtyjfy99jhnpj8u9en49meskq8x08czk5axrh4cju64fvpcfenrfupp59jp5ujzx5esug8ucxy9atxlk35sg4dffexv42y9l9w7e8z502yzqsp57qk39ljcg236t8l4cmuvlr2fg9dhppc77ctuj2644703k23a3vvs9qyysgqcqpcxqyz5vqjhddgvxc2ft35f47gr40rlfey5pay5dxe6a0p8ra7zq0jj7q4jsje6yvz7xvn9ps2ltxffz4azkqthzf2036kqehccqd0cw6ekn2mhgp3yda5s',
              fee_reserve: 1,
              paid: false,
              state: 'UNPAID',
              expiry: 1750452881,
              payment_preimage: null,
              change: null,
            },
            fees: {
              lightning_fee: 1,
              keyset_fee: 31,
            },
            mintUrl: 'https://mint.lnvoltz.com',
            nostr: {
              pubkey: '06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9',
            },
          },

          {
            request:
              'lnbc50n1p59t0supp5344nm3pmn509afyskpjhxg4p4y6pvx0dxs4v2gc9e0n8rsa8ffeqhp5x8svwrtx0cgr38440vdxsf9kt43c0tqahufmkg6psepgjuvxt7cscqzzsxqrrs0sp5lftsm7uduu0qnexrxgg2n7qjqdktdt2r8j5spfkt6e89g6zk6vps9qxpqysgqcu3rmysrka8tstvxt7s5ejpzslq3rzu99z8t8kyx9aag4y4trdsnlwqxrrydyhucze3m8qas2wzqsppxwvnlx62hp4t5qkkvnmapqzspkr3eze',
            amount: 5,
            date: '2025-06-20T20:01:51.505Z',
            type: 'lightning',
            transactionType: 'send',
            unit: 'sat',
            paid: true,
            meltQuote: {
              quote: '5GXnjAD-CclPRsdPtQdUEVRx15go-QKtRftv8ThZ',
              amount: 5,
              unit: 'sat',
              request:
                'lnbc50n1p59t0supp5344nm3pmn509afyskpjhxg4p4y6pvx0dxs4v2gc9e0n8rsa8ffeqhp5x8svwrtx0cgr38440vdxsf9kt43c0tqahufmkg6psepgjuvxt7cscqzzsxqrrs0sp5lftsm7uduu0qnexrxgg2n7qjqdktdt2r8j5spfkt6e89g6zk6vps9qxpqysgqcu3rmysrka8tstvxt7s5ejpzslq3rzu99z8t8kyx9aag4y4trdsnlwqxrrydyhucze3m8qas2wzqsppxwvnlx62hp4t5qkkvnmapqzspkr3eze',
              fee_reserve: 2,
              paid: false,
              state: 'UNPAID',
              expiry: 1750453291,
              payment_preimage: null,
              change: null,
            },
            lud16: 'quiethorse9@primal.net',
            fees: {
              lightning_fee: 2,
              keyset_fee: 1,
            },
            mintUrl: 'https://testnut.cashu.space',
            nostr: {
              pubkey: 'c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81',
            },
          },
          {
            amount: '1',
            date: '2025-06-20T20:40:33.303Z',
            type: 'ecash',
            token:
              'cashuBo2Ftdmh0dHBzOi8vbWludC5jb2lub3MuaW9hdWNzYXRhdIGiYWlIAE963yoENWxhcIGjYWEBYXN4q1siUDJQSyIseyJub25jZSI6ImE1ZjFkNmQwZDA0ZDU3NjkxZjg2MzgyZDk4NmIxYzc4OWFhZDFlNTBmYTA5YjYxZmIyZDkyOWY1NzU5NjJhMWIiLCJkYXRhIjoiMDJjNjczZmYwYjVmMjI4ZmViMGFiYjEwMDE4ODIxNzhkNGM1ODhiYzRlNTBmODU3MTczNTQ0YjU1NDNiNDU0ZjgxIiwidGFncyI6W119XWFjWCECmrKehBpogIGGK-Z_RDdf5dnXbiDcCo_obNdfEIEfCEc',
            transactionType: 'send',
            unit: 'sat',
            paid: false,
            nostr: {},
            mintUrl: 'https://mint.coinos.io',
            counter: 15,
            p2pk: {
              pubkey: '02c673ff0b5f228feb0abb1001882178d4c588bc4e50f857173544b5543b454f81',
            },
            status: 'unspent',
          },
          {
            request:
              'lnbc210n1p59t5vxpp57pznue96075znux6d2hfa435tmf6895cye4c246f0qdxkhf3gghqdqqcqzzsxqyz5vqrzjqvueefmrckfdwyyu39m0lf24sqzcr9vcrmxrvgfn6empxz7phrjxvrttncqq0lcqqyqqqqlgqqqqqqgq2qsp5kfmekssm532jvxr9mh389ksgehtkl8pxel5t9fynm8fse3krcp3s9qxpqysgq2n4x4a5xvy3z4qekdand5ggkjmwd0v6ts3ruxnwcuw2ca2z3nmwydh2nw6k4wpfgl39lcgtzmd475we7cfzn6frdu248cjkyj97z98cpy44n59',
            amount: 21,
            date: '2025-06-20T21:24:32.000Z',
            type: 'lightning',
            paid: true,
            transactionType: 'receive',
            unit: 'sat',
            mintUrl: 'https://mint.minibits.cash/Bitcoin',
            fromNIP05: 'npub12f3tkn46zj6kx6egeq8ljw7xe7wgpx790ve5zh20zzcsrfqmahcqgfxln7@npubx.cash',
            status: 'paid',
            completedAt: 1750454682293,
          },
        ].map((tx) => (
          <>
            <Text bold size={12}>
              {tx.type} • {tx.transactionType}
            </Text>
            <Transaction tx={tx} />
          </>
        ))}

        <Text thin overpass size={16}>
          OverpassThin
        </Text>
        <Text extralight overpass size={16}>
          OverpassExtralight
        </Text>
        <Text light overpass size={16}>
          OverpassLight
        </Text>
        {/* Overpass Regular is the default if nothing is passed */}
        <Text regular overpass size={16}>
          OverpassRegular
        </Text>
        <Text semibold overpass size={16}>
          OverpassSemibold
        </Text>
        <Text bold overpass size={16}>
          OverpassBold
        </Text>
        <Text extrabold overpass size={16}>
          OverpassExtrabold
        </Text>
        <Text heavy overpass size={16}>
          OverpassHeavy
        </Text>
        <Spacer size={8} />

        <Text thin overpass italic size={16}>
          OverpassThinItalic
        </Text>
        <Text extralight overpass italic size={16}>
          OverpassExtralightItalic
        </Text>
        <Text light overpass italic size={16}>
          OverpassLightItalic
        </Text>
        <Text regular overpass italic size={16}>
          OverpassItalic
        </Text>
        <Text semibold overpass italic size={16}>
          OverpassSemiboldItalic
        </Text>
        <Text bold overpass italic size={16}>
          OverpassBoldItalic
        </Text>
        <Text extrabold overpass italic size={16}>
          OverpassExtraboldItalic
        </Text>
        <Text heavy overpass italic size={16}>
          OverpassHeavyItalic
        </Text>

        <Spacer size={8} />
        <Text mono overpass size={16}>
          OverpassMono
        </Text>

        <Spacer size={8} />

        {/* Lexend isn't really used in this project, only in onboarding flows */}
        <Text thin lexend size={16}>
          LexendThin
        </Text>
        <Text extralight lexend size={16}>
          LexendExtraLight
        </Text>
        <Text light lexend size={16}>
          LexendLight
        </Text>
        <Text regular lexend size={16}>
          LexendRegular
        </Text>
        <Text medium lexend size={16}>
          LexendMedium
        </Text>
        <Text semibold lexend size={16}>
          LexendSemiBold
        </Text>
        <Text bold lexend size={16}>
          LexendBold
        </Text>
        <Text extrabold lexend size={16}>
          LexendExtraBold
        </Text>
        <Text black lexend size={16}>
          LexendBlack
        </Text>

        {Object.keys(greys).map((grey) => {
          return (
            <View key={grey} className={`bg-primary-${grey} h-16`}>
              <Text>{(greys as any)[grey]}</Text>
              <Text>{JSON.stringify(parseToHsl((greys as any)[grey]))}</Text>
            </View>
          );
        })}

        <View className="bg-primary-950 h-8 w-8"></View>

        {/* info message */}
        <Card
          message="Message"
          variant="info"
          onPress={() => {
            // this triggers onPress
          }}
        />
        {/* warning message */}
        <Card message="Message" variant="warning" />
        {/* this is a table view with two columns one for title and one for value */}
        <TableSection
          items={[
            {
              title: 'Title',
              value: 'Value',
            },
            {
              title: 'Title2',
              value: 'Value2',
            },
          ]}
        />

        {/* This is typically used in setting or configuration screens */}
        <Section title="Title">
          <RowButton label="Label" value={'Optional Value'} onPress={() => {}} />
          <RowButton label="Label" isDanger value={'Optional Value'} onPress={() => {}} />
          {/* Example with a custom right icon and label */}
          <RowButton
            label={
              <HStack align="center" spacing={8}>
                <Icon name="mingcute:lightning-fill" size={20} color={getPrimaryColor('400')} />
                <Text className="text-primary-50" bold>
                  npub1example@npubx.cash
                </Text>
              </HStack>
            }
            onPress={() => {}}
            rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
          />
        </Section>

        {/* This is usually added at the bottom of model pages, is shows 2 buttons at once, if 3 buttons are added then it will show a popup to show more options */}
        {/* you need to include this wrapper for now. */}
        <HStack justify="center" align="center" className="pb-2">
          <ButtonHandler
            buttons={[
              {
                text: 'Button Text',
                icon: 'lets-icons:copy', // icon name from a library
                variant: 'primary',
                onPress: async () => {},
              },
              {
                text: 'Button Text 2',
                icon: 'lets-icons:copy', // icon name from a library
                variant: 'secondary',
                onPress: async () => {},
              },
            ]}></ButtonHandler>
        </HStack>

        <Tabs
          amounts={['0', '1', '200']}
          tabs={['Confirmed', 'Pending', 'Failed']}
          selectedTab={'Confirmed'}
          handleTabPress={() => {}}
        />

        {/* Examples for different tab counts */}
        <VStack className="space-y-4" style={{ marginTop: 16 }}>
          {[1, 2, 3, 4, 5].map((count) => (
            <Tabs
              key={`example-tabs-${count}`}
              amounts={Array(count).fill(0)}
              tabs={Array.from({ length: count }, (_, i) => `Tab ${i + 1}`)}
              selectedTab={'Tab 1'}
              handleTabPress={() => {}}
            />
          ))}
        </VStack>

        <VStack>
          {chunkArray(icons, 3).map((row, rowIndex) => (
            <HStack key={rowIndex} className="bg-transparent" style={{ marginBottom: 16 }}>
              {row.map((icon) => (
                <VStack key={icon} className="flex-1 items-center" style={{ margin: 16 }}>
                  <Icon name={icon} size={48} color={getPrimaryColor('0')} />
                  <Spacer size={8} />
                  <Text className="text-primary-0 w-full truncate text-center text-xs">{icon}</Text>
                </VStack>
              ))}
              {/* Fill empty columns if row has less than 3 icons */}
              {Array.from({ length: 3 - row.length }).map((_, idx) => (
                <View key={`empty-${idx}`} className="flex-1" />
              ))}
            </HStack>
          ))}
        </VStack>

        <TouchableOpacity
          style={{
            marginBottom: 16,
            paddingHorizontal: 16,
          }}
          onPress={toggleCheckbox}>
          <HStack align="center">
            <Checkbox
              value={isChecked}
              onValueChange={toggleCheckbox}
              color={isChecked ? getShadeColor('300') : undefined}
            />
            <Spacer size={8} />
            <Text
              id="terms-checkbox"
              style={{
                flex: 1,
                fontFamily: 'OverpassRegular',
                fontSize: 14,
              }}
              className="text-primary-0">
              Toggle experimental features
            </Text>
          </HStack>
        </TouchableOpacity>
      </ScrollView>
    </Container>
  );
}
