import { useCashu } from 'helper/redux/cashu';

export const CheckProofsSpentProvider = ({ children }) => {
  const { transactions: cashuTransactions } = useCashu();

  const tokens = cashuTransactions
    .filter((transaction) => transaction.token && !transaction.paid)
    .map((transaction) => transaction.token);

  // useCheckProofsSpent(tokens, 10000, () => {});

  return children;
};
