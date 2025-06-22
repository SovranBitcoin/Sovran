import React, { useState } from 'react';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { View, Text, SafeAreaView, StatusBar, StyleSheet, Dimensions } from 'react-native';

const Calculator = () => {
  const [display, setDisplay] = useState('0');
  const [calculation, setCalculation] = useState('');
  const [operatorPressed, setOperatorPressed] = useState(false);
  const [equalsPressed, setEqualsPressed] = useState(false);

  const handleNumberPress = (num) => {
    if (display === '0' || operatorPressed || equalsPressed) {
      setDisplay(num);
      setOperatorPressed(false);
      setEqualsPressed(false);
    } else {
      setDisplay(display + num);
    }
  };

  const handleOperatorPress = (operator) => {
    setCalculation(`${display}${operator}`);
    setOperatorPressed(true);
    setEqualsPressed(false);
  };

  const handleEquals = () => {
    try {
      // Extract number from calculation string (removing the operator)
      const firstNum = parseFloat(calculation.slice(0, -1));
      const secondNum = parseFloat(display);
      const operator = calculation.slice(-1);

      let result;
      switch (operator) {
        case '+':
          result = firstNum + secondNum;
          break;
        case '-':
          result = firstNum - secondNum;
          break;
        case '×':
          result = firstNum * secondNum;
          break;
        case '÷':
          result = firstNum / secondNum;
          break;
        default:
          result = 0;
      }

      // Format the result
      if (Number.isInteger(result)) {
        setDisplay(result.toString());
      } else {
        // Show decimal result with up to 10 decimal places (like iOS)
        setDisplay(result.toFixed(10).replace(/\.?0+$/, ''));
      }

      // Show calculation above the result
      setCalculation(`${firstNum}${operator}${secondNum}=`);
      setEqualsPressed(true);
    } catch (e) {
      setDisplay('Error');
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setCalculation('');
    setOperatorPressed(false);
    setEqualsPressed(false);
  };

  const handlePercent = () => {
    const num = parseFloat(display);
    setDisplay((num / 100).toString());
  };

  const handlePlusMinus = () => {
    setDisplay((parseFloat(display) * -1).toString());
  };

  const handleDecimal = () => {
    if (!display.includes('.')) {
      setDisplay(display + '.');
    }
  };

  // Calculate button dimensions based on screen width to maintain proportions
  const screen = Dimensions.get('window');
  const buttonSize = (screen.width - 50) / 4; // We'll keep this for reference but use fixed values in styles

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.displayContainer}>
        {calculation ? <Text style={styles.calculationText}>{calculation}</Text> : null}
        <Text style={styles.displayText} numberOfLines={1} adjustsFontSizeToFit>
          {display}
        </Text>
      </View>

      <View style={styles.buttonsContainer}>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.button, styles.functionButton]} onPress={handleClear}>
            <Text style={styles.buttonText}>AC</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.functionButton]}
            onPress={handlePlusMinus}>
            <Text style={styles.buttonText}>+/-</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.functionButton]} onPress={handlePercent}>
            <Text style={styles.buttonText}>%</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.operatorButton]}
            onPress={() => handleOperatorPress('÷')}>
            <Text style={styles.buttonText}>÷</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('7')}>
            <Text style={styles.buttonText}>7</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('8')}>
            <Text style={styles.buttonText}>8</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('9')}>
            <Text style={styles.buttonText}>9</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.operatorButton]}
            onPress={() => handleOperatorPress('×')}>
            <Text style={styles.buttonText}>×</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('4')}>
            <Text style={styles.buttonText}>4</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('5')}>
            <Text style={styles.buttonText}>5</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('6')}>
            <Text style={styles.buttonText}>6</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.operatorButton]}
            onPress={() => handleOperatorPress('-')}>
            <Text style={styles.buttonText}>−</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('1')}>
            <Text style={styles.buttonText}>1</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('2')}>
            <Text style={styles.buttonText}>2</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.numberButton]}
            onPress={() => handleNumberPress('3')}>
            <Text style={styles.buttonText}>3</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.operatorButton]}
            onPress={() => handleOperatorPress('+')}>
            <Text style={styles.buttonText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.numberButton, styles.zeroButton]}
            onPress={() => handleNumberPress('0')}>
            <Text style={[styles.buttonText, styles.zeroText]}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.numberButton]} onPress={handleDecimal}>
            <Text style={styles.buttonText}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.operatorButton]} onPress={handleEquals}>
            <Text style={styles.buttonText}>=</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'flex-end',
  },
  displayContainer: {
    padding: 20,
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  calculationText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 30,
    marginBottom: 10,
    fontFamily: 'System',
  },
  displayText: {
    color: 'white',
    fontSize: 80,
    fontWeight: '200',
    fontFamily: 'System',
  },
  buttonsContainer: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    marginHorizontal: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  button: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 3,
  },
  numberButton: {
    backgroundColor: '#333333',
  },
  functionButton: {
    backgroundColor: '#A5A5A5',
  },
  operatorButton: {
    backgroundColor: '#FF9F0A',
  },
  buttonText: {
    color: 'white',
    fontSize: 34,
    fontWeight: '400',
    fontFamily: 'System',
  },
  zeroButton: {
    width: 150,
    alignItems: 'flex-start',
    paddingLeft: 28,
    marginRight: 3,
  },
  zeroText: {
    textAlign: 'left',
  },
});

export default Calculator;
