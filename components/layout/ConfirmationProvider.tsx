import { useState, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { SuccessAnimation } from 'assets/icons/SuccessIcon';
import { memoizedGetTheme } from 'helper/redux/settings';

const withConfirmation = (WrappedComponent) => {
  return (props) => {
    const theme = useSelector(memoizedGetTheme);
    const styles = createStyles(theme);
    const [showConfirmationState, setShowConfirmationState] = useState(false);
    const [params, setParams] = useState();
    const showConfirmation = useCallback((p) => {
      setShowConfirmationState(true);
      setParams(p);
    }, []);

    return (
      <View style={{ flex: 1 }}>
        <WrappedComponent {...props} showConfirmation={showConfirmation} />
        {showConfirmationState && params && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100%',
              height: '100%',
              zIndex: 9999, // Highest z-index
            }}>
            <SuccessAnimation params={params} />
          </View>
        )}
      </View>
    );
  };
};

const createStyles = (theme) => StyleSheet.create({});

export default withConfirmation;
