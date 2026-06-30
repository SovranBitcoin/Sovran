declare module '@mealection/react-native-boring-avatars' {
  import type { ReactElement } from 'react';

  export interface AvatarProps {
    size?: number;
    name?: string;
    square?: boolean;
    variant?: 'beam' | 'sunset' | 'bauhaus' | 'pixel' | 'ring';
    colors?: string[];
  }

  export default function Avatar(props: AvatarProps): ReactElement | null;
}
