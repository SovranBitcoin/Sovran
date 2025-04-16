import { LinearGradient } from "expo-linear-gradient"; // Install if not already
import { ButtonBase } from "./ButtonBase";

export const Button = (props) => {
  const renderBackground = (colors, width) => (
    <LinearGradient
      colors={colors}
      start={[0, 0]}
      end={[1, 0]}
      style={{
        width: "100%",
        height: 100,
        flex: 1,
        position: "absolute",
        zIndex: -1,
        overflow: "hidden",
        opacity: props.camera ? 0.75 : 1,
      }}
    />
  );

  return <ButtonBase {...props} renderBackground={renderBackground} />;
};
