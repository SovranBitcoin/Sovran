import { StyleSheet, View } from 'react-native';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import CreditCardComponent from 'components/common/NFCCard';
import Swiper from 'react-native-web-infinite-swiper';
import { withSheetProvider } from 'components/hocs/withSheetProvider';

const TabTwoScreen = () => {
  const theme = useSelector((state: any) => state.settings?.settings?.theme);
  const styles = createStyles(theme);
  return null;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: greys(theme)[1500],
      }}>
      <View className="bg-transparent">
        <View style={{ height: 500 }}>
          <Swiper
            controlsEnabled={false}
            // loop
            // infinite
            from={0}
            minDistanceForAction={0.1}
            slideWrapperStyle={
              {
                // padding: 32,
              }
            }
            controlsProps={{
              dotsTouchable: true,
              dotsPos: 'top',
            }}>
            {[1, 2].map((acc, index) => (
              <View
                style={{
                  flex: 1,
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                  backgroundColor: greys(theme)[1500],
                  marginTop: 32,
                }}>
                <CreditCardComponent />
              </View>
            ))}
          </Swiper>
        </View>
      </View>
    </View>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      backgroundColor: greys(theme)[2300],
      flex: 1,
      padding: 16,
    },
    scrollContainer: {
      marginTop: 8,
    },
    eventCard: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 8,
      padding: 8,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: greys(theme)[1500],
    },
    eventContent: {
      color: greys(theme)[0],
      fontSize: 16,
      marginBottom: 8,
    },
    eventDate: {
      color: greys(theme)[400],
      fontSize: 12,
    },
    loadingText: {
      color: greys(theme)[0],
      fontSize: 16,
      textAlign: 'center',
      marginTop: 20,
    },
    reactionCount: {
      color: greys(theme)[200],
      fontSize: 14,
      marginBottom: 8,
      marginTop: 12,
    },
    reactionCard: {
      backgroundColor: greys(theme)[1800],
      borderRadius: 50,
      padding: 8,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
      borderWidth: 1,
      borderColor: greys(theme)[1500],
    },
    reactionContent: {
      flexDirection: 'row',
    },
    reactionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
      paddingLeft: 6,
    },
    profilePictureWrapper: {
      position: 'relative',
    },
    overlappingProfile: {
      marginLeft: -12, // Adjust this value for the amount of overlap
    },
    profilePicture: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2, // Optional: Add a border for better visibility
      borderColor: greys(theme)[1000],
    },
    moreCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: greys(theme)[1500],
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: greys(theme)[1000],
    },
    moreText: {
      color: greys(theme)[0],
      fontSize: 14,
      fontWeight: 'bold',
    },
  });

export default withSheetProvider(TabTwoScreen);
