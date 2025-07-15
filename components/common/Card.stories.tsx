import type { Meta, StoryObj } from '@storybook/react';
import { Card } from './Card';
import { persistStore } from 'redux-persist';
import { Provider } from 'react-redux';
import { store } from 'helper/redux/store';

export const persistor = persistStore(store);

const meta = {
  title: 'Card',
  component: Card,
  args: {
    title: 'Hello world',
    message: 'Hello world',
    variant: 'info',
  },
  decorators: [
    (Story) => (
      <Provider store={store}>
        <Story />
      </Provider>
    ),
  ],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {},
};
