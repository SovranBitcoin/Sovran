import React, { useState } from "react";
import { shades } from "helper/colors"; // Import colors as needed for styling
import TextInputBase from "./TextInputBase";

const WebInput = React.forwardRef(
  ({ style, value, onChange, placeholderTextColor, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false); // Track focus state for custom styles

    const flattenedStyle = Array.isArray(style)
      ? Object.assign({}, ...style)
      : style;

    return (
      <input
        ref={ref}
        type="text"
        style={{
          ...flattenedStyle,
          outline: "none", // Remove default outline
          ...(isFocused && {
            boxShadow: `0 0 0 0.1px ${shades[500]}, 0 0 10px ${shades[500]}`, // Updated focus style with a softer glow
            borderColor: shades[500], // Adjust border color on focus
          }),
          "::placeholder": {
            color: placeholderTextColor,
          },
        }}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        {...props}
      />
    );
  }
);

const TextInput = ({ value: initialValue, onChangeText, ...props }) => {
  const [value, setValue] = useState(initialValue || "");

  const handleChange = (text) => {
    setValue(text);
    onChangeText && onChangeText(text);
  };

  return (
    <TextInputBase
      {...props}
      Component={WebInput}
      value={value}
      onChange={handleChange}
    />
  );
};

export default TextInput;
