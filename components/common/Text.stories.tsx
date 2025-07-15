import type { Meta, StoryObj } from '@storybook/react';
import { Text } from './Text';
import { persistStore } from 'redux-persist';
import { Provider } from 'react-redux';
import { store } from 'helper/redux/store';

export const persistor = persistStore(store);

const meta = {
  title: 'Text',
  component: Text,
  args: {
    color: 'black',
    children: 'Hello world',
  },
  decorators: [
    (Story) => (
      <Provider store={store}>
        <Story />
      </Provider>
    ),
  ],
} satisfies Meta<typeof Text>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {},
};
