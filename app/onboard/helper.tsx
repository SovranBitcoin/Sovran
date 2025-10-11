const calculatePosition = (index: number) => {
  const basePosition = 0;
  const maxOffset = 1000;
  const decayFactor = 0.1;
  return (
    basePosition + maxOffset * Math.sign(index) * (1 - Math.exp(-Math.abs(index) * decayFactor))
  );
};

const calculateSize = (index: number) => {
  const baseSize = 1;
  const minSize = 0.1;
  const decayFactor = 0.2;
  const reductionFactor = Math.exp(-Math.abs(index) * decayFactor);
  return minSize + (baseSize - minSize) * reductionFactor;
};

const calculateOpacity = (index: number) => {
  const baseOpacity = 1;
  const minOpacity = 0.1;
  const decayFactor = 0.5;
  const reductionFactor = Math.exp(-Math.abs(index) * decayFactor);
  return minOpacity + (baseOpacity - minOpacity) * reductionFactor;
};

export { calculatePosition, calculateSize, calculateOpacity };
