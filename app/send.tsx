import React from "react";
import EcashLightningSender from "components/layout/EcashLightningSender";
import { View } from "components/common/Themed";
import { useSelector } from "react-redux";
import { greys } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";
import { useTypedRoute } from "helper/navigation";

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const { unit, type } = useTypedRoute<"send">();

  if (type === "ecash" || type === "lightning") {
    return (
      <>
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            backgroundColor: greys(theme)[2300],
          }}
        >
          <EcashLightningSender unit={unit} type={type} />
        </View>
      </>
    );
  }

  return <></>;
}

export default ModalScreen;
