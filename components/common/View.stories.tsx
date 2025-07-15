import type { Meta, StoryObj } from '@storybook/react';
import { View } from './View';

const meta = {
  title: 'View',
  component: View,
  args: {},
  decorators: [(Story) => <Story />],
} satisfies Meta<typeof View>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {
  args: {},
};
