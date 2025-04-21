import { runWithAnimationFrame } from 'app/onboard/new';
import { useRef } from 'react';
import { TouchableOpacity as TO } from 'react-native';

export const TouchableOpacity = ({ onPress, onPressIn, onPressOut, ...props }) => {
  const _touchActivatePositionRef = useRef(null);

  function _onPressIn(e) {
    const { pageX, pageY } = e.nativeEvent;

    _touchActivatePositionRef.current = {
      pageX,
      pageY,
    };

    onPressIn?.(e);
  }

  function _onPress(e) {
    const { pageX, pageY } = e.nativeEvent;

    const absX = Math.abs(_touchActivatePositionRef.current.pageX - pageX);
    const absY = Math.abs(_touchActivatePositionRef.current.pageY - pageY);

    const dragged = absX > 1 || absY > 1;
    if (!dragged) {
      runWithAnimationFrame(onPress, () => {})(e);
    }
  }

  return (
    <TO onPressIn={_onPressIn} onPress={_onPress} onPressOut={onPressOut} {...props}>
      {props.children}
    </TO>
  );
};
