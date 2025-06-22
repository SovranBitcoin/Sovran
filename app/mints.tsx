import React from 'react';
import { View } from 'components/common/View';
import DonutChartContainer from 'components/layout/Donut';
import { useSelector } from 'react-redux';
import { memoizedGetAllBalances } from 'helper/redux/cashu';
import { formatCurrency } from 'helper/currency';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

function TabOneScreen() {
  const balances = useSelector(memoizedGetAllBalances);

  const chartData = balances.map((balance) => {
    const formattedValue = formatCurrency(
      {
        currency: balance.unit === 'sat' ? 'BTC' : balance.unit.toUpperCase(),
        value: balance.amount,
        denomination: balance.unit === 'sat' ? 'sats' : balance.unit,
      },
      {
        locale: 'en-US',
        precision: balance.unit === 'sat' ? 0 : 2,
        currencyDisplay: balance.unit === 'sat' ? 'name' : 'symbol',
        denomination: balance.unit === 'sat' ? 'sats' : balance.unit,
      }
    );

    return {
      amount: balance.amount,
      label: balance.mintUrl.replace('https://', ''),
      subtitle: balance.mintUrl,
      value: formattedValue,
    };
  });

  return (
    <View
      style={{
        flex: 1,
      }}>
      <DonutChartContainer data={chartData} titleText="Total balance" totalValueSuffix="sats" />
    </View>
  );
}

export default withSheetProvider(TabOneScreen);
