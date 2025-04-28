import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { ButtonBase, ButtonBaseProps } from './ButtonBase';

interface ButtonProps extends ButtonBaseProps {
  camera?: boolean;
}

export const Button = (props: ButtonProps) => {
  const renderBackground = (colors: string[], width: number) => (
    <Canvas
      className="absolute inset-0 -z-10 flex-1 scale-110 overflow-hidden opacity-75"
      style={{
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        position: 'absolute',
        zIndex: -1,
        opacity: props.camera ? 0.75 : 1,
        transform: [{ scale: 1.1 }], // needs this on "Get data plan" page to avoid some 0.2 pixel underflow issue
      }}>
      <Rect x={0} y={0} width={width} height={70}>
        <LinearGradient start={vec(0, 0)} end={vec(width, 0)} colors={colors} />
      </Rect>
    </Canvas>
  );

  return <ButtonBase {...props} renderBackground={renderBackground} />;
};
