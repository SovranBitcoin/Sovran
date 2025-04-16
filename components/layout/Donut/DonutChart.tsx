import { StyleSheet } from "react-native";
import { SharedValue, useDerivedValue } from "react-native-reanimated";
import { Canvas, Path, SkFont, Skia, Text } from "@shopify/react-native-skia";
import { DonutPath } from "./DonutPath";
import { View } from "components/common/Themed";
import { greens, greys } from "helper/colors";
import { useSelector } from "react-redux";
import { memoizedGetTheme } from "helper/redux/settings";

type Props = {
  n: number;
  gap: number;
  radius: number;
  strokeWidth: number;
  outerStrokeWidth: number;
  decimals: SharedValue<number[]>;
  colors: string[];
  totalValue: SharedValue<number>;
  font: SkFont;
  smallFont: SkFont;
  titleText?: string;
  totalValueSuffix?: string;
};

const DonutChart = ({
  chartData,
  n,
  gap,
  decimals,
  colors,
  totalValue,
  strokeWidth,
  outerStrokeWidth,
  radius,
  font,
  smallFont,
  titleText = "Total balance",
  totalValueSuffix = "sats",
  isSpecialCase = false,
}: Props) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const array = Array.from({ length: n });
  const innerRadius = radius - outerStrokeWidth / 2;

  const path = Skia.Path.Make();
  path.addCircle(radius, radius, innerRadius);

  const targetText = useDerivedValue(() => {
    const remaining =
      chartData.find((item) => item.label === "Remaining")?.amount || 0;
    const used = chartData.find((item) => item.label === "Used")?.amount || 0;
    return isSpecialCase
      ? `${used} GB`
      : `${Math.round(totalValue.value)} ${totalValueSuffix}`;
  }, [chartData, isSpecialCase]);

  const targetText2 = useDerivedValue(() => {
    const remaining =
      chartData.find((item) => item.label === "Remaining")?.amount || 0;
    const used = chartData.find((item) => item.label === "Used")?.amount || 0;
    return isSpecialCase
      ? `/ ${remaining} GB`
      : `${Math.round(totalValue.value)} ${totalValueSuffix}`;
  }, [chartData, isSpecialCase]);

  const fontSize = font.measureText("$00");
  const smallFontSize = smallFont.measureText("$00");

  const titleTextWidth = smallFont.measureText(titleText).width;

  const textX = useDerivedValue(() => {
    const _fontSize = font.measureText(targetText.value);
    return radius - _fontSize.width / 2;
  }, []);

  const textX2 = useDerivedValue(() => {
    const _fontSize = smallFont.measureText(targetText2.value);
    return radius - _fontSize.width / 2;
  }, []);

  return (
    <View style={styles.container}>
      <Canvas style={styles.container}>
        <Path
          path={path}
          color={greys(theme)[2300]}
          style="stroke"
          strokeJoin="round"
          strokeWidth={outerStrokeWidth}
          strokeCap="round"
          start={0}
          end={1}
        />
        {array.map((_, index) => {
          // Exclude the "Used" segment if isSpecialCase is true
          const shouldRenderPath =
            !isSpecialCase || chartData[index]?.label !== "Used";

          if (shouldRenderPath) {
            return (
              <DonutPath
                key={index}
                radius={radius}
                strokeWidth={strokeWidth}
                outerStrokeWidth={outerStrokeWidth}
                color={isSpecialCase ? greens[300] : colors[index]}
                decimals={decimals}
                index={index}
                gap={gap}
              />
            );
          }
          return null; // Skip rendering for "Used"
        })}
        <Text
          x={radius - titleTextWidth / 2}
          y={radius - fontSize.height / 1.5}
          text={titleText}
          font={smallFont}
          color={greys(theme)[0]}
        />
        <Text
          x={textX}
          y={radius + fontSize.height / 2}
          text={targetText}
          font={font}
          color={greys(theme)[0]}
        />
        {isSpecialCase && (
          <Text
            x={textX2}
            y={radius + smallFontSize.height / 0.425}
            text={targetText2}
            font={smallFont}
            color={greys(theme)[100]}
          />
        )}
      </Canvas>
    </View>
  );
};

export default DonutChart;

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
    },
  });
